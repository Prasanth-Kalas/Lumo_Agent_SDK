# RFC 0001 — Compound bookings, TripSummary, and Saga rollback

| | |
| --- | --- |
| **Status** | Draft |
| **Target SDK version** | `@lumo/agent-sdk@0.2.0` |
| **Author** | Kalas + assistant |
| **Created** | 2026-04-23 |
| **Supersedes** | — |

## 1. Context

The SDK v0.1.0 confirmation gate is single-leg. One `flight_price_offer`
call produces one `_lumo_summary`, the shell stores it, the user
confirms, `flight_book_offer` fires iff `summary_hash` matches. This is
correct for "book me a flight" but falls apart on the real consumer
prompt:

> "Book a flight from Chicago to Vegas on May 1, book a suite near the
> airport, and reserve a table at a good restaurant near a casino."

Three bookable legs, three specialists, one user intent, one expected
confirmation. The user made a compound decision; they should make one
compound decision. Making them confirm three times is a product
regression dressed up as rigor.

This RFC defines the primitive that makes compound bookings safe:
`TripSummary` (the compound envelope), `hashTripSummary` (deterministic
composition of leg hashes), cancellation protocol (each bookable tool
has a cancel counterpart), and Saga orchestration semantics (what the
shell does when leg N fails after legs 1..N-1 committed).

This is a one-way door. Once v0.2.0 ships and a vendor pins it, the
envelope shape and the cancellation protocol become part of the public
contract. We're intentionally specifying this before Hotel, Restaurant,
or third-party vendors exist.

## 2. Non-goals

- **Public third-party marketplace.** Vendors are hand-picked v1.
  Signing, vetting, kill-switch policy are separate RFCs.
- **2-phase commit / distributed transaction coordination.** The
  orchestrator is the Saga. Specialists don't coordinate with each other.
- **Partial-leg confirmation UI.** v0.2.0 is all-or-nothing. Toggle-off
  legs in the confirm card is a v0.3 feature.
- **Cross-leg price negotiation.** No "cheaper hotel if you book the
  flight too" logic. Each leg is priced by its own specialist against
  its own provider.

## 3. The envelope

### 3.1 `TripSummary`

A trip is an ordered list of *legs*. Each leg is one bookable output
from one specialist, carrying its own `AttachedSummary` (the existing
v0.1.0 envelope). The trip envelope is a wrapper that:

- lists each leg in execution order,
- names the agent responsible for each leg,
- carries a root `hash` computed from all leg hashes + ordering,
- optionally carries an aggregate user-visible payload (total price,
  trip title, date range).

```ts
export interface TripLegRef {
  /** The specialist that will execute this leg. Matches manifest.agent_id. */
  agent_id: string;
  /** Which bookable tool on that specialist. e.g. "flight_book_offer". */
  tool_name: string;
  /** The v0.1.0 single-leg summary for this leg — verbatim. */
  summary: AttachedSummary;
  /** Ordering within the trip. 1-indexed, dense. */
  order: number;
  /**
   * Legs this leg depends on, by order. Flight = [], hotel = [1],
   * restaurant = [1, 2]. Orchestrator uses this to sequence execution
   * and to compute rollback order (reverse topological).
   */
  depends_on: number[];
}

export interface TripSummaryPayload {
  trip_title: string;           // "Chicago → Las Vegas, May 1–3"
  total_amount: string;         // "1247.00"
  currency: string;             // "USD"
  legs: TripLegRef[];
}

export interface TripSummary {
  kind: "structured-trip";      // new ConfirmationKind
  payload: TripSummaryPayload;
  /** sha256 of hashTripSummary(payload). */
  hash: string;
}
```

### 3.2 `hashTripSummary`

Deterministic over:

1. the ordered list of `(agent_id, tool_name, order, summary.hash)`
   tuples — **not** the full leg payloads, just their v0.1.0 hashes, so
   any leg payload mutation invalidates the trip hash transitively,
2. the aggregate fields (`trip_title`, `total_amount`, `currency`).

