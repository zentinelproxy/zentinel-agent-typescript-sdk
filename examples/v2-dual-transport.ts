#!/usr/bin/env npx tsx
/**
 * V2 agent with dual transport (gRPC and UDS).
 *
 * This example demonstrates a v2 agent that listens on both:
 * - gRPC for high-performance communication
 * - Unix Domain Socket for local/container communication
 */

import { Decision, Request, Response } from "../src/index.js";
import {
  AgentV2,
  AgentCapabilities,
  AgentRunnerV2,
  HealthStatus,
  parseV2CliArgs,
} from "../src/v2/index.js";

class DualTransportAgent implements AgentV2 {
  private _healthy = true;
  private _draining = false;

  get name(): string {
    return "dual-transport-agent";
  }

  capabilities(): AgentCapabilities {
    return new AgentCapabilities(
      "dual-transport-agent",
      "Dual Transport Agent",
      "1.0.0"
    )
      .withStreamingBody(true)
      .withFlowControl(true)
      .withConcurrentRequests(200)
      .withCancellation(true)
      .withConfigPush(true)
      .withHealthReporting(true);
  }

  healthStatus(): HealthStatus {
    if (!this._healthy) {
      return HealthStatus.unhealthy(this.name, "Agent marked unhealthy");
    }
    if (this._draining) {
      return HealthStatus.degraded(this.name, "Agent is draining");
    }
    return HealthStatus.healthy(this.name);
  }

  async onConfigure(config: Record<string, unknown>): Promise<void> {
    console.log("Received configuration update:", JSON.stringify(config));
    // Apply configuration changes
  }

  async onRequest(request: Request): Promise<Decision> {
    // Reject new requests when draining
    if (this._draining) {
      return Decision.block(503).withBody("Service draining, try another instance");
    }

    // Add transport info header
    return Decision.allow()
      .addRequestHeader("X-Agent", this.name)
      .addRequestHeader("X-Agent-Version", "1.0.0");
  }

  async onResponse(_request: Request, response: Response): Promise<Decision> {
    // Log response status
    console.log(`Response status: ${response.status}`);
    return Decision.allow();
  }

  async onRequestComplete(
    request: Request,
    status: number,
    durationMs: number
  ): Promise<void> {
    console.log(
      `${request.method} ${request.path} -> ${status} (${durationMs}ms)`
    );
  }

  onDrain(durationMs: number, reason: string): void {
    console.log(`Draining for ${durationMs}ms, reason: ${reason}`);
    this._draining = true;

    // Stop draining after the duration
    setTimeout(() => {
      this._draining = false;
      console.log("Drain period ended");
    }, durationMs);
  }

  onShutdown(reason: string, gracePeriodMs: number): void {
    console.log(
      `Shutdown requested: ${reason}, grace period: ${gracePeriodMs}ms`
    );
    this._healthy = false;
  }
}

// Parse CLI args to get transport configuration
const args = parseV2CliArgs();

// Create runner with dual transport
let runner = new AgentRunnerV2(new DualTransportAgent()).withName(
  "dual-transport-agent"
);

// Configure transports based on CLI args
if (args.grpc) {
  runner = runner.withBoth(args.grpc, args.socket);
  console.log(`Starting with gRPC on ${args.grpc} and UDS on ${args.socket}`);
} else {
  runner = runner.withUds(args.socket);
  console.log(`Starting with UDS on ${args.socket}`);
}

if (args.jsonLogs) {
  runner = runner.withJsonLogs();
}

runner = runner.withLogLevel(args.logLevel);

// Run the agent
runner.run().catch((error) => {
  console.error(`Agent error: ${error}`);
  process.exit(1);
});
