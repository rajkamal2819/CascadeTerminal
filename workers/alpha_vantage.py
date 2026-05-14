"""
Alpha Vantage technicals (RSI, MACD, MA50, MA200) → companies enrichment.

Free tier: 25 API calls per day. With 4 indicators per ticker that's only
6 tickers/day. We rotate through the top tickers by market cap, storing the
latest reading on the company doc as `technicals.{indicator}`.

Set ALPHA_VANTAGE_API_KEY in .env.

Run:
    python -m workers.alpha_vantage
    python -m workers.alpha_vantage --once
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from workers._common import get_db, jlog, sync_main

NAME = "alpha_vantage"
ENDPOINT = "https://www.alphavantage.co/query"

API_KEY = os.environ.get("ALPHA_VANTAGE_API_KEY", "").strip()
DAILY_CALL_BUDGET = int(os.environ.get("ALPHA_VANTAGE_DAILY_BUDGET", "20"))

# Indicators to fetch and how to read the latest value from the response.
INDICATORS: list[tuple[str, dict[str, str], str, str]] = [
    # (function, extra_params, response_key, value_field)
    ("RSI",  {"interval": "daily", "time_period": "14", "series_type": "close"}, "Technical Analysis: RSI", "RSI"),
    ("MACD", {"interval": "daily", "series_type": "close"}, "Technical Analysis: MACD", "MACD"),
    ("SMA",  {"interval": "daily", "time_period": "50",  "series_type": "close"}, "Technical Analysis: SMA", "SMA"),
    ("SMA",  {"interval": "daily", "time_period": "200", "series_type": "close"}, "Technical Analysis: SMA", "SMA"),
]
# Tag each indicator with a stable storage key.
INDICATOR_KEYS = ["rsi_14", "macd", "sma_50", "sma_200"]


@retry(
    retry=retry_if_exception_type(httpx.HTTPError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    reraise=True,
)
async def _call(client: httpx.AsyncClient, params: dict[str, str]) -> dict[str, Any]:
    resp = await client.get(ENDPOINT, params=params, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def _latest_value(body: dict[str, Any], series_key: str, value_field: str) -> tuple[str, float] | None:
    series = body.get(series_key) or {}
    if not series:
        return None
    # Date keys are ISO strings; take the most recent.
    latest = max(series.keys())
    point = series[latest]
    try:
        return (latest, float(point[value_field]))
    except (KeyError, ValueError, TypeError):
        return None


async def _rotation_tickers(budget: int) -> list[str]:
    """
    Pick the next batch of tickers to refresh.

    Strategy: order by `technicals.updated_at` ascending, missing first, capped
    so we never exceed the daily call budget (budget / 4 indicators).
    """
    per_ticker_calls = len(INDICATORS)
    max_tickers = max(1, budget // per_ticker_calls)
    db = get_db()
    cursor = (
        db.companies.find(
            {},
            {"ticker": 1, "technicals.updated_at": 1, "market_cap": 1},
        )
        .sort([("technicals.updated_at", 1), ("market_cap", -1)])
        .limit(max_tickers)
    )
    return [doc["ticker"] async for doc in cursor]


async def poll_once() -> None:
    if not API_KEY:
        jlog("warn", "alphav.no_key", message="ALPHA_VANTAGE_API_KEY not set; skipping")
        return

    tickers = await _rotation_tickers(DAILY_CALL_BUDGET)
    if not tickers:
        jlog("info", "alphav.no_tickers")
        return

    db = get_db()
    now = datetime.now(timezone.utc)
    refreshed = 0

    async with httpx.AsyncClient() as client:
        for ticker in tickers:
            tech: dict[str, Any] = {}
            for (function, extra, series_key, value_field), storage_key in zip(
                INDICATORS, INDICATOR_KEYS, strict=True
            ):
                params = {
                    "function": function,
                    "symbol": ticker,
                    "apikey": API_KEY,
                    **extra,
                }
                try:
                    body = await _call(client, params)
                except httpx.HTTPError as exc:
                    jlog("error", "alphav.call.fail", ticker=ticker, function=function, error=str(exc)[:200])
                    continue

                # Alpha Vantage returns {"Note": "..."} when rate-limited.
                if "Note" in body or "Information" in body:
                    jlog("warn", "alphav.rate_limited", note=str(body)[:200])
                    break

                pair = _latest_value(body, series_key, value_field)
                if pair:
                    date, value = pair
                    tech[storage_key] = {"value": value, "as_of": date}

            if tech:
                tech["updated_at"] = now
                await db.companies.update_one({"ticker": ticker}, {"$set": {"technicals": tech}})
                refreshed += 1
                jlog("info", "alphav.refresh", ticker=ticker, indicators=list(tech.keys()))

    jlog("info", "alphav.poll.done", tickers=len(tickers), refreshed=refreshed)


if __name__ == "__main__":
    sync_main(NAME, poll_once, default_interval=3600.0)  # 1 hour