```ts
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
        leg_hash: l.summary.hash,
        depends_on: l.depends_on.slice().sort((x, y) => x - y),
      })),
  };
  return hashSummary(canonical);
}
```

Tamper-resistance property: if any leg's summary mutates, its
`summary.hash` changes (v0.1.0 guarantee), which changes the trip
`hash`. The shell's gate compares the trip hash the LLM passes with the
one the shell computed server-side.

### 3.3 `ConfirmationKind` extension

Add `"structured-trip"` to the union. Any tool tagged
`x-lumo-cost-tier: money-compound` requires `required_kind:
"structured-trip"` at the gate.

## 4. Cancellation protocol

### 4.1 Specialist obligation

Every specialist that declares a tool with `x-lumo-cost-tier: money`
MUST declare a cancellation counterpart with:

```yaml
# In the specialist's OpenAPI spec:
paths:
  /tools/flight_cancel_booking:
    post:
      x-lumo-cancels: "flight_book_offer"   # tool_name it compensates
      x-lumo-cost-tier: "compensation"      # distinct from money/read
      requestBody:
        # Takes the booking_id returned by the booked tool
        required: true
      responses:
        '200':  # cancellation succeeded
        '409':  # already cancelled — idempotent
        '422':  # too late to cancel (past non-refundable window)
```

The shell's OpenAPI parser reads `x-lumo-cancels` at boot and wires the
cancel tool to its corresponding book tool. If a specialist declares a
money tool without a cancel counterpart, manifest validation **fails at
registry load** — the specialist does not get registered. This is a
hard gate.

### 4.2 Orchestrator obligation

On compound-booking failure at leg N (where legs `1..N-1` already
committed), the orchestrator:

1. For each committed leg `i` in `N-1..1` (reverse order):
   1. Look up its cancel tool via `x-lumo-cancels`.
   2. POST to it with the leg's booking reference.
   3. Retry with exponential backoff (3 attempts: 0s, 1s, 4s).
2. If any cancellation exhausts retries, **do not silently swallow**.
   Emit a `rollback_incomplete` SSE frame with the leg's booking
   reference and the specialist's `on_call_escalation` URL. User sees:
   "Couldn't cancel your hotel — here's the confirmation number, the
   hotel's support line is X."
3. Never book leg `N+1` after a failure. No forward progress past a
   failed leg.

### 4.3 Idempotency

Cancel calls are idempotent. Orchestrator may retry freely; specialist
must return `200` or `409` regardless of whether the booking was
already cancelled. `422` is reserved for "cancellation window closed"
— this is a terminal state, no retry.

## 5. Orchestration semantics

### 5.1 The happy path

```
User: "flight to Vegas May 1, suite near airport, restaurant near Bellagio"

shell.orchestrator:
  1. Intent decomposition (Claude): 3 legs, dependencies flight<-hotel<-restaurant
  2. Execute leg 1 (flight_search → flight_price_offer) → AttachedSummary_1
  3. Thread state: arrival airport, arrival time into leg 2 context
  4. Execute leg 2 (hotel_search → hotel_price_room) → AttachedSummary_2
  5. Thread state: hotel location into leg 3 context
  6. Execute leg 3 (restaurant_search → restaurant_hold_reservation) → AttachedSummary_3
  7. Aggregate into TripSummary, compute trip hash
  8. Emit SSE `trip_summary` frame → TripConfirmationCard renders
  9. User clicks Confirm / types "yes"
 10. Dispatch flight_book_offer (gate: trip_hash, leg_order=1)
 11. Dispatch hotel_book_room (gate: trip_hash, leg_order=2)
 12. Dispatch restaurant_confirm_reservation (gate: trip_hash, leg_order=3)
 13. Emit SSE `trip_booked` frame with all three booking refs
```

### 5.2 The unhappy path (leg 2 book fails)

```
 10. flight_book_offer → OK (booking_ref_1)
 11. hotel_book_room → 502 upstream error (after retries exhausted)
 12. Rollback: flight_cancel_booking(booking_ref_1)
 13. Emit SSE `trip_rolled_back` frame
 14. User sees: "Couldn't book the hotel — flight was cancelled, no charges."
```

