# Quickstart Guide

This guide will help you create your first Sentinel agent in under 5 minutes.

## Prerequisites

- Node.js 20+
- Sentinel proxy (for testing with real traffic)

## Step 1: Create a New Project

```bash
mkdir my-agent
cd my-agent
npm init -y
npm install @sentinel-agent/sdk typescript ts-node @types/node
```

## Step 2: Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  }
}
```

## Step 3: Create Your Agent

Create `src/agent.ts`:

```typescript
import { Agent, Decision, Request, runAgent } from '@sentinel-agent/sdk';

class MyAgent implements Agent {
  name = 'my-agent';

  async onRequest(request: Request): Promise<Decision> {
    // Log the request
    console.log(`Processing: ${request.method} ${request.path}`);

    // Block requests to sensitive paths
    if (request.pathStartsWith('/admin')) {
      return Decision.deny()
        .withBody('Access denied')
        .withTag('blocked');
    }

    // Allow with a custom header
    return Decision.allow()
      .addRequestHeader('X-Processed-By', 'my-agent');
  }
}

runAgent(new MyAgent());
```

## Step 4: Run the Agent

```bash
npx ts-node src/agent.ts --socket /tmp/my-agent.sock --log-level debug
```

You should see:

```
[my-agent] INFO: Agent 'my-agent' listening on /tmp/my-agent.sock
```

## Step 5: Configure Sentinel

Add the agent to your Sentinel configuration (`sentinel.kdl`):

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
        timeout-ms 100
        failure-mode "open"
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

## Step 6: Test It

With Sentinel running, send a test request:

```bash
# This should pass through
curl http://localhost:8080/api/users

# This should be blocked
curl http://localhost:8080/api/admin/settings
```

## Command Line Options

The `runAgent` function supports these CLI arguments:

| Option | Description | Default |
|--------|-------------|---------|
| `--socket PATH` | Unix socket path | `/tmp/sentinel-agent.sock` |
| `--log-level LEVEL` | Log level (debug, info, warn, error) | `info` |
| `--json-logs` | Enable JSON log format | disabled |

## Next Steps

- Read the [API Reference](api.md) for complete documentation
- See [Examples](examples.md) for common patterns
- Learn about [Sentinel Configuration](configuration.md) options
