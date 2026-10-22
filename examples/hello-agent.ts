/**
 * The quick-start agent from the README: adds `X-Hello` and allows.
 *
 * The conformance harness runs it with `--profile hello` in CI, so the README
 * cannot drift from code that works. Usage: `node build/examples/hello-agent.js [socket]`.
 */

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

await new AgentRunnerV2(new HelloAgent()).withUds(process.argv[2] ?? "/tmp/hello.sock").run();
