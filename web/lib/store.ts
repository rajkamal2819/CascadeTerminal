// Zustand store for the terminal — events, selection, cascade, time-machine.

import { create } from "zustand";
import type { CascadeResponse, Event } from "./api";

type StreamStatus = "idle" | "connecting" | "live" | "reconnecting";

type State = {
  events: Event[];
  selectedEventId: string | null;
  cascade: CascadeResponse | null;
  cascadeLoading: boolean;
  cascadePhase: "idle" | "building" | "ranking" | "synthesising" | "ready";
  streamStatus: StreamStatus;

  // Click-to-drill breadcrumb: last 5 events visited via cascade node clicks.
  breadcrumb: { id: string; label: string }[];

  // Compare mode: when set, terminal renders two cascade graphs side-by-side.
  compareIds: [string, string] | null;

  // Time-machine: 0 = now, 7 = 7 days ago. Drives a UI-side time filter.
  timeOffset: number;

  // ELI5 toggle on narrative card — re-renders with novice-friendly text.
  eli5: boolean;

  // Source filter chips: when non-empty, only show events with this source_type.
  sourceFilter: string | null;

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
  setCascadePhase: (p: State["cascadePhase"]) => void;
  setStreamStatus: (s: StreamStatus) => void;
  setTimeOffset: (n: number) => void;
  toggleEli5: () => void;
  setSourceFilter: (s: string | null) => void;
};

const MAX_EVENTS = 500;

export const useStore = create<State>((set) => ({
  events: [],
  selectedEventId: null,
  cascade: null,
  cascadeLoading: false,
  cascadePhase: "idle",
  streamStatus: "idle",
  breadcrumb: [],
  compareIds: null,
  timeOffset: 0,
  eli5: false,
  sourceFilter: null,

  setEvents: (events) => set({ events }),

  pushEvent: (e) =>
    set((s) => {
      const without = s.events.filter((x) => x.id !== e.id);
      return { events: [e, ...without].slice(0, MAX_EVENTS) };
    }),

  selectEvent: (id) =>
    set((s) => (id === null ? { selectedEventId: null, breadcrumb: [] } : { selectedEventId: id })),

  drillIntoEvent: (id, label) =>
    set((s) => {
      if (!id || id === s.selectedEventId) return s;
      const trail = [...s.breadcrumb];
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
        return { compareIds: [id, ""] as [string, string] };
      }
      if (s.compareIds[1] === "") {
        if (s.compareIds[0] === id) return s;
        return { compareIds: [s.compareIds[0], id] };
      }
      return { compareIds: [s.compareIds[0], id] };
    }),

  clearCompare: () => set({ compareIds: null }),

  setCascade: (cascade) => set({ cascade }),
  setCascadeLoading: (b) => set({ cascadeLoading: b }),
  setCascadePhase: (cascadePhase) => set({ cascadePhase }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),
  setTimeOffset: (timeOffset) => set({ timeOffset }),
  toggleEli5: () => set((s) => ({ eli5: !s.eli5 })),
  setSourceFilter: (sourceFilter) => set({ sourceFilter }),
}));
