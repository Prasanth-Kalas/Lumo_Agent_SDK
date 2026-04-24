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
    p50_latency_ms: number;
    p95_latency_ms: number;
    availability_target: number;
}, {
    p50_latency_ms: number;
    p95_latency_ms: number;
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
/**
 * Connection block — introduced in SDK v0.4 to support the Lumo appstore.
 *
 * Every agent that holds user-scoped state (a cart, an order history, a
 * saved payment method, a loyalty account) declares how a Lumo user
 * "connects" their identity to the agent. The Super Agent reads this
 * block when rendering the marketplace card ("Connect Food Agent") and
 * the router reads it to know whether to attach a user-scoped bearer
 * token on each tool dispatch.
 *
 * Three models are allowed today:
 *
 *   "oauth2"    — the agent is an OAuth 2.1 Authorization Server. Lumo
 *                 kicks off the Authorization Code + PKCE flow, stores
 *                 the returned access/refresh tokens per user, and
 *                 attaches `Authorization: Bearer <access>` on every
 *                 tool call. This is the model every Lumo-built agent
 *                 uses and the one third-party SaaS typically slots into.
 *
 *   "lumo_id"   — the agent delegates identity to Lumo. Lumo issues a
 *                 signed OIDC token per request; the agent trusts Lumo's
 *                 JWKS. Cheap for Lumo-native agents; doesn't work for
 *                 third-party SaaS with pre-existing user bases.
 *
 *   "none"      — agent exposes only anonymous tools (e.g., a public
 *                 weather lookup). No per-user state, no bearer, no
 *                 Connect button in the marketplace.
 *
 * An agent with `requires_payment: true` or any money-tier tool MUST NOT
 * declare `"none"`. The Super Agent will refuse to load such a manifest.
 *
 * Why a block, not top-level fields: future additions (API-key-per-user,
 * MTLS, passkey-bound bearer) extend this block without churning the top
 * of the manifest. Keep additions backward-compatible or bump SDK major.
 */
export declare const AgentConnectSchema: z.ZodDiscriminatedUnion<"model", [z.ZodObject<{
    model: z.ZodLiteral<"oauth2">;
    /**
     * The agent's OAuth authorize endpoint. Users are redirected here
     * with client_id, redirect_uri, scope, state, code_challenge,
     * code_challenge_method=S256.
     */
    authorize_url: z.ZodString;
    /**
     * The agent's OAuth token endpoint. Receives the authorization code
     * and returns access_token, refresh_token, expires_in, token_type=Bearer.
     */
    token_url: z.ZodString;
    /**
     * Optional revocation endpoint (RFC 7009). Super Agent calls this on
     * explicit disconnect to tell the agent to invalidate the token
     * server-side. If not provided, we just delete our copy.
     */
    revocation_url: z.ZodOptional<z.ZodString>;
    /**
     * The scopes the agent supports. Minimum set the agent requires for
     * ANY tool call should be listed with `required: true` — the
     * consent UI surfaces that. Additional fine-grained scopes can be
     * declared optional and the consent UI will let the user toggle.
     */
    scopes: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        required: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        required: boolean;
    }, {
        name: string;
        description: string;
        required?: boolean | undefined;
    }>, "many">;
    /**
     * Env var name the Super Agent looks up for this agent's OAuth
     * client_id and client_secret. Convention:
     *   LUMO_<AGENT_ID_SHOUT>_CLIENT_ID / LUMO_<AGENT_ID_SHOUT>_CLIENT_SECRET
     * Declared here so the orchestrator fails fast with a clear error
     * instead of a mysterious 401 at token-exchange time.
     */
    client_id_env: z.ZodString;
    client_secret_env: z.ZodOptional<z.ZodString>;
    /**
     * Whether this client is confidential (secret required) or public
     * (PKCE only). Public is the right default for user-facing apps where
     * the "secret" would just be bundled in the browser. Confidential is
     * right for server-to-server where we can keep the secret out of
     * client code. Lumo Super Agent is always server-side, so
     * confidential is preferred — but agents that haven't wired secrets
     * can still register as public.
     */
    client_type: z.ZodDefault<z.ZodEnum<["public", "confidential"]>>;
}, "strip", z.ZodTypeAny, {
    model: "oauth2";
    authorize_url: string;
    token_url: string;
    scopes: {
        name: string;
        description: string;
        required: boolean;
    }[];
    client_id_env: string;
    client_type: "public" | "confidential";
    revocation_url?: string | undefined;
    client_secret_env?: string | undefined;
}, {
    model: "oauth2";
    authorize_url: string;
    token_url: string;
    scopes: {
        name: string;
        description: string;
        required?: boolean | undefined;
    }[];
    client_id_env: string;
    revocation_url?: string | undefined;
    client_secret_env?: string | undefined;
    client_type?: "public" | "confidential" | undefined;
}>, z.ZodObject<{
    model: z.ZodLiteral<"lumo_id">;
    /**
     * Audience claim the agent expects on the OIDC ID token. Typically
     * the agent's base URL or agent_id.
     */
    audience: z.ZodString;
}, "strip", z.ZodTypeAny, {
    model: "lumo_id";
    audience: string;
}, {
    model: "lumo_id";
    audience: string;
}>, z.ZodObject<{
    model: z.ZodLiteral<"none">;
}, "strip", z.ZodTypeAny, {
    model: "none";
}, {
    model: "none";
}>]>;
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
        p50_latency_ms: number;
        p95_latency_ms: number;
        availability_target: number;
    }, {
        p50_latency_ms: number;
        p95_latency_ms: number;
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
    /**
     * Connection block — how a Lumo user links their account on THIS agent
     * to their Lumo identity. See {@link AgentConnectSchema}. Defaulted to
     * `none` so pre-v0.4 manifests still parse; the registry validator
     * refuses agents with money tools + model="none".
     */
    connect: z.ZodDefault<z.ZodDiscriminatedUnion<"model", [z.ZodObject<{
        model: z.ZodLiteral<"oauth2">;
        /**
         * The agent's OAuth authorize endpoint. Users are redirected here
         * with client_id, redirect_uri, scope, state, code_challenge,
         * code_challenge_method=S256.
         */
        authorize_url: z.ZodString;
        /**
         * The agent's OAuth token endpoint. Receives the authorization code
         * and returns access_token, refresh_token, expires_in, token_type=Bearer.
         */
        token_url: z.ZodString;
        /**
         * Optional revocation endpoint (RFC 7009). Super Agent calls this on
         * explicit disconnect to tell the agent to invalidate the token
         * server-side. If not provided, we just delete our copy.
         */
        revocation_url: z.ZodOptional<z.ZodString>;
        /**
         * The scopes the agent supports. Minimum set the agent requires for
         * ANY tool call should be listed with `required: true` — the
         * consent UI surfaces that. Additional fine-grained scopes can be
         * declared optional and the consent UI will let the user toggle.
         */
        scopes: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            required: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description: string;
            required: boolean;
        }, {
            name: string;
            description: string;
            required?: boolean | undefined;
        }>, "many">;
        /**
         * Env var name the Super Agent looks up for this agent's OAuth
         * client_id and client_secret. Convention:
         *   LUMO_<AGENT_ID_SHOUT>_CLIENT_ID / LUMO_<AGENT_ID_SHOUT>_CLIENT_SECRET
         * Declared here so the orchestrator fails fast with a clear error
         * instead of a mysterious 401 at token-exchange time.
         */
        client_id_env: z.ZodString;
        client_secret_env: z.ZodOptional<z.ZodString>;
        /**
         * Whether this client is confidential (secret required) or public
         * (PKCE only). Public is the right default for user-facing apps where
         * the "secret" would just be bundled in the browser. Confidential is
         * right for server-to-server where we can keep the secret out of
         * client code. Lumo Super Agent is always server-side, so
         * confidential is preferred — but agents that haven't wired secrets
         * can still register as public.
         */
        client_type: z.ZodDefault<z.ZodEnum<["public", "confidential"]>>;
    }, "strip", z.ZodTypeAny, {
        model: "oauth2";
        authorize_url: string;
        token_url: string;
        scopes: {
            name: string;
            description: string;
            required: boolean;
        }[];
        client_id_env: string;
        client_type: "public" | "confidential";
        revocation_url?: string | undefined;
        client_secret_env?: string | undefined;
    }, {
        model: "oauth2";
        authorize_url: string;
        token_url: string;
        scopes: {
            name: string;
            description: string;
            required?: boolean | undefined;
        }[];
        client_id_env: string;
        revocation_url?: string | undefined;
        client_secret_env?: string | undefined;
        client_type?: "public" | "confidential" | undefined;
    }>, z.ZodObject<{
        model: z.ZodLiteral<"lumo_id">;
        /**
         * Audience claim the agent expects on the OIDC ID token. Typically
         * the agent's base URL or agent_id.
         */
        audience: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        model: "lumo_id";
        audience: string;
    }, {
        model: "lumo_id";
        audience: string;
    }>, z.ZodObject<{
        model: z.ZodLiteral<"none">;
    }, "strip", z.ZodTypeAny, {
        model: "none";
    }, {
        model: "none";
    }>]>>;
    /**
     * Appstore catalog fields (v0.4). Surfaced on /marketplace cards.
     * Optional so internal/private agents don't have to fill them in.
     */
    listing: z.ZodOptional<z.ZodObject<{
        /** Square or circular logo, ≥ 128px, hosted by the agent. */
        logo_url: z.ZodOptional<z.ZodString>;
        /** Marketing hero image for the detail page, wide aspect. */
        hero_url: z.ZodOptional<z.ZodString>;
        /** Plain-English category for filters: "Food", "Travel", "Productivity", etc. */
        category: z.ZodOptional<z.ZodString>;
        /** Short (≤200 char) paragraphs, 1-5 of them, for the detail page. */
        about_paragraphs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** Links the detail page surfaces in the sidebar. */
        homepage_url: z.ZodOptional<z.ZodString>;
        privacy_policy_url: z.ZodOptional<z.ZodString>;
        terms_url: z.ZodOptional<z.ZodString>;
        /** Optional pricing note, human-readable: "Free", "Pay-per-use", "Subscription — $9.99/mo". */
        pricing_note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        logo_url?: string | undefined;
        hero_url?: string | undefined;
        category?: string | undefined;
        about_paragraphs?: string[] | undefined;
        homepage_url?: string | undefined;
        privacy_policy_url?: string | undefined;
        terms_url?: string | undefined;
        pricing_note?: string | undefined;
    }, {
        logo_url?: string | undefined;
        hero_url?: string | undefined;
        category?: string | undefined;
        about_paragraphs?: string[] | undefined;
        homepage_url?: string | undefined;
        privacy_policy_url?: string | undefined;
        terms_url?: string | undefined;
        pricing_note?: string | undefined;
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
        p50_latency_ms: number;
        p95_latency_ms: number;
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
    connect: {
        model: "oauth2";
        authorize_url: string;
        token_url: string;
        scopes: {
            name: string;
            description: string;
            required: boolean;
        }[];
        client_id_env: string;
        client_type: "public" | "confidential";
        revocation_url?: string | undefined;
        client_secret_env?: string | undefined;
    } | {
        model: "lumo_id";
        audience: string;
    } | {
        model: "none";
    };
    mcp_url?: string | undefined;
    listing?: {
        logo_url?: string | undefined;
        hero_url?: string | undefined;
        category?: string | undefined;
        about_paragraphs?: string[] | undefined;
        homepage_url?: string | undefined;
        privacy_policy_url?: string | undefined;
        terms_url?: string | undefined;
        pricing_note?: string | undefined;
    } | undefined;
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
        p50_latency_ms: number;
        p95_latency_ms: number;
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
    connect?: {
        model: "oauth2";
        authorize_url: string;
        token_url: string;
        scopes: {
            name: string;
            description: string;
            required?: boolean | undefined;
        }[];
        client_id_env: string;
        revocation_url?: string | undefined;
        client_secret_env?: string | undefined;
        client_type?: "public" | "confidential" | undefined;
    } | {
        model: "lumo_id";
        audience: string;
    } | {
        model: "none";
    } | undefined;
    listing?: {
        logo_url?: string | undefined;
        hero_url?: string | undefined;
        category?: string | undefined;
        about_paragraphs?: string[] | undefined;
        homepage_url?: string | undefined;
        privacy_policy_url?: string | undefined;
        terms_url?: string | undefined;
        pricing_note?: string | undefined;
    } | undefined;
    owner_team?: string | undefined;
    on_call_escalation?: string | undefined;
}>;
export type AgentSLA = z.infer<typeof AgentSLASchema>;
export type AgentUIManifest = z.infer<typeof AgentUIManifestSchema>;
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
export type AgentConnect = z.infer<typeof AgentConnectSchema>;
export type AgentConnectOAuth2 = Extract<AgentConnect, {
    model: "oauth2";
}>;
export type AgentConnectLumoId = Extract<AgentConnect, {
    model: "lumo_id";
}>;
export type AgentConnectNone = Extract<AgentConnect, {
    model: "none";
}>;
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