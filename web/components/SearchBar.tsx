"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api, type SearchHit } from "@/lib/api";

export function SearchBar({ onResults }: { onResults?: (hits: SearchHit[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.search({ query: q, days_back: 30, limit: 10 });
      setHits(res.events);
      onResults?.(res.events);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full max-w-xl">
      <form onSubmit={submit} className="glass flex items-center gap-2 rounded-full px-3 py-1.5 focus-within:glow-accent">
        <Search size={14} className="text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder="ask · ‘AI capex slowdown’ · ‘semis correction’ · ‘TSM earnings’"
          className="flex-1 bg-transparent text-[13px] text-text placeholder:text-muted/70 outline-none"
        />
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="mono rounded-full bg-accent/20 px-3 py-1 text-[10px] uppercase tracking-wider text-accent transition hover:bg-accent/30 disabled:opacity-40"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : "search"}
        </button>
      </form>

      {error && (
        <div className="absolute left-0 right-0 top-full mt-2 rounded-lg bg-critical/15 px-3 py-2 text-xs text-critical">
          {error}
        </div>
      )}

      <AnimatePresence>
        {open && hits.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="glass-strong thin-scroll absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl text-xs"
          >
            <li className="flex justify-between px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted">
              <span>hybrid · rerank-2.5</span>
              <button onClick={() => setOpen(false)} className="hover:text-text">close</button>
            </li>
            {hits.map((h) => (
              <li
                key={h.id}
                onClick={() => {
                  onResults?.([h]);
                  setOpen(false);
                }}
                className="cursor-pointer border-t border-white/5 px-3 py-2 hover:bg-white/[0.04]"
              >
                <div className="flex items-baseline gap-2">
                  <span className="mono text-[10px] font-semibold tracking-wider text-text">
                    {h.tickers.slice(0, 3).join(" · ") || h.source_type}
                  </span>
                  <span className="ml-auto mono text-[10px] tabular-nums text-accent">
                    {h.rerank_score.toFixed(3)}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">
                  {h.headline || "(no headline)"} · {h.sector || h.impact || "—"}
                </div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
