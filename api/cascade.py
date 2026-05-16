"""
/cascade routes — build and fetch supply-chain cascade trees.

POST /cascade
    body: {event_id, max_hops, top_k}
    runs build_cascade ($graphLookup + rerank-2.5). The Gemini-synthesised
    narrative ("summary") is cached in the cascades collection keyed by
    raw_event_id; on cache hit (<24h old) we return it inline. On miss we
    return the cascade immediately and kick off synthesis in the background.

GET /cascade/{id}
    returns a previously-synthesised cascade by its Mongo ObjectId.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from agent.cascade_reasoning import synthesize_cascade
from agent.tools import build_cascade
from api.deps import get_db
from api.models import CascadeRequest, CascadeResponse

router = APIRouter()
log = logging.getLogger(__name__)

CACHE_TTL_HOURS = 24


async def _synth_and_persist(raw: dict, event_id: str, db: AsyncIOMotorDatabase) -> None:
    """Background task — synth + persist. Failure is non-fatal and logged."""
    try:
        synth = await synthesize_cascade(raw)
        await db.cascades.insert_one({
            **synth,
            "raw_event_id": event_id,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:
        log.warning("background cascade synthesis failed: %s", e)


@router.post("/cascade", response_model=CascadeResponse)
async def post_cascade(
    req: CascadeRequest,
    background: BackgroundTasks,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> CascadeResponse:
    try:
        raw = await build_cascade(
            event_id=req.event_id,
            max_hops=req.max_hops,
            top_k=req.top_k,
        )
    except Exception as e:
        log.exception("build_cascade failed")
        raise HTTPException(status_code=500, detail=f"build_cascade failed: {e}")

    if "error" in raw:
        raise HTTPException(status_code=404, detail=raw["error"])

    # Cache check: any narrative synthesised in the last 24h for this event?
    since = datetime.now(timezone.utc) - timedelta(hours=CACHE_TTL_HOURS)
    cached = await db.cascades.find_one(
        {"raw_event_id": req.event_id, "created_at": {"$gte": since}},
        sort=[("created_at", -1)],
    )
    if cached and cached.get("summary"):
        raw["narrative"] = cached.get("summary", "")
        raw["severity"] = cached.get("severity", "")
    else:
        # Cache miss → fire-and-forget background synth. The next call within
        # 24h will pick up the cached narrative.
        background.add_task(_synth_and_persist, raw, req.event_id, db)

    return CascadeResponse(**raw)


@router.get("/cascade/{cascade_id}")
async def get_cascade(
    cascade_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    try:
        oid = ObjectId(cascade_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="invalid cascade id")

    doc = await db.cascades.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="cascade not found")
    doc["id"] = str(doc.pop("_id"))
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


@router.get("/cascade/by-event/{event_id}/narrative")
async def get_narrative(
    event_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Poll for the Gemini narrative — frontend can refetch shortly after
    the initial /cascade call to pick up the synthesised summary."""
    since = datetime.now(timezone.utc) - timedelta(hours=CACHE_TTL_HOURS)
    doc = await db.cascades.find_one(
        {"raw_event_id": event_id, "created_at": {"$gte": since}},
        sort=[("created_at", -1)],
    )
    if not doc:
        return {"ready": False}
    return {
        "ready": True,
        "narrative": doc.get("summary", ""),
        "severity": doc.get("severity", ""),
        "risk_factors": doc.get("risk_factors", []),
        "confidence": doc.get("confidence", 0),
    }
