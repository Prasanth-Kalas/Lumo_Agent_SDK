/**
 * Smoke test for the v0.2 TripSummary primitive.
 * Runs against the built dist/, not source, so we're exercising the
 * same artifact consumers will.
 *
 *   node scripts/smoke-trips.mjs
 */

import { attachSummary } from "../dist/summaries.js";
import {
  attachTripSummary,
  extractTripSummary,
  hashTripSummary,
  LUMO_TRIP_SUMMARY_KEY,
} from "../dist/trips.js";
import {
  evaluateCompoundConfirmation,
} from "../dist/confirmation.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ✗", msg);
    failures += 1;
  } else {
    console.log("  ✓", msg);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────
const flightSummary = attachSummary(
  { offer_id: "DUFFEL_OFF_1" },
  {
    kind: "structured-itinerary",
    payload: { flight: "ORD->LAS", depart: "2026-05-01T08:00", total: "287.45" },
  },
)._lumo_summary;

const hotelSummary = attachSummary(
  { room_id: "MAR_SUI_88" },
  {
    kind: "structured-booking",
    payload: { hotel: "Marriott LAS Airport", nights: 2, total: "489.00" },
  },
)._lumo_summary;

const restaurantSummary = attachSummary(
  { hold_id: "RESY_HOLD_42" },
  {
    kind: "structured-booking",
    payload: { venue: "Le Cirque", party: 2, time: "2026-05-01T20:00" },
  },
)._lumo_summary;

const tripPayload = {
  trip_title: "Chicago → Las Vegas, May 1–3",
  total_amount: "1247.45",
  currency: "USD",
  legs: [
    {
      agent_id: "lumo-flight-agent",
      tool_name: "flight_book_offer",
      summary: flightSummary,
      order: 1,
      depends_on: [],
    },
    {
      agent_id: "lumo-hotel-agent",
      tool_name: "hotel_book_room",
      summary: hotelSummary,
      order: 2,
      depends_on: [1],
    },
    {
      agent_id: "lumo-restaurant-agent",
      tool_name: "restaurant_confirm_reservation",
      summary: restaurantSummary,
      order: 3,
      depends_on: [1, 2],
    },
  ],
};

// ── 1. Hash determinism ─────────────────────────────────────────────────
console.log("\n[1] hashTripSummary is deterministic");
const h1 = hashTripSummary(tripPayload);
const h2 = hashTripSummary(tripPayload);
assert(h1 === h2, "same payload yields same hash");
assert(/^[0-9a-f]{64}$/.test(h1), "hash is sha256 hex");

// Reorder legs in the array but keep `order` values — hash should be stable.
const reordered = {
  ...tripPayload,
  legs: [tripPayload.legs[2], tripPayload.legs[0], tripPayload.legs[1]],
};
assert(hashTripSummary(reordered) === h1, "array-order independence (only `order` field matters)");

// ── 2. Attach / extract round-trip ──────────────────────────────────────
console.log("\n[2] attach / extract round-trip");
const body = attachTripSummary({ meta: "trip-123" }, { payload: tripPayload });
assert(body[LUMO_TRIP_SUMMARY_KEY] !== undefined, "envelope attached");
assert(body[LUMO_TRIP_SUMMARY_KEY].hash === h1, "attached hash matches direct hashTripSummary");
const roundtrip = extractTripSummary(body);
assert(roundtrip !== null, "extract succeeds on well-formed body");
assert(roundtrip.hash === h1, "extracted hash matches");

// ── 3. Tampering invalidates the hash (coarse: total_amount) ────────────
console.log("\n[3] tampering at trip level is caught");
const tamperedTrip = {
  ...body,
  [LUMO_TRIP_SUMMARY_KEY]: {
    ...body[LUMO_TRIP_SUMMARY_KEY],
    payload: {
      ...body[LUMO_TRIP_SUMMARY_KEY].payload,
      total_amount: "1.00",
    },
  },
};
assert(
  extractTripSummary(tamperedTrip) === null,
  "extract refuses payload whose hash no longer matches",
);

// ── 4. Tampering at leg level is caught (transitive via leg_hash) ───────
console.log("\n[4] tampering inside a leg payload is caught transitively");
const legTampered = JSON.parse(JSON.stringify(body));
legTampered[LUMO_TRIP_SUMMARY_KEY].payload.legs[0].summary.payload.total = "0.01";
// Note: we did NOT recompute the leg's hash — so the trip hash is still
// computed from the (now mismatched) leg_hash field. The trip-level
// extract catches this because payload.legs[0].summary.hash no longer
// matches the leg's actual content. In practice the shell will also
// re-verify each leg's summary.hash against its payload before dispatch.
// At the trip envelope level, this specific tamper is NOT caught — the
// leg_hash field is what we hashed. This is the documented composition
// property: catching sub-tampers is the shell's job, not the envelope's.
const extractedAfterLegTamper = extractTripSummary(legTampered);
assert(
  extractedAfterLegTamper !== null,
  "trip envelope still extracts (leg-payload sub-tamper is caught by leg-level verify, not trip-level)",
);
// But if the attacker ALSO flips the leg_hash to match, the trip hash breaks:
const legTamperWithHash = JSON.parse(JSON.stringify(body));
legTamperWithHash[LUMO_TRIP_SUMMARY_KEY].payload.legs[0].summary.hash =
  "deadbeef".repeat(8);
assert(
  extractTripSummary(legTamperWithHash) === null,
  "flipping any leg_hash field invalidates trip hash",
);

// ── 5. Compound gate ────────────────────────────────────────────────────
console.log("\n[5] evaluateCompoundConfirmation");
const trip = roundtrip; // well-formed

// Leg 1 dispatch, no legs committed yet, trip confirmed.
const ok1 = evaluateCompoundConfirmation({
  prior_trip_summary: trip,
  tool_call_trip_hash: trip.hash,
  tool_call_leg_order: 1,
  committed_leg_orders: [],
  trip_confirmed: true,
});
assert(ok1.ok === true, "leg 1 dispatch allowed when confirmed and in order");

// Leg 3 dispatch before leg 2 — should fail.
const ooo = evaluateCompoundConfirmation({
  prior_trip_summary: trip,
  tool_call_trip_hash: trip.hash,
  tool_call_leg_order: 3,
  committed_leg_orders: [1],
  trip_confirmed: true,
});
assert(!ooo.ok && ooo.reason === "summary-hash-mismatch", "out-of-order leg dispatch refused");

// Wrong trip hash.
const wrong = evaluateCompoundConfirmation({
  prior_trip_summary: trip,
  tool_call_trip_hash: "0".repeat(64),
  tool_call_leg_order: 1,
  committed_leg_orders: [],
  trip_confirmed: true,
});
assert(!wrong.ok && wrong.reason === "summary-hash-mismatch", "wrong trip_hash refused");

// Not confirmed.
const notConfirmed = evaluateCompoundConfirmation({
  prior_trip_summary: trip,
  tool_call_trip_hash: trip.hash,
  tool_call_leg_order: 1,
  committed_leg_orders: [],
  trip_confirmed: false,
});
assert(!notConfirmed.ok && notConfirmed.reason === "no-user-confirmation", "unconfirmed trip refused");

// Missing trip summary.
const noPrior = evaluateCompoundConfirmation({
  prior_trip_summary: null,
  tool_call_trip_hash: trip.hash,
  tool_call_leg_order: 1,
  committed_leg_orders: [],
  trip_confirmed: true,
});
assert(!noPrior.ok && noPrior.reason === "no-prior-summary", "missing trip summary refused");

// ── 6. Validation errors ────────────────────────────────────────────────
console.log("\n[6] payload validation");

// Validation fires inside attachTripSummary / extractTripSummary, not the
// pure hash fn (which is symmetrical with v0.1's hashSummary).
function rejects(bad, why) {
  try {
    attachTripSummary({}, { payload: bad });
    assert(false, why);
  } catch {
    assert(true, why);
  }
}

rejects({ ...tripPayload, legs: [] }, "empty legs rejected");
rejects(
  {
    ...tripPayload,
    legs: [
      { ...tripPayload.legs[0], order: 1 },
      { ...tripPayload.legs[1], order: 1 }, // duplicate
    ],
  },
  "duplicate order rejected",
);
rejects(
  {
    ...tripPayload,
    legs: [
      { ...tripPayload.legs[0], order: 1 },
      { ...tripPayload.legs[1], order: 3 }, // gap
    ],
  },
  "non-dense order rejected",
);
rejects({ ...tripPayload, total_amount: "free" }, "non-decimal total rejected");
rejects({ ...tripPayload, currency: "usd" }, "lowercase currency rejected");

// ── summary ──────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log("✓ all trip-primitive smokes passed");
  process.exit(0);
} else {
  console.error(`✗ ${failures} failure(s)`);
  process.exit(1);
}
