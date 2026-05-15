"use client";

import { useEffect, useMemo, useState } from "react";
import { FixedSizeList } from "react-window";
import { motion } from "framer-motion";
import { ChevronDown, Network, SlidersHorizontal, X } from "lucide-react";
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

// Source → short display label
const SOURCE_LABEL: Record<string, string> = {
  sec_8k: "SEC",
  news: "News",
  marketaux: "News",
  finnhub_ws: "Ticks",
  alpha_vantage: "TA",
  reddit: "Social",
  test: "Seed",
};

// Sector palette — each sector gets a subtle hue so the chip rail reads at a glance.
const SECTOR_COLOR: Record<string, string> = {
  "Technology": "#60a5fa",
  "Financials": "#4ade80",
  "Healthcare": "#f472b6",
  "Energy": "#fbbf24",
  "Industrials": "#fb923c",
  "Consumer Discretionary": "#c084fc",
  "Consumer Staples": "#22d3ee",
  "Communication Services": "#a78bfa",
  "Materials": "#84cc16",
  "Utilities": "#facc15",
  "Real Estate": "#f87171",
};

const TIME_WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
] as const;

type Impact = "all" | "critical" | "high";

export function Feed() {
  const events = useStore((s) => s.events);
  const setEvents = useStore((s) => s.setEvents);
  const selectedId = useStore((s) => s.selectedEventId);
  const selectEvent = useStore((s) => s.selectEvent);
  const status = useStore((s) => s.streamStatus);

  const [impact, setImpact] = useState<Impact>("all");
  const [cascadableOnly, setCascadableOnly] = useState(false);
  const [hoursBack, setHoursBack] = useState<number>(168);
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [height, setHeight] = useState(600);

  // Fetch whenever any server-driven filter changes.
  useEffect(() => {
    api
      .listEvents({
        hours_back: hoursBack,
        limit: 150,
        sector: sectorFilter || undefined,
        source_type: sourceFilter || undefined,
      })
      .then((res) => setEvents(res.events))
      .catch(() => {});
  }, [setEvents, hoursBack, sectorFilter, sourceFilter]);

  useEffect(() => {
    const onResize = () => setHeight(Math.max(300, window.innerHeight - 280));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Client-side filters (cheap, no roundtrip)
  const filtered = useMemo(() => {
    let xs = events;
    if (impact !== "all") xs = xs.filter((e) => e.impact === impact);
    if (cascadableOnly) xs = xs.filter((e) => e.has_cascade);
    return xs;
  }, [events, impact, cascadableOnly]);

  // Sector chip counts derived from currently-loaded events (post-enrichment).
  const sectorCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      const s = e.sector || "Uncategorized";
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()]
      .filter(([s]) => s !== "Uncategorized" || sectorFilter === "Uncategorized")
      .sort((a, b) => b[1] - a[1]);
  }, [events, sectorFilter]);

  const sourceCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      const s = e.source_type;
      if (!s) continue;
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (impact !== "all") activeFilters.push({ key: "impact", label: impact, clear: () => setImpact("all") });
  if (cascadableOnly) activeFilters.push({ key: "graph", label: "graph", clear: () => setCascadableOnly(false) });
  if (sectorFilter) activeFilters.push({ key: "sector", label: sectorFilter, clear: () => setSectorFilter("") });
  if (sourceFilter)
    activeFilters.push({ key: "source", label: SOURCE_LABEL[sourceFilter] ?? sourceFilter, clear: () => setSourceFilter("") });

  function clearAll() {
    setImpact("all");
    setCascadableOnly(false);
    setSectorFilter("");
    setSourceFilter("");
  }

  return (
    <aside className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      {/* Header */}
      <div className="border-b border-white/5 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="mono uppercase tracking-[0.18em] text-muted">Stream</span>
          <StreamBadge status={status} />
        </div>

        {/* Primary row: impact + graph */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {(["all", "critical", "high"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setImpact(f)}
              className={
                "rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition " +
                (impact === f
                  ? "bg-accent text-black"
                  : "bg-white/[0.04] text-muted hover:bg-white/[0.08] hover:text-text")
              }
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setCascadableOnly((v) => !v)}
            title="Only events whose tickers are in the supply-chain graph"
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

        {/* Time window */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="mono text-[9px] uppercase tracking-widest text-muted">window</span>
          <div className="flex flex-1 gap-1">
            {TIME_WINDOWS.map((w) => (
              <button
                key={w.label}
                onClick={() => setHoursBack(w.hours)}
                className={
                  "flex-1 rounded-md py-0.5 text-[10px] tabular-nums transition " +
                  (hoursBack === w.hours
                    ? "bg-white/10 text-text ring-1 ring-white/15"
                    : "bg-white/[0.03] text-muted hover:text-text")
                }
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* More filters expander */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="mt-2 flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted hover:text-text"
        >
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal size={11} />
            categories · sources
          </span>
          <ChevronDown
            size={12}
            className={"transition " + (showFilters ? "rotate-180" : "")}
          />
        </button>

        {showFilters && (
          <div className="mt-1.5 space-y-2">
            {/* Sectors */}
            <FilterGroup label="sector">
              {sectorCounts.length === 0 ? (
                <span className="text-[10px] text-muted">no data</span>
              ) : (
                sectorCounts.slice(0, 8).map(([s, n]) => {
                  const active = sectorFilter === s;
                  const color = SECTOR_COLOR[s] ?? "var(--text-muted)";
                  return (
                    <button
                      key={s}
                      onClick={() => setSectorFilter(active ? "" : s)}
                      className={
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition " +
                        (active
                          ? "bg-white/10 ring-1 text-text"
                          : "bg-white/[0.03] text-muted hover:bg-white/[0.07]")
                      }
                      style={active ? { boxShadow: `inset 0 0 0 1px ${color}`, color } : undefined}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      <span className="truncate">{shortSector(s)}</span>
                      <span className="tabular-nums opacity-60">{n}</span>
                    </button>
                  );
                })
              )}
            </FilterGroup>

            {/* Sources */}
            <FilterGroup label="source">
              {sourceCounts.length === 0 ? (
                <span className="text-[10px] text-muted">no data</span>
              ) : (
                sourceCounts.map(([s, n]) => {
                  const active = sourceFilter === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setSourceFilter(active ? "" : s)}
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider transition " +
                        (active
                          ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                          : "bg-white/[0.03] text-muted hover:bg-white/[0.07]")
                      }
                    >
                      {SOURCE_LABEL[s] ?? s}
                      <span className="ml-1 tabular-nums opacity-60">{n}</span>
                    </button>
                  );
                })
              )}
            </FilterGroup>
          </div>
        )}

        {/* Active filter strip */}
        {activeFilters.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2">
            <span className="mono text-[9px] uppercase tracking-widest text-muted">active</span>
            {activeFilters.map((f) => (
              <button
                key={f.key}
                onClick={f.clear}
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent hover:bg-accent/15"
              >
                {f.label}
                <X size={10} />
              </button>
            ))}
            <button
              onClick={clearAll}
              className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted hover:text-text"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-muted">
          No events match these filters.
          {activeFilters.length > 0 && (
            <button onClick={clearAll} className="ml-1 underline hover:text-text">
              clear
            </button>
          )}
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
            const sectorColor = e.sector ? SECTOR_COLOR[e.sector] : undefined;
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
                {(e.sector || e.source_type) && (
                  <div className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider">
                    {e.sector && (
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-px"
                        style={{ background: sectorColor ? `${sectorColor}1a` : "rgba(255,255,255,0.04)", color: sectorColor ?? "var(--text-muted)" }}
                      >
                        {shortSector(e.sector)}
                      </span>
                    )}
                    {e.source_type && (
                      <span className="text-muted/70">{SOURCE_LABEL[e.source_type] ?? e.source_type}</span>
                    )}
                  </div>
                )}
              </motion.div>
            );
          }}
        </FixedSizeList>
      )}
    </aside>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mono mb-1 text-[9px] uppercase tracking-widest text-muted/70">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function shortSector(s: string): string {
  const map: Record<string, string> = {
    "Communication Services": "Comm",
    "Consumer Discretionary": "Consumer Disc",
    "Consumer Staples": "Staples",
    "Real Estate": "Real Est",
    Uncategorized: "Other",
  };
  return map[s] ?? s;
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