### 5.3 The very-unhappy path (rollback fails)

```
 10. flight_book_offer → OK (booking_ref_1)
 11. hotel_book_room → 502 (retries exhausted)
 12. Rollback: flight_cancel_booking(booking_ref_1) → 500 (retries exhausted)
 13. Emit SSE `rollback_incomplete` frame with:
       - booking_ref_1 = "DUFFEL_ABC123"
       - specialist escalation url
 14. User sees: "Your flight booked (ref ABC123) but we couldn't book the
     hotel AND couldn't cancel the flight. To cancel your flight, contact
     the airline directly with reference ABC123."
```

This is the tail case we will never silently swallow.

## 6. Gate extensions

`evaluateConfirmation()` gains a compound overload:

```ts
export interface EvaluateCompoundArgs {
  prior_trip_summary: TripSummary | null;
  tool_call_trip_hash: string | undefined;
  tool_call_leg_order: number | undefined;
  user_confirmed: boolean;
  max_age_ms?: number;
  now?: number;
}

export function evaluateCompoundConfirmation(
  args: EvaluateCompoundArgs,
): ConfirmationEvaluation;
```

Rules:

- trip-hash must match.
- `tool_call_leg_order` must be the next un-committed leg (prevents
  out-of-order execution).
- `user_confirmed` required **once** — the same confirm covers all
  legs in the trip. Subsequent leg dispatches within the same trip
  inherit the confirmation as long as the trip hash matches.

## 7. State passing between legs

v0.2.0 scope: **Claude context only.** The orchestrator adds the
previous legs' booked results to the tool-use context so the model can
reason about them when composing the next leg's query. No structured
`trip_context` object; no new specialist-facing type.

Rationale: shipping a structured context type early adds mandatory
contract surface that all future vendors must implement even when they
don't need it. We add it when we see the model drop constraints,
which we'll measure via eval traces.

## 8. Migration impact

| Consumer | Action | Breaking? |
| --- | --- | --- |
| Existing Flight Agent | Add `flight_cancel_booking` tool, declare `x-lumo-cancels` | **Breaking** — money tools without cancels fail manifest validation |
| Super Agent | Upgrade to SDK v0.2.0, implement compound orchestrator | Non-breaking at runtime, additive |
| Food Agent (future) | Must declare cancels on any money-tier tool | N/A — not yet SDK-conformant |
| Third parties | N/A in v0.2.0 window | — |

## 9. Open questions (resolved in this RFC by fiat, can be revisited)

| Q | Resolution | Revisit when |
| --- | --- | --- |
| Specialist-side cancel vs 2PC | Specialist-side | Specialists start leaking partial state that 2PC would prevent |
| Rollback policy on rollback failure | Retry bounded, then surface to user | We get the first real incident and measure UX |
| One confirm card vs per-leg | One card, all-or-nothing | We ship v0.2 and measure confirm-rate vs abandon-rate |
| Cross-leg state threading | Claude context only | Eval traces show the model dropping flight-arrival constraint on hotel search |

## 10. Deliverables

SDK v0.2.0 ships:

- [ ] `src/trips.ts` — `TripSummary`, `TripLegRef`, `TripSummaryPayload`,
      `hashTripSummary`, `attachTripSummary`, `extractTripSummary`,
      `stripTripSummary`, `LUMO_TRIP_SUMMARY_KEY`.
- [ ] `src/confirmation.ts` — add `"structured-trip"` to `ConfirmationKind`,
      add `evaluateCompoundConfirmation()`.
- [ ] `src/manifest.ts` — add `x-lumo-cancels` manifest validation,
      `AgentManifestSchema` enforces cancel counterparts.
- [ ] `src/openapi.ts` — surface `x-lumo-cancels` on the tool bridge so
      orchestrator can look up cancel tools.
- [ ] README + migration guide for v0.1 → v0.2.
- [ ] Tag `v0.2.0`, push.

Then Flight Agent + Super Agent upgrade in lockstep before any
compound-booking feature flag flips.
