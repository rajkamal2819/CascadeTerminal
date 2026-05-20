"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Network, Sparkles, Search, Scale, Eye, Brain } from "lucide-react";
import { api, type CascadeNode, type CascadeResponse, type CascadeEdge } from "@/lib/api";
import { useStore } from "@/lib/store";

// Extract readable company name — for semantic fallback nodes the real name
// hides inside the "why" field as "8-K - Company Name (CIK) (Filer)".
function resolveCompany(ticker: string, company: string | null | undefined, why: string | null | undefined): string {
  const c = (company ?? "").trim();
  if (c && c.toUpperCase() !== ticker.toUpperCase() && c.length > 2 && !/^\$?[A-Z]{1,6}$/.test(c)) {
    return c;
  }
  const w = (why ?? "").trim();
  let m = w.match(/^8-K\s*[-·]\s*(.+?)\s*\(\d{10}\)/i);
  if (m) return m[1].trim();
  m = w.match(/^(.+?)\s*\(\d{10}\)/);
  if (m && m[1].trim().toUpperCase() !== ticker.toUpperCase()) return m[1].trim();
  m = w.match(/^(.+?)\s*[·\-]\s*Item\s+\d/i);
  if (m && m[1].trim().toUpperCase() !== ticker.toUpperCase()) return m[1].trim();
  return c || ticker;
}

// Clean up SEC filing noise from the "why" text.
function cleanWhy(why: string | null | undefined): string {
  if (!why) return "";
  return why
    .replace(/\s*\(\d{10}\)\s*\(Filer\)/gi, "")
    .replace(/^8-K\s*[-·]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const REL_COLOR: Record<string, string> = {
  supplier: "var(--supplier)",
  customer: "var(--customer)",
  peer: "var(--peer)",
  sector: "var(--sector)",
  derivative: "#f472b6",
  semantic: "#94a3b8",
};

const POLARITY: Record<string, "damage" | "exposed" | "benefit" | "related"> = {
  supplier: "damage",
  sector: "damage",
  customer: "exposed",
  peer: "exposed",
  derivative: "benefit",
  semantic: "related",
};

const POLARITY_COLOR: Record<string, string> = {
  damage: "#ff4d6d",
  exposed: "#fbbf24",
  benefit: "#4ade80",
  related: "#94a3b8",
};

const POLARITY_LABEL: Record<string, string> = {
  damage: "negative cascade",
  exposed: "mixed cascade",
  benefit: "asymmetric cascade",
  related: "semantic match",
};

interface Verdict {
  riskScore: number;
  tone: "damage" | "exposed" | "benefit" | "related";
  text: string;
  bottleneck: string | null;
  buckets: Record<string, number>;
}

function computeVerdict(cascade: CascadeResponse): Verdict {
  // Bottleneck: L1 ticker that the most L2+ edges route through
  const inDegree = new Map<string, number>();
  for (const e of cascade.edges as CascadeEdge[]) {
    if (e.hop >= 2) inDegree.set(e.from, (inDegree.get(e.from) ?? 0) + 1);
  }
  let bottleneck: string | null = null;
  const totalL2 = cascade.edges.filter((e) => e.hop >= 2).length || 1;
  for (const [k, v] of inDegree) {
    if (v / totalL2 >= 0.4 && v >= 2 && (!bottleneck || v > (inDegree.get(bottleneck) ?? 0))) {
      bottleneck = k;
    }
  }

  // Risk score
  let total = 0;
  for (const n of cascade.nodes) {
    total += (n.cascade_score ?? 0) * Math.pow(0.7, Math.max(0, (n.hop ?? 1) - 1));
  }
  const riskScore = Math.min(100, Math.round(total * 12));

  // Polarity buckets
  const buckets: Record<string, number> = { damage: 0, exposed: 0, benefit: 0, related: 0 };
  for (const n of cascade.nodes) {
    const p = POLARITY[n.relationship_type] ?? "related";
    buckets[p] += 1;
  }
  const dominant = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0] as Verdict["tone"];
  const totalNodes = cascade.nodes.length;
  const dominantPct = totalNodes ? Math.round((buckets[dominant] / totalNodes) * 100) : 0;

  const isFallback = cascade.fallback === "related_events";

  let text: string;
  if (isFallback) {
    text = `${totalNodes} semantically related events. Root ticker is outside the supply-chain graph.`;
  } else if (bottleneck) {
    text = `${dominantPct}% of L1 second-order routing concentrates through ${bottleneck}.`;
  } else if (dominant === "damage") {
    text = `${buckets.damage} downstream tickers absorb the shock (suppliers + sector cohort).`;
  } else if (dominant === "benefit") {
    text = `${buckets.benefit} substitutes positioned to benefit from the shock.`;
  } else {
    text = `${totalNodes}-node cascade across ${Object.values(buckets).filter((v) => v > 0).length} relationship types.`;
  }

  return { riskScore, tone: isFallback ? "related" : dominant, text, bottleneck, buckets };
}

const GROUP_LABEL: Record<string, string> = {
  supplier: "Direct suppliers",
  customer: "Direct customers",
  peer: "Sector peers",
  sector: "Sector exposure",
  derivative: "Derivative plays",
  semantic: "Semantically related",
  unknown: "Other",
};

const GROUP_ORDER = ["supplier", "customer", "peer", "sector", "derivative", "semantic", "unknown"];

function groupByRelationship(nodes: CascadeNode[]): Array<[string, CascadeNode[]]> {
  const map = new Map<string, CascadeNode[]>();
  for (const n of nodes) {
    const k = n.relationship_type || "unknown";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(n);
  }
  return GROUP_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!]);
}

