/**
 * The conformance agent of Zentinel's SDK conformance harness
 * (zentinelproxy/zentinel, `sdk-conformance/README.md`).
 *
 * CI runs it behind a real `zentinel` binary on both transports:
 *
 *   node build/examples/conformance-agent.js --socket /path/to/agent.sock
 *   node build/examples/conformance-agent.js --grpc 127.0.0.1:50051
 */

import { parseArgs } from "node:util";

import { Decision, Request, Response } from "zentinel-agent-sdk";
import { AgentCapabilities, AgentRunnerV2, AgentV2 } from "zentinel-agent-sdk/v2";

class ConformanceAgent implements AgentV2 {
  private _config: Record<string, unknown> | undefined;

  get name(): string {
    return "conformance";
  }

  capabilities(): AgentCapabilities {
    return new AgentCapabilities("conformance", "Conformance agent", "0.1.0");
  }

  async onConfigure(config: Record<string, unknown>): Promise<void> {
    this._config = config;
  }

  async onRequest(request: Request): Promise<Decision> {
    if (request.pathStartsWith("/block")) {
      return Decision.block(403).withBody("blocked-by-agent");
    }
    const nested = this._config?.nested as Record<string, unknown> | undefined;
    const value = typeof nested?.value === "string" ? nested.value : "unconfigured";
    return Decision.allow()
      .addRequestHeader("X-Hello", "from-agent")
      .addRequestHeader("X-Conformance-Config", value);
  }

  async onRequestBody(request: Request): Promise<Decision> {
    const body = request.bodyStr;
    if (body.includes("block-this-body")) {
      return Decision.block(403).withBody(`body-seen:${body}`);
    }
    return Decision.allow();
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow().addResponseHeader("X-Conformance-Response", "from-agent");
  }
}

const { values } = parseArgs({
  options: { socket: { type: "string" }, grpc: { type: "string" } },
});

const runner = new AgentRunnerV2(new ConformanceAgent());
if (values.grpc) {
  await runner.withGrpc(values.grpc).run();
} else {
  await runner.withUds(values.socket ?? "/tmp/zentinel-conformance.sock").run();
}
