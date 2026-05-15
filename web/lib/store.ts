// Zustand store for the terminal — events, selection, cascade, theme.

import { create } from "zustand";
import type { CascadeResponse, Event } from "./api";

type StreamStatus = "idle" | "connecting" | "live" | "reconnecting";

type State = {
  events: Event[];
  selectedEventId: string | null;
  cascade: CascadeResponse | null;
  cascadeLoading: boolean;
  streamStatus: StreamStatus;
  theme: "dark" | "light";

  setEvents: (events: Event[]) => void;
  pushEvent: (e: Event) => void;
  selectEvent: (id: string | null) => void;
  setCascade: (c: CascadeResponse | null) => void;
  setCascadeLoading: (b: boolean) => void;
  setStreamStatus: (s: StreamStatus) => void;
  toggleTheme: () => void;
};

const MAX_EVENTS = 500;

export const useStore = create<State>((set) => ({
  events: [],
  selectedEventId: null,
  cascade: null,
  cascadeLoading: false,
  streamStatus: "idle",
  theme: "dark",

  setEvents: (events) => set({ events }),

  pushEvent: (e) =>
    set((s) => {
      // Deduplicate by id, keep newest first, cap.
      const without = s.events.filter((x) => x.id !== e.id);
      return { events: [e, ...without].slice(0, MAX_EVENTS) };
    }),

  selectEvent: (id) => set({ selectedEventId: id }),
  setCascade: (cascade) => set({ cascade }),
  setCascadeLoading: (b) => set({ cascadeLoading: b }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("cascade-theme", next);
        } catch {}
      }
      return { theme: next };
    }),
}));
