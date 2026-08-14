/**
 * Database Layer (module slice) — static architecture metadata.
 *
 * Backed by a constant today; the interface is what services depend on, so it
 * can move to Postgres without touching the service or the API.
 */

import type { ArchitectureLayer } from "./system.schemas";

export interface SystemRepository {
  listLayers(): Promise<ArchitectureLayer[]>;
}

const LAYERS: ArchitectureLayer[] = [
  {
    id: "frontend",
    name: "Frontend Layer",
    responsibility: "React UI and routing. Talks to the backend only over /api/v1.",
    status: "ready",
  },
  {
    id: "backend",
    name: "Backend / API Layer",
    responsibility: "Versioned HTTP API, validation, middleware, services, repositories.",
    status: "ready",
  },
  {
    id: "ai",
    name: "AI Layer",
    responsibility: "Provider-agnostic model contracts and registry. Never imported by UI code.",
    status: "scaffolded",
  },
  {
    id: "auth",
    name: "Authentication Layer",
    responsibility: "Principal resolution and route guards. Contracts only until Week 3.",
    status: "planned",
  },
  {
    id: "database",
    name: "Database Layer",
    responsibility: "Repository contracts. Isolated from frontend code by design.",
    status: "scaffolded",
  },
  {
    id: "storage",
    name: "Storage Layer",
    responsibility: "Object storage contract for documents and media.",
    status: "planned",
  },
  {
    id: "integration",
    name: "Integration Layer",
    responsibility: "One interface per external system: OpenAI, Anthropic, MCP, n8n, Google, Microsoft.",
    status: "scaffolded",
  },
];

export const systemRepository: SystemRepository = {
  async listLayers() {
    return LAYERS;
  },
};
