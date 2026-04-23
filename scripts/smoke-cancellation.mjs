/**
 * Smoke test for the v0.2 cancellation protocol.
 *
 * Exercises:
 *   1. Happy path — money tool with matching cancel counterpart loads cleanly.
 *   2. Money tool WITHOUT x-lumo-cancels is rejected at bridge time.
 *   3. Money tool pointing at a non-existent cancel id is rejected.
 *   4. Cancel with no back-pointer (or wrong back-pointer) is rejected.
 *   5. Cancel that requires confirmation is rejected (Saga must not re-prompt).
 *   6. Defaulted compensation_kind is "best-effort" on any cancel tool.
 *   7. Manifest capabilities block parses with legacy (unset) and new values.
 *
 * Runs against dist/, same as smoke-trips.
 *
 *   node scripts/smoke-cancellation.mjs
 */

import {
  openApiToClaudeTools,
  mergeBridges,
} from "../dist/openapi.js";
import { parseManifest, AgentManifestSchema } from "../dist/manifest.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ✗", msg);
    failures += 1;
  } else {
    console.log("  ✓", msg);
  }
}
function rejects(fn, substring, msg) {
  try {
    fn();
    assert(false, `${msg} (expected throw)`);
  } catch (err) {
    const message = String(err?.message ?? err);
    if (substring && !message.includes(substring)) {
      assert(false, `${msg} (wrong error: ${message})`);
    } else {
      assert(true, msg);
    }
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────
function docWith(ops) {
  const paths = {};
  for (const [path, method, op] of ops) {
    paths[path] ??= {};
    paths[path][method] = op;
  }
  return { openapi: "3.1.0", info: { title: "x", version: "0.0.0" }, paths };
}

const bookOffer = {
  operationId: "flight_book_offer",
  summary: "Book the held offer",
  "x-lumo-tool": true,
  "x-lumo-cost-tier": "money",
  "x-lumo-requires-confirmation": "structured-itinerary",
  "x-lumo-cancels": "flight_cancel_booking",
};
const cancelBooking = {
  operationId: "flight_cancel_booking",
  summary: "Cancel a prior booking (Saga rollback)",
  "x-lumo-tool": true,
  "x-lumo-cost-tier": "free",
  "x-lumo-cancel-for": "flight_book_offer",
  "x-lumo-requires-confirmation": false,
  "x-lumo-compensation-kind": "best-effort",
};

// ── 1. Happy path ────────────────────────────────────────────────────────
console.log("\n[1] happy path — money tool with matching cancel loads");
const happy = openApiToClaudeTools(
  "flight",
  docWith([
    ["/book", "post", bookOffer],
    ["/cancel", "post", cancelBooking],
  ]),
);
assert(happy.tools.length === 2, "both tools exposed");
assert(
  happy.routing.flight_book_offer.cancels === "flight_cancel_booking",
  "money tool routing carries `cancels`",
);
assert(
  happy.routing.flight_cancel_booking.cancel_for === "flight_book_offer",
  "cancel tool routing carries `cancel_for`",
);
assert(
  happy.routing.flight_cancel_booking.compensation_kind === "best-effort",
  "explicit compensation_kind preserved",
);

// ── 2. Money tool missing x-lumo-cancels ─────────────────────────────────
console.log("\n[2] money tool without x-lumo-cancels is refused");
rejects(
  () =>
    openApiToClaudeTools(
      "flight",
      docWith([["/book", "post", { ...bookOffer, "x-lumo-cancels": undefined }]]),
    ),
  "does not declare `x-lumo-cancels`",
  "missing cancel counterpart rejected",
);

// ── 3. Money tool pointing at non-existent cancel ────────────────────────
console.log("\n[3] x-lumo-cancels referencing unknown op is refused");
rejects(
  () =>
    openApiToClaudeTools(
      "flight",
      docWith([
        ["/book", "post", { ...bookOffer, "x-lumo-cancels": "ghost_op" }],
      ]),
    ),
  "is not ",
  "dangling cancel reference rejected",
);

// ── 4. Cancel without back-pointer (or wrong back-pointer) ───────────────
console.log("\n[4] cancel missing/wrong x-lumo-cancel-for is refused");
rejects(
  () =>
    openApiToClaudeTools(
      "flight",
      docWith([
        ["/book", "post", bookOffer],
        [
          "/cancel",
          "post",
          { ...cancelBooking, "x-lumo-cancel-for": undefined },
        ],
      ]),
    ),
  "bidirectional",
  "cancel without back-pointer rejected",
);
rejects(
  () =>
    openApiToClaudeTools(
      "flight",
      docWith([
        ["/book", "post", bookOffer],
        [
          "/cancel",
          "post",
          { ...cancelBooking, "x-lumo-cancel-for": "some_other_tool" },
        ],
      ]),
    ),
  "bidirectional",
  "cancel with wrong back-pointer rejected",
);

// ── 5. Cancel that requires confirmation ─────────────────────────────────
console.log("\n[5] cancel tool requiring confirmation is refused");
rejects(
  () =>
    openApiToClaudeTools(
      "flight",
      docWith([
        ["/book", "post", bookOffer],
        [
          "/cancel",
          "post",
          {
            ...cancelBooking,
            "x-lumo-requires-confirmation": "structured-booking",
          },
        ],
      ]),
    ),
  "must set `false`",
  "cancel requiring confirmation rejected",
);

// ── 6. Defaulted compensation_kind ───────────────────────────────────────
console.log("\n[6] compensation_kind defaults to best-effort");
const defaulted = openApiToClaudeTools(
  "flight",
  docWith([
    ["/book", "post", bookOffer],
    [
      "/cancel",
      "post",
      { ...cancelBooking, "x-lumo-compensation-kind": undefined },
    ],
  ]),
);
assert(
  defaulted.routing.flight_cancel_booking.compensation_kind === "best-effort",
  "default applied on cancel tool",
);
// Money (forward) tool: no cancel metadata, so compensation_kind should be unset.
assert(
  defaulted.routing.flight_book_offer.compensation_kind === undefined,
  "compensation_kind not synthesized on forward money tool",
);

// ── 7. Manifest capabilities ─────────────────────────────────────────────
console.log("\n[7] manifest capabilities parse w/ legacy and explicit values");
const baseManifest = {
  agent_id: "flight",
  version: "0.1.0",
  domain: "flights",
  display_name: "Lumo Flights",
  one_liner: "Search, price, and book flights worldwide.",
  intents: ["book_flight"],
  openapi_url: "https://flight.lumo.rentals/openapi.json",
  ui: { components: [] },
  health_url: "https://flight.lumo.rentals/api/health",
  sla: { p50_latency_ms: 1500, p95_latency_ms: 4000, availability_target: 0.99 },
  pii_scope: ["name", "email"],
  supported_regions: ["US"],
};
// Legacy (no capabilities block) → parses with defaults.
const legacy = parseManifest({ ...baseManifest });
assert(
  legacy.capabilities.sdk_version === "0.1.0" &&
    legacy.capabilities.supports_compound_bookings === false &&
    legacy.capabilities.implements_cancellation === false,
  "legacy manifest gets default capabilities",
);
// Explicit capabilities block survives round-trip.
const modern = parseManifest({
  ...baseManifest,
  capabilities: {
    sdk_version: "0.2.0-rc.1",
    supports_compound_bookings: true,
    implements_cancellation: true,
  },
});
assert(
  modern.capabilities.sdk_version === "0.2.0-rc.1" &&
    modern.capabilities.supports_compound_bookings === true &&
    modern.capabilities.implements_cancellation === true,
  "explicit capabilities round-trip",
);
// Bad sdk_version → rejected by regex.
const bad = AgentManifestSchema.safeParse({
  ...baseManifest,
  capabilities: {
    sdk_version: "latest",
    supports_compound_bookings: false,
    implements_cancellation: false,
  },
});
assert(!bad.success, "non-semver sdk_version rejected");

// ── 8. mergeBridges preserves per-agent validation ───────────────────────
console.log("\n[8] mergeBridges: per-agent validation runs before merge");
// Each agent is validated in isolation by openApiToClaudeTools, so a bad
// doc fails at bridge construction — not at merge. Merge just enforces
// tool-name uniqueness across agents.
const merged = mergeBridges([
  openApiToClaudeTools(
    "flight",
    docWith([
      ["/book", "post", bookOffer],
      ["/cancel", "post", cancelBooking],
    ]),
  ),
]);
assert(merged.tools.length === 2, "merged bridge carries both tools");
assert(
  merged.routing.flight_book_offer.cancels === "flight_cancel_booking",
  "cancel metadata survives merge",
);

// ── summary ──────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log("✓ all cancellation-protocol smokes passed");
  process.exit(0);
} else {
  console.error(`✗ ${failures} failure(s)`);
  process.exit(1);
}
