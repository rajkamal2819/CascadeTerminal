"use client";

import { useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";

type Status =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; ran: number; succeeded: number; failed: number }
  | { kind: "error"; message: string };

// Manually triggers every poll-style worker on the backend. Judges can use
// this to refresh data on demand instead of waiting for the cron tick.
// Subject to a 30-second server-side cooldown so we don't burst the Voyage
// rate limit (3 RPM on the free tier).
export function RefreshButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const setEvents = useStore((s) => s.setEvents);

  const onClick = async () => {
    if (status.kind === "running") return;
    setStatus({ kind: "running" });
    try {
      const r = await api.refreshAll();
      setStatus({ kind: "ok", ran: r.ran, succeeded: r.succeeded, failed: r.failed });
      // Re-pull the feed so judges see the new docs without a manual refresh.
      try {
        const events = await api.listEvents({ hours_back: 720, limit: 200 });
        setEvents(events.events);
      } catch { /* swallow — UI still shows old feed */ }
      // Reset the chip back to idle after a beat.
      setTimeout(() => setStatus({ kind: "idle" }), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Cooldown / lock errors come back as HTTP 429 / 409.
      setStatus({ kind: "error", message: msg.split(":").slice(-1)[0].trim().slice(0, 60) });
      setTimeout(() => setStatus({ kind: "idle" }), 4000);
    }
  };

  const running = status.kind === "running";
  const ok = status.kind === "ok";
  const err = status.kind === "error";

  return (
    <button
      onClick={onClick}
      disabled={running}
      title="Run every poll-style worker once · refreshes the feed"
      className={
        "glass mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider transition " +
        (ok
          ? "text-accent ring-1 ring-accent/30"
          : err
          ? "text-rose-300 ring-1 ring-rose-400/30"
          : running
          ? "text-muted"
          : "text-muted hover:text-text")
      }
    >
      {ok ? (
        <CheckCircle2 size={12} />
      ) : err ? (
        <AlertTriangle size={12} />
      ) : (
        <RefreshCw size={12} className={running ? "animate-spin" : ""} />
      )}
      <span className="hidden sm:inline">
        {running
          ? "refreshing…"
          : ok
          ? `+${status.succeeded}/${status.ran}`
          : err
          ? status.message || "failed"
          : "refresh"}
      </span>
    </button>
  );
}
