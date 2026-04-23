/**
 * Agent manifest types.
 *
 * Every specialist agent serves a manifest at `/.well-known/agent.json` that
 * conforms to {@link AgentManifest}. The shell polls manifests at boot to build
 * its registry and re-validates on every deploy webhook.
 */
import { z } from "zod";
import type { PIIScope, RegionCode } from "./types.js";
export declare const AgentSLASchema: z.ZodObject<{
    p50_latency_ms: z.ZodNumber;
    p95_latency_ms: z.ZodNumber;
    availability_target: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    p95_latency_ms: number;
    p50_latency_ms: number;
    availability_target: number;
}, {
    p95_latency_ms: number;
    p50_latency_ms: number;
    availability_target: number;
}>;
export declare const AgentUIManifestSchema: z.ZodObject<{
    /** URL of the Module Federation remote entry (web shell). */
    remote_url: z.ZodOptional<z.ZodString>;
    /** Published npm package name for React Native components. */
    native_package: z.ZodOptional<z.ZodString>;
    /** Component names the shell is allowed to render. */
    components: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    components: string[];
    remote_url?: string | undefined;
    native_package?: string | undefined;
}, {
    remote_url?: string | undefined;
    native_package?: string | undefined;
    components?: string[] | undefined;
}>;
/**
 * Self-declared contract version and capability flags. The shell reads this
 * at `/.well-known/agent.json` load and fast-fails if the agent is missing
 * a capability the registry needs.
 *
 * Why a separate block rather than top-level fields: capabilities will grow
 * (compound bookings today, streaming tool results later, …) and nesting
 * them keeps the top of the manifest stable.
 */
