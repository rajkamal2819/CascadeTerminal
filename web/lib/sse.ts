// Browser EventSource client that talks to /stream and routes payloads
// into the Zustand store. The backend tags messages with `event: event`
// for actual events and `event: ping` for heartbeats.

import { useEffect } from "react";
import { SSE_URL } from "./api";
import { useStore } from "./store";

export function useLiveEvents() {
  useEffect(() => {
    const es = new EventSource(SSE_URL);
    useStore.getState().setStreamStatus("connecting");

    es.addEventListener("ready", () => useStore.getState().setStreamStatus("live"));

    es.addEventListener("event", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        useStore.getState().pushEvent({
          id: payload.id,
          headline: payload.headline ?? "",
          tickers: payload.tickers ?? [],
          sector: payload.sector ?? "",
          impact: payload.impact ?? "",
          source_type: payload.source_type ?? "",
          published_at: payload.published_at ?? null,
        });
      } catch {
        // ignore malformed payloads
      }
    });

    es.addEventListener("ping", () => {
      // heartbeat — connection is alive
    });

    es.onerror = () => useStore.getState().setStreamStatus("reconnecting");

    return () => {
      es.close();
      useStore.getState().setStreamStatus("idle");
    };
  }, []);
}
