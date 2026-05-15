"""
MongoDB change streams → Server-Sent Events.

A single background task tails `events` change-stream and fans out new
critical/high-impact events to every connected SSE client. Browsers see live
updates without polling.

Usage from api/main.py:
    @app.get("/stream")
    async def stream(request: Request):
        return EventSourceResponse(sse_event_generator(request))
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, AsyncIterator

from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorDatabase

log = logging.getLogger(__name__)

# In-process broadcast — one queue per connected SSE client.
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
_subscribers_lock = asyncio.Lock()

# Background change-stream task handle.
_watcher_task: asyncio.Task | None = None


_cascadable_tickers: set[str] = set()


def set_cascadable_tickers(tickers: set[str]) -> None:
    global _cascadable_tickers
    _cascadable_tickers = tickers


async def _watch_changes(db: AsyncIOMotorDatabase) -> None:
    """
    Tail the events collection change-stream and broadcast inserts to all
    SSE subscribers. Reconnects automatically on transient errors.
    """
    pipeline = [
        {
            "$match": {
                "operationType": "insert",
                "fullDocument.impact": {"$in": ["critical", "high"]},
            }
        }
    ]
    while True:
        try:
            log.info("change-stream watcher starting")
            async with db.events.watch(pipeline=pipeline, full_document="updateLookup") as stream:
                async for change in stream:
                    doc = change.get("fullDocument") or {}
                    payload = _serialize_event(doc)
                    await _broadcast(payload)
        except Exception as e:
            log.warning("change-stream watcher error (%s) — reconnecting in 5s", e)
            await asyncio.sleep(5)


_HTML_TAGS = re.compile(r"<[^>]+>")


def _derive_headline(doc: dict[str, Any]) -> str:
    h = (doc.get("headline") or "").strip()
    if h:
        return h
    text = (doc.get("text") or "").strip()
    if not text:
        return ""
    return _HTML_TAGS.sub("", text.split("\n", 1)[0]).strip()[:200]


def _serialize_event(doc: dict[str, Any]) -> dict[str, Any]:
    """Project an event doc to a JSON-safe SSE payload."""
    tickers = doc.get("tickers", []) or []
    return {
        "id": str(doc.get("_id", "")),
        "headline": _derive_headline(doc),
        "tickers": tickers,
        "sector": doc.get("sector") or "",
        "impact": doc.get("impact", ""),
        "source_type": doc.get("source_type", ""),
        "published_at": _iso(doc.get("published_at")),
        "has_cascade": bool(_cascadable_tickers and any(t in _cascadable_tickers for t in tickers)),
    }


def _iso(v: Any) -> str:
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v) if v else ""


async def _broadcast(payload: dict[str, Any]) -> None:
    """Drop the payload into every subscriber's queue (non-blocking)."""
    async with _subscribers_lock:
        dead: list[asyncio.Queue] = []
        for q in _subscribers:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            _subscribers.discard(q)


async def start_watcher(db: AsyncIOMotorDatabase) -> None:
    """Kick off the singleton change-stream watcher on app startup."""
    global _watcher_task
    if _watcher_task is None or _watcher_task.done():
        _watcher_task = asyncio.create_task(_watch_changes(db), name="events-watcher")


async def stop_watcher() -> None:
    global _watcher_task
    if _watcher_task and not _watcher_task.done():
        _watcher_task.cancel()
        try:
            await _watcher_task
        except (asyncio.CancelledError, Exception):
            pass
    _watcher_task = None


async def sse_event_generator(request: Request) -> AsyncIterator[dict[str, Any]]:
    """
    Per-client async generator. Yields sse-starlette events for every
    broadcasted change. Sends a heartbeat every 15s so proxies don't close
    the connection.
    """
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    async with _subscribers_lock:
        _subscribers.add(queue)

    # Send an initial ready event so the client knows the channel is live.
    yield {"event": "ready", "data": json.dumps({"ok": True})}

    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield {"event": "event", "data": json.dumps(payload)}
            except asyncio.TimeoutError:
                # Heartbeat keeps Cloud Run / proxies from idling us out.
                yield {"event": "ping", "data": ""}
    finally:
        async with _subscribers_lock:
            _subscribers.discard(queue)
