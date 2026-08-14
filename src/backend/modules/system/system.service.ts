/**
 * Backend Layer — system service. Transport-agnostic business logic.
 */

import { listAiProviders } from "../../ai/ai-registry";
import { API_VERSION } from "../../core/api-response";
import { listIntegrations } from "../../integrations/integration-registry";
import { systemRepository, type SystemRepository } from "./system.repository";
import type { Health } from "./system.schemas";

const bootedAt = Date.now();

export function createSystemService(repository: SystemRepository = systemRepository) {
  return {
    async health(): Promise<Health> {
      return {
        status: "ok",
        service: "norpia-api",
        apiVersion: API_VERSION,
        uptimeMs: Date.now() - bootedAt,
      };
    },

    async architecture() {
      return {
        product: "NORPIA",
        phase: "Week 2 — System Architecture & Project Foundation",
        apiVersion: API_VERSION,
        layers: await repository.listLayers(),
        aiProviders: listAiProviders(),
        integrations: listIntegrations(),
      };
    },
  };
}

export const systemService = createSystemService();
