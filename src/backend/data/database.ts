/**
 * Data Layer — PostgreSQL foundation.
 *
 * Week 2 exposes configuration + readiness only. No driver is wired yet;
 * Week 3 plugs a concrete client behind the Repository contract in
 * ./repository.ts so callers never change.
 */

import { getConfig } from "../core/config";

export interface DatabaseStatus {
  engine: "postgresql";
  configured: boolean;
  poolMax: number;
  /** Schemas reserved by infrastructure/db/migrations/0001_foundation.sql. */
  schemas: string[];
  /** Entities planned for later phases, kept visible for architecture review. */
  plannedEntities: string[];
}

export function getDatabaseStatus(): DatabaseStatus {
  const { database } = getConfig();
  return {
    engine: "postgresql",
    configured: database.isConfigured,
    poolMax: database.poolMax,
    schemas: ["identity", "workspace", "ai"],
    plannedEntities: [
      "users",
      "organizations",
      "workspaces",
      "conversations",
      "messages",
      "ai_sessions",
      "documents",
      "permissions",
      "settings",
    ],
  };
}
