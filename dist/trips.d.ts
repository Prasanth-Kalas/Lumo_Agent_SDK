/**
 * Compound-booking envelope — aka TripSummary.
 *
 * Background: the v0.1.0 `_lumo_summary` envelope is single-leg. It locks
 * one booked artefact (one flight, one cart) behind a hash the user has
 * to affirm before the shell will dispatch the money-moving tool.
 *
 * Real consumer intents are compound: "book a flight to Vegas on May 1,
 * a suite near the airport, and a table at a good restaurant nearby."
 * That's three specialists, one user decision. Making the user affirm
 * three times is a product regression.
 *
 * `TripSummary` is a wrapper envelope over N v0.1 `AttachedSummary`
 * leaves. The shell aggregates per-leg summaries after pricing each
 * leg, computes a compound hash that depends transitively on every
 * leg's hash, presents one confirmation card, and — if affirmed —
 * dispatches leg bookings in dependency order. If any leg fails after
 * an earlier leg committed, the shell runs cancellation (the Saga)
 * through each specialist's declared compensating tool.
 *
 * See docs/rfcs/0001-compound-bookings.md for the full design.
 */
import type { AttachedSummary } from "./summaries.js";
/**
 * A single leg inside a TripSummary. Each leg binds a specialist
 * (`agent_id`) and its bookable tool (`tool_name`) to an already-priced
 * v0.1 single-leg summary.
 */
export interface TripLegRef {
    /** Matches the specialist's manifest.agent_id. */
    agent_id: string;
    /** The bookable tool the orchestrator will dispatch on confirm. */
    tool_name: string;
    /**
     * The v0.1 single-leg summary for this leg — verbatim. Used by the UI
     * to render per-leg details and by hashTripSummary() for tamper-
     * resistance.
     */
    summary: AttachedSummary;
    /**
     * 1-indexed execution order within the trip. Dense (no gaps).
     * leg[0].order === 1, leg[1].order === 2, …
     */
    order: number;
    /**
     * Orders of legs this leg depends on. Flight = [], hotel = [1],
     * restaurant = [1, 2]. Orchestrator uses this to sequence execution
     * and to compute rollback order (reverse topological).
     */
    depends_on: number[];
}
/**
 * The user-facing trip payload — shown in the TripConfirmationCard.
 */
export interface TripSummaryPayload {
    /** Short user-readable title. e.g. "Chicago → Las Vegas, May 1–3". */
    trip_title: string;
    /** Total across all legs, in currency. Decimal string. */
    total_amount: string;
    /** ISO 4217 currency code. All legs must agree. */
    currency: string;
    /** Ordered list of legs. */
    legs: TripLegRef[];
}
/**
 * The compound envelope. Analogous to AttachedSummary but composed of
 * N single-leg summaries.
 */
export interface TripSummary {
    /** Always "structured-trip" — extends ConfirmationKind in confirmation.ts. */
    kind: "structured-trip";
    payload: TripSummaryPayload;
    /** sha256 hex of hashTripSummary(payload). */
    hash: string;
}
/**
 * Reserved body key for the compound envelope. Distinct from
 * `_lumo_summary` so the shell can tell them apart on a tool result
 * without sniffing `kind`.
 */
export declare const LUMO_TRIP_SUMMARY_KEY: "_lumo_trip_summary";
/**
 * A body that carries a TripSummary envelope.
 */
export type WithTripSummary<B extends object> = B & {
    readonly [LUMO_TRIP_SUMMARY_KEY]: TripSummary;
};
/**
 * Produce the canonical compound hash for a trip payload.
 *
 * Hashes over:
 *   - trip_title, total_amount, currency
 *   - each leg's (agent_id, tool_name, order, depends_on, leg_hash)
 *
 * Explicitly NOT over each leg's full `summary.payload` — we delegate
 * per-leg tamper-resistance to the v0.1 leg hash (which was already
 * computed over the leg's canonical payload). This composes: any
 * mutation inside any leg flips the leg hash, which flips the trip
 * hash, so the shell's gate catches both coarse and fine tampering.
 */
export declare function hashTripSummary(payload: TripSummaryPayload): string;
export interface AttachTripSummaryInput {
    payload: TripSummaryPayload;
}
/**
 * Attach a TripSummary envelope to a response body. Throws if the
 * payload is ill-formed (duplicate orders, empty legs, currency
 * mismatch between legs).
 *
 * Typical caller is the Super Agent's orchestrator, not a specialist —
 * specialists still emit single-leg `_lumo_summary` envelopes; the
 * compound envelope is assembled server-side in the shell.
 */
export declare function attachTripSummary<B extends object>(body: B, input: AttachTripSummaryInput): WithTripSummary<B>;
/**
 * Defensive extractor — returns the trip envelope if the input looks
 * like a body carrying one, else `null`. Used by the shell when
 * reading back its own cached trip state (and later, if trip envelopes
 * ever cross HTTP boundaries, for untrusted input).
 */
export declare function extractTripSummary(input: unknown): TripSummary | null;
export declare function stripTripSummary<B extends object>(body: B): B;
//# sourceMappingURL=trips.d.ts.map