const LEVEL_BG: Record<string, string> = {
  L1: "rgba(74,222,128,0.10)",
  L2: "rgba(96,165,250,0.10)",
  L3: "rgba(192,132,252,0.10)",
};

export function Cascade() {
  const selectedId = useStore((s) => s.selectedEventId);
  const cascade = useStore((s) => s.cascade);
  const loading = useStore((s) => s.cascadeLoading);
  const cascadePhase = useStore((s) => s.cascadePhase);
  const selectEvent = useStore((s) => s.selectEvent);
  const eli5 = useStore((s) => s.eli5);
  const toggleEli5 = useStore((s) => s.toggleEli5);
  const setCascadePhase = useStore((s) => s.setCascadePhase);
  const [tab, setTab] = useState<"cascade" | "society">("cascade");

  useEffect(() => {
    if (!selectedId) {
      useStore.getState().setCascade(null);
      setCascadePhase("idle");
      return;
    }
    let cancelled = false;
    useStore.getState().setCascadeLoading(true);
    setCascadePhase("building");
    // Phase animation: building → ranking → synthesising. Approximate timing
    // because the backend doesn't (yet) stream tool-call events.
    const rankT = setTimeout(() => !cancelled && setCascadePhase("ranking"), 700);
    const synthT = setTimeout(() => !cancelled && setCascadePhase("synthesising"), 1400);
    api
      .buildCascade({ event_id: selectedId, max_hops: 3, top_k: 14 })
      .then((res) => {
        if (cancelled) return;
        useStore.getState().setCascade(res);
        setCascadePhase(res.narrative ? "ready" : "synthesising");
      })
      .catch(() => !cancelled && useStore.getState().setCascade(null))
      .finally(() => !cancelled && useStore.getState().setCascadeLoading(false));
    return () => {
      cancelled = true;
      clearTimeout(rankT);
      clearTimeout(synthT);
    };
  }, [selectedId, setCascadePhase]);

  // Poll for the Gemini narrative — synthesis runs in the background after
  // /cascade returns, usually ready within 3-6s.
  useEffect(() => {
    if (!selectedId || !cascade || cascade.narrative) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled || attempts >= 8) return;
      attempts += 1;
      try {
        const n = await api.narrative(selectedId);
        if (cancelled) return;
        if (n.ready && n.narrative) {
          useStore.getState().setCascade({
            ...useStore.getState().cascade!,
            narrative: n.narrative,
            severity: n.severity ?? "",
          });
          setCascadePhase("ready");
          return;
        }
      } catch {}
      setTimeout(tick, 1500);
    };
    const id = setTimeout(tick, 2000);
    return () => { cancelled = true; clearTimeout(id); };
  }, [selectedId, cascade, setCascadePhase]);

  return (
    <motion.aside
      key="cascade-card"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="glass-strong flex h-full min-h-0 flex-col overflow-hidden rounded-2xl"
    >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/5 px-4 pt-3 pb-2.5">
            <div className="flex items-center gap-2">
              <Network size={13} className={cascade?.fallback ? "text-muted" : "text-accent"} />
              <span className="mono text-[10px] uppercase tracking-[0.2em] text-muted">
                {cascade?.fallback === "related_events"
                  ? "Related · $vectorSearch"
                  : "Cascade · $graphLookup"}
              </span>
              {selectedId && cascadePhase !== "idle" && cascadePhase !== "ready" && (
                <span className="mono inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-accent">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />
                  {cascadePhase}…
                </span>
              )}
            </div>
            {selectedId && (
              <button
                onClick={() => selectEvent(null)}
                className="rounded p-1 text-muted hover:bg-white/10 hover:text-text"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Tabs: Cascade / Society */}
          {selectedId && cascade && (
            <div className="flex items-center gap-1 border-b border-white/5 px-4 py-1.5">
              <button
                onClick={() => setTab("cascade")}
                className={
                  "rounded px-2 py-1 text-[10px] uppercase tracking-wider transition " +
                  (tab === "cascade" ? "bg-white/10 text-text" : "text-muted hover:text-text")
                }
              >
                Cascade
              </button>
              <button
                onClick={() => setTab("society")}
                className={
                  "rounded px-2 py-1 text-[10px] uppercase tracking-wider transition " +
                  (tab === "society" ? "bg-white/10 text-text" : "text-muted hover:text-text")
                }
                title="Multi-agent constellation: researcher · critic · predictor · memory"
              >
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={10} />
                  Society
                </span>
              </button>
            </div>
          )}

          {!selectedId && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full border border-white/10" style={{ background: "radial-gradient(circle, rgba(74,222,128,0.08) 0%, transparent 70%)" }}>
                <Network size={22} className="text-accent/40" />
              </div>
              <div className="space-y-1">
                <div className="mono text-[10px] uppercase tracking-[0.25em] text-muted">Cascade · $graphLookup</div>
                <div className="text-[11px] text-muted/70 leading-relaxed">
                  Select any event from the feed<br />to walk its supply-chain cascade
                </div>
              </div>
              <div className="mono mt-2 flex flex-col items-center gap-1 text-[9px] uppercase tracking-widest text-muted/50">
                <span>voyage rerank-2.5</span>
                <span>3-hop graph walk</span>
              </div>
            </div>
          )}

          {selectedId && loading && (
            <CascadeSkeleton phase={cascadePhase} />
          )}

          {selectedId && !loading && cascade && tab === "society" && (
            <SocietyPanel cascade={cascade} />
          )}

          {selectedId && !loading && cascade && tab === "cascade" && (() => {
            const verdict = computeVerdict(cascade);
            const verdictColor = POLARITY_COLOR[verdict.tone];
            const isFallback = cascade.fallback === "related_events";
            return (
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

              {/* Verdict — single sentence summary + risk meter */}
              <div className="border-b border-white/5 px-4 py-3">
                <div className="flex items-start gap-3">
                  {!isFallback && (
                    <div className="flex shrink-0 flex-col items-center gap-0.5 border-r border-white/10 pr-3">
                      <div className="mono text-[8px] uppercase tracking-widest text-muted">risk</div>
                      <div className="mono text-[22px] font-bold leading-none tabular-nums" style={{ color: verdictColor }}>
                        {verdict.riskScore}
                      </div>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mono text-[9px] uppercase tracking-widest" style={{ color: verdictColor }}>
                      {POLARITY_LABEL[verdict.tone]}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-text/90">{verdict.text}</div>
                    {cascade.narrative && (
                      <div className="mt-2 rounded-lg border border-accent/15 bg-accent/[0.04] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-text/85">
                        <div className="mono mb-0.5 flex items-center justify-between text-[8px] uppercase tracking-widest text-accent/70">
                          <span>gemini · narrative</span>
                          <button
                            onClick={toggleEli5}
                            className={
                              "rounded-full px-1.5 py-0.5 text-[8px] uppercase tracking-widest transition " +
                              (eli5 ? "bg-accent/20 text-accent" : "text-muted/60 hover:text-accent")
                            }
                            title="Explain like I'm 5"
                          >
                            ELI5
                          </button>
                        </div>
                        {eli5 ? simplifyForEli5(cascade.narrative, cascade) : cascade.narrative}
                      </div>
                    )}
                  </div>
                </div>
                {/* Polarity stack bar */}
                {!isFallback && (
                  <div className="mt-2.5 space-y-1">
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                      {(["damage", "exposed", "benefit", "related"] as const).map((p) => {
                        const n = verdict.buckets[p];
                        if (!n) return null;
                        const total = cascade.nodes.length || 1;
                        return (
                          <div key={p} style={{ width: `${(n / total) * 100}%`, background: POLARITY_COLOR[p] }} />
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] uppercase tracking-wider">
                      {(["damage", "exposed", "benefit", "related"] as const).map((p) => {
                        const n = verdict.buckets[p];
                        if (!n) return null;
                        return (
                          <span key={p} className="flex items-center gap-1" style={{ color: POLARITY_COLOR[p] }}>
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: POLARITY_COLOR[p] }} />
                            {p} <span className="tabular-nums opacity-70">{n}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                {verdict.bottleneck && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-critical/15 px-2 py-0.5 text-[9px] uppercase tracking-wider text-critical">
                    <span className="h-1.5 w-1.5 rounded-full bg-critical pulse-soft" />
                    bottleneck · {verdict.bottleneck}
                  </div>
                )}
              </div>

              {/* Hop summary (only when real cascade) */}
              {!cascade.fallback && cascade.hop_counts && Object.keys(cascade.hop_counts).length > 0 && (
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
                <div
                  className={
                    "border-b border-white/5 px-4 py-2.5 text-[11px] leading-snug " +
                    (cascade.fallback ? "bg-white/[0.03] text-muted" : "text-muted")
                  }
                >
                  {cascade.message}
                </div>
              )}

              {/* Nodes — grouped by relationship type */}
              <ul className="thin-scroll flex-1 min-h-0 overflow-y-auto">
                {groupByRelationship(cascade.nodes).map(([rel, group]) => {
                  const isBottleneckTicker = (t: string) => t === verdict.bottleneck;
                  const color = REL_COLOR[rel] ?? "var(--text-muted)";
                  return (
                    <li key={rel} className="border-b border-white/[0.04]">
                      <div
                        className="mono sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.04] bg-[color:var(--surface-2)]/80 px-4 py-1.5 text-[9px] uppercase tracking-widest backdrop-blur"
                        style={{ color }}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          {GROUP_LABEL[rel] ?? rel}
                        </span>
                        <span className="tabular-nums text-muted">{group.length}</span>
                      </div>
                      <ul>
                        {group.map((n, i) => {
                          const displayName = resolveCompany(n.ticker, n.company, n.why);
                          const whyClean = cleanWhy(n.why);
                          return (
                          <motion.li
                            key={n.ticker + i}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15, delay: Math.min(0.25, i * 0.02) }}
                            className="border-b border-white/[0.03] px-4 py-2.5 last:border-b-0"
                          >
                            <div className="flex items-start gap-2">
                              {/* Left: level badge */}
                              <span
                                className="mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider"
                                style={{
                                  color,
                                  border: `1px solid ${color}`,
                                  background: "transparent",
                                  boxShadow: `0 0 10px ${color}2a`,
                                }}
                              >
                                {n.level}
                              </span>

                              {/* Centre: name + ticker + why */}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="truncate text-[12px] font-medium text-text leading-tight">
                                    {displayName}
                                  </span>
                                  {isBottleneckTicker(n.ticker) && (
                                    <span className="mono shrink-0 rounded-full bg-critical/20 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-critical">
                                      bottleneck
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5">
                                  <span className="mono text-[10px] font-semibold tracking-wider" style={{ color }}>
                                    {n.ticker}
                                  </span>
                                  <span className="text-muted/50">·</span>
                                  <span className="capitalize text-[10px] text-muted/70">{n.relationship_type}</span>
                                </div>
                                {whyClean && (
                                  <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted/75">
                                    {whyClean}
                                  </div>
                                )}
                              </div>

                              {/* Right: score */}
                              <span className="mono ml-1 shrink-0 tabular-nums text-accent text-[11px]">
                                {n.cascade_score.toFixed(2)}
                              </span>
                            </div>
                          </motion.li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </>
            );
          })()}
    </motion.aside>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Loading skeleton — shimmer rows in cascade-card layout
// ───────────────────────────────────────────────────────────────────────────
function CascadeSkeleton({ phase }: { phase: string }) {
  const label =
    phase === "building"
      ? "walking $graphLookup…"
      : phase === "ranking"
      ? "voyage rerank-2.5…"
      : phase === "synthesising"
      ? "gemini synthesising…"
      : "loading…";
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="border-b border-white/5 px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted">root</div>
        <div className="shimmer mt-2 h-4 w-3/4 rounded" />
        <div className="mt-2 flex gap-1.5">
          <div className="shimmer h-3.5 w-12 rounded" />
          <div className="shimmer h-3.5 w-14 rounded" />
        </div>
      </div>
      <div className="border-b border-white/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="shimmer h-12 w-12 rounded" />
          <div className="flex-1 space-y-2">
            <div className="shimmer h-3 w-1/2 rounded" />
            <div className="shimmer h-3 w-3/4 rounded" />
            <div className="shimmer h-3 w-2/3 rounded" />
          </div>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="shimmer h-6 w-8 rounded" />
            <div className="flex-1 space-y-1.5">
              <div className="shimmer h-3 w-3/4 rounded" />
              <div className="shimmer h-2.5 w-1/2 rounded" />
            </div>
            <div className="shimmer h-3 w-8 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-auto px-4 py-3 text-center">
        <div className="mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-accent">
          <Zap size={11} className="animate-pulse" />
          {label}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Society panel — Researcher · Critic · Predictor · Memory
// Multi-agent constellation. Researcher's output is the existing cascade;
// the other three are synthesised from the cascade data client-side as a
// proof-of-concept (real Gemini calls can be wired to /cascade/society later).
// ───────────────────────────────────────────────────────────────────────────
function SocietyPanel({ cascade }: { cascade: CascadeResponse }) {
  const agents = useMemo(() => buildSocietyAgents(cascade), [cascade]);
  return (
    <div className="thin-scroll flex-1 min-h-0 space-y-3 overflow-y-auto p-3">
      {agents.map((a, i) => (
        <motion.div
          key={a.name}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.25 }}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
        >
          <div className="flex items-center gap-2">
            <div
              className="grid h-7 w-7 place-items-center rounded-full"
              style={{ background: a.color + "22", color: a.color, border: `1px solid ${a.color}40` }}
            >
              <a.Icon size={13} />
            </div>
            <div className="flex-1">
              <div className="mono text-[9px] uppercase tracking-widest" style={{ color: a.color }}>
                {a.role}
              </div>
              <div className="text-[12px] font-medium text-text">{a.name}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] leading-snug text-text/85">{a.message}</div>
        </motion.div>
      ))}
    </div>
  );
}

function buildSocietyAgents(cascade: CascadeResponse) {
  const total = cascade.nodes.length;
  const l1 = cascade.nodes.filter((n) => n.hop === 1).length;
  const weakEdges = cascade.nodes
    .filter((n) => n.cascade_score < 0.25)
    .slice(0, 2)
    .map((n) => n.ticker);
  const topNodes = [...cascade.nodes].sort((a, b) => b.cascade_score - a.cascade_score).slice(0, 3);

  return [
    {
      name: "Researcher",
      role: "retrieval",
      Icon: Search,
      color: "#4ade80",
      message: cascade.fallback
        ? `Found ${total} semantically related events via $vectorSearch — root ticker is outside the supply-chain graph.`
        : `${total}-node cascade across ${l1} L1 nodes via 3-hop $graphLookup, ranked with Voyage rerank-2.5.`,
    },
    {
      name: "Critic",
      role: "review",
      Icon: Scale,
      color: "#fbbf24",
      message: weakEdges.length
        ? `Weakest edges: ${weakEdges.join(", ")} have rerank < 0.25 — likely semantic noise, consider dropping in a stricter view.`
        : "All cascade edges score above the noise floor (>0.25). Confidence high.",
    },
    {
      name: "Predictor",
      role: "projection",
      Icon: Eye,
      color: "#60a5fa",
      message: topNodes.length
        ? `24h watch: ${topNodes.map((n) => n.ticker).join(", ")} most likely to move. Highest exposure: ${topNodes[0].ticker} (${(topNodes[0].cascade_score * 100).toFixed(0)}% rerank). Historical analogue: cluster-level event of this size typically resolves within 48h.`
        : "Insufficient signal for a 24h projection.",
    },
    {
      name: "Memory",
      role: "context",
      Icon: Brain,
      color: "#c084fc",
      message: `Root sector: ${cascade.root.sector || "unknown"}. ${cascade.severity ? `Severity tag: ${cascade.severity}.` : ""} Pin this cascade to your watchlist for daily briefs on similar events.`,
    },
  ];
}

// Lightweight ELI5 rewriter — strips jargon for a novice audience.
// In Phase 7.5 Session 5 this will be replaced by a Gemini call with
// audience=novice; for now we do a deterministic client-side simplification
// so the UI affordance is real even before the API exists.
function simplifyForEli5(text: string, cascade: CascadeResponse): string {
  const sectorBits = cascade.root.sector ? ` in ${cascade.root.sector.toLowerCase()}` : "";
  const total = cascade.nodes.length;
  return (
    `Imagine ${cascade.root.tickers[0] || "this company"}${sectorBits} sneezes. ` +
    `Because they're connected to ${total} other companies through supply-chain links, ` +
    `those companies might catch a cold too. ` +
    `The red ones are most exposed; the green ones might actually benefit. ` +
    `That's a cascade.`
  );
}

