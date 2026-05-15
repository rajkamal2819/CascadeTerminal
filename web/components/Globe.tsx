"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";

// react-globe.gl needs WebGL + window; SSR-disabled, and we delay mount so
// the page paints instantly with a skeleton instead of blocking on three.js.
const GlobeGL = dynamic(() => import("react-globe.gl"), { ssr: false });

// HQ coordinates for the most-referenced tickers in our seed graph.
const HQ: Record<string, { lat: number; lng: number; name: string }> = {
  AAPL: { lat: 37.3349, lng: -122.0090, name: "Apple" },
  MSFT: { lat: 47.6396, lng: -122.1281, name: "Microsoft" },
  GOOGL: { lat: 37.4220, lng: -122.0841, name: "Alphabet" },
  AMZN: { lat: 47.6228, lng: -122.3375, name: "Amazon" },
  META: { lat: 37.4848, lng: -122.1484, name: "Meta" },
  NVDA: { lat: 37.3711, lng: -121.9619, name: "NVIDIA" },
  TSLA: { lat: 30.2225, lng: -97.7666, name: "Tesla" },
  TSM: { lat: 24.7740, lng: 120.9982, name: "TSMC" },
  AMD: { lat: 37.3825, lng: -121.9627, name: "AMD" },
  INTC: { lat: 37.3879, lng: -121.9636, name: "Intel" },
  AVGO: { lat: 37.4419, lng: -122.1430, name: "Broadcom" },
  AMAT: { lat: 37.4053, lng: -121.9876, name: "Applied Materials" },
  MU: { lat: 43.6150, lng: -116.2023, name: "Micron" },
  SMCI: { lat: 37.3865, lng: -121.9842, name: "Super Micro" },
  ORCL: { lat: 30.2240, lng: -97.7460, name: "Oracle" },
  CRM: { lat: 37.7898, lng: -122.3942, name: "Salesforce" },
  JPM: { lat: 40.7558, lng: -73.9787, name: "JPMorgan" },
  GS: { lat: 40.7141, lng: -74.0144, name: "Goldman Sachs" },
  XOM: { lat: 32.9667, lng: -96.8333, name: "Exxon" },
  CVX: { lat: 37.5217, lng: -122.0292, name: "Chevron" },
};

const DEFAULT_HQ = { lat: 40.7128, lng: -74.006, name: "—" };

const REL_COLOR: Record<string, string> = {
  supplier: "#4ade80",
  customer: "#60a5fa",
  peer: "#c084fc",
  sector: "#fbbf24",
  derivative: "#f472b6",
};

const IMPACT_COLOR: Record<string, string> = {
  critical: "#ff4d6d",
  high: "#fbbf24",
  medium: "#8b96a8",
  low: "#4b5563",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Globe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<any>(null);
  const events = useStore((s) => s.events);
  const cascade = useStore((s) => s.cascade);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Defer mount one frame so the rest of the UI paints first.
    const t = setTimeout(() => setShown(true), 30);
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.max(300, rect.width), height: Math.max(300, rect.height) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Background event pulses (latest events as points on the globe).
  const points = useMemo(() => {
    return events.slice(0, 120).map((e) => {
      const t = e.tickers[0];
      const hq = (t && HQ[t]) || DEFAULT_HQ;
      return {
        lat: hq.lat,
        lng: hq.lng,
        size: e.impact === "critical" ? 0.45 : e.impact === "high" ? 0.3 : 0.18,
        color: IMPACT_COLOR[e.impact] ?? "#8b96a8",
        label: `${t ?? e.source_type}: ${e.headline?.slice(0, 80) ?? ""}`,
      };
    });
  }, [events]);

  // Cascade arcs — emphasised when a cascade is selected.
  const arcs = useMemo(() => {
    if (!cascade) return [];
    return cascade.edges.slice(0, 80).map((edge) => {
      const from = HQ[edge.from] ?? DEFAULT_HQ;
      const to = HQ[edge.to] ?? DEFAULT_HQ;
      return {
        startLat: from.lat,
        startLng: from.lng,
        endLat: to.lat,
        endLng: to.lng,
        color: [REL_COLOR[edge.type] ?? "#ffffff", REL_COLOR[edge.type] ?? "#ffffff"],
        stroke: 0.35 + edge.weight * 0.4,
        hop: edge.hop,
      };
    });
  }, [cascade]);

  // Ring halos: root tickers glow critical-red, cascade nodes glow rel-color.
  const rings = useMemo(() => {
    if (!cascade) return [];
    const out: Array<{ lat: number; lng: number; color: string; maxR: number; period: number }> = [];
    for (const t of cascade.root.tickers) {
      const hq = HQ[t] ?? DEFAULT_HQ;
      out.push({ lat: hq.lat, lng: hq.lng, color: "#ff4d6d", maxR: 4.5, period: 1400 });
    }
    for (const n of cascade.nodes) {
      const hq = HQ[n.ticker] ?? DEFAULT_HQ;
      out.push({
        lat: hq.lat,
        lng: hq.lng,
        color: REL_COLOR[n.relationship_type] ?? "#ffffff",
        maxR: 2.5 + n.cascade_score * 2,
        period: 1700 + n.hop * 200,
      });
    }
    return out;
  }, [cascade]);

  // Idle auto-rotate, slowed when a cascade is on-screen.
  useEffect(() => {
    const g = globeRef.current;
    if (!g?.controls) return;
    const c = g.controls();
    c.autoRotate = true;
    c.autoRotateSpeed = cascade ? 0.15 : 0.45;
    c.enableZoom = false;
  }, [cascade, shown]);

  // When a cascade lands, zoom toward the root's HQ.
  useEffect(() => {
    const g = globeRef.current;
    if (!g?.pointOfView || !cascade) return;
    const t = cascade.root.tickers[0];
    const hq = (t && HQ[t]) || DEFAULT_HQ;
    g.pointOfView({ lat: hq.lat, lng: hq.lng, altitude: 1.9 }, 1400);
  }, [cascade]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {!shown && <GlobeSkeleton />}
      {shown && (
        <GlobeGL
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          showAtmosphere
          atmosphereColor={cascade ? "#ff4d6d" : "#4ade80"}
          atmosphereAltitude={0.22}
          pointsData={points}
          pointAltitude={(d: any) => d.size}
          pointColor={(d: any) => d.color}
          pointLabel={(d: any) => d.label}
          pointRadius={0.5}
          pointResolution={6}
          arcsData={arcs}
          arcColor={(d: any) => d.color}
          arcStroke={(d: any) => d.stroke}
          arcDashLength={0.45}
          arcDashGap={0.15}
          arcDashAnimateTime={(d: any) => 1800 + d.hop * 300}
          arcAltitudeAutoScale={0.5}
          ringsData={rings}
          ringColor={(d: any) => () => d.color}
          ringMaxRadius={(d: any) => d.maxR}
          ringPropagationSpeed={2.5}
          ringRepeatPeriod={(d: any) => d.period}
        />
      )}

      {/* Vignette so the rim text reads cleanly */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 70% at 50% 50%, transparent 60%, rgba(4,6,10,0.55) 100%)",
        }}
      />
    </div>
  );
}

function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative h-72 w-72 rounded-full opacity-50">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 35%, rgba(74,222,128,0.25) 0%, transparent 60%), radial-gradient(circle at 70% 70%, rgba(96,165,250,0.18) 0%, transparent 60%)",
          }}
        />
        <div className="pulse-ring absolute inset-0 rounded-full border border-white/10" />
      </div>
    </div>
  );
}
