"""
/search route — hybrid $vectorSearch + $search + Voyage rerank-2.5.

Thin HTTP wrapper around agent.tools.search_events so the same logic is
reachable both as an agent tool and as a public REST endpoint.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from agent.tools import search_events
from api.models import SearchHit, SearchRequest, SearchResponse

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def post_search(req: SearchRequest) -> SearchResponse:
    try:
        result = await search_events(
            query=req.query,
            sector=req.sector,
            impact=req.impact,
            days_back=req.days_back,
            limit=req.limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"search failed: {e}")

    return SearchResponse(
        query=req.query,
        events=[SearchHit(**hit) for hit in result.get("events", [])],
        count=result.get("count", 0),
    )
