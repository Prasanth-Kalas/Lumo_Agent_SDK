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
 *       operationId: flight_book_offer
 *       x-lumo-tool: true
 *       x-lumo-cost-tier: money
 *       x-lumo-requires-confirmation: structured-itinerary
 *       x-lumo-pii-required: [name, email, payment_method_id]
 *       x-lumo-cancels: flight_cancel_booking
 *       x-lumo-compensation-kind: best-effort
 *   /cancel:
 *     post:
 *       operationId: flight_cancel_booking
 *       x-lumo-tool: true
 *       x-lumo-cost-tier: free        # cancellation itself never charges
 *       x-lumo-cancel-for: flight_book_offer
 *       x-lumo-requires-confirmation: false
 * ```
 *
 * Contract — cancellation protocol (see RFC 0001):
 * - Any operation with `x-lumo-cost-tier: money` MUST declare `x-lumo-cancels`
 *   pointing to a peer operation on the same agent whose `x-lumo-cancel-for`
 *   matches it (bidirectional link, validated at registry load).
 * - The cancel counterpart MUST set `x-lumo-requires-confirmation: false`
 *   — rollback fires WITHOUT re-prompting the user; a stuck money tool that
 *   depended on a second human ack would be a Saga deadlock.
 * - `x-lumo-compensation-kind` classifies what the cancel guarantees:
 *   • `perfect`     — vendor fully reverses (e.g. reservation hold release)
 *   • `best-effort` — subject to vendor policy; may be partial refund
 *   • `manual`      — cancel tool exists but expects human follow-up
 *   Orchestrator uses this to decide whether to surface
 *   `rollback_incomplete` warnings to the user proactively.
 */
export interface LumoOperationExtensions {
  "x-lumo-tool"?: boolean;
  "x-lumo-cost-tier"?: CostTier;
  /** The shape of the summary the user must have confirmed before this tool fires. */
  "x-lumo-requires-confirmation"?:
    | "structured-cart"
    | "structured-itinerary"
    | "structured-booking"
    | "structured-trip"
    | false;
  /** PII fields the tool needs in its request body. */
  "x-lumo-pii-required"?: string[];
  /** Tags the orchestrator uses for routing heuristics and analytics. */
  "x-lumo-intent-tags"?: string[];
  /**
   * operationId of the cancel counterpart for this tool. Required for any
   * operation at cost-tier `money`. The Saga invokes this on rollback.
   */
  "x-lumo-cancels"?: string;
  /**
   * Set on a cancel tool to declare which money tool it rolls back. Must
   * point to a peer operation on the same agent whose `x-lumo-cancels`
   * points back to this one.
   */
  "x-lumo-cancel-for"?: string;
  /**
   * Declares the strength of the compensation guarantee. See the module
   * doc comment for semantics. Defaults to `best-effort` on any cancel tool.
   */
  "x-lumo-compensation-kind"?: "perfect" | "best-effort" | "manual";
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
    | "structured-trip"
    | false;
  pii_required: string[];
  intent_tags: string[];
  /**
   * operationId of the cancel counterpart. Set on money-tier tools only.
   * The orchestrator's Saga reads this to find the rollback tool without
   * having to re-parse the OpenAPI doc.
   */
  cancels?: string;
  /**
   * operationId of the money tool this cancel rolls back. Set on cancel
   * tools only. The orchestrator uses this to validate that a rollback
   * invocation matches the original forward tool it's compensating for.
   */
  cancel_for?: string;
  /**
   * Compensation strength — drives whether the orchestrator surfaces
   * partial-rollback warnings proactively. Only meaningful on cancel tools.
   */
  compensation_kind?: "perfect" | "best-effort" | "manual";
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
  const componentSchemas =
    (doc.components?.schemas as Record<string, unknown> | undefined) ?? {};

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

      const schema = extractInputSchema(op, componentSchemas);
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
        cancels: op["x-lumo-cancels"],
        cancel_for: op["x-lumo-cancel-for"],
        compensation_kind:
          op["x-lumo-compensation-kind"] ??
          (op["x-lumo-cancel-for"] ? "best-effort" : undefined),
      };
    }
  }

  // Validate cancellation protocol — every money tool must declare a cancel,
  // every declared cancel must point back, within the same agent's doc.
  validateCancellationProtocol(agentId, routing);

  return { tools, routing };
}

/**
 * Registry-load-time check: a money-tier tool without a cancel counterpart
 * is a contract violation. Compound bookings would deadlock on rollback
 * if any leg's commit tool couldn't be reversed.
 *
 * Rules:
 *   1. cost_tier === "money"  ⇒  `cancels` is set.
 *   2. If `cancels` is set, that operationId must exist in this same doc
 *      (agents may not delegate their cancel to another agent).
 *   3. The referenced cancel tool must declare `cancel_for` pointing back
 *      to the money tool (bidirectional link).
 *   4. Cancel tools must NOT require confirmation — the Saga never asks
 *      the user a second time.
 */
function validateCancellationProtocol(
  agentId: string,
  routing: Record<string, ToolRoutingEntry>,
): void {
  for (const entry of Object.values(routing)) {
    if (entry.cost_tier !== "money") continue;
    if (!entry.cancels) {
      throw new Error(
        `[${agentId}] Operation "${entry.operation_id}" is cost-tier "money" ` +
          `but does not declare \`x-lumo-cancels\`. Every money tool must ship ` +
          `a cancel counterpart so the Saga can roll it back on compound-booking failure.`,
      );
    }
    const cancelTool = routing[entry.cancels];
    if (!cancelTool) {
      throw new Error(
        `[${agentId}] Operation "${entry.operation_id}" declares ` +
          `\`x-lumo-cancels: ${entry.cancels}\`, but that operationId is not ` +
          `exposed as a tool in this agent's OpenAPI. Add \`x-lumo-tool: true\` ` +
          `to the cancel operation (cancels live on the same agent as the money tool).`,
      );
    }
    if (cancelTool.cancel_for !== entry.operation_id) {
      throw new Error(
        `[${agentId}] Cancel link is not bidirectional: ` +
          `"${entry.operation_id}" points at "${entry.cancels}", but ` +
          `"${entry.cancels}".x-lumo-cancel-for === ` +
          `"${cancelTool.cancel_for ?? "(unset)"}". ` +
          `Both operations must reference each other.`,
      );
    }
    if (cancelTool.requires_confirmation !== false) {
      throw new Error(
        `[${agentId}] Cancel tool "${cancelTool.operation_id}" sets ` +
          `\`x-lumo-requires-confirmation: ${cancelTool.requires_confirmation}\`. ` +
          `Cancel tools must set \`false\` — the Saga runs rollback without ` +
          `re-prompting the user (re-prompt would deadlock compound bookings ` +
          `where an earlier leg has already committed).`,
      );
    }
  }
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

