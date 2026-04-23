/**
 * Agent manifest types.
 *
 * Every specialist agent serves a manifest at `/.well-known/agent.json` that
 * conforms to {@link AgentManifest}. The shell polls manifests at boot to build
 * its registry and re-validates on every deploy webhook.
 */
import { z } from "zod";
// ──────────────────────────────────────────────────────────────────────────
// Zod schemas (runtime validation at registry load)
// ──────────────────────────────────────────────────────────────────────────
export const AgentSLASchema = z.object({
    p50_latency_ms: z.number().int().positive(),
    p95_latency_ms: z.number().int().positive(),
    availability_target: z.number().min(0).max(1),
});
export const AgentUIManifestSchema = z.object({
    /** URL of the Module Federation remote entry (web shell). */
    remote_url: z.string().url().optional(),
    /** Published npm package name for React Native components. */
    native_package: z.string().optional(),
    /** Component names the shell is allowed to render. */
    components: z.array(z.string()).default([]),
});
/**
 * Self-declared contract version and capability flags. The shell reads this
 * at `/.well-known/agent.json` load and fast-fails if the agent is missing
 * a capability the registry needs.
 *
 * Why a separate block rather than top-level fields: capabilities will grow
 * (compound bookings today, streaming tool results later, …) and nesting
 * them keeps the top of the manifest stable.
 */
export const AgentCapabilitiesSchema = z.object({
    /**
     * SDK semver the agent was built against. The shell refuses to register
     * an agent whose major ≠ the shell's major (breaking contract drift).
     */
    sdk_version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/),
    /**
     * Does this agent participate in compound bookings (trip summaries)?
     * If false, the orchestrator will never route a leg of a TripSummary
     * to this agent — it can only be used for single-leg intents. Any
     * agent with a money tool SHOULD set this to true; the registry will
     * warn if money + compound=false to flag the config as likely wrong.
     */
    supports_compound_bookings: z.boolean().default(false),
    /**
     * Does the agent implement the cancellation protocol for every money
     * tool it exposes? This is validated structurally at OpenAPI load
     * (see openapi.ts validateCancellationProtocol), but we record the
     * self-declaration here so health checks can surface the gap early
     * even before the first tool bridge is built.
     */
    implements_cancellation: z.boolean().default(false),
});
export const AgentManifestSchema = z.object({
    agent_id: z.string().regex(/^[a-z][a-z0-9-]{2,31}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/),
    domain: z.string().min(3),
    display_name: z.string().min(2).max(48),
    one_liner: z.string().min(8).max(140),
    /** Canonical intent labels the agent handles. */
    intents: z.array(z.string().min(2)).min(1),
    /** Short, natural-language examples the orchestrator uses as few-shot hints. */
    example_utterances: z.array(z.string()).default([]),
    openapi_url: z.string().url(),
    mcp_url: z.string().url().optional(),
    ui: AgentUIManifestSchema,
    health_url: z.string().url(),
    sla: AgentSLASchema,
    /** Narrow list of PII fields the agent may be granted. */
    pii_scope: z.array(z.enum([
        "name",
        "email",
        "phone",
        "address",
        "dob",
        "payment_method_id",
        "passport",
        "passport_optional",
        "loyalty_numbers",
        "traveler_profile",
    ])),
    requires_payment: z.boolean().default(false),
    /** ISO region codes where this agent is available to users. */
    supported_regions: z.array(z.string()).default([]),
    /**
     * Contract/capability block. Defaulted so v0.1.x manifests still parse —
     * but registry-level validation (in the shell) will refuse to register
     * an agent that exposes a money tool without `implements_cancellation`.
     */
    capabilities: AgentCapabilitiesSchema.default({
        sdk_version: "0.1.0",
        supports_compound_bookings: false,
        implements_cancellation: false,
    }),
    /** Optional metadata for analytics / ops. */
    owner_team: z.string().optional(),
    on_call_escalation: z.string().url().optional(),
});
/**
 * Define and validate an agent manifest at build time. Throws with a readable
 * error if the shape is wrong. Use this in your agent's `app/manifest.ts`.
 */
export function defineManifest(input) {
    const parsed = AgentManifestSchema.safeParse(input);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  · ${i.path.join(".") || "<root>"}: ${i.message}`)
            .join("\n");
        throw new Error(`Invalid agent manifest:\n${issues}`);
    }
    return parsed.data;
}
/**
 * Runtime guard used by the shell when it loads `/.well-known/agent.json` from
 * a remote agent. Never trust manifest data without running it through this.
 */
export function parseManifest(raw) {
    return AgentManifestSchema.parse(raw);
}
//# sourceMappingURL=manifest.js.map