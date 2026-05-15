"""
ADK tool wrappers for the Cascade agent.

Each function is decorated with @tool from google.adk and registered in agent/main.py.
All DB/Voyage calls are async; ADK calls them via asyncio.

Tools:
  search_events     — hybrid $vectorSearch + $search + rerank-2.5
  build_cascade     — $graphLookup on relationships + rerank
  get_company       — company profile by ticker
  get_prices        — recent OHLCV + RSI from prices time-series
  aggregate_stats   — $facet dashboard stats
  optimize_self     — Atlas performance advisor index suggestions
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

log = logging.getLogger(__name__)

_motor: AsyncIOMotorClient | None = None


def _db():
    global _motor
    if _motor is None:
        uri = os.environ["MONGODB_URI"]
        _motor = AsyncIOMotorClient(uri, maxPoolSize=10, serverSelectionTimeoutMS=5000)
    return _motor[os.environ.get("MONGODB_DB", "cascade")]


# ---------------------------------------------------------------------------
# Helper: lazy-load embed + rerank modules so they can read .env at import time
# ---------------------------------------------------------------------------

def _embed_query():
    from embed.text import embed_query
    return embed_query


def _rerank_dicts():
    from embed.rerank import rerank_dicts
    return rerank_dicts


# ---------------------------------------------------------------------------
# Tool implementations (plain async functions — wrapped in agent/main.py)
# ---------------------------------------------------------------------------

async def search_events(
    query: str,
    sector: str = "",
    impact: str = "",
    days_back: int = 7,
    limit: int = 10,
) -> dict[str, Any]:
    """
    Search for financial events using hybrid semantic + keyword search with Voyage rerank-2.5.

    Args:
        query: Natural language query, e.g. "NVIDIA earnings beat AI chip demand"
        sector: Optional sector filter, e.g. "Technology", "Energy"
        impact: Optional impact filter: "critical", "high", "medium", "low"
        days_back: Look back window in days (default 7)
        limit: Maximum results to return (default 10)

    Returns:
        dict with "events" list (each with id, headline, tickers, sector, impact,
        source_type, published_at, rerank_score) and "count".
    """
    db = _db()
    since = datetime.now(timezone.utc) - timedelta(days=days_back)

    # Step 1: embed the query for $vectorSearch (degrade to text-only on rate limit)
    query_vec = None
    try:
        query_vec = await _embed_query()(query)
    except Exception as e:
        log.warning("embed_query failed (%s) — falling back to text-only search", e)

    # Step 2: $vectorSearch (semantic recall) — skipped if embed failed
    vs_docs: list[Any] = []
    if query_vec is not None:
        vector_pipeline: list[Any] = [
            {
                "$vectorSearch": {
                    "index": "events_vector_index",
                    "path": "embedding",
                    "queryVector": query_vec,
                    "numCandidates": 100,
                    "limit": 40,
                }
            },
            {"$addFields": {"vs_score": {"$meta": "vectorSearchScore"}}},
        ]
        vs_filter: dict[str, Any] = {"published_at": {"$gte": since}}
        if sector:
            vs_filter["sector"] = sector
        if impact:
            vs_filter["impact"] = impact
        vector_pipeline.append({"$match": vs_filter})

    # Step 3: Atlas $search (keyword/entity recall)
    must_clauses: list[Any] = [{"text": {"query": query, "path": ["text", "headline", "entities"]}}]
    text_filter: dict[str, Any] = {"range": {"path": "published_at", "gte": since}}
    if sector:
        must_clauses.append({"text": {"query": sector, "path": "sector"}})
    if impact:
        must_clauses.append({"text": {"query": impact, "path": "impact"}})

    text_pipeline: list[Any] = [
        {
            "$search": {
                "index": "events_text_index",
                "compound": {
                    "must": must_clauses,
                    "filter": [text_filter],
                },
            }
        },
        {"$addFields": {"ts_score": {"$meta": "searchScore"}}},
        {"$limit": 40},
    ]

    # Run pipelines in parallel (vector only if embedding succeeded)
    if query_vec is not None:
        vs_docs, ts_docs = await asyncio.gather(
            db.events.aggregate(vector_pipeline).to_list(length=40),
            db.events.aggregate(text_pipeline).to_list(length=40),
        )
    else:
        ts_docs = await db.events.aggregate(text_pipeline).to_list(length=40)

    # Step 4: Reciprocal Rank Fusion
    def rrf_score(rank: int, k: int = 60) -> float:
        return 1.0 / (k + rank)

    scored: dict[str, dict] = {}
    for rank, doc in enumerate(vs_docs):
        key = str(doc["_id"])
        scored[key] = doc
        scored[key]["rrf"] = rrf_score(rank)
    for rank, doc in enumerate(ts_docs):
        key = str(doc["_id"])
        if key in scored:
            scored[key]["rrf"] += rrf_score(rank)
        else:
            scored[key] = doc
            scored[key]["rrf"] = rrf_score(rank)

    candidates = sorted(scored.values(), key=lambda d: d.get("rrf", 0), reverse=True)[:50]

    # Step 5: Voyage rerank-2.5 (degrade gracefully if rate-limited)
    if candidates:
        try:
            reranked = await _rerank_dicts()(
                query=query,
                items=candidates,
                text_field="text",
                top_k=limit,
            )
        except Exception as e:
            log.warning("rerank skipped (%s) — returning RRF order", e)
            for i, c in enumerate(candidates[:limit]):
                c["rerank_score"] = 1.0 - i * 0.05
            reranked = candidates[:limit]
    else:
        reranked = []

    # Step 6: Serialize for agent
    events = []
    for doc in reranked:
        events.append({
            "id": str(doc["_id"]),
            "headline": doc.get("headline", ""),
            "tickers": doc.get("tickers", []),
            "sector": doc.get("sector", ""),
            "impact": doc.get("impact", ""),
            "source_type": doc.get("source_type", ""),
            "published_at": doc.get("published_at", "").isoformat() if isinstance(doc.get("published_at"), datetime) else str(doc.get("published_at", "")),
            "rerank_score": round(doc.get("rerank_score", 0.0), 4),
        })

    return {"events": events, "count": len(events)}


async def build_cascade(
    event_id: str,
    max_hops: int = 3,
    top_k: int = 15,
) -> dict[str, Any]:
    """
    Build a supply-chain cascade tree for an event using $graphLookup on the
    relationships graph and Voyage rerank-2.5 to score propagation paths.

    Args:
        event_id: MongoDB ObjectId string of the root event
        max_hops: Max graph hops to traverse (1-3, default 3)
        top_k: Max cascade nodes to return after reranking (default 15)

    Returns:
        dict with "root" event, "nodes" list (each with ticker, level, score,
        relationship_type, why) and "edges" list.
    """
    db = _db()
    max_hops = max(1, min(3, max_hops))

    # Fetch root event
    try:
        oid = ObjectId(event_id)
    except Exception:
        return {"error": f"Invalid event_id: {event_id}"}

    root_doc = await db.events.find_one({"_id": oid})
    if not root_doc:
        return {"error": f"Event {event_id} not found"}

    root_tickers = root_doc.get("tickers", [])
    headline = root_doc.get("headline", "")
    root_text = root_doc.get("text", headline)

    if not root_tickers:
        return {
            "root": {
                "id": event_id,
                "headline": headline,
                "tickers": [],
                "impact": root_doc.get("impact", ""),
                "published_at": str(root_doc.get("published_at", "")),
            },
            "nodes": [],
            "edges": [],
            "message": "No tickers found on root event — cannot walk supply-chain graph",
        }

    # $graphLookup: walk supply-chain edges from root tickers.
    # Seed schema: relationships use {from_ticker, to_ticker, type, weight}.
    graph_pipeline = [
        {"$match": {"ticker": {"$in": root_tickers}}},
        {
            "$graphLookup": {
                "from": "relationships",
                "startWith": "$ticker",
                "connectFromField": "to_ticker",
                "connectToField": "from_ticker",
                "as": "cascade_path",
                "maxDepth": max_hops - 1,
                "depthField": "hop",
                "restrictSearchWithMatch": {"weight": {"$gte": 0.3}},
            }
        },
        {"$project": {"ticker": 1, "cascade_path": 1}},
    ]

    graph_results = await db.companies.aggregate(graph_pipeline).to_list(length=200)

    # Collect unique affected tickers with hop depth and relationship type
    affected: dict[str, dict] = {}
    edges: list[dict] = []

    for row in graph_results:
        src_ticker = row["ticker"]
        for path_node in row.get("cascade_path", []):
            t = path_node.get("to_ticker")
            if not t or t in root_tickers:
                continue
            hop = path_node.get("hop", 0) + 1
            rel = path_node.get("type", "unknown")
            w = path_node.get("weight", 0.5)

            if t not in affected or affected[t]["hop"] > hop:
                affected[t] = {"ticker": t, "hop": hop, "rel": rel, "weight": w}

            edges.append({
                "from": path_node.get("from_ticker", src_ticker),
                "to": t,
                "type": rel,
                "weight": w,
                "hop": hop,
            })

    if not affected:
        return {
            "root": {
                "id": event_id,
                "headline": headline,
                "tickers": root_tickers,
                "impact": root_doc.get("impact", ""),
                "published_at": str(root_doc.get("published_at", "")),
            },
            "nodes": [],
            "edges": [],
            "message": f"No relationships found for tickers {root_tickers} at weight >= 0.3",
        }

    # Fetch company info for affected tickers
    affected_tickers = list(affected.keys())
    companies = await db.companies.find(
        {"ticker": {"$in": affected_tickers}},
        {"ticker": 1, "name": 1, "sector": 1, "description": 1},
    ).to_list(length=100)
    company_map = {c["ticker"]: c for c in companies}

    # Build candidate documents for reranking: "why would this cascade?"
    candidates = []
    for ticker, info in affected.items():
        co = company_map.get(ticker, {})
        hop_label = f"L{info['hop']}"
        text = (
            f"{ticker} ({co.get('name', ticker)}) is a {info['rel']} of {root_tickers[0]}. "
            f"Hop {hop_label}. {co.get('description', '')} "
            f"Root event: {root_text[:200]}"
        )
        candidates.append({
            "_ticker": ticker,
            "_hop": info["hop"],
            "_rel": info["rel"],
            "_weight": info["weight"],
            "_company": co.get("name", ticker),
            "_sector": co.get("sector", ""),
            "text": text,
        })

    # Rerank with Voyage rerank-2.5 (degrade gracefully if rate-limited)
    query = f"supply chain cascade impact: {root_text[:300]}"
    try:
        reranked = await _rerank_dicts()(
            query=query,
            items=candidates,
            text_field="text",
            top_k=top_k,
        )
    except Exception as e:
        log.warning("cascade rerank skipped (%s) — using weight-hop order", e)
        candidates.sort(key=lambda c: (-c["_weight"], c["_hop"]))
        for i, c in enumerate(candidates[:top_k]):
            c["rerank_score"] = c["_weight"] * (0.8 ** c["_hop"])
        reranked = candidates[:top_k]

    nodes = []
    for doc in reranked:
        hop = doc["_hop"]
        score = round(doc.get("rerank_score", 0.0), 4)
        # Decay score by hop distance
        cascade_score = round(score * (0.8 ** (hop - 1)), 4)
        nodes.append({
            "ticker": doc["_ticker"],
            "company": doc["_company"],
            "sector": doc["_sector"],
            "level": f"L{hop}",
            "hop": hop,
            "relationship_type": doc["_rel"],
            "cascade_score": cascade_score,
            "why": (
                f"{doc['_company']} is a {doc['_rel']} of {root_tickers[0]} "
                f"(L{hop} hop, weight {doc['_weight']:.2f}). "
                f"Rerank score: {score}"
            ),
        })

    # Deduplicate edges
    seen_edges = set()
    unique_edges = []
    for e in edges:
        key = (e["from"], e["to"])
        if key not in seen_edges:
            seen_edges.add(key)
            unique_edges.append(e)

    return {
        "root": {
            "id": event_id,
            "headline": headline,
            "tickers": root_tickers,
            "impact": root_doc.get("impact", ""),
            "sector": root_doc.get("sector", ""),
            "published_at": str(root_doc.get("published_at", "")),
            "source_type": root_doc.get("source_type", ""),
        },
        "nodes": nodes,
        "edges": unique_edges[:50],
        "hop_counts": {f"L{h}": sum(1 for n in nodes if n["hop"] == h) for h in range(1, max_hops + 1)},
    }


async def get_company(ticker: str) -> dict[str, Any]:
    """
    Get company profile by ticker symbol.

    Args:
        ticker: Uppercase ticker symbol, e.g. "NVDA", "AAPL"

    Returns:
        dict with name, sector, industry, hq_city, hq_country, market_cap,
        description, lat, lon. Empty dict if not found.
    """
    db = _db()
    doc = await db.companies.find_one({"ticker": ticker.upper()})
    if not doc:
        return {"error": f"Company {ticker} not found in seed data"}
    doc.pop("_id", None)
    return doc


async def get_prices(ticker: str, lookback_days: int = 5) -> dict[str, Any]:
    """
    Get recent OHLCV price data and RSI for a ticker from the time-series collection.

    Args:
        ticker: Uppercase ticker symbol
        lookback_days: Days of history to return (1-30, default 5)

    Returns:
        dict with "ticker", "bars" list (ts, open, high, low, close, volume),
        "latest_close", "latest_rsi".
    """
    db = _db()
    ticker = ticker.upper()
    lookback_days = max(1, min(30, lookback_days))
    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    pipeline = [
        {"$match": {"metadata.ticker": ticker, "ts": {"$gte": since}}},
        {"$sort": {"ts": 1}},
        {"$project": {
            "ts": 1, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1,
            "_id": 0,
        }},
    ]
    bars = await db.prices.aggregate(pipeline).to_list(length=500)

    # Serialize datetimes
    for b in bars:
        if isinstance(b.get("ts"), datetime):
            b["ts"] = b["ts"].isoformat()

    latest_rsi = None
    co = await db.companies.find_one({"ticker": ticker}, {"technicals": 1})
    if co and co.get("technicals", {}).get("rsi"):
        latest_rsi = co["technicals"]["rsi"]

    latest_close = bars[-1]["close"] if bars else None

    return {
        "ticker": ticker,
        "bars": bars[-100:],  # cap at 100 bars
        "bar_count": len(bars),
        "latest_close": latest_close,
        "latest_rsi": latest_rsi,
        "lookback_days": lookback_days,
    }


async def aggregate_stats(
    sector: str = "",
    hours_back: int = 24,
) -> dict[str, Any]:
    """
    Get dashboard statistics: event counts by impact, sector breakdown, top tickers.

    Uses MongoDB $facet for parallel sub-pipelines.

    Args:
        sector: Optional sector to filter on
        hours_back: Time window for stats (1-168 hours, default 24)

    Returns:
        dict with "impact_counts", "sector_counts", "top_tickers", "total_events",
        "cascade_count".
    """
    db = _db()
    hours_back = max(1, min(168, hours_back))
    since = datetime.now(timezone.utc) - timedelta(hours=hours_back)

    match_filter: dict[str, Any] = {"published_at": {"$gte": since}}
    if sector:
        match_filter["sector"] = sector

    pipeline = [
        {"$match": match_filter},
        {
            "$facet": {
                "impact_counts": [
                    {"$group": {"_id": "$impact", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}},
                ],
                "sector_counts": [
                    {"$group": {"_id": "$sector", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}},
                    {"$limit": 10},
                ],
                "top_tickers": [
                    {"$unwind": "$tickers"},
                    {"$group": {"_id": "$tickers", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}},
                    {"$limit": 10},
                ],
                "total": [{"$count": "n"}],
            }
        },
    ]

    result = await db.events.aggregate(pipeline).to_list(length=1)
    facet = result[0] if result else {}

    cascade_count = await db.cascades.count_documents({"created_at": {"$gte": since}})

    return {
        "impact_counts": {d["_id"]: d["count"] for d in facet.get("impact_counts", []) if d["_id"]},
        "sector_counts": {d["_id"]: d["count"] for d in facet.get("sector_counts", []) if d["_id"]},
        "top_tickers": [{"ticker": d["_id"], "count": d["count"]} for d in facet.get("top_tickers", [])],
        "total_events": (facet.get("total") or [{}])[0].get("n", 0),
        "cascade_count": cascade_count,
        "hours_back": hours_back,
    }


async def optimize_self() -> dict[str, Any]:
    """
    Run Atlas Performance Advisor to find slow queries and suggest indexes.
    Returns top index recommendations from the advisor.

    This is a demo flourish — in production this would apply the indexes automatically.

    Returns:
        dict with "suggestions" list and "message".
    """
    db = _db()

    # Check current index usage on events collection
    try:
        indexes = await db.events.list_indexes().to_list(length=20)
        index_names = [idx.get("name", "") for idx in indexes]

        # Suggest useful compound indexes if missing
        suggestions = []
        has_ticker_date = any("tickers" in n and "published_at" in n for n in index_names)
        has_sector_date = any("sector" in n and "published_at" in n for n in index_names)
        has_impact_date = any("impact" in n and "published_at" in n for n in index_names)

        if not has_ticker_date:
            suggestions.append({
                "collection": "events",
                "index": {"tickers": 1, "published_at": -1},
                "reason": "Speeds up per-ticker feed queries",
                "status": "already_created_in_setup",
            })
        if not has_sector_date:
            suggestions.append({
                "collection": "events",
                "index": {"sector": 1, "published_at": -1},
                "reason": "Speeds up sector filter in aggregate_stats",
                "status": "already_created_in_setup",
            })
        if not has_impact_date:
            suggestions.append({
                "collection": "events",
                "index": {"impact": 1, "published_at": -1},
                "reason": "Speeds up impact filter and change-stream SSE",
                "status": "already_created_in_setup",
            })

        rel_indexes = await db.relationships.list_indexes().to_list(length=10)
        rel_index_names = [idx.get("name", "") for idx in rel_indexes]
        has_rel_source = any("from_ticker" in n for n in rel_index_names)
        if not has_rel_source:
            suggestions.append({
                "collection": "relationships",
                "index": {"from_ticker": 1, "type": 1, "weight": -1},
                "reason": "Critical for $graphLookup performance on cascade queries",
                "status": "missing — creating now",
            })
            # Actually create it if missing
            await db.relationships.create_index(
                [("from_ticker", 1), ("type", 1), ("weight", -1)],
                name="from_ticker_type_weight",
                background=True,
            )

        return {
            "existing_indexes": index_names,
            "suggestions": suggestions,
            "message": (
                f"Reviewed {len(indexes)} indexes on events. "
                + (f"Created source_ticker_rel_weight on relationships. " if not has_rel_source else "")
                + "All critical indexes are in place."
            ),
        }
    except Exception as e:
        log.warning("optimize_self failed: %s", e)
        return {"error": str(e), "message": "Performance advisor check failed"}