function extractInputSchema(
  op: OpenApiOperation,
  componentSchemas: Record<string, unknown>,
): ClaudeTool["input_schema"] {
  // Prefer the JSON body schema if present.
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema && typeof bodySchema === "object") {
    // OpenAPI lets operations point at a named schema via `$ref`. Claude can't
    // dereference `$ref` on its own — if we pass the raw ref object through,
    // the tool input_schema looks empty and Claude fabricates plausible field
    // names (e.g. `origin`/`destination` when the real schema wants Duffel's
    // `slices`/`passengers`). Resolve every `$ref` recursively against
    // `components.schemas` before normalising.
    const resolved = resolveRefs(
      bodySchema as Record<string, unknown>,
      componentSchemas,
      new Set<string>(),
    );
    return normalizeSchema(resolved as Record<string, unknown>);
  }

  // Otherwise, synthesize from query/path parameters.
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of op.parameters ?? []) {
    const paramSchema = p.schema
      ? resolveRefs(p.schema as Record<string, unknown>, componentSchemas, new Set())
      : { type: "string" };
    properties[p.name] = paramSchema;
    if (p.required) required.push(p.name);
  }

  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
    additionalProperties: false,
  };
}

/**
 * Walk a JSON Schema fragment and replace every `{"$ref": "#/components/schemas/X"}`
 * with a (recursively resolved) copy of the target. Keeps a `seen` set so
 * self-referential schemas don't loop forever — a circular ref collapses to
 * `{}` which Claude will treat as "any", an acceptable degradation.
 *
 * Only handles `#/components/schemas/...` refs. External refs (http URIs,
 * paths into other files) are left untouched; agents that need those should
 * bundle their spec first.
 */
function resolveRefs(
  node: unknown,
  componentSchemas: Record<string, unknown>,
  seen: Set<string>,
): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, componentSchemas, seen));
  }

  const obj = node as Record<string, unknown>;
  const ref = obj["$ref"];
  if (typeof ref === "string") {
    const prefix = "#/components/schemas/";
    if (!ref.startsWith(prefix)) return obj;
    if (seen.has(ref)) return {}; // circular — bail gracefully
    const name = ref.slice(prefix.length);
    const target = componentSchemas[name];
    if (target === undefined) return obj; // dangling ref; leave as-is
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return resolveRefs(target, componentSchemas, nextSeen);
  }

  // Recurse into every value — cheap and correct for arbitrary JSON Schema
  // shapes (properties, items, allOf/anyOf/oneOf, patternProperties, …).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveRefs(v, componentSchemas, seen);
  }
  return out;
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
