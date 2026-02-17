/**
 * Agent runner for handling connections and events.
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { Agent } from "./agent.js";
import { AgentHandler } from "./handler.js";
import { encodeMessage, MAX_MESSAGE_SIZE } from "./protocol.js";

export interface RunnerConfig {
  socketPath: string;
  name: string;
  jsonLogs: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

function createDefaultConfig(name: string): RunnerConfig {
  return {
    socketPath: "/tmp/zentinel-agent.sock",
    name,
    jsonLogs: false,
    logLevel: "info",
  };
}

type LogLevel = "debug" | "info" | "warn" | "error";

function createLogger(config: RunnerConfig): (level: LogLevel, message: string) => void {
  const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const configLevel = levels[config.logLevel] || 1;

  return (level: LogLevel, message: string) => {
    if (levels[level] < configLevel) {
      return;
    }

    const timestamp = new Date().toISOString();

    if (config.jsonLogs) {
      const logData = {
        timestamp,
        level: level.toUpperCase(),
        agent: config.name,
        message,
      };
      console.log(JSON.stringify(logData));
    } else {
      console.log(`${timestamp} [${config.name}] ${level.toUpperCase()}: ${message}`);
    }
  };
}

export class AgentRunner {
  private readonly _agent: Agent;
  private _config: RunnerConfig;
  private _server: net.Server | null = null;
  private _shuttingDown = false;
  private _logger: (level: LogLevel, message: string) => void;

  constructor(agent: Agent) {
    this._agent = agent;
    this._config = createDefaultConfig(agent.name);
    this._logger = createLogger(this._config);
  }

  withName(name: string): AgentRunner {
    this._config.name = name;
    this._logger = createLogger(this._config);
    return this;
  }

  withSocket(socketPath: string): AgentRunner {
    this._config.socketPath = socketPath;
    return this;
  }

  withJsonLogs(): AgentRunner {
    this._config.jsonLogs = true;
    this._logger = createLogger(this._config);
    return this;
  }

  withLogLevel(level: LogLevel): AgentRunner {
    this._config.logLevel = level;
    this._logger = createLogger(this._config);
    return this;
  }

  withConfig(config: RunnerConfig): AgentRunner {
    this._config = config;
    this._logger = createLogger(this._config);
    return this;
  }

  async run(): Promise<void> {
    const socketPath = this._config.socketPath;

    // Clean up existing socket
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(socketPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Create server
    this._server = net.createServer((socket) => {
      this._handleConnection(socket);
    });

    // Set up signal handlers
    const handleSignal = () => {
      this._logger("info", "Shutdown signal received");
      this._shutdown();
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this._server!.on("error", reject);
      this._server!.listen(socketPath, () => {
        // Set socket permissions (readable/writable by owner and group)
        fs.chmodSync(socketPath, 0o660);
        this._logger("info", `Agent '${this._config.name}' listening on ${socketPath}`);
        resolve();
      });
    });

    // Wait for shutdown
    await new Promise<void>((resolve) => {
      this._server!.on("close", resolve);
    });

    // Cleanup
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    this._logger("info", "Agent shutdown complete");
  }

  private _shutdown(): void {
    if (this._shuttingDown) {
      return;
    }
    this._shuttingDown = true;

    if (this._server) {
      this._server.close();
    }
  }

  private _handleConnection(socket: net.Socket): void {
    const handler = new AgentHandler(this._agent, this._logger as (level: string, message: string) => void);
    const remoteAddress = socket.remoteAddress || "unknown";
    this._logger("debug", `Connection from ${remoteAddress}`);

    let buffer = Buffer.alloc(0);

    socket.on("data", async (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // Process complete messages
      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32BE(0);

        if (messageLength > MAX_MESSAGE_SIZE) {
          this._logger("error", `Message size ${messageLength} exceeds maximum`);
          socket.destroy();
          return;
        }

        if (buffer.length < 4 + messageLength) {
          // Wait for more data
          break;
        }

        // Extract the message
        const messageData = buffer.subarray(4, 4 + messageLength);
        buffer = buffer.subarray(4 + messageLength);

        try {
          const message = JSON.parse(messageData.toString("utf-8")) as Record<string, unknown>;
          const response = await handler.handleEvent(message);
          const responseBuffer = encodeMessage(response);
          socket.write(responseBuffer);
        } catch (error) {
          this._logger("error", `Error processing message: ${error}`);
        }
      }
    });

    socket.on("error", (error) => {
      this._logger("error", `Socket error: ${error.message}`);
    });

    socket.on("close", () => {
      this._logger("debug", `Connection closed: ${remoteAddress}`);
    });
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
  });

  return {
    socket: values.socket as string,
    jsonLogs: values["json-logs"] as boolean,
    logLevel: values["log-level"] as LogLevel,
  };
}

export function runAgent(agent: Agent): void {
  const args = parseCliArgs();

  const config: RunnerConfig = {
    socketPath: args.socket,
    name: agent.name,
    jsonLogs: args.jsonLogs,
    logLevel: args.logLevel,
  };

  const runner = new AgentRunner(agent).withConfig(config);

  runner.run().catch((error) => {
    console.error(`Agent error: ${error}`);
    process.exit(1);
  });
}
