/**
 * Attached summaries — the server-authoritative confirmation envelope.
 *
 * Background: the shell's money-tool gate compares two hashes — the
 * `summary_hash` the LLM puts on a tool call, and the hash of the summary
 * the user was shown in a prior turn. Deriving that prior summary from
 * model-emitted XML is brittle: any whitespace, re-ordering, or stray
 * character in the LLM's output breaks the hash. So we don't.
 *
 * Instead, every agent that can produce a confirmable artefact attaches
 * a canonical summary to the tool response body:
 *
 *   {
 *     offer_id: "...",
 *     total_amount: "287.45",
 *     ...,
 *     _lumo_summary: {
 *       kind: "structured-itinerary",
 *       payload: <the exact object the user will see, key-sorted>,
 *       hash:    <sha256 of the canonical payload>,
 *     }
 *   }
 *
 * The shell extracts `_lumo_summary` from the tool result (not from the
 * model's text), stores it as the turn's confirmation summary, and later
 * matches it against the book-tool's `summary_hash`. Both sides use
 * `hashSummary()` from this same package, so equality is true by
 * construction — LLM formatting is not in the trust path.
 *
 * The envelope lives under a reserved key (`_lumo_summary`) so it cannot
 * collide with legitimate domain fields and is trivially strippable on
 * its way to the user-facing card.
 */

import { hashSummary, type ConfirmationKind } from "./confirmation.js";

/**
 * The envelope an agent attaches to a tool response body.
 *
 * `payload` is the canonical, user-facing summary object. The hash is
 * computed from exactly that payload using {@link hashSummary}, so any
 * agent that re-hashes the payload with the same helper gets the same
 * string.
 */
export interface AttachedSummary<T = unknown> {
  kind: ConfirmationKind;
  payload: T;
  /** sha256 hex of hashSummary(payload). */
  hash: string;
}

/**
 * The reserved body key. Underscore-prefixed so it sorts to the top in
 * most IDEs and is obviously non-domain.
 */
export const LUMO_SUMMARY_KEY = "_lumo_summary" as const;

/**
 * A body that carries a summary envelope.
 */
export type WithAttachedSummary<B extends object, T = unknown> = B & {
  readonly [LUMO_SUMMARY_KEY]: AttachedSummary<T>;
};

export interface AttachSummaryInput<T> {
  kind: ConfirmationKind;
  /** Canonical user-visible payload — must be JSON-serializable. */
  payload: T;
}

/**
 * Attach a canonical summary envelope to a tool response body. The hash
 * is derived from `payload` via {@link hashSummary}; callers must not
 * mutate `payload` after attaching (it is frozen defensively).
 *
 * @example
 *   return Response.json(
 *     attachSummary(offer, {
 *       kind: "structured-itinerary",
 *       payload: canonicalItinerarySummary(offer),
 *     }),
 *   );
 */
export function attachSummary<B extends object, T>(
  body: B,
  input: AttachSummaryInput<T>,
): WithAttachedSummary<B, T> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError(
      "attachSummary: `body` must be a plain object (got " +
        (Array.isArray(body) ? "array" : typeof body) +
        ")",
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, LUMO_SUMMARY_KEY)) {
    throw new Error(
      `attachSummary: body already carries a \`${LUMO_SUMMARY_KEY}\` field; refusing to overwrite.`,
    );
  }
  if (input.payload === undefined) {
    throw new TypeError("attachSummary: `payload` is required.");
  }

  const envelope: AttachedSummary<T> = Object.freeze({
    kind: input.kind,
    payload: input.payload,
    hash: hashSummary(input.payload),
  });

  // Spread into a fresh object so we don't surprise callers with mutation.
  return { ...body, [LUMO_SUMMARY_KEY]: envelope } as WithAttachedSummary<B, T>;
}

/**
 * Type-guard extractor used by the shell's orchestrator. Returns the
 * summary envelope if the input looks like a tool-result body carrying
 * one, else `null`. Intentionally defensive — tool results cross an
 * HTTP boundary and may be partially malformed.
 */
export function extractAttachedSummary(input: unknown): AttachedSummary | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const env = (input as Record<string, unknown>)[LUMO_SUMMARY_KEY];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return null;
  const rec = env as Record<string, unknown>;
  if (typeof rec.kind !== "string") return null;
  if (
    rec.kind !== "structured-cart" &&
    rec.kind !== "structured-itinerary" &&
    rec.kind !== "structured-booking"
  ) {
    return null;
  }
  if (typeof rec.hash !== "string" || !/^[0-9a-f]{64}$/.test(rec.hash)) return null;
  if (!("payload" in rec)) return null;

  return {
    kind: rec.kind as ConfirmationKind,
    payload: rec.payload,
    hash: rec.hash,
  };
}

/**
 * Return a shallow copy of `body` with the summary envelope removed.
 * Useful when passing the tool result downstream to a UI that should
 * not see the internal envelope.
 */
export function stripAttachedSummary<B extends object>(body: B): B {
  if (body === null || typeof body !== "object") return body;
  if (!Object.prototype.hasOwnProperty.call(body, LUMO_SUMMARY_KEY)) return body;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [LUMO_SUMMARY_KEY]: _removed, ...rest } = body as Record<string, unknown>;
  return rest as B;
}
