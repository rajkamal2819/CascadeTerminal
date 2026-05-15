# Cascade

**Real-time equity-market intelligence with supply-chain cascade reasoning.**

Cascade ingests live news, SEC filings, social signals, and price ticks; uses
MongoDB Atlas as the unified data brain; runs graph RAG with Voyage AI rerankers
to predict how a single financial event ripples through supplier and customer
relationships; and renders the result as a 3D globe terminal.

Built for the [Devpost Rapid Agent Hackathon](https://rapid-agent.devpost.com/)
on the MongoDB + Google Cloud partner track. Submission deadline 2026-06-11.

---

## Why this exists

Most market terminals show you _what_ happened. Cascade shows you _what happens
next_. When TSMC's fab utilization slips, every downstream chip designer is
affected — but the story doesn't surface for hours, sometimes days. Cascade
walks the supply-chain graph in real time and ranks second- and third-order
impacts with a cross-encoder rerank model the same minute the source filing
hits the wire.

The technical bet is that MongoDB Atlas alone — vector search, full-text
search, graph traversal, change streams, and a time-series collection in one
cluster — is enough to back this entire product. No separate vector DB, no
Redis, no Postgres. One database, one connection pool, one source of truth.

---

## How it works

```
                       ┌──────────────────────────────────────┐
                       │      Cascade Terminal (Next.js)      │
                       │  3D globe · feed · cascade tree · ⌕  │
                       └────────────────┬─────────────────────┘
                                        │  REST + SSE
                                        ▼
                       ┌──────────────────────────────────────┐
                       │       FastAPI + Cloud Run            │
                       │  /events  /search  /cascade  /stream │
                       └────────┬───────────────────┬─────────┘
                                │                   │
                  ┌─────────────▼──────────┐   ┌────▼─────────────┐
                  │  Cascade Agent (ADK)   │   │  Change Streams  │
                  │  Gemini 3 + 6 tools    │   │  events → SSE    │
                  └─────────────┬──────────┘   └────┬─────────────┘
                                │                   │
            ┌───────────────────▼───────────────────▼──────────────────┐
            │                    MongoDB Atlas (M0)                    │
            │                                                          │
            │  events           — $vectorSearch + $search (hybrid)     │
            │  relationships    — $graphLookup walk (3 hops)           │
            │  companies        — 100 US tickers + HQ coords           │
            │  prices           — time-series OHLCV                    │
            │  cascades         — synthesised propagation trees        │
            │  watchlists       — per-user follow lists                │
            └────────────┬─────────────────────────────────────────────┘
                         │
       ┌─────────────────┼─────────────────────────────────┐
       │                 │                                 │
   ┌───▼────┐    ┌───────▼────────┐                   ┌────▼─────┐
   │ Voyage │    │  Six async     │                   │  Gemini  │
   │  AI    │    │  workers       │                   │   3      │
   ├────────┤    ├────────────────┤                   ├──────────┤
   │embed-4 │    │ sec_edgar      │                   │ tool use │
   │rerank-2│    │ finnhub_ws     │                   │ JSON-mode│
   │multimod│    │ marketaux      │                   │ on Vertex│
   └────────┘    │ alpha_vantage  │                   │   AI     │
                 │ yfinance_ticks │                   └──────────┘
                 │ reddit         │
                 └────────────────┘
```

---

## MongoDB Atlas features in use

The submission's strategic differentiator is using **10 distinct Atlas
features** in a single cluster — well beyond the typical vector-only chatbot.

| Feature                          | Where it lives                                          | Why it's there                                                  |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `$vectorSearch`                  | `agent/tools.py` → `search_events`                      | Semantic recall over event corpus (voyage-4, 1024-dim cosine)   |
| Atlas Search `$search`           | `agent/tools.py` → `search_events`                      | Exact ticker / entity matching                                  |
| Reciprocal Rank Fusion           | `agent/tools.py` → `search_events`                      | Fuse vector + text rankings before reranking                    |
| **`$graphLookup`**               | `agent/tools.py` → `build_cascade`                      | Walk supplier / customer / peer edges up to 3 hops              |
| `$facet`                         | `agent/tools.py` → `aggregate_stats`                    | Parallel sub-pipelines for dashboard counts                     |
| Time-series collection           | `prices` (`scripts/setup_mongo.py`)                     | Native OHLCV storage, minute granularity                        |
| TTL index                        | `events.published_at` (14 days)                         | Keeps M0 free tier under its 512 MB cap                         |
| Change streams                   | `api/sse.py` (Phase 5)                                  | Push-based real-time updates to the browser via SSE             |
| Voyage rerank-2.5                | `embed/rerank.py`                                       | Cross-encoder relevance for cascade ranking                     |
| `voyage-multimodal-3.5`          | `embed/multimodal.py`                                   | Embed charts and images alongside text                          |

Atlas Performance Advisor is consulted at agent runtime via `optimize_self` and
auto-creates indexes flagged as missing — a small flourish demonstrating
agent → MongoDB control-plane integration.

---

## Tech stack

**Frontend** (Phase 6, in progress): Next.js 15 App Router · TypeScript strict
· Tailwind · shadcn/ui · react-globe.gl · framer-motion · Zustand

**Backend** (Phase 5, in progress): Python 3.11 · FastAPI · Motor (async
Mongo) · Pydantic v2

**Agent**: Google Agent Development Kit (`google-adk`) · Gemini 3 (Vertex AI
for submission, AI Studio key during dev) · MongoDB MCP server for tool
discovery · custom ADK tool wrappers for hybrid search, graph cascade, prices,
stats, and self-optimisation

**Ingestion** (six async workers, all in `workers/`): SEC EDGAR 8-K Atom feed
· Finnhub WebSocket trades · Marketaux REST · yfinance OHLCV · Alpha Vantage
RSI · Reddit (gated)

**Hosting**: Vercel (web) · Cloud Run (api + agent + workers) · Cloud
Scheduler (cron-style workers) · MongoDB Atlas M0 · all free tier

---

## Repo layout

```
cascade/
├── web/                Next.js terminal UI (Phase 6)
├── api/                FastAPI + change-stream SSE (Phase 5)
├── agent/              ADK agent, 6 tools, Gemini synthesis
│   ├── main.py
│   ├── tools.py            search_events, build_cascade, get_company,
│   │                       get_prices, aggregate_stats, optimize_self
│   ├── prompts.py
│   └── cascade_reasoning.py
├── workers/            Six async ingestion workers
│   ├── sec_edgar.py
│   ├── finnhub_ws.py
│   ├── marketaux.py
│   ├── reddit.py
│   ├── yfinance_ticks.py
│   ├── alpha_vantage.py
│   └── _common.py          env loader, structured logging, shared DB
├── embed/              Voyage wrappers
│   ├── text.py             voyage-4 query + document embed
│   ├── multimodal.py       voyage-multimodal-3.5 image embed
│   ├── ner.py              ticker + entity extraction
│   └── rerank.py           voyage rerank-2.5
├── scripts/
│   ├── setup_mongo.py      provisions collections, indexes, TTL, search
│   ├── seed_companies.py   100 top US tickers + HQ coords
│   ├── seed_relationships.py  1149 supplier/customer/peer edges
│   ├── backfill_embeddings.py
│   └── test_tools.py       Phase 4 gate verification
├── data/
│   ├── companies.json
│   └── relationships.json
└── pyproject.toml
```

---

## Quick start (local dev)

Prerequisites: Python 3.11+, Node 20+, a MongoDB Atlas cluster (M0 free is
enough), a Voyage AI key, a Gemini key.

```bash
git clone https://github.com/rajkamal2819/CascadeTerminal.git
cd CascadeTerminal

# Python env
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Configure
cp .env.example .env
# Fill in MONGODB_URI, VOYAGE_API_KEY, GEMINI_API_KEY, SEC_USER_AGENT, …

# Provision Atlas (collections, vector + text indexes, TTL, time-series)
python -m scripts.setup_mongo
python -m scripts.seed_companies
python -m scripts.seed_relationships

# Start any worker manually (or let cron drive them in prod)
python -m workers.sec_edgar --once
python -m workers.yfinance_ticks --once

# Backfill embeddings for any events that landed before VOYAGE_API_KEY was set
python -m scripts.backfill_embeddings

# Smoke-test the agent's tools directly (no LLM round-trips)
python -m scripts.test_tools

# Run the agent end-to-end
python -m agent.main "What is today's NVIDIA AI chip news and what tickers does it cascade to?"
```

---

## Status

| Phase | Title                                             | State          |
| ----- | ------------------------------------------------- | -------------- |
| 0     | Repository scaffolding                            | done           |
| 1     | MongoDB schemas, indexes, seed data               | done           |
| 2     | Six async ingestion workers                       | done           |
| 3     | Voyage embeddings · NER · backfill pipeline       | done           |
| **4** | **Google ADK agent — 6 tools, `$graphLookup`, rerank-2.5** | **done** |
| 5     | FastAPI backend + change-stream SSE               | next           |
| 6     | Next.js terminal UI (globe, feed, cascade panel)  | pending        |
| 7     | Polish · seed demo · deploy · submit              | pending        |

The Phase 4 gate is met by `scripts/test_tools.py`:

```
build_cascade(event_id=<nvda_event>)
  → root tickers: ['NVDA']
  → 10 cascade nodes, 50 edges
  → hop counts: {L1: 9, L3: 1}
  → top: TSM (peer, 0.805) · AMZN (customer, 0.766) · GOOGL (customer, 0.750) …
```

`$graphLookup` is invoked once per cascade query; rerank-2.5 scores the
candidates; the agent's tool layer degrades gracefully when Voyage's free-tier
3 RPM cap bites (falls back to RRF ordering). See [TODO_LATER.md] for the
small list of deferred unblocks before submission (chiefly: Vertex AI swap and
optional payment-method add to lift the Voyage rate cap).

---

## License

Apache-2.0. See [LICENSE](LICENSE).

---

## Acknowledgements

Built with [Gemini](https://ai.google.dev/), [Google Cloud Agent
Builder](https://cloud.google.com/products/agent-builder),
[MongoDB MCP server](https://www.mongodb.com/docs/atlas/data-api/mcp/), and
[Voyage AI](https://www.voyageai.com/) embeddings + rerankers.
