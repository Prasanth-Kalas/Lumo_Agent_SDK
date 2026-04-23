/**
 * OpenAPI ↔ Claude tool bridge.
 *
 * The shell's orchestrator exposes Claude a union of tools drawn from every
 * registered agent. Each agent ships an OpenAPI 3.1 spec; the `x-lumo-*`
 * extensions below mark which operations become LLM tools and how they are
 * gated.
 *
 * This module is the single source of truth for converting an OpenAPI
 * operation to a Claude tool definition. It is intentionally small and has
 * no Anthropic SDK dependency — it returns plain shapes the orchestrator can
 * feed into `anthropic.messages.create({ tools })` (Claude) or the equivalent
 * OpenAI structured-tool shape (fallback).
 */

import type { CostTier } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────
// x-lumo-* extension conventions (documented for agent authors)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Put these on an OpenAPI operation to expose it as an orchestrator tool.
 *
 * ```yaml
 * paths:
 *   /confirm:
 *     post:
 *       operationId: confirm_booking
 *       x-lumo-tool: true
 *       x-lumo-cost-tier: money
 *       x-lumo-requires-confirmation: structured-itinerary
 *       x-lumo-pii-required: [name, email, payment_method_id]
 * ```
 */
export interface LumoOperationExtensions {
  "x-lumo-tool"?: boolean;
  "x-lumo-cost-tier"?: CostTier;
  /** The shape of the summary the user must have confirmed before this tool fires. */
  "x-lumo-requires-confirmation"?:
    | "structured-cart"
    | "structured-itinerary"
    | "structured-booking"
    | false;
  /** PII fields the tool needs in its request body. */
  "x-lumo-pii-required"?: string[];
  /** Tags the orchestrator uses for routing heuristics and analytics. */
  "x-lumo-intent-tags"?: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Minimal OpenAPI types we need (avoids pulling in a full openapi-types dep)
// ──────────────────────────────────────────────────────────────────────────

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, unknown> };
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

export interface OpenApiOperation extends LumoOperationExtensions {
  operationId: string;
  summary?: string;
  description?: string;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: unknown }>;
  };
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header" | "cookie";
    required?: boolean;
    schema?: unknown;
    description?: string;
  }>;
  responses?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────────
// Claude tool shape (portable — matches Anthropic Messages API)
// ──────────────────────────────────────────────────────────────────────────

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/**
 * The orchestrator keeps this side-table keyed by tool name so that when
 * Claude emits a tool_use block, we know which agent to route to and whether
 * the confirmation gate applies.
 */
export interface ToolRoutingEntry {
  agent_id: string;
  operation_id: string;
  http_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  cost_tier: CostTier;
  requires_confirmation:
    | "structured-cart"
    | "structured-itinerary"
    | "structured-booking"
    | false;
  pii_required: string[];
  intent_tags: string[];
}

export interface BridgeResult {
  tools: ClaudeTool[];
  routing: Record<string, ToolRoutingEntry>;
}

/**
 * Convert a single agent's OpenAPI document into (a) the Claude tool list
 * and (b) a routing table the orchestrator uses at dispatch time.
 *
 * Only operations with `x-lumo-tool: true` become tools. Operations without
 * the extension are ignored (they may be internal endpoints, webhooks, etc.).
 */
export function openApiToClaudeTools(
  agentId: string,
  doc: OpenApiDocument,
): BridgeResult {
  const tools: ClaudeTool[] = [];
  const routing: Record<string, ToolRoutingEntry> = {};

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    const methods: Array<[ToolRoutingEntry["http_method"], OpenApiOperation | undefined]> = [
      ["GET", pathItem.get],
      ["POST", pathItem.post],
      ["PUT", pathItem.put],
      ["PATCH", pathItem.patch],
      ["DELETE", pathItem.delete],
    ];

    for (const [method, op] of methods) {
      if (!op || op["x-lumo-tool"] !== true) continue;

      const schema = extractInputSchema(op);
      const tool: ClaudeTool = {
        name: op.operationId,
        description:
          op.description?.trim() ||
          op.summary?.trim() ||
          `Operation ${op.operationId} on ${agentId}`,
        input_schema: schema,
      };

      tools.push(tool);
      routing[op.operationId] = {
        agent_id: agentId,
        operation_id: op.operationId,
        http_method: method,
        path,
        cost_tier: op["x-lumo-cost-tier"] ?? "free",
        requires_confirmation: op["x-lumo-requires-confirmation"] ?? false,
        pii_required: op["x-lumo-pii-required"] ?? [],
        intent_tags: op["x-lumo-intent-tags"] ?? [],
      };
    }
  }

  return { tools, routing };
}

/**
 * Merge multiple agents' bridge results into a single tool list + routing
 * map. Tool name collisions are an error — agents must namespace their
 * operationIds (e.g. `flight_search_flights`) if they risk overlap.
 */
export function mergeBridges(results: BridgeResult[]): BridgeResult {
  const tools: ClaudeTool[] = [];
  const routing: Record<string, ToolRoutingEntry> = {};
  const seen = new Set<string>();

  for (const r of results) {
    for (const tool of r.tools) {
      if (seen.has(tool.name)) {
        throw new Error(
          `Tool name collision: "${tool.name}" is exposed by multiple agents. ` +
            `Namespace your operationIds.`,
        );
      }
      seen.add(tool.name);
      tools.push(tool);
    }
    Object.assign(routing, r.routing);
  }

  return { tools, routing };
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

function extractInputSchema(op: OpenApiOperation): ClaudeTool["input_schema"] {
  // Prefer the JSON body schema if present.
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema && typeof bodySchema === "object") {
    return normalizeSchema(bodySchema as Record<string, unknown>);
  }

  // Otherwise, synthesize from query/path parameters.
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of op.parameters ?? []) {
    properties[p.name] = p.schema ?? { type: "string" };
    if (p.required) required.push(p.name);
  }

  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
    additionalProperties: false,
  };
}

function normalizeSchema(schema: Record<string, unknown>): ClaudeTool["input_schema"] {
  // We assume the agent's JSON schema is already "object" at the root; if not,
  // we wrap it. Claude tool schemas must be object at the top level.
  if (schema.type === "object") {
    return {
      type: "object",
      properties: (schema.properties as Record<string, unknown>) ?? {},
      required: Array.isArray(schema.required) ? (schema.required as string[]) : undefined,
      additionalProperties: schema.additionalProperties === true ? true : false,
    };
  }
  return {
    type: "object",
    properties: { value: schema },
    required: ["value"],
    additionalProperties: false,
  };
}
