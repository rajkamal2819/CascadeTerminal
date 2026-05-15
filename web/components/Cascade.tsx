"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

const REL_COLOR: Record<string, string> = {
  supplier: "var(--accent)",
  customer: "#60a5fa",
  peer: "#a78bfa",
  sector: "#fbbf24",
  derivative: "#f472b6",
};

export function Cascade() {
  const selectedId = useStore((s) => s.selectedEventId);
  const cascade = useStore((s) => s.cascade);
  const loading = useStore((s) => s.cascadeLoading);

  useEffect(() => {
    if (!selectedId) {
      useStore.getState().setCascade(null);
      return;
    }
    let cancelled = false;
    useStore.getState().setCascadeLoading(true);
    api
      .buildCascade({ event_id: selectedId, max_hops: 3, top_k: 12 })
      .then((res) => {
        if (!cancelled) useStore.getState().setCascade(res);
      })
      .catch(() => {
        if (!cancelled) useStore.getState().setCascade(null);
      })
      .finally(() => {
        if (!cancelled) useStore.getState().setCascadeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <aside className="flex h-full flex-col border-l border-white/5 bg-surface/40">
      <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wider text-muted">
        Cascade
      </div>

      {!selectedId && (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
          Click an event in the feed to build its cascade tree.
        </div>
      )}

      {selectedId && loading && (
        <div className="flex h-full items-center justify-center text-xs text-muted">
          Walking $graphLookup + rerank-2.5…
        </div>
      )}

      {selectedId && !loading && cascade && (
        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-white/5 px-3 py-3">
            <div className="text-[10px] uppercase text-muted">root</div>
            <div className="mt-1 text-sm text-text">{cascade.root.headline || "(no headline)"}</div>
            <div className="mt-1 text-xs text-muted">
              {cascade.root.tickers.join(", ")} · {cascade.root.sector || "—"} · {cascade.root.impact || "—"}
            </div>
          </div>

          {cascade.message && (
            <div className="px-3 py-3 text-xs text-muted">{cascade.message}</div>
          )}

          <ul>
            {cascade.nodes.map((n, i) => (
              <motion.li
                key={n.ticker + i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15, delay: i * 0.02 }}
                className="border-b border-white/5 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: "var(--surface)", border: `1px solid ${REL_COLOR[n.relationship_type] ?? "var(--text-muted)"}`, color: REL_COLOR[n.relationship_type] ?? "var(--text-muted)" }}
                  >
                    {n.level}
                  </span>
                  <span className="text-text font-semibold">{n.ticker}</span>
                  <span className="text-muted truncate flex-1">{n.company}</span>
                  <span className="tabular-nums text-accent shrink-0">{n.cascade_score.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-muted line-clamp-2">{n.why}</div>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
