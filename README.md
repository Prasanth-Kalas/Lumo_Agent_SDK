# @lumo/agent-sdk

The contract every Lumo specialist agent implements, plus helpers the shell uses to consume it.

## What this package gives you

- **Types** for the agent manifest (`AgentManifest`, `AgentUIManifest`, `AgentSLA`, …).
- **OpenAPI conventions** — the `x-lumo-*` extensions that mark tools, cost tiers, and confirmation gates.
- **Tool bridge** — convert an agent's OpenAPI 3.1 operations into Claude tool definitions the orchestrator can expose.
- **Confirmation gate** — helpers to declare money-moving tools safely.
- **Health probe** — a standard shape for liveness + readiness.
- **Error taxonomy** — well-known error codes the shell understands and surfaces to the user.

## If you are building an agent

```ts
import {
  defineManifest,
  defineHealth,
  ConfirmationSummary,
} from "@lumo/agent-sdk";

export const manifest = defineManifest({
  agent_id: "flight-agent",
  version: "1.0.0",
  domain: "travel.flight",
  display_name: "Lumo Flight",
  // …
});
```

Serve the manifest at `/.well-known/agent.json`, your OpenAPI at `/openapi.json`, and the health probe at `/api/health`. The shell discovers you through those three endpoints.

## If you are working on the shell

```ts
import { openApiToClaudeTools, evaluateConfirmation } from "@lumo/agent-sdk";

const tools = openApiToClaudeTools(agentOpenApiDoc);
```

The shell's router uses these helpers at boot to build the LLM tool list and at runtime to validate money-moving tool calls.

## Versioning

Follows semver. Breaking changes to the contract are major bumps and require every agent to re-pin. Agents pin on `^X.Y` in their own `package.json`.
