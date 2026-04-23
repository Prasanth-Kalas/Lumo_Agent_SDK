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

import { createHash } from "node:crypto";

export type ConfirmationKind =
  | "structured-cart"
  | "structured-itinerary"
  | "structured-booking"
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
  rendered_at: string; // ISO
}

/**
 * Produce a canonical hash for a summary payload. Keys are sorted so that
 * functionally-equivalent payloads hash identically.
 */
export function hashSummary(payload: unknown): string {
  const canonical = stableStringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ConfirmationEvaluation {
  ok: boolean;
  reason?:
    | "no-prior-summary"
    | "summary-hash-mismatch"
    | "no-user-confirmation"
    | "wrong-summary-kind"
    | "summary-expired";
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
export function evaluateConfirmation(args: EvaluateArgs): ConfirmationEvaluation {
  const now = args.now ?? Date.now();
  const max_age_ms = args.max_age_ms ?? 10 * 60 * 1000;

  if (!args.prior_summary) {
    return {
      ok: false,
      reason: "no-prior-summary",
      message:
        "A structured summary must be presented to the user before this tool can run.",
    };
  }

  if (args.prior_summary.kind !== args.required_kind) {
    return {
      ok: false,
      reason: "wrong-summary-kind",
      message: `This tool requires a ${args.required_kind} summary; found ${args.prior_summary.kind}.`,
    };
  }

  const rendered_at_ms = Date.parse(args.prior_summary.rendered_at);
  if (Number.isFinite(rendered_at_ms) && now - rendered_at_ms > max_age_ms) {
    return {
      ok: false,
      reason: "summary-expired",
      message: "The confirmation summary is too old; please re-present it to the user.",
    };
  }

  if (
    !args.tool_call_summary_hash ||
    args.tool_call_summary_hash !== args.prior_summary.hash
  ) {
    return {
      ok: false,
      reason: "summary-hash-mismatch",
      message:
        "The tool call's summary_hash does not match the summary the user was shown.",
    };
  }

  if (!args.user_confirmed) {
    return {
      ok: false,
      reason: "no-user-confirmation",
      message: "User has not affirmed the summary in their most recent message.",
    };
  }

  return { ok: true };
}

/**
 * Lightweight heuristic for the user's most recent message being an
 * affirmative confirmation. Regex-only — the orchestrator pairs this with a
 * Claude-based classifier for production and keeps this as a safety backstop.
 */
const AFFIRMATIVE_REGEX =
  /^\s*(yes|yep|yeah|yup|sure|ok(ay)?|confirm(ed)?|go(ahead)?|do it|book it|place it|order it|sounds good|looks good|perfect|proceed|let's do it|let's go)[.! ]*$/i;

export function isAffirmative(userMessage: string): boolean {
  return AFFIRMATIVE_REGEX.test(userMessage.trim());
}

// ──────────────────────────────────────────────────────────────────────────
// Compound evaluator — gate for trip-scoped money tools
// ──────────────────────────────────────────────────────────────────────────

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
export function evaluateCompoundConfirmation(
  args: EvaluateCompoundArgs,
): ConfirmationEvaluation {
  const now = args.now ?? Date.now();
  const max_age_ms = args.max_age_ms ?? 10 * 60 * 1000;

  if (!args.prior_trip_summary) {
    return {
      ok: false,
      reason: "no-prior-summary",
      message:
        "A trip summary must be presented to the user before any compound-booking leg can run.",
    };
  }

  if (args.prior_trip_summary.kind !== "structured-trip") {
    return {
      ok: false,
      reason: "wrong-summary-kind",
      message: "Compound legs require a structured-trip summary.",
    };
  }

  // TripSummary carries no rendered_at on the envelope itself; the shell
  // tracks it out-of-band. If max_age_ms was passed, we expect caller to
  // have injected `now` and know what they're doing.
  void max_age_ms;
  void now;

  if (
    !args.tool_call_trip_hash ||
    args.tool_call_trip_hash !== args.prior_trip_summary.hash
  ) {
    return {
      ok: false,
      reason: "summary-hash-mismatch",
      message:
        "The tool call's trip_hash does not match the trip the user confirmed.",
    };
  }

  if (
    !Number.isInteger(args.tool_call_leg_order) ||
    (args.tool_call_leg_order as number) < 1
  ) {
    return {
      ok: false,
      reason: "summary-hash-mismatch",
      message: "Tool call missing a valid trip_leg_order.",
    };
  }

  const committed = new Set(args.committed_leg_orders);
  // Next un-committed leg is the smallest order not yet in `committed`.
  const legs = args.prior_trip_summary.payload.legs
    .slice()
    .sort((a, b) => a.order - b.order);
  const nextUncommitted = legs.find((l) => !committed.has(l.order));
  if (!nextUncommitted) {
    return {
      ok: false,
      reason: "summary-hash-mismatch",
      message: "All legs of this trip are already committed.",
    };
  }
  if (args.tool_call_leg_order !== nextUncommitted.order) {
    return {
      ok: false,
      reason: "summary-hash-mismatch",
      message: `Out-of-order leg dispatch: expected order ${nextUncommitted.order}, got ${args.tool_call_leg_order}.`,
    };
  }

  if (!args.trip_confirmed) {
    return {
      ok: false,
      reason: "no-user-confirmation",
      message: "User has not affirmed this trip.",
    };
  }

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
