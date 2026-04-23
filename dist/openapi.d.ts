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
    "x-lumo-requires-confirmation"?: "structured-cart" | "structured-itinerary" | "structured-booking" | "structured-reservation" | "structured-trip" | false;
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
export interface OpenApiDocument {
    openapi: string;
    info: {
        title: string;
        version: string;
    };
    paths: Record<string, OpenApiPathItem>;
    components?: {
        schemas?: Record<string, unknown>;
    };
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
        content?: Record<string, {
            schema?: unknown;
        }>;
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
    requires_confirmation: "structured-cart" | "structured-itinerary" | "structured-booking" | "structured-reservation" | "structured-trip" | false;
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
export declare function openApiToClaudeTools(agentId: string, doc: OpenApiDocument): BridgeResult;
/**
 * Merge multiple agents' bridge results into a single tool list + routing
 * map. Tool name collisions are an error — agents must namespace their
 * operationIds (e.g. `flight_search_flights`) if they risk overlap.
 */
export declare function mergeBridges(results: BridgeResult[]): BridgeResult;
//# sourceMappingURL=openapi.d.ts.map