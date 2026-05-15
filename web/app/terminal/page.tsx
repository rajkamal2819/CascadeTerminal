"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
    <main className="flex h-screen flex-col bg-bg text-text">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-white/5 bg-surface/60 px-4 py-2">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Cascade
          </Link>
          <div className="hidden text-[11px] uppercase tracking-wider text-muted sm:block">
            terminal
          </div>
        </div>
        <div className="flex flex-1 justify-center">
          <SearchBar
            onResults={(hits) => {
              if (hits[0]) selectEvent(hits[0].id);
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
        </div>
      </header>

      {/* Three-panel terminal */}
      <div className="flex flex-1 overflow-hidden md:grid md:grid-cols-[280px_1fr_320px] flex-col">
        <Feed />
        <section className="relative h-full w-full bg-bg">
          <Globe />
        </section>
        <Cascade />
      </div>

      {/* Bottom stats strip */}
      <footer className="flex items-center justify-between gap-4 border-t border-white/5 bg-surface/60 px-4 py-1.5 text-[11px] text-muted">
        <div className="flex gap-4">
          <span>
            events 72h: <span className="text-text tabular-nums">{stats?.total_events ?? "—"}</span>
          </span>
          <span>
            cascades: <span className="text-text tabular-nums">{stats?.cascade_count ?? "—"}</span>
          </span>
          {stats?.impact_counts && (
            <>
              <span>
                critical: <span className="text-critical tabular-nums">{stats.impact_counts.critical ?? 0}</span>
              </span>
              <span>
                high: <span className="text-high tabular-nums">{stats.impact_counts.high ?? 0}</span>
              </span>
            </>
          )}
        </div>
        <div className="hidden sm:block">MongoDB Atlas · Voyage · Gemini 3</div>
      </footer>
    </main>
  );
}
