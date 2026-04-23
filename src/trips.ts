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

import { hashSummary } from "./confirmation.js";
import type { AttachedSummary } from "./summaries.js";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

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
export const LUMO_TRIP_SUMMARY_KEY = "_lumo_trip_summary" as const;

/**
 * A body that carries a TripSummary envelope.
 */
export type WithTripSummary<B extends object> = B & {
  readonly [LUMO_TRIP_SUMMARY_KEY]: TripSummary;
};

// ──────────────────────────────────────────────────────────────────────────
// Hashing — compound over leg hashes, not leg payloads
// ──────────────────────────────────────────────────────────────────────────

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
export function hashTripSummary(payload: TripSummaryPayload): string {
  const canonical = {
    trip_title: payload.trip_title,
    total_amount: payload.total_amount,
    currency: payload.currency,
    legs: payload.legs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((l) => ({
        agent_id: l.agent_id,
        tool_name: l.tool_name,
        order: l.order,
        depends_on: l.depends_on.slice().sort((x, y) => x - y),
        leg_hash: l.summary.hash,
      })),
  };
  return hashSummary(canonical);
}

// ──────────────────────────────────────────────────────────────────────────
// Attach / extract / strip (mirrors summaries.ts surface for consistency)
// ──────────────────────────────────────────────────────────────────────────

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
export function attachTripSummary<B extends object>(
  body: B,
  input: AttachTripSummaryInput,
): WithTripSummary<B> {
  assertValidTripPayload(input.payload);

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError(
      "attachTripSummary: `body` must be a plain object (got " +
        (Array.isArray(body) ? "array" : typeof body) +
        ")",
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, LUMO_TRIP_SUMMARY_KEY)) {
    throw new Error(
      `attachTripSummary: body already carries a \`${LUMO_TRIP_SUMMARY_KEY}\` field; refusing to overwrite.`,
    );
  }

  const envelope: TripSummary = Object.freeze({
    kind: "structured-trip" as const,
    payload: input.payload,
    hash: hashTripSummary(input.payload),
  });

  return { ...body, [LUMO_TRIP_SUMMARY_KEY]: envelope } as WithTripSummary<B>;
}

/**
 * Defensive extractor — returns the trip envelope if the input looks
 * like a body carrying one, else `null`. Used by the shell when
 * reading back its own cached trip state (and later, if trip envelopes
 * ever cross HTTP boundaries, for untrusted input).
 */
export function extractTripSummary(input: unknown): TripSummary | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const env = (input as Record<string, unknown>)[LUMO_TRIP_SUMMARY_KEY];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return null;
  const rec = env as Record<string, unknown>;
  if (rec.kind !== "structured-trip") return null;
  if (typeof rec.hash !== "string" || !/^[0-9a-f]{64}$/.test(rec.hash)) return null;
  if (rec.payload === null || typeof rec.payload !== "object") return null;

  // Trust-but-verify: recompute the hash and refuse on mismatch. This
  // is the single place the shell's gate anchors.
  const payload = rec.payload as TripSummaryPayload;
  try {
    assertValidTripPayload(payload);
  } catch {
    return null;
  }
  const recomputed = hashTripSummary(payload);
  if (recomputed !== rec.hash) return null;

  return {
    kind: "structured-trip",
    payload,
    hash: rec.hash,
  };
}

export function stripTripSummary<B extends object>(body: B): B {
  if (body === null || typeof body !== "object") return body;
  if (!Object.prototype.hasOwnProperty.call(body, LUMO_TRIP_SUMMARY_KEY)) return body;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [LUMO_TRIP_SUMMARY_KEY]: _removed, ...rest } = body as Record<string, unknown>;
  return rest as B;
}

// ──────────────────────────────────────────────────────────────────────────
// Validation — strict, throws, used by attach and extract
// ──────────────────────────────────────────────────────────────────────────

function assertValidTripPayload(p: TripSummaryPayload): void {
  if (!p || typeof p !== "object") {
    throw new TypeError("TripSummaryPayload: must be an object");
  }
  if (typeof p.trip_title !== "string" || p.trip_title.length === 0) {
    throw new TypeError("TripSummaryPayload.trip_title: non-empty string required");
  }
  if (typeof p.total_amount !== "string" || !/^\d+(\.\d+)?$/.test(p.total_amount)) {
    throw new TypeError(
      "TripSummaryPayload.total_amount: decimal string required (e.g. \"1247.00\")",
    );
  }
  if (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency)) {
    throw new TypeError("TripSummaryPayload.currency: ISO 4217 code required");
  }
  if (!Array.isArray(p.legs) || p.legs.length === 0) {
    throw new TypeError("TripSummaryPayload.legs: non-empty array required");
  }

  const orders = new Set<number>();
  for (const leg of p.legs) {
    if (typeof leg.agent_id !== "string" || leg.agent_id.length === 0) {
      throw new TypeError("TripLegRef.agent_id: non-empty string required");
    }
    if (typeof leg.tool_name !== "string" || leg.tool_name.length === 0) {
      throw new TypeError("TripLegRef.tool_name: non-empty string required");
    }
    if (!Number.isInteger(leg.order) || leg.order < 1) {
      throw new TypeError("TripLegRef.order: positive integer required");
    }
    if (orders.has(leg.order)) {
      throw new Error(`TripLegRef.order ${leg.order}: duplicate ordering`);
    }
    orders.add(leg.order);
    if (!Array.isArray(leg.depends_on)) {
      throw new TypeError("TripLegRef.depends_on: array required");
    }
    for (const d of leg.depends_on) {
      if (!Number.isInteger(d) || d < 1 || d >= leg.order) {
        throw new Error(
          `TripLegRef[${leg.order}].depends_on contains invalid order ${d}: must be >=1 and < ${leg.order}`,
        );
      }
    }
    // The leg must carry a v0.1 AttachedSummary — minimal shape check.
    if (
      !leg.summary ||
      typeof leg.summary !== "object" ||
      typeof (leg.summary as AttachedSummary).hash !== "string" ||
      !/^[0-9a-f]{64}$/.test((leg.summary as AttachedSummary).hash)
    ) {
      throw new TypeError(
        `TripLegRef[${leg.order}].summary: invalid AttachedSummary (missing or malformed hash)`,
      );
    }
  }

  // Dense 1-indexed ordering: if we have N legs, orders must be {1..N}.
  for (let i = 1; i <= p.legs.length; i += 1) {
    if (!orders.has(i)) {
      throw new Error(
        `TripSummaryPayload.legs: ordering must be dense 1..${p.legs.length}, missing ${i}`,
      );
    }
  }
}
