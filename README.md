# Cascade — Implementation Plan

This bundle contains everything you need to build, deploy, and demo Cascade for the Google Cloud Rapid Agent Hackathon, MongoDB track.

## Files in this bundle

| File | Purpose | Used by |
|---|---|---|
| **CLAUDE.md** | Master instructions Claude Code reads on every session. Pin this to repo root. | Claude Code |
| **docs/SETUP.md** | Account signups, API keys, MongoDB Atlas walkthrough | You (manual setup) |
| **docs/DEPLOY.md** | Free hosting deployment (Vercel + Cloud Run + Cloud Scheduler) | You (after build) |
| **docs/PHASES.md** | Seven phase-by-phase prompts to feed Claude Code | You → Claude Code |
| **scripts/setup_mongo.py** | Actual working Python that creates all collections + indexes | You run once after Atlas signup |

## How to use this

1. **Day 1 morning** — Read CLAUDE.md (15 min). Follow SETUP.md to create all accounts and get API keys (90 min).
2. **Day 1 afternoon** — Create the repo. Drop CLAUDE.md at repo root, docs/ inside docs/, scripts/setup_mongo.py inside scripts/. Run `python scripts/setup_mongo.py` to provision MongoDB.
3. **Day 1–7** — Open Claude Code and paste the Phase 0 → Phase 3 prompts from PHASES.md sequentially.
4. **Day 8–14** — Phase 4 + 5 (agent + API).
5. **Day 15–21** — Phase 6 (frontend).
6. **Day 22–28** — Phase 7 (polish, deploy, record demo).
7. **Day 28** — Submit on Devpost before 2026-06-11 14:00 PDT.

## Key strategic choices made for you

**Free everything, $0 to judges.** Vercel + Cloud Run + Atlas M0 + Voyage 200M tokens free + Google Cloud $100 credit. Net cost during 14-day judging window: under $0.10.

**MongoDB is the entire data layer.** No Postgres, no Redis, no separate vector store. The hackathon judges from MongoDB will explicitly look for this. We use 10 distinct MongoDB features — $graphLookup is the killer differentiator.

**Voyage AI for embeddings AND reranking.** Voyage was acquired by MongoDB, so using rerank-2.5 scores extra-well with judges. 7.94% accuracy boost over Cohere v3.5 per their benchmarks. 200M tokens free.

**Atlas Automated Embedding.** MongoDB invokes Voyage on insert — zero client-side embedding code to maintain. This is set at index creation, see scripts/setup_mongo.py line ~95.

**Time-series collection for prices.** Native MongoDB feature, not a regular collection. Optimized storage and bucket indexes. The right answer for OHLCV.

**Change streams → SSE for real-time.** No polling from the browser. MongoDB pushes new events through change streams; FastAPI relays via Server-Sent Events; the React globe pulses on arrival.

**Google ADK + MongoDB MCP server for the agent.** Required by the hackathon. Gemini 3 Pro for reasoning, ADK for orchestration, MongoDB MCP for tool use. The agent calls $vectorSearch, $graphLookup, rerank, and Performance Advisor through MCP.

**Cloud Run, not Cloud Functions.** Cloud Run supports persistent WebSockets (Finnhub) and SSE (browser → API). Functions don't. Same free tier generosity.

**Next.js on Vercel for the frontend.** Native fit, fastest deploys, free hobby tier. No Cloudflare Pages, no Netlify, no Render — those have rougher edges for Next.js.

## What Claude Code will write

About 70 hours of coding spread across 4 weeks: roughly 8,000 lines of Python (workers + agent + API + scripts) and 3,000 lines of TypeScript (the terminal UI). The repo will be ~15,000 lines total including tests and configs.

You do approximately 3 hours of clicking: account signups, MongoDB Atlas cluster creation, secret pushing, Vercel and Cloud Run deploys, and recording the demo video.

## Submission checklist

- [ ] GitHub repo public with Apache-2.0 license
- [ ] README has live URL and demo video link
- [ ] Live URL works without login
- [ ] 3-minute YouTube demo video in English at 1080p
- [ ] Built with Gemini + Google Cloud Agent Builder + MongoDB MCP server (mention all three)
- [ ] Submitted on Devpost before deadline

## If something breaks

The single biggest gotcha is Atlas Vector Search index building. After running setup_mongo.py, the index takes 60–180 seconds to become ACTIVE. Queries before that return empty. Solution: wait, then check Atlas UI > Search.

The second gotcha is the SEC EDGAR User-Agent header. They will block you without it. Set `SEC_USER_AGENT` to something like `Cascade research/your-email@example.com`.

The third gotcha is M0's 512MB limit. The TTL index on events (14 days) keeps you under it, but during heavy testing you might exceed. If so, drop the events collection and reseed, or temporarily upgrade to M2 ($9/mo).

Good luck. Build something judges remember.
