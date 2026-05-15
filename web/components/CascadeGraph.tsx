"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "@/lib/store";
import type { CascadeNode, CascadeEdge, CascadeResponse } from "@/lib/api";

const REL_COLOR: Record<string, string> = {
  supplier: "#4ade80",
  customer: "#60a5fa",
  peer: "#c084fc",
  sector: "#fbbf24",
  derivative: "#f472b6",
  semantic: "#94a3b8",
  root: "#ff4d6d",
};

// Ring radii per hop level
const RING_R: Record<number, number> = { 0: 0, 1: 150, 2: 265, 3: 345 };
const ROOT_R = 22;
const NODE_R = 12;

interface Vec { x: number; y: number }

interface PlacedNode extends Vec {
  ticker: string;
  company: string;
  color: string;
  level: string;
  hop: number;
  score: number;
  relType: string;
  isRoot: boolean;
}

interface PlacedEdge {
  from: Vec;
  to: Vec;
  cx: number; // bezier control point
  cy: number;
  color: string;
  pathId: string;
  length: number;
}

function buildLayout(
  cascade: CascadeResponse | null,
  W: number,
  H: number,
): { nodes: PlacedNode[]; edges: PlacedEdge[] } {
  const ox = W / 2;
  const oy = H / 2;
  const nodes: PlacedNode[] = [];
  const edges: PlacedEdge[] = [];
  if (!cascade) return { nodes, edges };

  // Root at center
  nodes.push({
    ticker: cascade.root.tickers[0] ?? "—",
    company: (cascade.root.headline ?? "").slice(0, 30),
    x: ox, y: oy,
    color: "#ff4d6d",
    level: "ROOT", hop: 0, score: 1, relType: "root", isRoot: true,
  });

  // Group by hop; clamp hop to 1-3 so nothing goes to center
  const byHop = new Map<number, CascadeNode[]>();
  for (const n of cascade.nodes) {
    const h = Math.max(1, n.hop ?? 1);
    if (!byHop.has(h)) byHop.set(h, []);
    byHop.get(h)!.push(n);
  }

  const posMap = new Map<string, Vec>();
  posMap.set(cascade.root.tickers[0] ?? "ROOT", { x: ox, y: oy });

  // Place each hop ring
  for (const [hop, group] of [...byHop.entries()].sort((a, b) => a[0] - b[0])) {
    const r = RING_R[hop] ?? 345;
    const count = group.length;
    // Spread evenly, offset by hop * 15° to break perfect stacking on small groups
    const offsetAngle = (hop * Math.PI) / 6 - Math.PI / 2;
    group.forEach((n, i) => {
      const angle = offsetAngle + (2 * Math.PI / count) * i;
      const x = ox + r * Math.cos(angle);
      const y = oy + r * Math.sin(angle);
      const color = REL_COLOR[n.relationship_type] ?? "#94a3b8";
      nodes.push({
        ticker: n.ticker, company: (n.company ?? "").slice(0, 20),
        x, y, color, level: n.level, hop, score: n.cascade_score,
        relType: n.relationship_type, isRoot: false,
      });
      posMap.set(n.ticker, { x, y });
    });
  }

  // Build curved edges
  const seen = new Set<string>();
  const allEdges: CascadeEdge[] = cascade.edges.length > 0
    ? cascade.edges
    // For semantic fallback, synthesise root→node edges
    : cascade.nodes.map((n: CascadeNode) => ({ from: cascade.root.tickers[0] ?? "", to: n.ticker, type: n.relationship_type, weight: n.cascade_score, hop: 1 }));

  for (const e of allEdges.slice(0, 60)) {
    const key = `${e.from}→${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = posMap.get(e.from) ?? { x: ox, y: oy };
    const t = posMap.get(e.to);
    if (!t) continue;
    // Quadratic bezier control point: pull slightly toward center for organic curves
    const mx = (f.x + t.x) / 2;
    const my = (f.y + t.y) / 2;
    // Offset control point toward/away from center for curvature
    const dx = ox - mx;
    const dy = oy - my;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const curveFactor = 0.25;
    const cx = mx + (dx / d) * d * curveFactor;
    const cy = my + (dy / d) * d * curveFactor;
    // Approximate path length for dash animation
    const len = Math.sqrt((t.x - f.x) ** 2 + (t.y - f.y) ** 2) * 1.1;
    edges.push({ from: f, to: t, cx, cy, color: REL_COLOR[e.type] ?? "#94a3b8", pathId: key.replace(/[^a-zA-Z0-9]/g, "_"), length: len });
  }

  return { nodes, edges };
}

// Animated particle that travels along a bezier path
function FlowParticle({ edge, delay }: { edge: PlacedEdge; delay: number }) {
  const ref = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const path = document.getElementById(`path_${edge.pathId}`) as SVGPathElement | null;
    if (!path) return;
    const len = path.getTotalLength();
    let frame = 0;
    let start = 0;
    const duration = 1800 + delay * 200;
    const animate = (ts: number) => {
      if (!start) start = ts + delay * 120;
      const t = ((ts - start) % duration) / duration;
      if (t >= 0 && t <= 1) {
        try {
          const pt = path.getPointAtLength(t * len);
          el.setAttribute("cx", String(pt.x));
          el.setAttribute("cy", String(pt.y));
          el.style.opacity = String(Math.sin(t * Math.PI) * 0.9);
        } catch {}
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [edge, delay]);

  return (
    <circle
      ref={ref}
      r={2.5}
      fill={edge.color}
      style={{ filter: `drop-shadow(0 0 4px ${edge.color})`, opacity: 0 }}
    />
  );
}

export function CascadeGraph() {
  const cascade = useStore((s) => s.cascade);
  const loading = useStore((s) => s.cascadeLoading);
  const selectedId = useStore((s) => s.selectedEventId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 760, h: 560 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(400, r.width), h: Math.max(320, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = useMemo(
    () => buildLayout(cascade, size.w, size.h),
    [cascade, size],
  );

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <div className="space-y-2 px-8">
          <div className="mono text-[10px] uppercase tracking-[0.3em] text-muted">Cascade graph</div>
          <div className="text-[12px] text-muted/60 leading-relaxed">
            Select an event from the feed<br />to render its supply-chain graph
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className="h-8 w-8 rounded-full border border-accent/30 border-t-accent animate-spin" />
        <div className="mono text-[11px] uppercase tracking-wider text-accent/70">walking graph…</div>
      </div>
    );
  }

  if (!cascade) return null;

  const isSemantic = cascade.fallback === "related_events";

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {/* CSS keyframe for flowing edges */}
      <style>{`
        @keyframes flow {
          from { stroke-dashoffset: 300; }
          to   { stroke-dashoffset: 0; }
        }
        .flow-edge {
          animation: flow 2.4s linear infinite;
        }
      `}</style>

      <svg
        viewBox={`0 0 ${size.w} ${size.h}`}
        width={size.w}
        height={size.h}
        className="absolute inset-0"
      >
        <defs>
          <radialGradient id="rootHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff4d6d" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ff4d6d" stopOpacity="0" />
          </radialGradient>
          {edges.map((e) => (
            <radialGradient key={`grad_${e.pathId}`} id={`grad_${e.pathId}`} cx="0%" cy="50%" r="100%" gradientUnits="userSpaceOnUse"
              x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
            >
              <stop offset="0%" stopColor={e.color} stopOpacity="0.6" />
              <stop offset="100%" stopColor={e.color} stopOpacity="0.1" />
            </radialGradient>
          ))}
        </defs>

        {/* Orbit rings */}
        {[1, 2, 3].map((h) => (
          <motion.circle
            key={`ring-${h}`}
            cx={size.w / 2} cy={size.h / 2}
            r={RING_R[h]}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
            strokeDasharray="3 8"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: h * 0.12, ease: "easeOut" }}
            style={{ transformOrigin: `${size.w / 2}px ${size.h / 2}px` }}
          />
        ))}

        {/* Edges — curved bezier with flow animation */}
        {edges.map((e, i) => (
          <g key={e.pathId}>
            {/* Dim base path */}
            <path
              id={`path_${e.pathId}`}
              d={`M ${e.from.x} ${e.from.y} Q ${e.cx} ${e.cy} ${e.to.x} ${e.to.y}`}
              fill="none"
              stroke={e.color}
              strokeWidth={1}
              strokeOpacity={0.18}
            />
            {/* Animated flow dash */}
            <motion.path
              d={`M ${e.from.x} ${e.from.y} Q ${e.cx} ${e.cy} ${e.to.x} ${e.to.y}`}
              fill="none"
              stroke={e.color}
              strokeWidth={1.5}
              strokeOpacity={0.7}
              strokeLinecap="round"
              strokeDasharray="18 40"
              className="flow-edge"
              style={{ animationDelay: `${i * 0.08}s`, filter: `drop-shadow(0 0 3px ${e.color})` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.04 }}
            />
            {/* Travelling particle */}
            <FlowParticle edge={e} delay={i} />
          </g>
        ))}

        {/* Root glow halo */}
        <motion.circle
          cx={size.w / 2} cy={size.h / 2} r={60}
          fill="url(#rootHalo)"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{ transformOrigin: `${size.w / 2}px ${size.h / 2}px` }}
        />

        {/* Nodes */}
        {nodes.map((n, i) => (
          <motion.g
            key={n.ticker + i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 18, delay: n.isRoot ? 0 : 0.15 + i * 0.035 }}
            style={{ transformOrigin: `${n.x}px ${n.y}px` }}
          >
            {/* Outer pulse ring for root */}
            {n.isRoot && (
              <>
                <motion.circle cx={n.x} cy={n.y} r={ROOT_R + 10}
                  fill="none" stroke="#ff4d6d" strokeWidth={1} strokeOpacity={0.3}
                  animate={{ r: [ROOT_R + 8, ROOT_R + 18, ROOT_R + 8], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.circle cx={n.x} cy={n.y} r={ROOT_R + 4}
                  fill="none" stroke="#ff4d6d" strokeWidth={1} strokeOpacity={0.5}
                  animate={{ r: [ROOT_R + 2, ROOT_R + 12, ROOT_R + 2], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
                />
              </>
            )}

            {/* Score arc (ring behind node for non-root) */}
            {!n.isRoot && n.score > 0.1 && (
              <circle
                cx={n.x} cy={n.y} r={NODE_R + 5}
                fill="none"
                stroke={n.color}
                strokeWidth={2}
                strokeOpacity={0.25}
                strokeDasharray={`${n.score * (2 * Math.PI * (NODE_R + 5))} 9999`}
                transform={`rotate(-90 ${n.x} ${n.y})`}
              />
            )}

            {/* Filled node circle */}
            <circle
              cx={n.x} cy={n.y}
              r={n.isRoot ? ROOT_R : NODE_R}
              fill={`${n.color}18`}
              stroke={n.color}
              strokeWidth={n.isRoot ? 2.5 : 1.5}
              style={{ filter: `drop-shadow(0 0 ${n.isRoot ? 12 : 6}px ${n.color}88)` }}
            />

            {/* Ticker label */}
            <text
              x={n.x} y={n.isRoot ? n.y + 5 : n.y + 4}
              textAnchor="middle"
              fill={n.color}
              fontSize={n.isRoot ? 11 : 8}
              fontFamily="ui-monospace, monospace"
              fontWeight={700}
              style={{ userSelect: "none", paintOrder: "stroke", stroke: "rgba(4,6,10,0.8)", strokeWidth: 3 }}
            >
              {n.ticker.slice(0, 5)}
            </text>

            {/* Company name */}
            <text
              x={n.x}
              y={n.y + (n.isRoot ? ROOT_R + 14 : NODE_R + 12)}
              textAnchor="middle"
              fill="rgba(139,150,168,0.75)"
              fontSize={7}
              fontFamily="ui-sans-serif, sans-serif"
              style={{ userSelect: "none" }}
            >
              {n.company}
            </text>
          </motion.g>
        ))}
      </svg>

      {/* Top badge */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        {isSemantic && (
          <span className="mono rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted">
            semantic · $vectorSearch
          </span>
        )}
        {!isSemantic && (
          <span className="mono rounded-full bg-accent/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-accent/80">
            {cascade.nodes.length} nodes · $graphLookup
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-0 right-0 flex flex-wrap justify-center gap-x-3 gap-y-1 px-4 text-[8.5px] font-mono uppercase tracking-widest">
        {Object.entries(REL_COLOR)
          .filter(([k]) => k !== "root" && cascade.nodes.some((n) => n.relationship_type === k))
          .map(([k, v]) => (
            <span key={k} className="flex items-center gap-1" style={{ color: v }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: v }} />
              {k}
            </span>
          ))}
      </div>
    </div>
  );
}
