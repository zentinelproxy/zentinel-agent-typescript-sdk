/**
 * Header Mutation Agent - Tests add/remove operations on headers.
 *
 * Used for testing header mutation in both request and response phases.
 */

import { ConfigurableAgent, Decision, Request, Response } from "../../../src/index.js";

interface HeaderMutationConfig {
  requestHeadersToAdd: Record<string, string>;
  requestHeadersToRemove: string[];
  responseHeadersToAdd: Record<string, string>;
  responseHeadersToRemove: string[];
}

export class HeaderMutationAgent extends ConfigurableAgent<HeaderMutationConfig> {
  constructor() {
    super({
      requestHeadersToAdd: {
        "X-Request-Processed": "true",
        "X-Agent-Version": "1.0.0",
      },
      requestHeadersToRemove: ["X-Forwarded-For"],
      responseHeadersToAdd: {
        "X-Response-Processed": "true",
        "X-Cache-Status": "MISS",
      },
      responseHeadersToRemove: ["Server"],
    });
  }

  get name() {
    return "header-mutation-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    let decision = Decision.allow();

    // Add request headers
    for (const [name, value] of Object.entries(this.config.requestHeadersToAdd)) {
      decision = decision.addRequestHeader(name, value);
    }

    // Remove request headers
    for (const name of this.config.requestHeadersToRemove) {
      decision = decision.removeRequestHeader(name);
    }

    // Also add some info based on the request
    decision = decision
      .addRequestHeader("X-Original-Method", request.method)
      .addRequestHeader("X-Original-Path", request.pathOnly)
      .withTag("request_mutated");

    return decision;
  }

  async onResponse(request: Request, response: Response): Promise<Decision> {
    let decision = Decision.allow();

    // Add response headers
    for (const [name, value] of Object.entries(this.config.responseHeadersToAdd)) {
      decision = decision.addResponseHeader(name, value);
    }

    // Remove response headers
    for (const name of this.config.responseHeadersToRemove) {
      decision = decision.removeResponseHeader(name);
    }

    // Add info based on response
    decision = decision
      .addResponseHeader("X-Response-Status", String(response.statusCode))
      .addResponseHeader("X-Request-Correlation", request.correlationId)
      .withTag("response_mutated");

    return decision;
  }
}
