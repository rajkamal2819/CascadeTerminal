"use client";

import { useEffect, useMemo, useState } from "react";
import { FixedSizeList } from "react-window";
import { motion } from "framer-motion";
import { Network } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

const ROW_HEIGHT = 56;

const IMPACT_DOT: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--text-muted)",
  low: "var(--text-muted)",
};

const IMPACT_GLOW: Record<string, string> = {
  critical: "var(--critical-glow)",
  high: "var(--high-glow)",
  medium: "transparent",
  low: "transparent",
};

export function Feed() {
  const events = useStore((s) => s.events);
  const setEvents = useStore((s) => s.setEvents);
  const selectedId = useStore((s) => s.selectedEventId);
  const selectEvent = useStore((s) => s.selectEvent);
  const status = useStore((s) => s.streamStatus);

  const [filter, setFilter] = useState<"all" | "critical" | "high">("all");
  const [cascadableOnly, setCascadableOnly] = useState(false);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    api
      .listEvents({ hours_back: 168, limit: 120 })
      .then((res) => setEvents(res.events))
      .catch(() => {});
  }, [setEvents]);

  useEffect(() => {
    const onResize = () => setHeight(Math.max(300, window.innerHeight - 200));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const filtered = useMemo(() => {
    let xs = events;
    if (filter !== "all") xs = xs.filter((e) => e.impact === filter);
    if (cascadableOnly) xs = xs.filter((e) => e.has_cascade);
    return xs;
  }, [events, filter, cascadableOnly]);

  return (
    <aside className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="border-b border-white/5 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="mono uppercase tracking-[0.18em] text-muted">Stream</span>
          <StreamBadge status={status} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {(["all", "critical", "high"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition " +
                (filter === f
                  ? "bg-accent text-black"
                  : "bg-white/[0.04] text-muted hover:bg-white/[0.08] hover:text-text")
              }
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setCascadableOnly((v) => !v)}
            title="Only show events whose tickers are in the supply-chain graph"
            className={
              "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider transition " +
              (cascadableOnly
                ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                : "bg-white/[0.04] text-muted hover:text-text")
            }
          >
            <Network size={10} />
            graph
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted">
          Waiting for live stream…
        </div>
      ) : (
        <FixedSizeList
          className="thin-scroll"
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
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => selectEvent(e.id)}
                className={
                  "group cursor-pointer border-b border-white/[0.04] px-3 py-2 text-xs transition " +
                  (selected ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "hover:bg-white/[0.03]")
                }
              >
                <div className="flex items-center gap-2.5">
                  <span className="relative inline-flex h-2 w-2 shrink-0">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: IMPACT_DOT[e.impact] ?? "var(--text-muted)",
                        boxShadow: `0 0 10px ${IMPACT_GLOW[e.impact] ?? "transparent"}`,
                      }}
                    />
                    {(e.impact === "critical" || e.impact === "high") && (
                      <span
                        className="pulse-ring absolute inset-0 rounded-full"
                        style={{ border: `1px solid ${IMPACT_DOT[e.impact]}` }}
                      />
                    )}
                  </span>
                  <span className="mono truncate text-[11px] font-semibold tracking-wider text-text">
                    {e.tickers.slice(0, 3).join(" · ") || e.source_type.toUpperCase()}
                  </span>
                  {e.has_cascade && (
                    <Network
                      size={10}
                      className="shrink-0 text-accent"
                      style={{ filter: "drop-shadow(0 0 6px var(--accent-glow))" }}
                    />
                  )}
                  <span className="mono ml-auto shrink-0 text-[10px] tabular-nums text-muted">
                    {e.published_at
                      ? new Date(e.published_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : ""}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted group-hover:text-text/80">
                  {e.headline || e.source_type}
                </div>
              </motion.div>
            );
          }}
        </FixedSizeList>
      )}
    </aside>
  );
}

function StreamBadge({ status }: { status: string }) {
  const isLive = status === "live";
  const isReconn = status === "reconnecting";
  const color = isLive ? "var(--accent)" : isReconn ? "var(--high)" : "var(--text-muted)";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color }}>
      <span
        className={"h-1.5 w-1.5 rounded-full " + (isLive ? "pulse-soft" : "")}
        style={{ background: color, boxShadow: isLive ? `0 0 8px ${color}` : "none" }}
      />
      {status}
    </span>
  );
}
