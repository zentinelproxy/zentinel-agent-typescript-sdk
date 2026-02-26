/**
 * Zentinel Agent SDK v2 Protocol support.
 *
 * This module provides v2 protocol support including:
 * - AgentV2 interface with capability reporting
 * - gRPC and UDS transport options
 * - Health reporting
 * - Flow control awareness
 * - Streaming body support
 *
 * @example
 * ```typescript
 * import { Decision, Request } from "zentinel-agent-sdk";
 * import { AgentV2, AgentCapabilities, AgentRunnerV2 } from "zentinel-agent-sdk/v2";
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
 *   .withName("my-agent")
 *   .withGrpc("0.0.0.0:50051");
 *
 * runner.run();
 * ```
 */

// Agent
export { AgentV2, isAgentV2 } from "./agent.js";

// Handler
export { AgentHandlerV2 } from "./handler.js";

// gRPC transport
export { createGrpcServer, startGrpcServer } from "./grpc.js";

// Runner
export {
  AgentRunnerV2,
  TransportConfig,
  TransportType,
  V2RunnerConfig,
  ParsedV2Args,
  parseV2CliArgs,
  runAgentV2,
} from "./runner.js";

// Types
export {
  PROTOCOL_VERSION_2,
  MAX_MESSAGE_SIZE_UDS,
  MAX_MESSAGE_SIZE_GRPC,
  ShutdownReason,
  DrainReason,
  HealthState,
  AgentFeatures,
  AgentLimits,
  HealthConfig,
  AgentCapabilities,
  AgentCapabilitiesData,
  HealthStatus,
  HealthStatusData,
  MetricsReport,
  HandshakeRequest,
  HandshakeResponse,
  createSuccessHandshake,
  createFailedHandshake,
} from "./types.js";
