"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useStore } from "@/lib/store";

export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

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
      className="glass mono inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted transition hover:text-text"
      aria-label="Toggle theme"
      title={`Switch to ${theme === "dark" ? "light" : "dark"}`}
    >
      {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
      <span className="hidden sm:inline">{theme === "dark" ? "light" : "dark"}</span>
    </button>
  );
}
