#!/usr/bin/env npx tsx
/**
 * Simple Zentinel agent example.
 *
 * This example demonstrates a basic agent that:
 * - Blocks requests to /admin paths
 * - Adds custom headers to allowed requests
 * - Logs request completions
 */

import { Agent, Decision, Request, Response, runAgent } from "../src/index.js";

class SimpleAgent implements Agent {
  get name(): string {
    return "simple-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    // Block admin paths
    if (request.pathStartsWith("/admin")) {
      return Decision.deny()
        .withBody("Access denied")
        .withTag("security")
        .withRuleId("ADMIN_BLOCKED");
    }

    // Block requests without User-Agent
    if (!request.userAgent) {
      return Decision.block(400)
        .withBody("User-Agent header required")
        .withTag("validation");
    }

    // Allow with custom header
    return Decision.allow().addRequestHeader("X-Agent-Processed", "true");
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    // Add timing header
    return Decision.allow().addResponseHeader("X-Processed-By", this.name);
  }

  async onRequestComplete(request: Request, status: number, durationMs: number): Promise<void> {
    console.log(`Request completed: ${request.method} ${request.path} -> ${status} (${durationMs}ms)`);
  }
}

runAgent(new SimpleAgent());
