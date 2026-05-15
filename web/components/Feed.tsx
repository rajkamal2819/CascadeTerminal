"use client";

import { useEffect, useMemo, useState } from "react";
import { FixedSizeList } from "react-window";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

const ROW_HEIGHT = 64;

const IMPACT_COLOR: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--text-muted)",
  low: "var(--text-muted)",
};

export function Feed() {
  const events = useStore((s) => s.events);
  const setEvents = useStore((s) => s.setEvents);
  const selectedId = useStore((s) => s.selectedEventId);
  const selectEvent = useStore((s) => s.selectEvent);
  const status = useStore((s) => s.streamStatus);

  const [filter, setFilter] = useState<"all" | "critical" | "high">("all");
  const [height, setHeight] = useState(600);

  // Initial seed from REST: most recent events so the feed isn't empty before
  // a live SSE event arrives.
  useEffect(() => {
    api
      .listEvents({ hours_back: 168, limit: 100 })
      .then((res) => setEvents(res.events))
      .catch(() => {
        /* backend offline — feed will populate from SSE */
      });
  }, [setEvents]);

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight - 160);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.impact === filter)),
    [events, filter]
  );

  return (
    <aside className="flex h-full flex-col border-r border-white/5 bg-surface/40">
      <div className="border-b border-white/5 px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted uppercase tracking-wider">Feed</span>
          <span
            className={
              "inline-flex items-center gap-1.5 " +
              (status === "live" ? "text-accent" : status === "reconnecting" ? "text-high" : "text-muted")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (status === "live" ? "bg-accent animate-pulse" : status === "reconnecting" ? "bg-high" : "bg-muted")
              }
            />
            {status}
          </span>
        </div>
        <div className="mt-2 flex gap-1">
          {(["all", "critical", "high"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded px-2 py-0.5 text-xs " +
                (filter === f ? "bg-accent/20 text-accent" : "text-muted hover:text-text")
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
          No events yet. Waiting for live stream…
        </div>
      ) : (
        <FixedSizeList
          height={height}
          width={"100%"}
          itemCount={filtered.length}
          itemSize={ROW_HEIGHT}
          overscanCount={6}
        >
          {({ index, style }) => {
            const e = filtered[index];
            const selected = e.id === selectedId;
            return (
              <motion.div
                key={e.id}
                style={style}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => selectEvent(e.id)}
                className={
                  "cursor-pointer border-b border-white/5 px-3 py-2 text-xs hover:bg-white/5 " +
                  (selected ? "bg-accent/10" : "")
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: IMPACT_COLOR[e.impact] ?? "var(--text-muted)" }}
                  />
                  <span className="font-semibold text-text truncate flex-1">
                    {e.tickers.slice(0, 3).join(", ") || e.source_type}
                  </span>
                  <span className="text-muted shrink-0 tabular-nums">
                    {e.published_at ? new Date(e.published_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-muted">{e.headline || "(no headline)"}</div>
              </motion.div>
            );
          }}
        </FixedSizeList>
      )}
    </aside>
  );
}
