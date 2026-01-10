/**
 * Sentinel Agent SDK for TypeScript
 *
 * A TypeScript SDK for building Sentinel agents that can process
 * HTTP requests and responses in the Sentinel proxy pipeline.
 *
 * @example
 * ```typescript
 * import { Agent, Decision, Request, runAgent } from "sentinel-agent-sdk";
 *
 * class MyAgent implements Agent {
 *   get name(): string {
 *     return "my-agent";
 *   }
 *
 *   async onRequest(request: Request): Promise<Decision> {
 *     if (request.pathStartsWith("/admin")) {
 *       return Decision.deny().withBody("Access denied");
 *     }
 *     return Decision.allow().addRequestHeader("X-Agent", "true");
 *   }
 * }
 *
 * runAgent(new MyAgent());
 * ```
 */

// Core types
export { Agent, ConfigurableAgent } from "./agent.js";
export { Decision, decisions } from "./decision.js";
export { Request } from "./request.js";
export { Response } from "./response.js";

// Runner
export { AgentRunner, RunnerConfig, runAgent, parseCliArgs } from "./runner.js";

// Protocol (for advanced usage)
export { PROTOCOL_VERSION } from "./protocol.js";

// Guardrail types
export {
  GuardrailInspectEvent,
  GuardrailInspectionType,
  GuardrailResponse,
  GuardrailResponseBuilder,
  GuardrailDetection,
  DetectionSeverity,
  TextSpan,
  createGuardrailDetection,
  createGuardrailResponse,
} from "./protocol.js";
