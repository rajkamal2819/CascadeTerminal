"use client";

import { useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/store";

// Time-machine scrubber: rewind the globe view through the last 7 days.
// Implemented as a UI-side time filter on the in-memory event store;
// the SSE stream remains live, scrubber just narrows what the canvas draws.
export function TimeMachine() {
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0); // 0 = now, 7 = 7 days ago
  const setTimeOffset = useStore((s) => s.setTimeOffset);

  const onChange = (v: number) => {
    setOffset(v);
    setTimeOffset(v);
  };

  const reset = () => onChange(0);

  return (
    <div className="hidden items-center gap-2 text-[9px] sm:flex">
      <button
        onClick={() => setPlaying((p) => !p)}
        className="rounded-full p-1 text-muted transition hover:text-text"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={11} /> : <Play size={11} />}
      </button>
      <span className="tabular-nums text-muted/60">
        {offset === 0 ? "NOW" : `-${offset}d`}
      </span>
      <input
        type="range"
        min={0}
        max={7}
        step={0.25}
        value={offset}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="time-machine h-1 w-32 cursor-pointer appearance-none rounded-full bg-white/10"
        title="Drag to scrub through the last 7 days"
      />
      <button
        onClick={reset}
        className="rounded-full p-1 text-muted transition hover:text-text"
        title="Reset to now"
      >
        <RotateCcw size={11} />
      </button>
    </div>
  );
}
