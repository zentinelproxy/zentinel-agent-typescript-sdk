# Getting Started with Zentinel Agent TypeScript SDK

This guide will walk you through creating your first Zentinel agent in TypeScript.

## Prerequisites

- Node.js 18 or later
- A running Zentinel proxy instance (or just the SDK for development)

## Installation

```bash
npm install zentinel-agent-sdk
```

Or with other package managers:

```bash
yarn add zentinel-agent-sdk
pnpm add zentinel-agent-sdk
bun add zentinel-agent-sdk
```

## Your First Agent

Create a new file `my-agent.ts`:

```typescript
import { Agent, Decision, Request, runAgent } from "zentinel-agent-sdk";

class MyAgent implements Agent {
  get name(): string {
    return "my-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    // Block requests to /admin paths
    if (request.pathStartsWith("/admin")) {
      return Decision.deny().withBody("Access denied");
    }

    // Allow all other requests
    return Decision.allow();
  }
}

runAgent(new MyAgent());
```

## Running Your Agent

```bash
npx tsx my-agent.ts --socket /tmp/my-agent.sock
```

Or compile and run:

```bash
npx tsc my-agent.ts
node my-agent.js --socket /tmp/my-agent.sock
```

Your agent is now listening on `/tmp/my-agent.sock` and ready to receive events from Zentinel.

## Understanding the Agent Interface

The `Agent` interface defines the hooks you can implement:

```typescript
import { Agent, Decision, Request, Response } from "zentinel-agent-sdk";

class MyAgent implements Agent {
  get name(): string {
    // Required: Agent identifier for logging
    return "my-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    // Called when request headers arrive
    return Decision.allow();
  }

  async onRequestBody(request: Request): Promise<Decision> {
    // Called when request body is available (if body inspection enabled)
    return Decision.allow();
  }

  async onResponse(request: Request, response: Response): Promise<Decision> {
    // Called when response headers arrive from upstream
    return Decision.allow();
  }

  async onResponseBody(request: Request, response: Response): Promise<Decision> {
    // Called when response body is available (if body inspection enabled)
    return Decision.allow();
  }

  async onWebSocketFrame(event: WebSocketFrameEvent): Promise<Decision> {
    // Called when a WebSocket frame is received (if websocket feature enabled)
    return Decision.allow();
  }

  async onRequestComplete(
    request: Request,
    status: number,
    durationMs: number
  ): Promise<void> {
    // Called when request processing completes. Use for logging/metrics.
  }
}
```

## Making Decisions

The `Decision` builder provides a fluent API:

```typescript
// Allow the request
Decision.allow();

// Block with 403 Forbidden
Decision.deny();

// Block with custom status
Decision.block(429).withBody("Too many requests");

// Block with JSON body
Decision.block(400).withJsonBody({ error: "Invalid request" });

// Redirect
Decision.redirect("/login");
Decision.redirectPermanent("/new-path");

// Allow with header modifications
Decision.allow()
  .addRequestHeader("X-User-ID", "12345")
  .addResponseHeader("X-Cache", "HIT")
  .removeResponseHeader("Server");

// Add audit metadata
Decision.deny()
  .withTag("security")
  .withRuleId("ADMIN-001")
  .withConfidence(0.95)
  .withMetadata("reason", "blocked by rule");
```

## Working with Requests

The `Request` type provides convenient methods:

```typescript
async onRequest(request: Request): Promise<Decision> {
  // Path inspection
  const path = request.path;
  if (request.pathStartsWith("/api/")) {
    // ...
  }
  if (request.pathEquals("/health")) {
    return Decision.allow();
  }

  // Headers (case-insensitive)
  const auth = request.getHeader("Authorization");
  if (!request.hasHeader("X-API-Key")) {
    return Decision.unauthorized();
  }

  // Common headers as properties
  const userAgent = request.userAgent;
  const contentType = request.contentType;
  const host = request.host;

  // Query parameters
  const page = request.queryParams.get("page")?.[0] ?? "1";

  // Request metadata
  const clientIp = request.clientIp;
  const method = request.method;
  const correlationId = request.correlationId;

  // Body (when body inspection is enabled)
  if (request.body) {
    const data = new TextDecoder().decode(request.body);
  }

  return Decision.allow();
}
```

## Working with Responses

Inspect upstream responses:

```typescript
async onResponse(request: Request, response: Response): Promise<Decision> {
  // Check status code
  if (response.statusCode >= 500) {
    return Decision.allow().withTag("upstream-error");
  }

  // Inspect headers
  const contentType = response.getHeader("Content-Type");

  // Add security headers
  return Decision.allow()
    .addResponseHeader("X-Frame-Options", "DENY")
    .addResponseHeader("X-Content-Type-Options", "nosniff")
    .removeResponseHeader("Server");
}
```

## Typed Configuration

