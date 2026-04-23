/**
 * Health probe contract.
 *
 * Every agent serves GET /api/health. The shell polls this every 10s and
 * feeds the rolling score into the circuit breaker. Unhealthy agents are
 * removed from the LLM's tool list for new turns.
 */
import { z } from "zod";
export const HealthStatus = z.enum(["ok", "degraded", "down"]);
export const HealthReportSchema = z.object({
    status: HealthStatus,
    agent_id: z.string(),
    version: z.string(),
    /** Unix ms timestamp. */
    checked_at: z.number().int().positive(),
    /** Rolling p95 for the last 60s, in ms. */
    p95_latency_ms: z.number().nonnegative().optional(),
    /** Rolling error rate for the last 60s, 0..1. */
    error_rate: z.number().min(0).max(1).optional(),
    /** Per-upstream health breakdown (Duffel, MealMe, etc.). */
    upstream: z
        .record(z.object({
        status: HealthStatus,
        latency_ms: z.number().nonnegative().optional(),
        last_error: z.string().optional(),
    }))
        .optional(),
    /** Human-readable note surfaced to on-call. */
    note: z.string().optional(),
});
/**
 * Convenience for agents. Pass a producer that returns the current snapshot;
 * the helper wraps it in a Next.js-compatible Response. Agents can still roll
 * their own route handler; this is for the common case.
 */
export function healthResponse(report) {
    const body = HealthReportSchema.parse({ ...report, checked_at: Date.now() });
    const statusCode = body.status === "ok" ? 200 : body.status === "degraded" ? 200 : 503;
    return new Response(JSON.stringify(body), {
        status: statusCode,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
/**
 * Compute a rolling health score (0..1) used by the shell's circuit breaker.
 * Inputs are normalized to the SLA thresholds declared in the agent manifest.
 *
 * Score = w_avail * availability + w_latency * (1 - latency_overshoot) -
 *         w_errors * error_rate, clamped to [0, 1].
 */
export function computeHealthScore(args) {
    const { report, sla_p95_latency_ms, observed_availability } = args;
    const latency_overshoot = report.p95_latency_ms
        ? Math.max(0, Math.min(1, (report.p95_latency_ms - sla_p95_latency_ms) / sla_p95_latency_ms))
        : 0;
    const latency_score = 1 - latency_overshoot;
    const availability_score = Math.max(0, Math.min(1, observed_availability));
    const error_rate = report.error_rate ?? 0;
    const score = 0.5 * availability_score + 0.35 * latency_score - 0.15 * error_rate * 5;
    return Math.max(0, Math.min(1, score));
}
//# sourceMappingURL=health.js.map