import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Subtle radial backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 35%, rgba(74,222,128,0.18) 0%, rgba(7,9,13,0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface px-3 py-1 text-[11px] uppercase tracking-wider text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Live · MongoDB Atlas + Gemini 3
        </span>

        <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">Cascade</h1>
        <p className="mt-3 max-w-2xl text-base text-muted sm:text-lg">
          Real-time equity-market intelligence with supply-chain cascade reasoning.
          One event in; an unrolled chain of second- and third-order impacts out.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <Link
            href="/terminal"
            className="rounded bg-accent px-5 py-2.5 text-sm font-medium text-black hover:bg-accent/90"
          >
            Open terminal
          </Link>
          <a
            href="https://github.com/rajkamal2819/CascadeTerminal"
            target="_blank"
            rel="noreferrer"
            className="rounded border border-white/15 px-5 py-2.5 text-sm text-text hover:bg-white/5"
          >
            View source
          </a>
        </div>

        <div className="mt-14 grid w-full max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {[
            ["Hybrid search", "$vectorSearch + Atlas Search + Voyage rerank-2.5"],
            ["$graphLookup", "Walk supplier and customer edges, three hops deep"],
            ["Live SSE", "Change streams push critical events to the browser"],
          ].map(([title, body]) => (
            <div key={title} className="rounded border border-white/10 bg-surface p-3">
              <div className="text-xs uppercase tracking-wider text-muted">{title}</div>
              <div className="mt-1 text-sm text-text">{body}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
