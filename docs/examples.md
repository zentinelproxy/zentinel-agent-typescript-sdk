# Examples

Common patterns and use cases for Sentinel agents.

## Basic Request Blocking

Block requests based on path patterns:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class BlockingAgent implements Agent {
  name = 'blocking-agent';

  private blockedPaths = ['/admin', '/internal', '/.git', '/.env'];

  async onRequest(request: Request): Promise<Decision> {
    for (const blocked of this.blockedPaths) {
      if (request.pathStartsWith(blocked)) {
        return Decision.deny()
          .withBody('Not Found')
          .withTag('path-blocked');
      }
    }
    return Decision.allow();
  }
}
```

## IP-Based Access Control

Block or allow requests based on client IP:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class IPFilterAgent implements Agent {
  name = 'ip-filter';

  private allowedIps = new Set(['10.0.0.1', '192.168.1.1', '127.0.0.1']);

  async onRequest(request: Request): Promise<Decision> {
    const clientIp = request.clientIp;

    if (this.allowedIps.has(clientIp)) {
      return Decision.allow();
    }

    return Decision.deny()
      .withTag('ip-blocked')
      .withMetadata('blockedIp', clientIp);
  }
}
```

## Authentication Validation

Validate JWT tokens:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';
import jwt from 'jsonwebtoken';

class AuthAgent implements Agent {
  name = 'auth-agent';

  constructor(private secret: string) {}

  async onRequest(request: Request): Promise<Decision> {
    // Skip auth for public paths
    if (request.pathStartsWith('/public')) {
      return Decision.allow();
    }

    const auth = request.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return Decision.unauthorized()
        .withBody('Missing or invalid Authorization header')
        .withTag('auth-missing');
    }

    const token = auth.slice(7); // Remove 'Bearer ' prefix

    try {
      const payload = jwt.verify(token, this.secret) as { sub?: string; role?: string };
      return Decision.allow()
        .addRequestHeader('X-User-ID', payload.sub ?? '')
        .addRequestHeader('X-User-Role', payload.role ?? '');
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return Decision.unauthorized()
          .withBody('Token expired')
          .withTag('auth-expired');
      }
      return Decision.unauthorized()
        .withBody('Invalid token')
        .withTag('auth-invalid');
    }
  }
}
```

## Rate Limiting

Simple in-memory rate limiting:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class RateLimitAgent implements Agent {
  name = 'rate-limit';

  private maxRequests = 100;
  private windowSeconds = 60;
  private requests = new Map<string, number[]>();

  async onRequest(request: Request): Promise<Decision> {
    const key = request.clientIp;
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    // Clean old entries and add current
    const timestamps = (this.requests.get(key) ?? [])
      .filter(t => t > windowStart);
    timestamps.push(now);
    this.requests.set(key, timestamps);

    if (timestamps.length > this.maxRequests) {
      return Decision.rateLimited()
        .withBody('Too many requests')
        .withTag('rate-limited')
        .addResponseHeader('Retry-After', String(this.windowSeconds));
    }

    const remaining = this.maxRequests - timestamps.length;
    return Decision.allow()
      .addResponseHeader('X-RateLimit-Limit', String(this.maxRequests))
      .addResponseHeader('X-RateLimit-Remaining', String(remaining));
  }
}
```

## Header Modification

Add, remove, or modify headers:

```typescript
import { Agent, Decision, Request, Response, runAgent } from '@sentinel-agent/sdk';

class HeaderAgent implements Agent {
  name = 'header-agent';

  async onRequest(request: Request): Promise<Decision> {
    return Decision.allow()
      // Add headers for upstream
      .addRequestHeader('X-Forwarded-By', 'sentinel')
      .addRequestHeader('X-Request-ID', request.correlationId)
      // Remove sensitive headers
      .removeRequestHeader('X-Internal-Token');
  }

  async onResponse(request: Request, response: Response): Promise<Decision> {
    return Decision.allow()
      // Add security headers
      .addResponseHeader('X-Frame-Options', 'DENY')
      .addResponseHeader('X-Content-Type-Options', 'nosniff')
      .addResponseHeader('X-XSS-Protection', '1; mode=block')
      // Remove server info
      .removeResponseHeader('Server')
      .removeResponseHeader('X-Powered-By');
  }
}
```

