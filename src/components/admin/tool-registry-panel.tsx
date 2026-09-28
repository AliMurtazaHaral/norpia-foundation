import { useEffect, useState } from "react";

import { fetchToolDiscovery, type ToolDescriptor } from "@/lib/tools/tools-api";

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-medium " +
        (ok ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
      }
    >
      {label}
    </span>
  );
}

/** Developer/Admin view of the internal tool registry. Read-only. */
export function ToolRegistryPanel() {
  const [tools, setTools] = useState<ToolDescriptor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchToolDiscovery()
      .then((d) => setTools(d.registry ?? d.available))
      .catch(() => setError("The tool registry could not be loaded."));
  }, []);

  return (
    <section className="rounded-lg border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground">Tool registry</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Internal tool layer (Week 4 foundation). JARVIS chat does not call tools yet.
      </p>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      {!tools && !error && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {tools && (
        <ul className="mt-4 divide-y divide-border">
          {tools.map((t) => (
            <li key={t.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{t.name}</span>
                <code className="text-xs text-muted-foreground">{t.id}</code>
                <Badge ok={t.enabled} label={t.enabled ? "enabled" : "disabled"} />
                <Badge ok={t.configured} label={t.configured ? "configured" : "not configured"} />
                <Badge ok={t.available} label={t.available ? "available" : "unavailable"} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.category} · {t.source} · permissions: {t.permissions.join(", ")} · inputs:{" "}
                {t.inputFields.join(", ") || "none"} · timeout {t.timeoutMs} ms
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
