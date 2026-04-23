/**
 * Agent manifest types.
 *
 * Every specialist agent serves a manifest at `/.well-known/agent.json` that
 * conforms to {@link AgentManifest}. The shell polls manifests at boot to build
 * its registry and re-validates on every deploy webhook.
 */

import { z } from "zod";
import type { PIIScope, RegionCode } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────
// Zod schemas (runtime validation at registry load)
// ──────────────────────────────────────────────────────────────────────────

export const AgentSLASchema = z.object({
  p50_latency_ms: z.number().int().positive(),
  p95_latency_ms: z.number().int().positive(),
  availability_target: z.number().min(0).max(1),
});

export const AgentUIManifestSchema = z.object({
  /** URL of the Module Federation remote entry (web shell). */
  remote_url: z.string().url().optional(),
  /** Published npm package name for React Native components. */
  native_package: z.string().optional(),
  /** Component names the shell is allowed to render. */
  components: z.array(z.string()).default([]),
});

export const AgentManifestSchema = z.object({
  agent_id: z.string().regex(/^[a-z][a-z0-9-]{2,31}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/),
  domain: z.string().min(3),
  display_name: z.string().min(2).max(48),
  one_liner: z.string().min(8).max(140),

  /** Canonical intent labels the agent handles. */
  intents: z.array(z.string().min(2)).min(1),

  /** Short, natural-language examples the orchestrator uses as few-shot hints. */
  example_utterances: z.array(z.string()).default([]),

  openapi_url: z.string().url(),
  mcp_url: z.string().url().optional(),

  ui: AgentUIManifestSchema,

  health_url: z.string().url(),
  sla: AgentSLASchema,

  /** Narrow list of PII fields the agent may be granted. */
  pii_scope: z.array(
    z.enum([
      "name",
      "email",
      "phone",
      "address",
      "dob",
      "payment_method_id",
      "passport",
      "passport_optional",
      "loyalty_numbers",
      "traveler_profile",
    ]),
  ),

  requires_payment: z.boolean().default(false),

  /** ISO region codes where this agent is available to users. */
  supported_regions: z.array(z.string()).default([]),

  /** Optional metadata for analytics / ops. */
  owner_team: z.string().optional(),
  on_call_escalation: z.string().url().optional(),
});

// ──────────────────────────────────────────────────────────────────────────
// Inferred TS types — these are the canonical exports for consumers.
// ──────────────────────────────────────────────────────────────────────────

export type AgentSLA = z.infer<typeof AgentSLASchema>;
export type AgentUIManifest = z.infer<typeof AgentUIManifestSchema>;
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Define and validate an agent manifest at build time. Throws with a readable
 * error if the shape is wrong. Use this in your agent's `app/manifest.ts`.
 */
export function defineManifest(
  input: AgentManifest & { pii_scope: PIIScope[]; supported_regions: RegionCode[] },
): AgentManifest {
  const parsed = AgentManifestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  · ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid agent manifest:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Runtime guard used by the shell when it loads `/.well-known/agent.json` from
 * a remote agent. Never trust manifest data without running it through this.
 */
export function parseManifest(raw: unknown): AgentManifest {
  return AgentManifestSchema.parse(raw);
}
