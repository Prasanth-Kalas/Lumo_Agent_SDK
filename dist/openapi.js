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
/**
 * Convert a single agent's OpenAPI document into (a) the Claude tool list
 * and (b) a routing table the orchestrator uses at dispatch time.
 *
 * Only operations with `x-lumo-tool: true` become tools. Operations without
 * the extension are ignored (they may be internal endpoints, webhooks, etc.).
 */
export function openApiToClaudeTools(agentId, doc) {
    const tools = [];
    const routing = {};
    for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
        const methods = [
            ["GET", pathItem.get],
            ["POST", pathItem.post],
            ["PUT", pathItem.put],
            ["PATCH", pathItem.patch],
            ["DELETE", pathItem.delete],
        ];
        for (const [method, op] of methods) {
            if (!op || op["x-lumo-tool"] !== true)
                continue;
            const schema = extractInputSchema(op);
            const tool = {
                name: op.operationId,
                description: op.description?.trim() ||
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
                compensation_kind: op["x-lumo-compensation-kind"] ??
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
function validateCancellationProtocol(agentId, routing) {
    for (const entry of Object.values(routing)) {
        if (entry.cost_tier !== "money")
            continue;
        if (!entry.cancels) {
            throw new Error(`[${agentId}] Operation "${entry.operation_id}" is cost-tier "money" ` +
                `but does not declare \`x-lumo-cancels\`. Every money tool must ship ` +
                `a cancel counterpart so the Saga can roll it back on compound-booking failure.`);
        }
        const cancelTool = routing[entry.cancels];
        if (!cancelTool) {
            throw new Error(`[${agentId}] Operation "${entry.operation_id}" declares ` +
                `\`x-lumo-cancels: ${entry.cancels}\`, but that operationId is not ` +
                `exposed as a tool in this agent's OpenAPI. Add \`x-lumo-tool: true\` ` +
                `to the cancel operation (cancels live on the same agent as the money tool).`);
        }
        if (cancelTool.cancel_for !== entry.operation_id) {
            throw new Error(`[${agentId}] Cancel link is not bidirectional: ` +
                `"${entry.operation_id}" points at "${entry.cancels}", but ` +
                `"${entry.cancels}".x-lumo-cancel-for === ` +
                `"${cancelTool.cancel_for ?? "(unset)"}". ` +
                `Both operations must reference each other.`);
        }
        if (cancelTool.requires_confirmation !== false) {
            throw new Error(`[${agentId}] Cancel tool "${cancelTool.operation_id}" sets ` +
                `\`x-lumo-requires-confirmation: ${cancelTool.requires_confirmation}\`. ` +
                `Cancel tools must set \`false\` — the Saga runs rollback without ` +
                `re-prompting the user (re-prompt would deadlock compound bookings ` +
                `where an earlier leg has already committed).`);
        }
    }
}
/**
 * Merge multiple agents' bridge results into a single tool list + routing
 * map. Tool name collisions are an error — agents must namespace their
 * operationIds (e.g. `flight_search_flights`) if they risk overlap.
 */
export function mergeBridges(results) {
    const tools = [];
    const routing = {};
    const seen = new Set();
    for (const r of results) {
        for (const tool of r.tools) {
            if (seen.has(tool.name)) {
                throw new Error(`Tool name collision: "${tool.name}" is exposed by multiple agents. ` +
                    `Namespace your operationIds.`);
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
function extractInputSchema(op) {
    // Prefer the JSON body schema if present.
    const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
    if (bodySchema && typeof bodySchema === "object") {
        return normalizeSchema(bodySchema);
    }
    // Otherwise, synthesize from query/path parameters.
    const properties = {};
    const required = [];
    for (const p of op.parameters ?? []) {
        properties[p.name] = p.schema ?? { type: "string" };
        if (p.required)
            required.push(p.name);
    }
    return {
        type: "object",
        properties,
        required: required.length ? required : undefined,
        additionalProperties: false,
    };
}
function normalizeSchema(schema) {
    // We assume the agent's JSON schema is already "object" at the root; if not,
    // we wrap it. Claude tool schemas must be object at the top level.
    if (schema.type === "object") {
        return {
            type: "object",
            properties: schema.properties ?? {},
            required: Array.isArray(schema.required) ? schema.required : undefined,
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
//# sourceMappingURL=openapi.js.map