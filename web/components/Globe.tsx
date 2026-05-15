"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";

// react-globe.gl uses WebGL + window, so it must be SSR-disabled.
const GlobeGL = dynamic(() => import("react-globe.gl"), { ssr: false });

// Approx HQ coordinates for the most-referenced tickers in our seed graph.
// Used to position globe points when an event arrives. Falls back to
// New York if a ticker isn't mapped.
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

const IMPACT_COLOR: Record<string, string> = {
  critical: "#f87171",
  high: "#fbbf24",
  medium: "#8b949e",
  low: "#4b5563",
};

type GlobeRefAny = { pointOfView?: (pov: { lat: number; lng: number; altitude: number }, ms?: number) => void; controls?: () => { autoRotate: boolean; autoRotateSpeed: number } };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Globe() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<any>(null);
  const events = useStore((s) => s.events);
  const cascade = useStore((s) => s.cascade);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.max(300, rect.width), height: Math.max(300, rect.height) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // One globe point per event (use first ticker for position).
  const points = useMemo(() => {
    return events.slice(0, 200).map((e) => {
      const t = e.tickers[0];
      const hq = (t && HQ[t]) || DEFAULT_HQ;
      return {
        lat: hq.lat,
        lng: hq.lng,
        size: e.impact === "critical" ? 0.45 : e.impact === "high" ? 0.3 : 0.18,
        color: IMPACT_COLOR[e.impact] ?? "#8b949e",
        label: `${t ?? e.source_type}: ${e.headline?.slice(0, 80) ?? ""}`,
      };
    });
  }, [events]);

  // Animated arcs for the currently-selected cascade.
  const arcs = useMemo(() => {
    if (!cascade) return [];
    return cascade.edges.slice(0, 60).map((edge) => {
      const from = HQ[edge.from] ?? DEFAULT_HQ;
      const to = HQ[edge.to] ?? DEFAULT_HQ;
      return {
        startLat: from.lat,
        startLng: from.lng,
        endLat: to.lat,
        endLng: to.lng,
        color: edge.type === "supplier" ? "#4ade80" : edge.type === "customer" ? "#60a5fa" : "#a78bfa",
      };
    });
  }, [cascade]);

  // Auto-rotate idle; stop while a cascade is selected to keep arcs readable.
  useEffect(() => {
    const g = globeRef.current;
    if (!g?.controls) return;
    const c = g.controls();
    c.autoRotate = !cascade;
    c.autoRotateSpeed = 0.4;
  }, [cascade, mounted]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {mounted && (
        <GlobeGL
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          pointsData={points}
          pointAltitude={(d: any) => d.size}
          pointColor={(d: any) => d.color}
          pointLabel={(d: any) => d.label}
          pointRadius={0.45}
          arcsData={arcs}
          arcColor={(d: any) => d.color}
          arcDashLength={0.4}
          arcDashGap={0.15}
          arcDashAnimateTime={2200}
          arcStroke={0.5}
          atmosphereColor="#4ade80"
          atmosphereAltitude={0.18}
        />
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-muted">
        {events.length} events · {arcs.length} cascade edges
      </div>
    </div>
  );
}
