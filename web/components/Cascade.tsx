"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Network, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

const REL_COLOR: Record<string, string> = {
  supplier: "var(--supplier)",
  customer: "var(--customer)",
  peer: "var(--peer)",
  sector: "var(--sector)",
  derivative: "#f472b6",
};

const LEVEL_BG: Record<string, string> = {
  L1: "rgba(74,222,128,0.10)",
  L2: "rgba(96,165,250,0.10)",
  L3: "rgba(192,132,252,0.10)",
};

export function Cascade() {
  const selectedId = useStore((s) => s.selectedEventId);
  const cascade = useStore((s) => s.cascade);
  const loading = useStore((s) => s.cascadeLoading);
  const selectEvent = useStore((s) => s.selectEvent);

  useEffect(() => {
    if (!selectedId) {
      useStore.getState().setCascade(null);
      return;
    }
    let cancelled = false;
    useStore.getState().setCascadeLoading(true);
    api
      .buildCascade({ event_id: selectedId, max_hops: 3, top_k: 14 })
      .then((res) => !cancelled && useStore.getState().setCascade(res))
      .catch(() => !cancelled && useStore.getState().setCascade(null))
      .finally(() => !cancelled && useStore.getState().setCascadeLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <AnimatePresence>
      {selectedId && (
        <motion.aside
          key="cascade-card"
          initial={{ opacity: 0, x: 16, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 16, scale: 0.98 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="glass-strong flex h-full min-h-0 flex-col overflow-hidden rounded-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/5 px-4 pt-3 pb-2.5">
            <div className="flex items-center gap-2">
              <Network size={13} className="text-accent" />
              <span className="mono text-[10px] uppercase tracking-[0.2em] text-muted">
                Cascade · $graphLookup
              </span>
            </div>
            <button
              onClick={() => selectEvent(null)}
              className="rounded p-1 text-muted hover:bg-white/10 hover:text-text"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {loading && (
            <div className="flex h-full items-center justify-center text-[11px] text-muted">
              <Zap size={12} className="mr-1.5 animate-pulse text-accent" />
              walking graph · rerank-2.5…
            </div>
          )}

          {!loading && cascade && (
            <>
              {/* Root */}
              <div className="border-b border-white/5 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted">root</div>
                <div className="mt-1 text-sm leading-snug text-text">
                  {cascade.root.headline || "(no headline)"}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {cascade.root.tickers.map((t) => (
                    <span key={t} className="mono rounded bg-critical/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-critical">
                      {t}
                    </span>
                  ))}
                  {cascade.root.sector && (
                    <span className="text-[10px] text-muted">· {cascade.root.sector}</span>
                  )}
                </div>
              </div>

              {/* Hop summary */}
              {cascade.hop_counts && (
                <div className="flex gap-1.5 border-b border-white/5 px-4 py-2 text-[10px]">
                  {Object.entries(cascade.hop_counts).map(([lvl, n]) => (
                    <span
                      key={lvl}
                      className="mono rounded px-1.5 py-0.5"
                      style={{ background: LEVEL_BG[lvl] ?? "rgba(255,255,255,0.04)", color: "var(--text)" }}
                    >
                      {lvl} · <span className="tabular-nums">{n}</span>
                    </span>
                  ))}
                </div>
              )}

              {cascade.message && (
                <div className="px-4 py-3 text-xs text-muted">{cascade.message}</div>
              )}

              {/* Nodes */}
              <ul className="thin-scroll flex-1 min-h-0 overflow-y-auto">
                {cascade.nodes.map((n, i) => {
                  const color = REL_COLOR[n.relationship_type] ?? "var(--text-muted)";
                  return (
                    <motion.li
                      key={n.ticker + i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: i * 0.02 }}
                      className="border-b border-white/[0.04] px-4 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        {/* Hop swatch */}
                        <span
                          className="mono rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider"
                          style={{
                            color,
                            border: `1px solid ${color}`,
                            background: "transparent",
                            boxShadow: `0 0 12px ${color}33`,
                          }}
                        >
                          {n.level}
                        </span>
                        <span className="mono font-semibold tracking-wider text-text">{n.ticker}</span>
                        <span className="truncate text-muted">{n.company}</span>
                        <span className="mono ml-auto tabular-nums text-accent text-[11px]">
                          {n.cascade_score.toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 pl-9 text-[11px] text-muted">{n.why}</div>
                      <div className="mt-1 flex items-center gap-1.5 pl-9 text-[10px] text-muted/80">
                        <ArrowUpRight size={10} />
                        <span className="capitalize">{n.relationship_type}</span>
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            </>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
