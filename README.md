<div align="center">

<h1 align="center">
  Sentinel Agent TypeScript SDK
</h1>

<p align="center">
  <em>Build agents that extend Sentinel's security and policy capabilities.</em><br>
  <em>Inspect, block, redirect, and transform HTTP traffic.</em>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.0+-3178c6?logo=typescript&logoColor=white&style=for-the-badge">
  </a>
  <a href="https://nodejs.org/">
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white&style=for-the-badge">
  </a>
  <a href="https://github.com/raskell-io/sentinel">
    <img alt="Sentinel" src="https://img.shields.io/badge/Built%20for-Sentinel-f5a97f?style=for-the-badge">
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-c6a0f6?style=for-the-badge">
  </a>
</p>

<p align="center">
  <a href="docs/index.md">Documentation</a> •
  <a href="docs/quickstart.md">Quickstart</a> •
  <a href="docs/api.md">API Reference</a> •
  <a href="docs/examples.md">Examples</a>
</p>

</div>

---

The Sentinel Agent TypeScript SDK provides a simple, async-first API for building agents that integrate with the [Sentinel](https://github.com/raskell-io/sentinel) reverse proxy. Agents can inspect requests and responses, block malicious traffic, add headers, and attach audit metadata—all from TypeScript/Node.js.

## Quick Start

```bash
npm install sentinel-agent-sdk
```

Create `my-agent.ts`:

```typescript
import { Agent, Decision, Request, runAgent } from "sentinel-agent-sdk";

class MyAgent implements Agent {
  get name(): string {
    return "my-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    if (request.pathStartsWith("/admin")) {
      return Decision.deny().withBody("Access denied");
    }
    return Decision.allow();
  }
}

runAgent(new MyAgent());
```

Run the agent:

```bash
npx tsx my-agent.ts --socket /tmp/my-agent.sock
```

## Features

| Feature | Description |
|---------|-------------|
| **Simple Agent API** | Implement `onRequest`, `onResponse`, and other hooks |
| **Fluent Decision Builder** | Chain methods: `Decision.deny().withBody(...).withTag(...)` |
| **Request/Response Wrappers** | Ergonomic access to headers, body, query params, metadata |
| **Typed Configuration** | Generic `ConfigurableAgent<T>` with interface support |
| **Async Native** | Built on native async/await for high-performance concurrent processing |
| **Protocol Compatible** | Full compatibility with Sentinel agent protocol v1 |

## Why Agents?

Sentinel's agent system moves complex logic **out of the proxy core** and into isolated, testable, independently deployable processes:

- **Security isolation** — WAF engines, auth validation, and custom logic run in separate processes
- **Language flexibility** — Write agents in TypeScript, Python, Rust, Go, or any language
- **Independent deployment** — Update agent logic without restarting the proxy
- **Failure boundaries** — Agent crashes don't take down the dataplane

Agents communicate with Sentinel over Unix sockets using a simple length-prefixed JSON protocol.

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│   Client    │────────▶│   Sentinel   │────────▶│   Upstream   │
└─────────────┘         └──────────────┘         └──────────────┘
                               │
                               │ Unix Socket (JSON)
                               ▼
                        ┌──────────────┐
                        │    Agent     │
                        │ (TypeScript) │
                        └──────────────┘
```

1. Client sends request to Sentinel
2. Sentinel forwards request headers to agent
3. Agent returns decision (allow, block, redirect) with optional header mutations
4. Sentinel applies the decision
5. Agent can also inspect response headers before they reach the client

---

## Core Concepts

### Agent

The `Agent` interface defines the hooks you can implement:

```typescript
import { Agent, Decision, Request, Response } from "sentinel-agent-sdk";

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

  async onRequestComplete(request: Request, status: number, durationMs: number): Promise<void> {
    // Called when request processing completes. Use for logging/metrics.
  }
}
```

### Request

Access HTTP request data with convenience methods:

```typescript
async onRequest(request: Request): Promise<Decision> {
  // Path matching
  if (request.pathStartsWith("/api/")) {
    // ...
  }
  if (request.pathEquals("/health")) {
    return Decision.allow();
  }

  // Headers (case-insensitive)
  const auth = request.header("authorization");
  if (!request.hasHeader("x-api-key")) {
    return Decision.unauthorized();
  }

  // Common headers as properties
  const host = request.host;
  const userAgent = request.userAgent;
  const contentType = request.contentType;

  // Query parameters
  const page = request.query("page") ?? "1";
  const tags = request.queryAll("tag");

  // Request metadata
  const clientIp = request.clientIp;
  const correlationId = request.correlationId;

  // Body (when body inspection is enabled)
  if (request.body.length > 0) {
    const data = request.bodyStr;
    const json = request.bodyJson<{ name: string }>();
  }

  return Decision.allow();
}
```

### Response

Inspect upstream responses before they reach the client:

```typescript
async onResponse(request: Request, response: Response): Promise<Decision> {
  // Status code
  if (response.isServerError()) {
    return Decision.allow().withTag("upstream-error");
  }

  // Headers
  const contentType = response.header("content-type");

  // Add security headers to all responses
  return Decision.allow()
    .addResponseHeader("X-Frame-Options", "DENY")
    .addResponseHeader("X-Content-Type-Options", "nosniff")
    .removeResponseHeader("Server");
}
```

### Decision

Build responses with a fluent API:

```typescript
// Allow the request
Decision.allow();

// Block with common status codes
Decision.deny();          // 403 Forbidden
Decision.unauthorized();  // 401 Unauthorized
Decision.rateLimited();   // 429 Too Many Requests
Decision.block(503);      // Custom status

