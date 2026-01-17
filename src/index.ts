/**
 * Sentinel Agent SDK for TypeScript
 *
 * A TypeScript SDK for building Sentinel agents that can process
 * HTTP requests and responses in the Sentinel proxy pipeline.
 *
 * ## V1 Protocol (Default)
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
 *
 * ## V2 Protocol
 *
 * For v2 protocol support with gRPC transport, capability negotiation,
 * and health reporting, use the v2 module:
 *
 * @example
 * ```typescript
 * import { Decision, Request } from "sentinel-agent-sdk";
 * import { AgentV2, AgentCapabilities, AgentRunnerV2 } from "sentinel-agent-sdk/v2";
 *
 * class MyAgent implements AgentV2 {
 *   get name(): string {
 *     return "my-agent";
 *   }
 *
 *   capabilities(): AgentCapabilities {
 *     return new AgentCapabilities("my-agent", "My Agent", "1.0.0")
 *       .withStreamingBody(true)
 *       .withFlowControl(true);
 *   }
 *
 *   async onRequest(request: Request): Promise<Decision> {
 *     return Decision.allow();
 *   }
 * }
 *
 * const runner = new AgentRunnerV2(new MyAgent())
 *   .withGrpc("0.0.0.0:50051");
 *
 * runner.run();
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
