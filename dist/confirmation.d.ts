/**
 * Confirmation gate.
 *
 * Any tool call tagged `x-lumo-cost-tier: money` must pass this gate before
 * the orchestrator will invoke it. The gate is enforced in code — not in the
 * prompt — because a sufficiently creative LLM can always be talked into
 * ignoring instructions.
 *
 * A "structured summary" is a JSON blob the assistant rendered in a prior
 * turn (itinerary, cart, booking details). Its canonical hash is stored with
 * the turn and must match the `summary_hash` field on the money-moving tool
 * call's arguments.
 */
export type ConfirmationKind = "structured-cart" | "structured-itinerary" | "structured-booking"
/**
 * Restaurant reservation. Emitted by the Restaurant Agent before it
 * commits a booking via `restaurant_create_reservation`. Payload shape
 * is `canonicalReservationSummary` in the agent; the shell renders a
 * `ReservationConfirmationCard` as the user-facing gate.
 */
 | "structured-reservation"
/**
 * Compound envelope wrapping N single-leg summaries. Used by the shell
 * when a user intent spans multiple specialists (flight + hotel +
 * restaurant). See trips.ts for the envelope shape and docs/rfcs/
 * 0001-compound-bookings.md for the design.
 */
 | "structured-trip";
/**
 * A structured summary rendered to the user in a prior assistant turn.
 * Every money-moving tool call must reference one of these by hash.
 */
export interface ConfirmationSummary<T = unknown> {
    kind: ConfirmationKind;
    /** Sha-256 hex of the canonical-JSON serialization of `payload`. */
    hash: string;
    /** The user-visible payload. Can be anything JSON-serializable. */
    payload: T;
    /** Session & turn that rendered this summary. */
    session_id: string;
    turn_id: string;
    rendered_at: string;
}
/**
 * Produce a canonical hash for a summary payload. Keys are sorted so that
 * functionally-equivalent payloads hash identically.
 */
export declare function hashSummary(payload: unknown): string;
export interface ConfirmationEvaluation {
    ok: boolean;
    reason?: "no-prior-summary" | "summary-hash-mismatch" | "no-user-confirmation" | "wrong-summary-kind" | "summary-expired";
    message?: string;
}
export interface EvaluateArgs {
    /** The kind of summary the tool requires (from x-lumo-requires-confirmation). */
    required_kind: ConfirmationKind;
    /** The most recent summary rendered in this session. */
    prior_summary: ConfirmationSummary | null;
    /** The `summary_hash` field the LLM put on the tool-call arguments. */
    tool_call_summary_hash: string | undefined;
    /** Whether the user's most recent message is a valid affirmative. */
    user_confirmed: boolean;
    /** Max age of a summary before we require re-rendering (ms). Default 10 min. */
    max_age_ms?: number;
    /** Current time (ms since epoch). */
    now?: number;
}
/**
 * Evaluate whether a money-moving tool call is allowed to fire. The
 * orchestrator runs this before dispatching the HTTP request to the agent.
 */
export declare function evaluateConfirmation(args: EvaluateArgs): ConfirmationEvaluation;
export declare function isAffirmative(userMessage: string): boolean;
import type { TripSummary } from "./trips.js";
export interface EvaluateCompoundArgs {
    /** The trip summary the shell aggregated and the user affirmed. */
    prior_trip_summary: TripSummary | null;
    /** `trip_hash` field the LLM put on this leg's tool-call arguments. */
    tool_call_trip_hash: string | undefined;
    /**
     * `trip_leg_order` field the LLM put on the tool-call arguments.
     * Must equal the next un-committed leg's `order`. Prevents
     * out-of-order execution.
     */
    tool_call_leg_order: number | undefined;
    /** Orders of legs already successfully committed in this trip. */
    committed_leg_orders: number[];
    /**
     * Whether the user already affirmed the trip. One confirm covers all
     * legs within the trip as long as the trip hash matches — subsequent
     * leg dispatches do NOT require re-confirmation.
     */
    trip_confirmed: boolean;
    max_age_ms?: number;
    now?: number;
}
/**
 * Gate for legs of a compound booking. Runs once per leg dispatch.
 * Checks: trip hash stable, leg order is the next un-committed slot,
 * user confirmed the trip exactly once.
 */
export declare function evaluateCompoundConfirmation(args: EvaluateCompoundArgs): ConfirmationEvaluation;
//# sourceMappingURL=confirmation.d.ts.map