// Block with response body
Decision.deny().withBody("Access denied");
Decision.block(400).withJsonBody({ error: "Invalid request" });

// Redirect
Decision.redirect("/login");                   // 302 temporary
Decision.redirect("/new-path", 301);           // 301 permanent
Decision.redirectPermanent("/new-path");       // 301 permanent

// Modify headers
Decision.allow()
  .addRequestHeader("X-User-ID", userId)
  .removeRequestHeader("Cookie")
  .addResponseHeader("X-Cache", "HIT")
  .removeResponseHeader("X-Powered-By");

// Audit metadata (appears in Sentinel logs)
Decision.deny()
  .withTag("blocked")
  .withRuleId("SQLI-001")
  .withConfidence(0.95)
  .withMetadata("matched_pattern", pattern);
```

### ConfigurableAgent

For agents with typed configuration:

```typescript
import { ConfigurableAgent, Decision, Request } from "sentinel-agent-sdk";

interface RateLimitConfig {
  requestsPerMinute: number;
  enabled: boolean;
}

class RateLimitAgent extends ConfigurableAgent<RateLimitConfig> {
  constructor() {
    super({ requestsPerMinute: 60, enabled: true });
  }

  get name(): string {
    return "rate-limiter";
  }

  async onConfigApplied(config: RateLimitConfig): Promise<void> {
    console.log(`Rate limit set to ${config.requestsPerMinute}/min`);
  }

  async onRequest(request: Request): Promise<Decision> {
    if (!this.config.enabled) {
      return Decision.allow();
    }
    // Use this.config.requestsPerMinute...
    return Decision.allow();
  }
}
```

---

## Running Agents

### Command Line

The `runAgent` helper parses CLI arguments:

```bash
# Basic usage
npx tsx my-agent.ts --socket /tmp/my-agent.sock

# With options
npx tsx my-agent.ts \
    --socket /tmp/my-agent.sock \
    --log-level debug \
    --json-logs
```

| Option | Description | Default |
|--------|-------------|---------|
| `--socket PATH` | Unix socket path | `/tmp/sentinel-agent.sock` |
| `--log-level LEVEL` | debug, info, warn, error | `info` |
| `--json-logs` | Output logs as JSON | disabled |

### Programmatic

```typescript
import { AgentRunner } from "sentinel-agent-sdk";

const runner = new AgentRunner(new MyAgent())
  .withSocket("/tmp/my-agent.sock")
  .withLogLevel("debug")
  .withJsonLogs();

await runner.run();
```

---

## Sentinel Configuration

Configure Sentinel to connect to your agent:

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

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `unix-socket path="..."` | Path to agent's Unix socket | required |
| `events` | Events to send: `request_headers`, `request_body`, `response_headers`, `response_body` | `request_headers` |
| `timeout-ms` | Timeout for agent calls | `1000` |
| `failure-mode` | `"open"` (allow on failure) or `"closed"` (block on failure) | `"open"` |

See [docs/configuration.md](docs/configuration.md) for complete configuration reference.

---

## Examples

The `examples/` directory contains complete, runnable examples:

| Example | Description |
|---------|-------------|
| [`simple-agent.ts`](examples/simple-agent.ts) | Basic request blocking and header modification |
| [`configurable-agent.ts`](examples/configurable-agent.ts) | Rate limiting with typed configuration |

See [docs/examples.md](docs/examples.md) for more patterns: authentication, rate limiting, IP filtering, header transformation, and more.

---

## Development

This project uses [mise](https://mise.jdx.dev/) for tool management.

```bash
# Install tools
mise install

# Install dependencies
npm install

# Run tests
npm test

# Type checking
npm run typecheck

# Build
npm run build
```

### Without mise

```bash
# Ensure Node.js 18+ is installed
npm install
npm test
```

### Project Structure

```
sentinel-agent-typescript-sdk/
├── src/
│   ├── index.ts        # Public API exports
│   ├── agent.ts        # Agent and ConfigurableAgent base classes
│   ├── decision.ts     # Decision builder
│   ├── protocol.ts     # Wire protocol types and encoding
│   ├── request.ts      # Request wrapper
│   ├── response.ts     # Response wrapper
│   ├── handler.ts      # AgentHandler for event routing
│   └── runner.ts       # AgentRunner and CLI handling
├── tests/
│   ├── sdk.test.ts                    # Unit tests
│   ├── protocol-conformance.test.ts   # Protocol compatibility tests
│   └── integration/                   # Integration tests
└── examples/                          # Example agents
```

---

## Protocol

This SDK implements Sentinel Agent Protocol v1:

- **Transport**: Unix domain sockets
- **Encoding**: Length-prefixed JSON (4-byte big-endian length prefix)
- **Max message size**: 10 MB
- **Events**: `configure`, `request_headers`, `request_body_chunk`, `response_headers`, `response_body_chunk`, `request_complete`
- **Decisions**: `allow`, `block`, `redirect`, `challenge`

The protocol is designed for low latency and high throughput, with support for streaming body inspection.

---

## Community

- [Issues](https://github.com/raskell-io/sentinel-agent-typescript-sdk/issues) — Bug reports and feature requests
- [Sentinel Discussions](https://github.com/raskell-io/sentinel/discussions) — Questions and ideas
- [Sentinel Documentation](https://sentinel.raskell.io/docs) — Proxy documentation

Contributions welcome. Please open an issue to discuss significant changes before submitting a PR.

---

## License

Apache 2.0 — See [LICENSE](LICENSE).
