/**
 * Health probe contract.
 *
 * Every agent serves GET /api/health. The shell polls this every 10s and
 * feeds the rolling score into the circuit breaker. Unhealthy agents are
 * removed from the LLM's tool list for new turns.
 */
import { z } from "zod";
export declare const HealthStatus: z.ZodEnum<["ok", "degraded", "down"]>;
export type HealthStatus = z.infer<typeof HealthStatus>;
export declare const HealthReportSchema: z.ZodObject<{
    status: z.ZodEnum<["ok", "degraded", "down"]>;
    agent_id: z.ZodString;
    version: z.ZodString;
    /** Unix ms timestamp. */
    checked_at: z.ZodNumber;
    /** Rolling p95 for the last 60s, in ms. */
    p95_latency_ms: z.ZodOptional<z.ZodNumber>;
    /** Rolling error rate for the last 60s, 0..1. */
    error_rate: z.ZodOptional<z.ZodNumber>;
    /** Per-upstream health breakdown (Duffel, MealMe, etc.). */
    upstream: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        status: z.ZodEnum<["ok", "degraded", "down"]>;
        latency_ms: z.ZodOptional<z.ZodNumber>;
        last_error: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "ok" | "degraded" | "down";
        latency_ms?: number | undefined;
        last_error?: string | undefined;
    }, {
        status: "ok" | "degraded" | "down";
        latency_ms?: number | undefined;
        last_error?: string | undefined;
    }>>>;
    /** Human-readable note surfaced to on-call. */
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "ok" | "degraded" | "down";
    agent_id: string;
    version: string;
    checked_at: number;
    p95_latency_ms?: number | undefined;
    error_rate?: number | undefined;
    upstream?: Record<string, {
        status: "ok" | "degraded" | "down";
        latency_ms?: number | undefined;
        last_error?: string | undefined;
    }> | undefined;
    note?: string | undefined;
}, {
    status: "ok" | "degraded" | "down";
    agent_id: string;
    version: string;
    checked_at: number;
    p95_latency_ms?: number | undefined;
    error_rate?: number | undefined;
    upstream?: Record<string, {
        status: "ok" | "degraded" | "down";
        latency_ms?: number | undefined;
        last_error?: string | undefined;
    }> | undefined;
    note?: string | undefined;
}>;
export type HealthReport = z.infer<typeof HealthReportSchema>;
/**
 * Convenience for agents. Pass a producer that returns the current snapshot;
 * the helper wraps it in a Next.js-compatible Response. Agents can still roll
 * their own route handler; this is for the common case.
 */
export declare function healthResponse(report: Omit<HealthReport, "checked_at">): Response;
/**
 * Compute a rolling health score (0..1) used by the shell's circuit breaker.
 * Inputs are normalized to the SLA thresholds declared in the agent manifest.
 *
 * Score = w_avail * availability + w_latency * (1 - latency_overshoot) -
 *         w_errors * error_rate, clamped to [0, 1].
 */
export declare function computeHealthScore(args: {
    report: HealthReport;
    sla_p95_latency_ms: number;
    sla_availability_target: number;
    observed_availability: number;
}): number;
//# sourceMappingURL=health.d.ts.map