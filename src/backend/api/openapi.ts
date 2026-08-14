/**
 * Backend/API Layer — OpenAPI 3.1 document, served at /api/v1/openapi.json and
 * rendered by the interactive docs at /api/docs.
 *
 * Keep this in sync whenever a route is added; it is the API contract.
 */

import { API_VERSION } from "../core/api-response";

const envelope = (dataSchema: object) => ({
  type: "object",
  required: ["success", "data", "meta"],
  properties: {
    success: { type: "boolean", enum: [true] },
    data: dataSchema,
    meta: { $ref: "#/components/schemas/ResponseMeta" },
  },
});

const jsonOk = (dataSchema: object, description: string) => ({
  description,
  content: { "application/json": { schema: envelope(dataSchema) } },
});

const errorResponse = {
  description: "Error envelope",
  content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "NORPIA / JARVIS API",
    version: "1.0.0",
    description:
      "API-first foundation for the NORPIA AI Operating System. All endpoints return a consistent envelope.",
  },
  servers: [{ url: "/api/v1", description: "Version 1" }],
  tags: [
    { name: "System", description: "Health and architecture metadata" },
    { name: "AI", description: "AI provider registry (contracts only in Week 2)" },
    { name: "Integrations", description: "External integration registry" },
    { name: "Events", description: "Internal application event bus" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Service health",
        responses: { "200": jsonOk({ $ref: "#/components/schemas/Health" }, "Service is healthy") },
      },
    },
    "/system/architecture": {
      get: {
        tags: ["System"],
        summary: "Architecture layers, AI providers and integrations",
        responses: { "200": jsonOk({ type: "object" }, "Architecture snapshot") },
      },
    },
    "/ai/providers": {
      get: {
        tags: ["AI"],
        summary: "List registered AI providers",
        responses: { "200": jsonOk({ type: "array", items: { type: "object" } }, "Providers") },
      },
    },
    "/integrations": {
      get: {
        tags: ["Integrations"],
        summary: "List declared external integrations",
        responses: { "200": jsonOk({ type: "array", items: { type: "object" } }, "Integrations") },
      },
    },
    "/events": {
      get: {
        tags: ["Events"],
        summary: "Event catalogue and recent in-process events",
        responses: { "200": jsonOk({ type: "object" }, "Events") },
      },
      post: {
        tags: ["Events"],
        summary: "Publish an application event",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", example: "conversation.created" },
                  payload: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "201": jsonOk({ type: "object" }, "Event published"),
          "422": errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ResponseMeta: {
        type: "object",
        required: ["requestId", "timestamp", "apiVersion"],
        properties: {
          requestId: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          apiVersion: { type: "string", example: API_VERSION },
        },
      },
      ApiError: {
        type: "object",
        required: ["success", "error", "meta"],
        properties: {
          success: { type: "boolean", enum: [false] },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string" },
              details: {},
            },
          },
          meta: { $ref: "#/components/schemas/ResponseMeta" },
        },
      },
      Health: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          service: { type: "string" },
          apiVersion: { type: "string" },
          uptimeMs: { type: "number" },
        },
      },
    },
  },
} as const;
