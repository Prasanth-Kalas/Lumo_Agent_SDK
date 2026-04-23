/**
 * Shared primitive types used across the SDK.
 */
export type ISODate = string;
export type ISODateTime = string;
export type IATA = string;
export type CurrencyCode = string;
export type RegionCode = string;
/**
 * Tiers used by x-lumo-cost-tier. The shell uses this to decide whether a
 * tool call needs the confirmation gate.
 */
export type CostTier = "free" | "low" | "metered" | "money";
/**
 * PII scopes an agent may request. The orchestrator enforces that only these
 * fields are forwarded in tool-call payloads.
 */
export type PIIScope = "name" | "email" | "phone" | "address" | "dob" | "payment_method_id" | "passport" | "passport_optional" | "loyalty_numbers" | "traveler_profile";
/**
 * Identity/env context the shell passes to every tool call. Agents can trust
 * this — it is injected server-side and never derived from the LLM.
 */
export interface AgentInvocationContext {
    user_id: string;
    session_id: string;
    turn_id: string;
    region: RegionCode;
    device_kind: "web" | "ios" | "android" | "watch";
    idempotency_key: string;
    /** Set of PII fields this agent was granted for this turn. */
    pii_grant: PIIScope[];
}
//# sourceMappingURL=types.d.ts.map