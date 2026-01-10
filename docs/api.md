# API Reference

## Agent

The interface for all Sentinel agents.

```typescript
import { Agent } from '@sentinel-agent/sdk';
```

### Properties

#### `name`

```typescript
name: string;
```

The agent identifier used for logging.

### Event Handlers

#### `onConfigure`

```typescript
onConfigure?(config: Record<string, unknown>): Promise<void>;
```

Called when the agent receives configuration from the proxy. Override to validate and store configuration.

#### `onRequest`

```typescript
onRequest?(request: Request): Promise<Decision>;
```

Called when request headers are received. This is the main entry point for request processing.

**Default**: Returns `Decision.allow()`

#### `onRequestBody`

```typescript
onRequestBody?(request: Request): Promise<Decision>;
```

Called when the request body is available (requires body inspection to be enabled in Sentinel).

**Default**: Returns `Decision.allow()`

#### `onResponse`

```typescript
onResponse?(request: Request, response: Response): Promise<Decision>;
```

Called when response headers are received from the upstream server.

**Default**: Returns `Decision.allow()`

#### `onResponseBody`

```typescript
onResponseBody?(request: Request, response: Response): Promise<Decision>;
```

Called when the response body is available (requires body inspection to be enabled).

**Default**: Returns `Decision.allow()`

#### `onRequestComplete`

```typescript
onRequestComplete?(request: Request, status: number, durationMs: number): Promise<void>;
```

Called when request processing is complete. Use for logging or metrics.

---

## ConfigurableAgent

A generic agent class with typed configuration support.

```typescript
import { ConfigurableAgent } from '@sentinel-agent/sdk';

interface MyConfig {
  rateLimit: number;
  enabled: boolean;
}

class MyAgent extends ConfigurableAgent<MyConfig> {
  name = 'my-agent';

  constructor() {
    super({ rateLimit: 100, enabled: true });
  }

  async onRequest(request: Request): Promise<Decision> {
    if (!this.config.enabled) {
      return Decision.allow();
    }
    // Use this.config.rateLimit...
    return Decision.allow();
  }
}
```

### Properties

#### `config`

```typescript
get config(): T;
```

Returns the current configuration instance.

### Methods

#### `parseConfig`

```typescript
parseConfig(configObj: Record<string, unknown>): T;
```

Override to customize config parsing. Default returns the object as-is.

#### `onConfigApplied`

```typescript
onConfigApplied?(config: T): Promise<void>;
```

Called after new configuration is applied.

---

## Decision

Fluent builder for agent decisions.

```typescript
import { Decision } from '@sentinel-agent/sdk';
```

### Factory Methods

#### `Decision.allow()`

Create an allow decision (pass request through).

```typescript
return Decision.allow();
```

#### `Decision.block(status?: number)`

Create a block decision with a status code.

```typescript
return Decision.block(403);
return Decision.block(500);
```

#### `Decision.deny()`

Shorthand for `Decision.block(403)`.

```typescript
return Decision.deny();
```

#### `Decision.unauthorized()`

Shorthand for `Decision.block(401)`.

```typescript
return Decision.unauthorized();
```

#### `Decision.rateLimited()`

Shorthand for `Decision.block(429)`.

```typescript
return Decision.rateLimited();
```

#### `Decision.redirect(url: string, status?: number)`

Create a redirect decision.

```typescript
return Decision.redirect('https://example.com/login');
return Decision.redirect('https://example.com/new-path', 301);
```

#### `Decision.redirectPermanent(url: string)`

Shorthand for `Decision.redirect(url, 301)`.

```typescript
return Decision.redirectPermanent('https://example.com/new-path');
```

#### `Decision.challenge(type: string, params?: object)`

Create a challenge decision (e.g., CAPTCHA).

```typescript
return Decision.challenge('captcha', { siteKey: '...' });
```

### Chaining Methods

All methods return `this` for chaining.

#### `withBody(body: string)`

Set the response body for block decisions.

```typescript
Decision.deny().withBody('Access denied');
```

#### `withJsonBody(value: object)`

Set a JSON response body. Automatically sets `Content-Type: application/json`.

```typescript
Decision.block(400).withJsonBody({ error: 'Invalid request' });
```

#### `withBlockHeader(name: string, value: string)`

Add a header to the block response.

```typescript
Decision.deny().withBlockHeader('X-Blocked-By', 'my-agent');
```

#### `addRequestHeader(name: string, value: string)`

Add a header to the upstream request.

```typescript
Decision.allow().addRequestHeader('X-User-ID', '123');
```

#### `removeRequestHeader(name: string)`

Remove a header from the upstream request.

```typescript
Decision.allow().removeRequestHeader('Cookie');
```

#### `addResponseHeader(name: string, value: string)`

Add a header to the client response.

```typescript
Decision.allow().addResponseHeader('X-Frame-Options', 'DENY');
```

#### `removeResponseHeader(name: string)`

Remove a header from the client response.

```typescript
Decision.allow().removeResponseHeader('Server');
```

### Audit Methods

#### `withTag(tag: string)`

Add an audit tag.

```typescript
Decision.deny().withTag('security');
```

#### `withTags(tags: string[])`

Add multiple audit tags.

