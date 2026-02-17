#!/usr/bin/env npx tsx
/**
 * V2 Zentinel agent example.
 *
 * This example demonstrates a v2 agent with:
 * - Capability negotiation
 * - Health reporting
 * - Streaming body support
 * - Flow control
 */

import { Decision, Request, Response } from "../src/index.js";
import {
  AgentV2,
  AgentCapabilities,
  AgentRunnerV2,
  HealthStatus,
  MetricsReport,
  ShutdownReason,
  DrainReason,
} from "../src/v2/index.js";

class V2Agent implements AgentV2 {
  private _requestCount = 0;
  private _errorCount = 0;

  get name(): string {
    return "v2-agent";
  }

  capabilities(): AgentCapabilities {
    return new AgentCapabilities("v2-agent", "V2 Example Agent", "1.0.0")
      .withStreamingBody(true)
      .withFlowControl(true)
      .withConcurrentRequests(100)
      .withHealthReporting(true)
      .withMetricsExport(true)
      .withMaxBodySize(10 * 1024 * 1024) // 10MB
      .withPreferredChunkSize(64 * 1024); // 64KB
  }

  healthStatus(): HealthStatus {
    // Report degraded if error rate is high
    const errorRate = this._requestCount > 0 ? this._errorCount / this._requestCount : 0;

    if (errorRate > 0.5) {
      return HealthStatus.unhealthy(this.name, `High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }
    if (errorRate > 0.1) {
      return HealthStatus.degraded(this.name, `Elevated error rate: ${(errorRate * 100).toFixed(1)}%`);
    }
    return HealthStatus.healthy(this.name);
  }

  metricsReport(): MetricsReport {
    return {
      agentId: this.name,
      timestamp: new Date().toISOString(),
      metrics: {
        requests_total: this._requestCount,
        errors_total: this._errorCount,
        error_rate: this._requestCount > 0 ? this._errorCount / this._requestCount : 0,
      },
      labels: {
        version: "1.0.0",
      },
    };
  }

  async onRequest(request: Request): Promise<Decision> {
    this._requestCount++;

    // Block admin paths
    if (request.pathStartsWith("/admin")) {
      this._errorCount++;
      return Decision.deny()
        .withBody("Access denied")
        .withTag("security")
        .withRuleId("ADMIN_BLOCKED");
    }

    return Decision.allow().addRequestHeader("X-V2-Agent", "true");
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow().addResponseHeader("X-Processed-By", this.name);
  }

  onShutdown(reason: ShutdownReason, gracePeriodMs: number): void {
    console.log(`Shutdown requested: ${reason}, grace period: ${gracePeriodMs}ms`);
    // Perform cleanup here
  }

  onDrain(durationMs: number, reason: DrainReason): void {
    console.log(`Drain requested: ${reason}, duration: ${durationMs}ms`);
    // Stop accepting new requests but finish existing ones
  }

  onStreamClosed(): void {
    console.log("Stream closed, connection to proxy lost");
  }
}

// Run the v2 agent
const runner = new AgentRunnerV2(new V2Agent())
  .withName("v2-agent")
  .withUds("/tmp/zentinel-v2-agent.sock")
  .withLogLevel("info");

runner.run().catch((error) => {
  console.error(`Agent error: ${error}`);
  process.exit(1);
});
