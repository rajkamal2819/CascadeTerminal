"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useStore } from "@/lib/store";

export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  // Rehydrate the theme on mount from localStorage. Avoids flicker on reload.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cascade-theme");
      if (saved === "light" && theme !== "light") {
        document.documentElement.setAttribute("data-theme", "light");
        useStore.setState({ theme: "light" });
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded border border-white/10 bg-surface px-2 py-1 text-xs text-muted hover:text-text"
      aria-label="Toggle theme"
      title={`Switch to ${theme === "dark" ? "light" : "dark"}`}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