```typescript
Decision.deny().withTags(['blocked', 'rate-limit']);
```

#### `withRuleId(ruleId: string)`

Add a rule ID for audit logging.

```typescript
Decision.deny().withRuleId('SQLI-001');
```

#### `withConfidence(confidence: number)`

Set a confidence score (0.0 to 1.0).

```typescript
Decision.deny().withConfidence(0.95);
```

#### `withReasonCode(code: string)`

Add a reason code.

```typescript
Decision.deny().withReasonCode('IP_BLOCKED');
```

#### `withMetadata(key: string, value: unknown)`

Add custom audit metadata.

```typescript
Decision.deny().withMetadata('blockedIp', '192.168.1.100');
```

### Advanced Methods

#### `needsMoreData()`

Indicate that more data is needed before deciding.

```typescript
Decision.allow().needsMoreData();
```

#### `withRoutingMetadata(key: string, value: string)`

Add routing metadata for upstream selection.

```typescript
Decision.allow().withRoutingMetadata('upstream', 'backend-v2');
```

#### `withRequestBodyMutation(data: string, chunkIndex: number)`

Set a mutation for the request body.

```typescript
Decision.allow().withRequestBodyMutation('modified body', 0);
```

#### `withResponseBodyMutation(data: string, chunkIndex: number)`

Set a mutation for the response body.

```typescript
Decision.allow().withResponseBodyMutation('modified body', 0);
```

---

## Request

Represents an incoming HTTP request.

```typescript
import { Request } from '@sentinel-agent/sdk';
```

### Properties

#### `method`

The HTTP method (GET, POST, etc.).

```typescript
if (request.method === 'POST') { ... }
```

#### `path`

The request path without query string.

```typescript
const path = request.path; // '/api/users'
```

#### `uri`

The full URI including query string.

```typescript
const uri = request.uri; // '/api/users?page=1'
```

#### `queryString`

The raw query string.

```typescript
const qs = request.queryString; // 'page=1&limit=10'
```

#### `headers`

Map of headers (lowercase keys, array values).

```typescript
const contentType = request.headers.get('content-type')?.[0];
```

#### `body`

The request body as Buffer (if body inspection is enabled).

```typescript
if (request.body) {
  const data = JSON.parse(request.body.toString());
}
```

### Convenience Methods

#### `pathStartsWith(prefix: string)`

Check if the path starts with a prefix.

```typescript
if (request.pathStartsWith('/api/')) { ... }
```

#### `pathEquals(path: string)`

Check if the path exactly matches.

```typescript
if (request.pathEquals('/health')) { ... }
```

#### `hasHeader(name: string)`

Check if a header exists (case-insensitive).

```typescript
if (request.hasHeader('Authorization')) { ... }
```

#### `getHeader(name: string)`

Get a header value (first value if multiple).

```typescript
const auth = request.getHeader('authorization');
```

#### `queryParams`

Parsed query parameters.

```typescript
const page = request.queryParams.get('page')?.[0] ?? '1';
```

### Common Header Properties

```typescript
request.host           // Host header
request.userAgent      // User-Agent header
request.contentType    // Content-Type header
request.authorization  // Authorization header
```

### Metadata Properties

```typescript
request.correlationId  // Request correlation ID
request.requestId      // Unique request ID
request.clientIp       // Client IP address
request.clientPort     // Client port
request.serverName     // Server name
request.protocol       // HTTP protocol version
request.timestamp      // Request timestamp
```

---

## Response

Represents an HTTP response from the upstream.

```typescript
import { Response } from '@sentinel-agent/sdk';
```

### Properties

#### `statusCode`

The HTTP status code.

```typescript
if (response.statusCode === 200) { ... }
```

#### `headers`

Map of response headers.

```typescript
const contentType = response.headers.get('content-type')?.[0];
```

#### `body`

The response body as Buffer (if body inspection is enabled).

```typescript
if (response.body) {
  const data = JSON.parse(response.body.toString());
}
```

### Convenience Methods

#### `hasHeader(name: string)`

Check if a header exists.

#### `getHeader(name: string)`

Get a header value.

#### `isSuccess()`

Check if status is 2xx.

#### `isRedirect()`

Check if status is 3xx.

#### `isClientError()`

Check if status is 4xx.

#### `isServerError()`

Check if status is 5xx.

#### `isError()`

Check if status is 4xx or 5xx.

---

## AgentRunner

Runner for starting and managing an agent.

```typescript
import { AgentRunner } from '@sentinel-agent/sdk';
```

### Usage

```typescript
const runner = new AgentRunner(new MyAgent())
  .withSocket('/tmp/my-agent.sock')
  .withLogLevel('debug');

await runner.run();
```

### Builder Methods

#### `withName(name: string)`

Set the agent name for logging.

#### `withSocket(path: string)`

Set the Unix socket path.

#### `withJsonLogs()`

Enable JSON log format.

#### `withLogLevel(level: string)`

Set the log level (debug, info, warn, error).

---

## runAgent

Convenience function to run an agent with CLI argument parsing.

```typescript
import { runAgent } from '@sentinel-agent/sdk';

runAgent(new MyAgent());
```

This parses `--socket`, `--log-level`, and `--json-logs` from command line arguments.
