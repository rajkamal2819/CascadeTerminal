"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";

const GlobeGL = dynamic(() => import("react-globe.gl"), { ssr: false });

// HQ coordinates + city label for the most-referenced tickers.
// City names are shown when a cascade is active so judges can read
// "where" cascades originate / propagate to.
const HQ: Record<string, { lat: number; lng: number; name: string; city: string }> = {
  AAPL: { lat: 37.3349, lng: -122.0090, name: "Apple", city: "Cupertino" },
  MSFT: { lat: 47.6396, lng: -122.1281, name: "Microsoft", city: "Redmond" },
  GOOGL: { lat: 37.4220, lng: -122.0841, name: "Alphabet", city: "Mountain View" },
  AMZN: { lat: 47.6228, lng: -122.3375, name: "Amazon", city: "Seattle" },
  META: { lat: 37.4848, lng: -122.1484, name: "Meta", city: "Menlo Park" },
  NVDA: { lat: 37.3711, lng: -121.9619, name: "NVIDIA", city: "Santa Clara" },
  TSLA: { lat: 30.2225, lng: -97.7666, name: "Tesla", city: "Austin" },
  TSM: { lat: 24.7740, lng: 120.9982, name: "TSMC", city: "Hsinchu" },
  AMD: { lat: 37.3825, lng: -121.9627, name: "AMD", city: "Santa Clara" },
  INTC: { lat: 37.3879, lng: -121.9636, name: "Intel", city: "Santa Clara" },
  AVGO: { lat: 37.4419, lng: -122.1430, name: "Broadcom", city: "Palo Alto" },
  AMAT: { lat: 37.4053, lng: -121.9876, name: "Applied Materials", city: "Santa Clara" },
  MU: { lat: 43.6150, lng: -116.2023, name: "Micron", city: "Boise" },
  SMCI: { lat: 37.3865, lng: -121.9842, name: "Super Micro", city: "San Jose" },
  ORCL: { lat: 30.2240, lng: -97.7460, name: "Oracle", city: "Austin" },
  CRM: { lat: 37.7898, lng: -122.3942, name: "Salesforce", city: "San Francisco" },
  JPM: { lat: 40.7558, lng: -73.9787, name: "JPMorgan", city: "New York" },
  GS: { lat: 40.7141, lng: -74.0144, name: "Goldman Sachs", city: "New York" },
  MS: { lat: 40.7614, lng: -73.9776, name: "Morgan Stanley", city: "New York" },
  BAC: { lat: 35.2271, lng: -80.8431, name: "Bank of America", city: "Charlotte" },
  WFC: { lat: 37.7901, lng: -122.4019, name: "Wells Fargo", city: "San Francisco" },
  C: { lat: 40.7128, lng: -74.0060, name: "Citigroup", city: "New York" },
  XOM: { lat: 32.9667, lng: -96.8333, name: "Exxon", city: "Irving, TX" },
  CVX: { lat: 32.7833, lng: -96.8000, name: "Chevron", city: "Houston" },
  WMT: { lat: 36.3729, lng: -94.2088, name: "Walmart", city: "Bentonville" },
  HD: { lat: 33.8500, lng: -84.3625, name: "Home Depot", city: "Atlanta" },
  PG: { lat: 39.1031, lng: -84.5120, name: "P&G", city: "Cincinnati" },
  KO: { lat: 33.7660, lng: -84.3877, name: "Coca-Cola", city: "Atlanta" },
  PEP: { lat: 41.0700, lng: -73.7090, name: "PepsiCo", city: "Purchase, NY" },
  JNJ: { lat: 40.4969, lng: -74.4407, name: "J&J", city: "New Brunswick" },
  PFE: { lat: 40.7506, lng: -73.9756, name: "Pfizer", city: "New York" },
  UNH: { lat: 44.9637, lng: -93.4031, name: "UnitedHealth", city: "Minnetonka" },
  V: { lat: 37.7771, lng: -122.4196, name: "Visa", city: "San Francisco" },
  MA: { lat: 40.9710, lng: -73.7610, name: "Mastercard", city: "Purchase, NY" },
  DIS: { lat: 34.1561, lng: -118.3236, name: "Disney", city: "Burbank" },
  NFLX: { lat: 37.2580, lng: -121.9706, name: "Netflix", city: "Los Gatos" },
  BA: { lat: 41.8521, lng: -87.6314, name: "Boeing", city: "Arlington, VA" },
  CAT: { lat: 32.7767, lng: -96.7970, name: "Caterpillar", city: "Irving, TX" },
  GE: { lat: 42.3653, lng: -71.0856, name: "GE", city: "Boston" },
  F: { lat: 42.3223, lng: -83.2179, name: "Ford", city: "Dearborn" },
  GM: { lat: 42.3354, lng: -83.0398, name: "GM", city: "Detroit" },
  // Non-US anchors useful for geopolitical cascades
  ASML: { lat: 51.4108, lng: 5.4530, name: "ASML", city: "Veldhoven" },
  SSNLF: { lat: 37.2580, lng: 127.0470, name: "Samsung", city: "Suwon" },
  BABA: { lat: 30.2741, lng: 120.1551, name: "Alibaba", city: "Hangzhou" },
};

const DEFAULT_HQ = { lat: 40.7128, lng: -74.006, name: "—", city: "" };

