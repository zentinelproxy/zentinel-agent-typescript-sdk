/**
 * AgentV2 interface with v2 protocol capabilities.
 */

import { Agent } from "../agent.js";
import {
  AgentCapabilities,
  DrainReason,
  HealthStatus,
  MetricsReport,
  ShutdownReason,
} from "./types.js";

/**
 * Agent with v2 protocol capabilities.
 *
 * Extends the base Agent interface with v2-specific features:
 * - Capability negotiation
 * - Health reporting
 * - Flow control
 * - Metrics export
 *
 * @example
 * ```typescript
 * class MyAgent implements AgentV2 {
 *   get name(): string {
 *     return "my-agent";
 *   }
 *
 *   capabilities(): AgentCapabilities {
 *     return new AgentCapabilities("my-agent", "My Agent", "1.0.0")
 *       .withStreamingBody(true)
 *       .withFlowControl(true)
 *       .withConcurrentRequests(100);
 *   }
 *
 *   async onRequest(request: Request): Promise<Decision> {
 *     return Decision.allow();
 *   }
 * }
 * ```
 */
export interface AgentV2 extends Agent {
  /**
   * Get agent capabilities for v2 handshake.
   *
   * Capabilities inform the proxy about what features this agent supports
   * and its resource limits.
   */
  capabilities(): AgentCapabilities;

  /**
   * Get current health status.
   *
   * Override this to report custom health metrics.
   * Default returns a healthy status with the agent ID.
   */
  healthStatus?(): HealthStatus;

  /**
   * Get current metrics report.
   *
   * Override this to export custom metrics.
   * Default returns undefined, meaning no metrics are exported.
   */
  metricsReport?(): MetricsReport | undefined;

  /**
   * Handle shutdown request from proxy.
   *
   * Called when the proxy requests graceful shutdown. The agent should
   * finish processing in-flight requests within the grace period.
   *
   * Override this to perform cleanup operations.
   *
   * @param reason - The reason for shutdown.
   * @param gracePeriodMs - Time in milliseconds to complete in-flight work.
   */
  onShutdown?(reason: ShutdownReason, gracePeriodMs: number): void;

  /**
   * Handle drain request from proxy.
   *
   * Called when the proxy wants the agent to stop accepting new requests
   * while finishing existing ones. Used during config reloads or maintenance.
   *
   * Override this to update internal state to reject new requests.
   *
   * @param durationMs - Expected duration of the drain period.
   * @param reason - The reason for draining.
   */
  onDrain?(durationMs: number, reason: DrainReason): void;

  /**
   * Called when the gRPC stream is closed.
   *
   * Override this to perform cleanup when the connection to the proxy
   * is lost.
   */
  onStreamClosed?(): void;
}

/**
 * Check if an agent implements the AgentV2 interface.
 */
export function isAgentV2(agent: Agent): agent is AgentV2 {
  return typeof (agent as AgentV2).capabilities === "function";
}