## Configurable Agent

Agent with runtime configuration:

```typescript
import { ConfigurableAgent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

interface Config {
  enabled: boolean;
  blockedPaths: string[];
  logRequests: boolean;
}

class ConfigurableBlocker extends ConfigurableAgent<Config> {
  name = 'configurable-blocker';

  constructor() {
    super({
      enabled: true,
      blockedPaths: ['/admin'],
      logRequests: false,
    });
  }

  async onConfigApplied(config: Config): Promise<void> {
    console.log(`Configuration updated: enabled=${config.enabled}`);
  }

  async onRequest(request: Request): Promise<Decision> {
    if (!this.config.enabled) {
      return Decision.allow();
    }

    if (this.config.logRequests) {
      console.log(`Request: ${request.method} ${request.path}`);
    }

    for (const blocked of this.config.blockedPaths) {
      if (request.pathStartsWith(blocked)) {
        return Decision.deny();
      }
    }

    return Decision.allow();
  }
}
```

## Request Logging

Log all requests with timing:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class LoggingAgent implements Agent {
  name = 'logging-agent';

  async onRequest(request: Request): Promise<Decision> {
    return Decision.allow()
      .withTag(`method:${request.method.toLowerCase()}`)
      .withMetadata('path', request.path)
      .withMetadata('clientIp', request.clientIp);
  }

  async onRequestComplete(
    request: Request,
    status: number,
    durationMs: number
  ): Promise<void> {
    console.log(
      `${request.clientIp} - ${request.method} ${request.path} ` +
      `-> ${status} (${durationMs}ms)`
    );
  }
}
```

## Content-Type Validation

Validate request content types:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class ContentTypeAgent implements Agent {
  name = 'content-type-validator';

  private allowedTypes = new Set([
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
  ]);

  async onRequest(request: Request): Promise<Decision> {
    // Only check methods with body
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
      return Decision.allow();
    }

    const contentType = request.contentType;
    if (!contentType) {
      return Decision.block(400)
        .withBody('Content-Type header required');
    }

    // Check against allowed types (ignore params like charset)
    const baseType = contentType.split(';')[0].trim().toLowerCase();
    if (!this.allowedTypes.has(baseType)) {
      return Decision.block(415)
        .withBody(`Unsupported Content-Type: ${baseType}`)
        .withTag('invalid-content-type');
    }

    return Decision.allow();
  }
}
```

## Redirect Agent

Redirect requests to different URLs:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class RedirectAgent implements Agent {
  name = 'redirect-agent';

  private redirects: Record<string, string> = {
    '/old-path': '/new-path',
    '/legacy': '/v2/api',
    '/blog': 'https://blog.example.com',
  };

  async onRequest(request: Request): Promise<Decision> {
    if (request.path in this.redirects) {
      return Decision.redirect(this.redirects[request.path]);
    }

    // Redirect HTTP to HTTPS
    const proto = request.getHeader('x-forwarded-proto');
    if (proto === 'http') {
      const httpsUrl = `https://${request.host}${request.uri}`;
      return Decision.redirectPermanent(httpsUrl);
    }

    return Decision.allow();
  }
}
```

## Combining Multiple Checks

Agent that performs multiple validations:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class SecurityAgent implements Agent {
  name = 'security-agent';

  private suspiciousPatterns = ['/../', '/etc/', '/proc/', '.php'];

  async onRequest(request: Request): Promise<Decision> {
    // Check 1: User-Agent required
    if (!request.userAgent) {
      return Decision.block(400).withBody('User-Agent required');
    }

    // Check 2: Block suspicious paths
    const pathLower = request.path.toLowerCase();
    for (const pattern of this.suspiciousPatterns) {
      if (pathLower.includes(pattern)) {
        return Decision.deny()
          .withTag('path-traversal')
          .withRuleId('SEC-001');
      }
    }

    // Check 3: Block large requests without content-length
    if (['POST', 'PUT'].includes(request.method)) {
      if (!request.hasHeader('content-length')) {
        return Decision.block(411).withBody('Content-Length required');
      }
    }

    // All checks passed
    return Decision.allow()
      .withTag('security-passed')
      .addResponseHeader('X-Security-Check', 'passed');
  }
}
```
