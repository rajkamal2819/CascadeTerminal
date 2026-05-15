"""
/cascade routes — build and fetch supply-chain cascade trees.

POST /cascade
    body: {event_id, max_hops, top_k}
    runs build_cascade ($graphLookup + rerank-2.5), persists the synthesised
    CascadeResult to the cascades collection, and returns the tree.

GET /cascade/{id}
    returns a previously-synthesised cascade by its Mongo ObjectId.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from agent.cascade_reasoning import synthesize_cascade
from agent.tools import build_cascade
from api.deps import get_db
from api.models import CascadeRequest, CascadeResponse

router = APIRouter()
log = logging.getLogger(__name__)


@router.post("/cascade", response_model=CascadeResponse)
async def post_cascade(
    req: CascadeRequest,
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

    # Best-effort synthesis + persist. Failure is non-fatal.
    try:
        synth = await synthesize_cascade(raw)
        await db.cascades.insert_one({
            **synth,
            "raw_event_id": req.event_id,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:
        log.warning("cascade synthesis/persist skipped: %s", e)

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
