/**
 * Integration Layer — registry of declared (not yet implemented) integrations.
 */

import type {
  IntegrationAction,
  IntegrationDescriptor,
  IntegrationProvider,
} from "./integration-provider";

function planned(descriptor: Omit<IntegrationDescriptor, "status">): IntegrationProvider {
  const full: IntegrationDescriptor = { ...descriptor, status: "planned" };
  return {
    descriptor: full,
    isConfigured: () => false,
    async healthcheck() {
      return { ok: false, message: `${full.label} is declared but not implemented yet` };
    },
    listActions(): IntegrationAction[] {
      return [];
    },
  };
}

const registry = new Map<string, IntegrationProvider>(
  [
    planned({ id: "openai", label: "OpenAI", category: "ai", auth: "api-key", plannedFor: "Week 4" }),
    planned({ id: "anthropic", label: "Anthropic", category: "ai", auth: "api-key", plannedFor: "Week 4" }),
    planned({ id: "mcp", label: "Model Context Protocol", category: "protocol", auth: "none", plannedFor: "Month 2 Week 4 (tool layer ready)" }),
    planned({ id: "n8n", label: "n8n", category: "automation", auth: "api-key", plannedFor: "Phase 2" }),
    planned({
      id: "gmail",
      label: "Gmail",
      category: "productivity",
      auth: "oauth2",
      scopes: ["gmail.readonly", "gmail.send"],
      plannedFor: "Phase 2",
    }),
    planned({
      id: "google-calendar",
      label: "Google Calendar",
      category: "productivity",
      auth: "oauth2",
      scopes: ["calendar.events"],
      plannedFor: "Phase 2",
    }),
    planned({
      id: "microsoft-365",
      label: "Microsoft 365",
      category: "productivity",
      auth: "oauth2",
      scopes: ["Mail.Read", "Calendars.ReadWrite"],
      plannedFor: "Phase 3",
    }),
  ].map((p) => [p.descriptor.id, p]),
);

export function registerIntegration(provider: IntegrationProvider): void {
  registry.set(provider.descriptor.id, provider);
}

export function getIntegration(id: string): IntegrationProvider | undefined {
  return registry.get(id);
}

export function listIntegrations(): IntegrationDescriptor[] {
  return [...registry.values()].map((p) => ({
    ...p.descriptor,
    status: p.isConfigured() ? "connected" : p.descriptor.status,
  }));
}
