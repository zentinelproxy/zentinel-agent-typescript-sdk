#!/usr/bin/env npx tsx
/**
 * Configurable Zentinel agent example.
 *
 * This example demonstrates an agent with typed configuration that:
 * - Accepts rate limit configuration from the proxy
 * - Tracks request counts per client IP
 * - Rate limits clients exceeding the threshold
 */

import { ConfigurableAgent, Decision, Request, Response, runAgent } from "../src/index.js";

interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
  blockedPaths: string[];
}

class RateLimitAgent extends ConfigurableAgent<RateLimitConfig> {
  private _requestCounts: Map<string, number> = new Map();
  private _resetInterval: NodeJS.Timeout | null = null;

  constructor() {
    super({
      enabled: true,
      requestsPerMinute: 100,
      blockedPaths: [],
    });
  }

  get name(): string {
    return "rate-limit-agent";
  }

  parseConfig(configDict: Record<string, unknown>): RateLimitConfig {
    return {
      enabled: (configDict.enabled as boolean) ?? true,
      requestsPerMinute: (configDict.requests_per_minute as number) ?? 100,
      blockedPaths: (configDict.blocked_paths as string[]) ?? [],
    };
  }

  async onConfigApplied(config: RateLimitConfig): Promise<void> {
    console.log(`Configuration applied:`, config);

    // Start reset interval if not running
    if (this._resetInterval === null) {
      this._resetInterval = setInterval(() => {
        this._requestCounts.clear();
      }, 60000);
    }
  }

  async onRequest(request: Request): Promise<Decision> {
    const config = this.config;

    // Check if agent is enabled
    if (!config.enabled) {
      return Decision.allow();
    }

    // Check blocked paths
    for (const blockedPath of config.blockedPaths) {
      if (request.pathStartsWith(blockedPath)) {
        return Decision.deny()
          .withBody(`Path ${blockedPath} is blocked`)
          .withTag("blocked_path");
      }
    }

    // Check rate limit
    const clientIp = request.clientIp;
    const currentCount = (this._requestCounts.get(clientIp) || 0) + 1;
    this._requestCounts.set(clientIp, currentCount);

    if (currentCount > config.requestsPerMinute) {
      return Decision.rateLimited()
        .withBody("Rate limit exceeded")
        .withTag("rate_limited")
        .withMetadata("client_ip", clientIp)
        .withMetadata("request_count", currentCount)
        .withMetadata("limit", config.requestsPerMinute);
    }

    // Allow with rate limit headers
    const remaining = config.requestsPerMinute - currentCount;
    return Decision.allow()
      .addResponseHeader("X-RateLimit-Limit", String(config.requestsPerMinute))
      .addResponseHeader("X-RateLimit-Remaining", String(remaining));
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow();
  }
}

runAgent(new RateLimitAgent());