For agents with configuration, use `ConfigurableAgent`:

```typescript
import { ConfigurableAgent, Decision, Request, runAgent } from "zentinel-agent-sdk";

interface RateLimitConfig {
  requestsPerMinute: number;
  enabled: boolean;
}

class RateLimitAgent implements ConfigurableAgent<RateLimitConfig> {
  private _config: RateLimitConfig = {
    requestsPerMinute: 60,
    enabled: true,
  };

  get name(): string {
    return "rate-limiter";
  }

  get config(): RateLimitConfig {
    return this._config;
  }

  async onConfigApplied(config: RateLimitConfig): Promise<void> {
    this._config = config;
    console.log(`Rate limit set to ${config.requestsPerMinute}/min`);
  }

  async onRequest(request: Request): Promise<Decision> {
    if (!this._config.enabled) {
      return Decision.allow();
    }
    // Use this._config.requestsPerMinute...
    return Decision.allow();
  }
}

runAgent(new RateLimitAgent());
```

## Connecting to Zentinel

Configure Zentinel to use your agent:

```kdl
agents {
    agent "my-agent" type="custom" {
        unix-socket path="/tmp/my-agent.sock"
        events "request_headers"
        timeout-ms 100
        failure-mode "open"
    }
}

filters {
    filter "my-filter" {
        type "agent"
        agent "my-agent"
    }
}

routes {
    route "api" {
        matches {
            path-prefix "/api/"
        }
        upstream "backend"
        filters "my-filter"
    }
}
```

## CLI Options

The SDK provides built-in CLI argument parsing:

```bash
# Basic usage
npx tsx my-agent.ts --socket /tmp/my-agent.sock

# With options
npx tsx my-agent.ts \
    --socket /tmp/my-agent.sock \
    --log-level DEBUG \
    --json-logs
```

| Option | Description | Default |
|--------|-------------|---------|
| `--socket PATH` | Unix socket path | `/tmp/zentinel-agent.sock` |
| `--log-level LEVEL` | debug, info, warn, error | `info` |
| `--json-logs` | Output logs as JSON | disabled |

## Programmatic Runner

For more control, use `AgentRunner` directly:

```typescript
import { AgentRunner } from "zentinel-agent-sdk";

const runner = new AgentRunner(new MyAgent())
  .withSocket("/tmp/my-agent.sock")
  .withLogLevel("debug")
  .withJsonLogs();

await runner.run();
```

## Request Logging

Use `onRequestComplete` for logging and metrics:

```typescript
async onRequestComplete(
  request: Request,
  status: number,
  durationMs: number
): Promise<void> {
  console.log(
    `${request.clientIp} - ${request.method} ${request.path} -> ${status} (${durationMs}ms)`
  );
}
```

## Error Handling

Return appropriate decisions for errors:

```typescript
import jwt from "jsonwebtoken";

async onRequest(request: Request): Promise<Decision> {
  const auth = request.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return Decision.unauthorized()
      .withBody("Missing or invalid Authorization header")
      .withTag("auth-missing");
  }

  const token = auth.slice(7); // Remove "Bearer " prefix

  try {
    const payload = jwt.verify(token, this.secret) as { sub?: string };
    return Decision.allow().addRequestHeader("X-User-ID", payload.sub ?? "");
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return Decision.unauthorized()
        .withBody("Token expired")
        .withTag("auth-expired");
    }
    return Decision.unauthorized()
      .withBody("Invalid token")
      .withTag("auth-invalid");
  }
}
```

## Testing Your Agent

Write tests using your preferred testing framework:

```typescript
import { describe, it, expect } from "vitest";
import { MyAgent } from "./my-agent";
import { Request } from "zentinel-agent-sdk";

describe("MyAgent", () => {
  it("blocks admin paths", async () => {
    const agent = new MyAgent();
    const request = Request.builder().path("/admin/users").build();

    const decision = await agent.onRequest(request);

    expect(decision.isBlock()).toBe(true);
  });

  it("allows public paths", async () => {
    const agent = new MyAgent();
    const request = Request.builder().path("/public/docs").build();

    const decision = await agent.onRequest(request);

    expect(decision.isAllow()).toBe(true);
  });
});
```

Run tests:

```bash
npm test
# Or with vitest
npx vitest
```

## Project Setup

For a new project, here's a recommended `package.json`:

```json
{
  "name": "my-zentinel-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/agent.ts",
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": {
    "zentinel-agent-sdk": "^0.1.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

And `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

## Next Steps

- Read the [API Reference](api.md) for complete documentation
- Browse [Examples](../examples/) for common patterns
- See the [Configuration](configuration.md) guide for Zentinel setup

## Need Help?

- [GitHub Issues](https://github.com/zentinelproxy/zentinel-agent-typescript-sdk/issues)
- [Zentinel Documentation](https://zentinelproxy.io/docs)
