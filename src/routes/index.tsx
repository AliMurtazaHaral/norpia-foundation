import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Boxes, Cpu, Plug, Radio, ShieldCheck } from "lucide-react";

import { api } from "@/lib/api/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NORPIA — AI Operating System Foundation" },
      {
        name: "description",
        content:
          "NORPIA system architecture console: layered foundation, versioned API, event bus and integration contracts.",
      },
      { property: "og:title", content: "NORPIA — AI Operating System Foundation" },
      {
        property: "og:description",
        content:
          "Modular, API-first foundation for the NORPIA AI Operating System. Orchestrate. Decide. Execute.",
      },
    ],
  }),
  component: Index,
});

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-success/15 text-success border-success/30",
  scaffolded: "bg-primary/15 text-primary border-primary/30",
  planned: "bg-accent/15 text-accent border-accent/30",
  connected: "bg-success/15 text-success border-success/30",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border"
      }`}
    >
      {status}
    </span>
  );
}

function Index() {
  const architecture = useQuery({ queryKey: ["architecture"], queryFn: api.architecture });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });

  return (
    <main className="brand-grid-bg min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground">
              Orchestrate. Decide. Execute.
            </p>
            <h1 className="mt-3 font-display text-5xl font-extrabold tracking-tight">
              <span className="brand-gradient-text">NORPIA</span>
            </h1>

            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
              System architecture console for the AI Operating System foundation. Week 2 delivers
              the layered structure, the versioned API surface, the internal event bus and the
              integration contracts everything else will be built on.
            </p>
          </div>

          <div className="brand-panel px-5 py-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Activity className="size-3.5" /> API status
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span
                className={`text-2xl font-bold ${health.data ? "text-success" : "text-muted-foreground"}`}
              >
                {health.isPending ? "…" : (health.data?.status?.toUpperCase() ?? "OFFLINE")}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                /api/{health.data?.apiVersion ?? "v1"}
              </span>
            </div>
            <a
              href="/api/docs"
              className="mt-3 inline-flex text-xs font-semibold text-primary hover:text-accent"
            >
              Open API reference →
            </a>
          </div>
        </header>

        <section className="mt-14">
          <SectionTitle icon={<Boxes className="size-4" />} title="Architecture layers" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(architecture.data?.layers ?? []).map((layer) => (
              <article key={layer.id} className="brand-panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{layer.name}</h3>
                  <StatusPill status={layer.status} />
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {layer.responsibility}
                </p>
              </article>
            ))}
            {architecture.isPending &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="brand-panel h-32 animate-pulse opacity-40" />
              ))}
          </div>
        </section>

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <section>
            <SectionTitle icon={<Cpu className="size-4" />} title="AI provider registry" />
            <ul className="mt-5 space-y-3">
              {(architecture.data?.aiProviders ?? []).map((provider) => (
                <li
                  key={provider.id}
                  className="brand-panel flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <p className="font-medium">{provider.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {provider.capabilities.join(" · ")}
                    </p>
                  </div>
                  <StatusPill status={provider.status} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle icon={<Plug className="size-4" />} title="Integration contracts" />
            <ul className="mt-5 space-y-3">
              {(architecture.data?.integrations ?? []).map((integration) => (
                <li
                  key={integration.id}
                  className="brand-panel flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <p className="font-medium">{integration.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {integration.category} · {integration.auth} · {integration.plannedFor}
                    </p>
                  </div>
                  <StatusPill status={integration.status} />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-14">
          <SectionTitle icon={<Radio className="size-4" />} title="Event catalogue" />
          <div className="brand-panel mt-5 flex flex-wrap gap-2 p-5">
            {(architecture.data ? EVENT_HINTS : []).map((name) => (
              <code
                key={name}
                className="rounded-md border border-border bg-secondary/60 px-3 py-1.5 font-mono text-xs text-foreground/85"
              >
                {name}
              </code>
            ))}
          </div>
        </section>

        <footer className="mt-16 flex items-center gap-2 border-t border-border pt-6 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          Authentication, RBAC, RAG and workflow automation are intentionally out of scope for Week
          2 — only their contracts exist.
        </footer>
      </div>
    </main>
  );
}

const EVENT_HINTS = [
  "conversation.created",
  "message.created",
  "document.uploaded",
  "workflow.started",
  "workflow.completed",
  "ai.task.created",
  "integration.connected",
];

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {title}
    </div>
  );
}