export declare const AgentCapabilitiesSchema: z.ZodObject<{
    /**
     * SDK semver the agent was built against. The shell refuses to register
     * an agent whose major ≠ the shell's major (breaking contract drift).
     */
    sdk_version: z.ZodString;
    /**
     * Does this agent participate in compound bookings (trip summaries)?
     * If false, the orchestrator will never route a leg of a TripSummary
     * to this agent — it can only be used for single-leg intents. Any
     * agent with a money tool SHOULD set this to true; the registry will
     * warn if money + compound=false to flag the config as likely wrong.
     */
    supports_compound_bookings: z.ZodDefault<z.ZodBoolean>;
    /**
     * Does the agent implement the cancellation protocol for every money
     * tool it exposes? This is validated structurally at OpenAPI load
     * (see openapi.ts validateCancellationProtocol), but we record the
     * self-declaration here so health checks can surface the gap early
     * even before the first tool bridge is built.
     */
    implements_cancellation: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sdk_version: string;
    supports_compound_bookings: boolean;
    implements_cancellation: boolean;
}, {
    sdk_version: string;
    supports_compound_bookings?: boolean | undefined;
    implements_cancellation?: boolean | undefined;
}>;
export declare const AgentManifestSchema: z.ZodObject<{
    agent_id: z.ZodString;
    version: z.ZodString;
    domain: z.ZodString;
    display_name: z.ZodString;
    one_liner: z.ZodString;
    /** Canonical intent labels the agent handles. */
    intents: z.ZodArray<z.ZodString, "many">;
    /** Short, natural-language examples the orchestrator uses as few-shot hints. */
    example_utterances: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    openapi_url: z.ZodString;
    mcp_url: z.ZodOptional<z.ZodString>;
    ui: z.ZodObject<{
        /** URL of the Module Federation remote entry (web shell). */
        remote_url: z.ZodOptional<z.ZodString>;
        /** Published npm package name for React Native components. */
        native_package: z.ZodOptional<z.ZodString>;
        /** Component names the shell is allowed to render. */
        components: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        components: string[];
        remote_url?: string | undefined;
        native_package?: string | undefined;
    }, {
        remote_url?: string | undefined;
        native_package?: string | undefined;
        components?: string[] | undefined;
    }>;
    health_url: z.ZodString;
    sla: z.ZodObject<{
        p50_latency_ms: z.ZodNumber;
        p95_latency_ms: z.ZodNumber;
        availability_target: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        p95_latency_ms: number;
        p50_latency_ms: number;
        availability_target: number;
    }, {
        p95_latency_ms: number;
        p50_latency_ms: number;
        availability_target: number;
    }>;
    /** Narrow list of PII fields the agent may be granted. */
    pii_scope: z.ZodArray<z.ZodEnum<["name", "email", "phone", "address", "dob", "payment_method_id", "passport", "passport_optional", "loyalty_numbers", "traveler_profile"]>, "many">;
    requires_payment: z.ZodDefault<z.ZodBoolean>;
    /** ISO region codes where this agent is available to users. */
    supported_regions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /**
     * Contract/capability block. Defaulted so v0.1.x manifests still parse —
     * but registry-level validation (in the shell) will refuse to register
     * an agent that exposes a money tool without `implements_cancellation`.
     */
    capabilities: z.ZodDefault<z.ZodObject<{
        /**
         * SDK semver the agent was built against. The shell refuses to register
         * an agent whose major ≠ the shell's major (breaking contract drift).
         */
        sdk_version: z.ZodString;
        /**
         * Does this agent participate in compound bookings (trip summaries)?
         * If false, the orchestrator will never route a leg of a TripSummary
         * to this agent — it can only be used for single-leg intents. Any
         * agent with a money tool SHOULD set this to true; the registry will
         * warn if money + compound=false to flag the config as likely wrong.
         */
        supports_compound_bookings: z.ZodDefault<z.ZodBoolean>;
        /**
         * Does the agent implement the cancellation protocol for every money
         * tool it exposes? This is validated structurally at OpenAPI load
         * (see openapi.ts validateCancellationProtocol), but we record the
         * self-declaration here so health checks can surface the gap early
         * even before the first tool bridge is built.
         */
        implements_cancellation: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        sdk_version: string;
        supports_compound_bookings: boolean;
        implements_cancellation: boolean;
    }, {
        sdk_version: string;
        supports_compound_bookings?: boolean | undefined;
        implements_cancellation?: boolean | undefined;
    }>>;
    /** Optional metadata for analytics / ops. */
    owner_team: z.ZodOptional<z.ZodString>;
    on_call_escalation: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    agent_id: string;
    version: string;
    domain: string;
    display_name: string;
    one_liner: string;
    intents: string[];
    example_utterances: string[];
    openapi_url: string;
    ui: {
        components: string[];
        remote_url?: string | undefined;
        native_package?: string | undefined;
    };
    health_url: string;
    sla: {
        p95_latency_ms: number;
        p50_latency_ms: number;
        availability_target: number;
    };
    pii_scope: ("name" | "email" | "phone" | "address" | "dob" | "payment_method_id" | "passport" | "passport_optional" | "loyalty_numbers" | "traveler_profile")[];
    requires_payment: boolean;
    supported_regions: string[];
    capabilities: {
        sdk_version: string;
        supports_compound_bookings: boolean;
        implements_cancellation: boolean;
    };
    mcp_url?: string | undefined;
    owner_team?: string | undefined;
    on_call_escalation?: string | undefined;
}, {
    agent_id: string;
    version: string;
    domain: string;
    display_name: string;
    one_liner: string;
    intents: string[];
    openapi_url: string;
    ui: {
        remote_url?: string | undefined;
        native_package?: string | undefined;
        components?: string[] | undefined;
    };
    health_url: string;
    sla: {
        p95_latency_ms: number;
        p50_latency_ms: number;
        availability_target: number;
    };
    pii_scope: ("name" | "email" | "phone" | "address" | "dob" | "payment_method_id" | "passport" | "passport_optional" | "loyalty_numbers" | "traveler_profile")[];
    example_utterances?: string[] | undefined;
    mcp_url?: string | undefined;
    requires_payment?: boolean | undefined;
    supported_regions?: string[] | undefined;
    capabilities?: {
        sdk_version: string;
        supports_compound_bookings?: boolean | undefined;
        implements_cancellation?: boolean | undefined;
    } | undefined;
    owner_team?: string | undefined;
    on_call_escalation?: string | undefined;
}>;
export type AgentSLA = z.infer<typeof AgentSLASchema>;
export type AgentUIManifest = z.infer<typeof AgentUIManifestSchema>;
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
export type AgentManifest = z.infer<typeof AgentManifestSchema>;
/**
 * Authoring-time input shape for `defineManifest`. Defaulted fields
 * (e.g. `capabilities`) are optional; the parser fills them in.
 */
export type AgentManifestInput = z.input<typeof AgentManifestSchema> & {
    pii_scope: PIIScope[];
    supported_regions: RegionCode[];
};
/**
 * Define and validate an agent manifest at build time. Throws with a readable
 * error if the shape is wrong. Use this in your agent's `app/manifest.ts`.
 */
export declare function defineManifest(input: AgentManifestInput): AgentManifest;
/**
 * Runtime guard used by the shell when it loads `/.well-known/agent.json` from
 * a remote agent. Never trust manifest data without running it through this.
 */
export declare function parseManifest(raw: unknown): AgentManifest;
//# sourceMappingURL=manifest.d.ts.map