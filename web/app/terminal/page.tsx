"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Cascade } from "@/components/Cascade";
import { Feed } from "@/components/Feed";
import { Globe } from "@/components/Globe";
import { SearchBar } from "@/components/SearchBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, type StatsResponse } from "@/lib/api";
import { useLiveEvents } from "@/lib/sse";
import { useStore } from "@/lib/store";

export default function TerminalPage() {
  useLiveEvents();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const selectEvent = useStore((s) => s.selectEvent);
  const selectedId = useStore((s) => s.selectedEventId);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .stats(72)
        .then((s) => alive && setStats(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="terminal-bg relative h-screen overflow-hidden text-text">
      {/* Full-bleed Globe behind everything */}
      <div className="absolute inset-0">
        <Globe />
      </div>

      {/* Top bar — floats */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-4 py-3">
        <div className="pointer-events-auto flex items-center gap-3">
          <Link
            href="/"
            className="glass mono inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-[0.25em] text-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" style={{ boxShadow: "0 0 10px var(--accent-glow)" }} />
            CASCADE
          </Link>
          <span className="hidden text-[10px] uppercase tracking-[0.2em] text-muted sm:inline">terminal</span>
        </div>
        <div className="pointer-events-auto flex-1 flex justify-center">
          <SearchBar
            onResults={(hits) => {
              if (hits[0]) selectEvent(hits[0].id);
            }}
          />
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      {/* Left Feed rail — floats */}
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className="pointer-events-auto absolute bottom-12 left-3 top-16 z-10 hidden w-[320px] md:block"
      >
        <Feed />
      </motion.aside>

      {/* Right Cascade card — AnimatePresence inside, only renders when selected */}
      <div className={
        "pointer-events-auto absolute bottom-12 right-3 top-16 z-10 hidden w-[340px] md:block " +
        (selectedId ? "" : "pointer-events-none")
      }>
        <Cascade />
      </div>

      {/* Empty-state nudge over globe when nothing is selected */}
      {!selectedId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
        >
          <div className="mono text-[10px] uppercase tracking-[0.4em] text-muted">
            select an event ↗ to walk its cascade
          </div>
          <div className="mt-1 text-[10px] text-muted/60">$graphLookup · voyage rerank-2.5 · gemini 3</div>
        </motion.div>
      )}

      {/* Bottom stats strip — floats */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3">
        <div className="glass mono mx-auto flex max-w-5xl items-center justify-between gap-5 rounded-full px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Stat label="events 72h" value={stats?.total_events} />
            <Stat label="cascades" value={stats?.cascade_count} />
            <Stat label="critical" value={stats?.impact_counts?.critical ?? 0} color="var(--critical)" />
            <Stat label="high" value={stats?.impact_counts?.high ?? 0} color="var(--high)" />
          </div>
          <div className="hidden text-muted sm:block">
            mongo atlas · voyage · gemini 3
          </div>
        </div>
      </footer>

      {/* Mobile: stack feed below globe */}
      <div className="absolute inset-x-2 bottom-12 top-16 z-10 md:hidden">
        <div className="grid h-full grid-rows-2 gap-2">
          <div className="min-h-0"><Feed /></div>
          <div className="min-h-0"><Cascade /></div>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: number | undefined; color?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span>{label}</span>
      <span className="tabular-nums text-text" style={color ? { color } : undefined}>
        {value ?? "—"}
      </span>
    </span>
  );
}