const REL_COLOR: Record<string, string> = {
  supplier: "#4ade80",
  customer: "#60a5fa",
  peer: "#c084fc",
  sector: "#fbbf24",
  derivative: "#f472b6",
  semantic: "#94a3b8",
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
  const selectEvent = useStore((s) => s.selectEvent);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [shown, setShown] = useState(false);

  useEffect(() => {
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

  // Background event pulses — sized by impact, carry event id for click-to-select.
  const points = useMemo(() => {
    return events.slice(0, 150).map((e) => {
      const t = e.tickers[0];
      const hq = (t && HQ[t]) || DEFAULT_HQ;
      const isCrit = e.impact === "critical";
      const isHigh = e.impact === "high";
      return {
        id: e.id,
        lat: hq.lat,
        lng: hq.lng,
        altitude: isCrit ? 0.42 : isHigh ? 0.25 : 0.08,
        radius: isCrit ? 0.95 : isHigh ? 0.7 : 0.45,
        color: IMPACT_COLOR[e.impact] ?? "#8b96a8",
        ticker: t ?? "",
        impact: e.impact,
        headline: e.headline || e.source_type,
      };
    });
  }, [events]);

  // Cascade arcs.
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
        stroke: 0.4 + edge.weight * 0.45,
        hop: edge.hop,
      };
    });
  }, [cascade]);

  // Halos for root + cascade tickers.
  const rings = useMemo(() => {
    if (!cascade) return [];
    const out: Array<{ lat: number; lng: number; color: string; maxR: number; period: number }> = [];
    for (const t of cascade.root.tickers) {
      const hq = HQ[t] ?? DEFAULT_HQ;
      out.push({ lat: hq.lat, lng: hq.lng, color: "#ff4d6d", maxR: 5, period: 1300 });
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

  // City labels — when a cascade is active, name the cities at root + node HQs.
  // When idle, label the top-impact event cities so the globe always teaches
  // the viewer something about where the news is happening.
  const labels = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ lat: number; lng: number; text: string; size: number; color: string }> = [];
    const add = (ticker: string, color: string, size: number) => {
      const hq = HQ[ticker];
      if (!hq || seen.has(ticker)) return;
      seen.add(ticker);
      out.push({ lat: hq.lat, lng: hq.lng, text: `${ticker} · ${hq.city}`, size, color });
    };
    if (cascade) {
      for (const t of cascade.root.tickers) add(t, "#ff4d6d", 0.9);
      for (const n of cascade.nodes.slice(0, 10)) add(n.ticker, REL_COLOR[n.relationship_type] ?? "#fff", 0.7);
    } else {
      for (const e of events.slice(0, 40)) {
        if (e.impact === "critical" || e.impact === "high") {
          const t = e.tickers[0];
          if (t && HQ[t]) add(t, IMPACT_COLOR[e.impact], 0.65);
        }
      }
    }
    return out.slice(0, 15);
  }, [cascade, events]);

  // Idle auto-rotate. Constrain zoom so users can dive in without pixelation.
  useEffect(() => {
    const g = globeRef.current;
    if (!g?.controls) return;
    const c = g.controls();
    c.autoRotate = !cascade;
    c.autoRotateSpeed = cascade ? 0 : 0.35;
    c.enableZoom = true;
    c.minDistance = 180;
    c.maxDistance = 480;
    c.zoomSpeed = 0.6;
    c.rotateSpeed = 0.7;
  }, [cascade, shown]);

  // When a cascade lands, fly toward the root.
  useEffect(() => {
    const g = globeRef.current;
    if (!g?.pointOfView || !cascade) return;
    const t = cascade.root.tickers[0];
    const hq = (t && HQ[t]) || DEFAULT_HQ;
    g.pointOfView({ lat: hq.lat, lng: hq.lng, altitude: 1.7 }, 1400);
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
          atmosphereColor={cascade ? "#ff4d6d" : "#3b82f6"}
          atmosphereAltitude={0.28}
          pointsData={points}
          pointAltitude={(d: any) => d.altitude}
          pointColor={(d: any) => d.color}
          pointRadius={(d: any) => d.radius}
          pointResolution={8}
          pointLabel={(d: any) =>
            `<div style="font-family:ui-monospace;font-size:11px;padding:6px 8px;background:rgba(8,12,20,0.92);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e6edf3;max-width:280px;">
              <div style="font-weight:600;color:${d.color}">${d.ticker} · ${(d.impact || "").toUpperCase()}</div>
              <div style="margin-top:2px;color:#8b96a8;font-family:system-ui">${(d.headline || "").slice(0, 120)}</div>
            </div>`
          }
          onPointClick={(p: any) => p?.id && selectEvent(p.id)}
          arcsData={arcs}
          arcColor={(d: any) => d.color}
          arcStroke={(d: any) => d.stroke}
          arcDashLength={0.4}
          arcDashGap={0.12}
          arcDashAnimateTime={(d: any) => 1700 + d.hop * 300}
          arcAltitudeAutoScale={0.55}
          ringsData={rings}
          ringColor={(d: any) => () => d.color}
          ringMaxRadius={(d: any) => d.maxR}
          ringPropagationSpeed={2.6}
          ringRepeatPeriod={(d: any) => d.period}
          labelsData={labels}
          labelLat={(d: any) => d.lat}
          labelLng={(d: any) => d.lng}
          labelText={(d: any) => d.text}
          labelSize={(d: any) => d.size}
          labelDotRadius={0.25}
          labelColor={(d: any) => d.color}
          labelResolution={2}
          labelAltitude={0.02}
        />
      )}

      {/* Vignette */}
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
