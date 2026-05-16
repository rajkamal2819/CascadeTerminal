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

  // Click-to-drill breadcrumb: last 5 events visited via cascade node clicks.
  breadcrumb: { id: string; label: string }[];

  // Compare mode: when set, terminal renders two cascade graphs side-by-side.
  compareIds: [string, string] | null;

  setEvents: (events: Event[]) => void;
  pushEvent: (e: Event) => void;
  selectEvent: (id: string | null) => void;
  drillIntoEvent: (id: string, label: string) => void;
  popBreadcrumb: () => void;
  clearBreadcrumb: () => void;
  pinForCompare: (id: string) => void;
  clearCompare: () => void;
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
  breadcrumb: [],
  compareIds: null,

  setEvents: (events) => set({ events }),

  pushEvent: (e) =>
    set((s) => {
      // Deduplicate by id, keep newest first, cap.
      const without = s.events.filter((x) => x.id !== e.id);
      return { events: [e, ...without].slice(0, MAX_EVENTS) };
    }),

  selectEvent: (id) =>
    set((s) => (id === null ? { selectedEventId: null, breadcrumb: [] } : { selectedEventId: id })),

  drillIntoEvent: (id, label) =>
    set((s) => {
      if (!id || id === s.selectedEventId) return s;
      const trail = [...s.breadcrumb];
      // If current selection isn't already on the trail, push it.
      if (s.selectedEventId && !trail.some((b) => b.id === s.selectedEventId)) {
        const cur = s.events.find((e) => e.id === s.selectedEventId);
        trail.push({ id: s.selectedEventId, label: cur?.tickers?.[0] ?? "ROOT" });
      }
      return { selectedEventId: id, breadcrumb: trail.slice(-5), cascade: null };
    }),

  popBreadcrumb: () =>
    set((s) => {
      const trail = [...s.breadcrumb];
      const prev = trail.pop();
      if (!prev) return s;
      return { selectedEventId: prev.id, breadcrumb: trail, cascade: null };
    }),

  clearBreadcrumb: () => set({ breadcrumb: [] }),

  pinForCompare: (id) =>
    set((s) => {
      if (!id) return s;
      if (!s.compareIds) {
        // First pin → wait for second
        return { compareIds: [id, ""] as [string, string] };
      }
      if (s.compareIds[1] === "") {
        // Second pin → enter compare mode
        if (s.compareIds[0] === id) return s;
        return { compareIds: [s.compareIds[0], id] };
      }
      // Already comparing → replace second slot
      return { compareIds: [s.compareIds[0], id] };
    }),

  clearCompare: () => set({ compareIds: null }),

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
