"""
Cascade FastAPI application.

Routes:
    GET  /health             — liveness + dependency status
    GET  /events             — paginated event feed
    GET  /events/{id}        — single event by id
    POST /search             — hybrid vector + text search (rerank-2.5)
    POST /cascade            — build cascade via $graphLookup + rerank
    GET  /cascade/{id}       — fetch a persisted cascade
    GET  /stats              — $facet dashboard counts
    GET  /watchlist/{user}   — read watchlist
    POST /watchlist          — upsert watchlist
    GET  /stream             — Server-Sent Events backed by change streams
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from sse_starlette.sse import EventSourceResponse

from agent.tools import aggregate_stats
from api.cascade import router as cascade_router
from api.deps import DB_NAME, get_db
from api.models import (
    EventList,
    EventOut,
    HealthResponse,
    StatsResponse,
    WatchlistItem,
)
from api.search import router as search_router
from api.sse import sse_event_generator, start_watcher, stop_watcher

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","name":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("cascade.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open Motor + start change-stream watcher; tear down on shutdown."""
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI not set")

    client = AsyncIOMotorClient(
        uri,
        maxPoolSize=10,
        serverSelectionTimeoutMS=5000,
        appname="cascade-api",
    )
    await client.admin.command("ping")
    app.state.mongo = client
    app.state.db = client[DB_NAME]

    # Best-effort: change streams require a replica set. Atlas M0 is one.
    try:
        await start_watcher(app.state.db)
    except Exception as e:
        log.warning("change-stream watcher failed to start: %s", e)

    try:
        yield
    finally:
        await stop_watcher()
        client.close()


app = FastAPI(
    title="Cascade API",
    description="Real-time market cascade intelligence.",
    version="0.5.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tightened to https://*.vercel.app + localhost in Phase 7
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search_router, tags=["search"])
app.include_router(cascade_router, tags=["cascade"])


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
async def health(db: AsyncIOMotorDatabase = Depends(get_db)) -> HealthResponse:
    mongo_ok = "ok"
    events_24h = 0
    try:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        events_24h = await db.events.count_documents({"published_at": {"$gte": since}})
    except Exception as e:
        mongo_ok = f"error: {e}"

    voyage_ok = "configured" if os.environ.get("VOYAGE_API_KEY") else "missing"
    gemini_model = os.environ.get("GEMINI_MODEL", "unset")

    return HealthResponse(
        ok=(mongo_ok == "ok"),
        mongo=mongo_ok,
        voyage=voyage_ok,
        gemini_model=gemini_model,
        events_24h=events_24h,
    )


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

_HTML_TAGS = re.compile(r"<[^>]+>")


def derive_headline(doc: dict) -> str:
    """
    Workers don't all populate `headline` — derive it from the first
    meaningful line of `text` when the field is missing. Strips HTML so
    SEC EDGAR feed entries (which contain `<b>Filed:</b>` etc) read cleanly.
    """
    h = (doc.get("headline") or "").strip()
    if h:
        return h
    text = (doc.get("text") or "").strip()
    if not text:
        return ""
    first = text.split("\n", 1)[0]
    first = _HTML_TAGS.sub("", first).strip()
    return first[:200]


def _serialize_event(doc: dict) -> EventOut:
    return EventOut(
        id=str(doc.get("_id", "")),
        headline=derive_headline(doc),
        text=doc.get("text", "") or "",
        tickers=doc.get("tickers", []) or [],
        entities=doc.get("entities", []) or [],
        sector=doc.get("sector", "") or "",
        impact=doc.get("impact", "") or "",
        source_type=doc.get("source_type", "") or "",
        source_url=doc.get("source_url") or doc.get("url") or "",
        published_at=doc.get("published_at"),
        ingested_at=doc.get("ingested_at"),
    )


@app.get("/events", response_model=EventList)
async def list_events(
    ticker: str = "",
    sector: str = "",
    impact: str = "",
    hours_back: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> EventList:
    since = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    q: dict = {"published_at": {"$gte": since}}
    if ticker:
        q["tickers"] = ticker.upper()
    if sector:
        q["sector"] = sector
    if impact:
        q["impact"] = impact

    cursor = db.events.find(q).sort("published_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    events = [_serialize_event(d) for d in docs]
    return EventList(events=events, count=len(events))


@app.get("/events/{event_id}", response_model=EventOut)
async def get_event(event_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> EventOut:
    try:
        oid = ObjectId(event_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="invalid event id")

    doc = await db.events.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="event not found")
    return _serialize_event(doc)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.get("/stats", response_model=StatsResponse)
async def stats(
    sector: str = "",
    hours_back: int = Query(default=24, ge=1, le=168),
) -> StatsResponse:
    result = await aggregate_stats(sector=sector, hours_back=hours_back)
    return StatsResponse(**result)


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

@app.get("/watchlist/{user_id}", response_model=WatchlistItem)
async def get_watchlist(
    user_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> WatchlistItem:
    doc = await db.watchlists.find_one({"user_id": user_id})
    if not doc:
        return WatchlistItem(user_id=user_id, tickers=[])
    return WatchlistItem(user_id=user_id, tickers=doc.get("tickers", []))


@app.post("/watchlist", response_model=WatchlistItem)
async def upsert_watchlist(
    item: WatchlistItem,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> WatchlistItem:
    tickers = [t.upper() for t in item.tickers if t]
    await db.watchlists.update_one(
        {"user_id": item.user_id},
        {
            "$set": {"tickers": tickers, "updated_at": datetime.now(timezone.utc)},
            "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    return WatchlistItem(user_id=item.user_id, tickers=tickers)


# ---------------------------------------------------------------------------
# Server-Sent Events — backed by MongoDB change streams
# ---------------------------------------------------------------------------

@app.get("/stream")
async def stream(request: Request) -> EventSourceResponse:
    return EventSourceResponse(sse_event_generator(request))
