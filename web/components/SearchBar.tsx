"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { api, type SearchHit } from "@/lib/api";

export function SearchBar({ onResults }: { onResults?: (hits: SearchHit[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.search({ query: q, days_back: 30, limit: 10 });
      setHits(res.events);
      onResults?.(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full max-w-2xl">
      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events… e.g. 'AI capex slowdown' or 'TSM earnings'"
            className="w-full rounded border border-white/10 bg-surface pl-9 pr-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-accent/20 px-3 py-2 text-xs text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <div className="text-xs text-critical">{error}</div>}

      {hits.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded border border-white/10 bg-surface text-xs">
          {hits.map((h) => (
            <li key={h.id} className="border-b border-white/5 px-3 py-2 last:border-0 hover:bg-white/5">
              <div className="flex justify-between gap-3">
                <div className="flex-1">
                  <div className="text-text">{h.headline || "(no headline)"}</div>
                  <div className="text-muted mt-0.5">
                    {h.tickers.join(", ")} · {h.sector || "—"} · {h.impact || "—"}
                  </div>
                </div>
                <div className="text-accent shrink-0 tabular-nums">{h.rerank_score.toFixed(3)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
