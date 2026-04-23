/**
 * Well-known error shape. Agents return these; the shell maps them to
 * user-facing copy.
 */
export type AgentErrorCode = "invalid_input" | "missing_pii" | "unsupported_region" | "confirmation_required" | "confirmation_mismatch" | "not_available" | "price_changed" | "out_of_stock" | "upstream_timeout" | "upstream_error" | "rate_limited" | "payment_failed" | "payment_declined" | "refund_failed" | "internal_error";
export interface AgentError {
    code: AgentErrorCode;
    message: string;
    /** Optional structured detail — never include PII here. */
    detail?: Record<string, unknown>;
    /** ISO timestamp for log correlation. */
    at: string;
    /** Agent-scoped request id for traces. */
    trace_id?: string;
}
export declare class LumoAgentError extends Error {
    readonly code: AgentErrorCode;
    readonly detail?: Record<string, unknown>;
    readonly trace_id?: string;
    constructor(code: AgentErrorCode, message: string, opts?: {
        detail?: Record<string, unknown>;
        trace_id?: string;
    });
    toJSON(): AgentError;
}
/**
 * The shell's user-facing copy for each error code. Agents may override on a
 * per-tool basis but this is the sensible default.
 */
export declare const DEFAULT_USER_COPY: Record<AgentErrorCode, string>;
//# sourceMappingURL=errors.d.ts.map