<p align="center">
  <a href="https://zentinelproxy.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zentinelproxy/design/main/marks/lockup/zentinel-lockup-dark.svg">
      <img alt="Zentinel" src="https://raw.githubusercontent.com/zentinelproxy/design/main/marks/lockup/zentinel-lockup-light.svg" height="52">
    </picture>
  </a>
</p>

<h3 align="center">TypeScript agent SDK</h3>

<p align="center">Write Zentinel agents in TypeScript for Node.js, speaking agent protocol v2 over a Unix socket or gRPC.</p>

<p align="center">
  <a href="https://github.com/zentinelproxy/zentinel-agent-typescript-sdk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zentinelproxy/zentinel-agent-typescript-sdk/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-9b4d8a?style=flat&labelColor=1f161e">
  <img alt="Agent protocol: v2" src="https://img.shields.io/badge/agent%20protocol-v2-f68d31?style=flat&labelColor=1f161e">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-18%2B-f68d31?style=flat&labelColor=1f161e&logo=nodedotjs&logoColor=white">
</p>

<p align="center">
  <a href="https://docs.zentinelproxy.io/agents/v2/">Agent protocol</a> &middot;
  <a href="https://docs.zentinelproxy.io">Docs</a> &middot;
  <a href="https://github.com/zentinelproxy">All repositories</a>
</p>

The SDK gives you an `Agent` interface with one async method per event, a
`Decision` builder, typed configuration, and in `zentinel-agent-sdk/v2` a
runner with Unix socket and gRPC transports, health and metrics reporting.
Install it from source: the npm release is older than `main`.

> **Status (checked on 2026-10-21 against Zentinel 0.6.50): agents built with this SDK do not connect to Zentinel.**
> Both Unix socket runners (`runAgent` and the `v2` runner) expect the v1
> framing and fail to parse the proxy's v2 handshake as JSON, and the gRPC server never completes the handshake.
> Because the agent accepts the connection and then goes silent, Zentinel
> 0.6.50 waits on it at startup and never opens its listener. Unit tests pass in
> CI. The quick start shows the intended shape.

## Quick start

In an ES module project with the SDK and `tsx` installed (see
[Install](#install)), create `hello-agent.ts`:

```typescript
import { Decision, Request } from "zentinel-agent-sdk";
import { AgentCapabilities, AgentRunnerV2, AgentV2 } from "zentinel-agent-sdk/v2";

class HelloAgent implements AgentV2 {
  get name(): string {
    return "hello";
  }

  capabilities(): AgentCapabilities {
    return new AgentCapabilities("hello", "Hello agent", "0.1.0");
  }

  async onRequest(_request: Request): Promise<Decision> {
    return Decision.allow().addRequestHeader("X-Hello", "from-agent");
  }
}

await new AgentRunnerV2(new HelloAgent()).withUds("/tmp/hello.sock").run();
```

Run it with `node --import tsx hello-agent.ts`. It listens on `/tmp/hello.sock`.

Then point Zentinel at the socket. This assumes your config already defines a
listener and an upstream named `backend`:

```kdl
agents {
    agent "hello" type="custom" {
        unix-socket "/tmp/hello.sock"
        events "request_headers"
        timeout-ms 100
    }
}

filters {
    filter "hello" {
        type "agent"
        agent "hello"
        failure-mode "closed"
    }
}

routes {
    route "default" {
        matches {
            path-prefix "/"
        }
        upstream "backend"
        filters "hello"
    }
}
```

Check the file with `zentinel test -c zentinel.kdl` and start Zentinel. Every
request on the route then reaches `backend` with `X-Hello: from-agent`.
`failure-mode "closed"` on the filter turns an unreachable agent into a 503
instead of letting requests through unprocessed, so a wiring mistake shows up
on the first request.

With this SDK as it is today, that 503 is what you get: see the status note
above.

## Install

Build it from source and install the build:

```bash
git clone https://github.com/zentinelproxy/zentinel-agent-typescript-sdk
(cd zentinel-agent-typescript-sdk && npm ci && npm run build)
npm install ./zentinel-agent-typescript-sdk tsx
npm pkg set type=module
```

Node.js 18 or later (`engines`). Two shortcuts do not give you this code:
`npm install zentinel-agent-sdk` installs 0.3.0 from 2026-02-20, which
predates the move to v2 defaults (its `PROTOCOL_VERSION` is 1), and
`npm install github:zentinelproxy/zentinel-agent-typescript-sdk` installs a
package with no `dist/`, because the repository does not commit the build and
has no `prepare` script.

## API overview

- **`Agent`**: `name`, `onRequest`, `onRequestBody`, `onResponse`,
  `onResponseBody`, `onRequestComplete`, `onConfigure`, `onWebSocketFrame`,
  `onGuardrailInspect`; all optional except `name`.
- **`ConfigurableAgent<T>`**: typed configuration from the agent's `config` block.
- **`AgentV2`** (`zentinel-agent-sdk/v2`): adds `capabilities()` (required),
  health and metrics; `AgentRunnerV2` with `withUds`, `withGrpc`, `withBoth`;
  `runAgentV2(agent)` reads `--socket`, `--grpc`, `--log-level`, `--json-logs`.
- **`Request` / `Response`**: header, path, query, client IP and body accessors.
- **`Decision`**: `allow()`, `deny()`, `unauthorized()`, `rateLimited()`,
  `block(status)`, `redirect(url)`, `challenge(..)`, then chain
  `addRequestHeader`, `removeRequestHeader`, `addResponseHeader`, `withBody`,
  `withJsonBody`, `withTag`, `withRuleId`, `withConfidence`, `withMetadata`,
  `withRoutingMetadata`, body mutations.

Examples are in [`examples/`](examples/).

## Development

```bash
mise install        # Node 22
npm ci
npm run typecheck
npm run build
npm test
```

CI runs typecheck, build and test on Node 20. `package.json` has a `lint`
script, but the repository has no ESLint configuration, so it does not run.

## Related

- [Agent protocol v2](https://docs.zentinelproxy.io/agents/v2/)
- [Agent configuration](https://docs.zentinelproxy.io/configuration/agents/)
- [Guides in this repository](docs/index.md): getting started, API, configuration, examples
- [Other SDKs](https://github.com/zentinelproxy?q=sdk)
- [Zentinel](https://github.com/zentinelproxy/zentinel)

## License

Apache-2.0, see [`LICENSE`](LICENSE).

---

<p align="center">
  <sub>Part of <a href="https://zentinelproxy.io">Zentinel</a>, the security-first reverse proxy. The shisa guards the gate.</sub>
</p>
