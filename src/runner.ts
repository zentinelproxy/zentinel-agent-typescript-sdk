/**
 * Runner for agents written against the root `Agent` interface.
 *
 * It serves agent protocol v2 over a Unix socket through the v2 runner
 * (`zentinel-agent-sdk/v2`'s `AgentRunnerV2`); there is no separate v1 code
 * path any more. Use the v2 runner directly for gRPC.
 */

import { parseArgs } from "node:util";

import { Agent } from "./agent.js";
import { asAgentV2 } from "./v2/agent.js";
import { AgentRunnerV2 } from "./v2/runner.js";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface RunnerConfig {
  socketPath: string;
  name: string;
  jsonLogs: boolean;
  logLevel: LogLevel;
}

export class AgentRunner {
  private readonly _agent: Agent;
  private _config: RunnerConfig;

  constructor(agent: Agent) {
    this._agent = agent;
    this._config = {
      socketPath: "/tmp/zentinel-agent.sock",
      name: agent.name,
      jsonLogs: false,
      logLevel: "info",
    };
  }

  withName(name: string): AgentRunner {
    this._config.name = name;
    return this;
  }

  withSocket(socketPath: string): AgentRunner {
    this._config.socketPath = socketPath;
    return this;
  }

  withJsonLogs(): AgentRunner {
    this._config.jsonLogs = true;
    return this;
  }

  withLogLevel(level: LogLevel): AgentRunner {
    this._config.logLevel = level;
    return this;
  }

  withConfig(config: RunnerConfig): AgentRunner {
    this._config = { ...config };
    return this;
  }

  /** Serve the agent on the configured Unix socket until SIGINT/SIGTERM. */
  async run(): Promise<void> {
    let runner = new AgentRunnerV2(asAgentV2(this._agent))
      .withName(this._config.name)
      .withUds(this._config.socketPath)
      .withLogLevel(this._config.logLevel);
    if (this._config.jsonLogs) {
      runner = runner.withJsonLogs();
    }
    await runner.run();
  }
}

export interface ParsedArgs {
  socket: string;
  jsonLogs: boolean;
  logLevel: LogLevel;
}

export function parseCliArgs(): ParsedArgs {
  const { values } = parseArgs({
    options: {
      socket: {
        type: "string",
        default: "/tmp/zentinel-agent.sock",
      },
      "json-logs": {
        type: "boolean",
        default: false,
      },
      "log-level": {
        type: "string",
        default: "info",
      },
    },
    strict: false,
  });

  return {
    socket: values.socket as string,
    jsonLogs: values["json-logs"] as boolean,
    logLevel: values["log-level"] as LogLevel,
  };
}

export function runAgent(agent: Agent): void {
  const args = parseCliArgs();

  const runner = new AgentRunner(agent).withConfig({
    socketPath: args.socket,
    name: agent.name,
    jsonLogs: args.jsonLogs,
    logLevel: args.logLevel,
  });

  runner.run().catch((error) => {
    console.error(`Agent error: ${error}`);
    process.exit(1);
  });
}
