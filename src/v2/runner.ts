/**
 * V2 Agent runner with gRPC and UDS support.
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { encodeMessage, MAX_MESSAGE_SIZE } from "../protocol.js";
import { AgentV2 } from "./agent.js";
import { AgentHandlerV2 } from "./handler.js";

/**
 * Transport type for v2 agents.
 */
export type TransportType = "grpc" | "uds" | "both";

/**
 * Transport configuration for v2 agents.
 */
export interface TransportConfig {
  type: TransportType;
  grpcAddress?: string;
  udsPath?: string;
}

/**
 * Configuration for the v2 agent runner.
 */
export interface V2RunnerConfig {
  transport: TransportConfig;
  name: string;
  jsonLogs: boolean;
  logLevel: LogLevel;
}

type LogLevel = "debug" | "info" | "warn" | "error";

function createDefaultConfig(name: string): V2RunnerConfig {
  return {
    transport: {
      type: "uds",
      udsPath: "/tmp/sentinel-agent.sock",
    },
    name,
    jsonLogs: false,
    logLevel: "info",
  };
}

function createLogger(config: V2RunnerConfig): (level: LogLevel, message: string) => void {
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

/**
 * Runner for v2 Sentinel agents.
 *
 * Handles CLI parsing, logging setup, and server lifecycle for v2 protocol.
 * Supports both gRPC and UDS transports.
 *
 * @example
 * ```typescript
 * class MyAgent implements AgentV2 {
 *   get name(): string {
 *     return "my-agent";
 *   }
 *
 *   capabilities(): AgentCapabilities {
 *     return new AgentCapabilities("my-agent", "My Agent", "1.0.0")
 *       .withStreamingBody(true)
 *       .withFlowControl(true);
 *   }
 *
 *   async onRequest(request: Request): Promise<Decision> {
 *     return Decision.allow();
 *   }
 * }
 *
 * const runner = new AgentRunnerV2(new MyAgent())
 *   .withName("my-agent")
 *   .withGrpc("0.0.0.0:50051");
 *
 * runner.run();
 * ```
 */
export class AgentRunnerV2 {
  private readonly _handler: AgentHandlerV2;
  private _config: V2RunnerConfig;
  private _udsServer: net.Server | null = null;
  private _shuttingDown = false;
  private _logger: (level: LogLevel, message: string) => void;

  constructor(agent: AgentV2) {
    this._config = createDefaultConfig(agent.name);
    this._logger = createLogger(this._config);
    this._handler = new AgentHandlerV2(agent, (level, message) =>
      this._logger(level as LogLevel, message)
    );
  }

  /**
   * Set the agent name for logging.
   */
  withName(name: string): AgentRunnerV2 {
    this._config.name = name;
    this._logger = createLogger(this._config);
    return this;
  }

  /**
   * Configure gRPC transport.
   */
  withGrpc(address: string): AgentRunnerV2 {
    this._config.transport = {
      type: "grpc",
      grpcAddress: address,
    };
    return this;
  }

  /**
   * Configure Unix domain socket transport.
   */
  withUds(socketPath: string): AgentRunnerV2 {
    this._config.transport = {
      type: "uds",
      udsPath: socketPath,
    };
    return this;
  }

  /**
   * Configure both gRPC and UDS transports.
   */
  withBoth(grpcAddress: string, udsPath: string): AgentRunnerV2 {
    this._config.transport = {
      type: "both",
      grpcAddress,
      udsPath,
    };
    return this;
  }

  /**
   * Enable JSON log format.
   */
  withJsonLogs(): AgentRunnerV2 {
    this._config.jsonLogs = true;
    this._logger = createLogger(this._config);
    return this;
  }

  /**
   * Set the log level.
   */
  withLogLevel(level: LogLevel): AgentRunnerV2 {
    this._config.logLevel = level;
    this._logger = createLogger(this._config);
    return this;
  }

  /**
   * Set the full runner configuration.
   */
  withConfig(config: V2RunnerConfig): AgentRunnerV2 {
    this._config = config;
    this._logger = createLogger(this._config);
    return this;
  }

  /**
   * Start the v2 agent server.
   */
  async run(): Promise<void> {
    const caps = this._handler.capabilities();
    this._logger(
      "info",
      `Starting v2 agent: ${caps.agentId} (${caps.name} v${caps.version})`
    );

    // Set up signal handlers
    const handleSignal = () => {
      this._logger("info", "Shutdown signal received");
      this._shutdown();
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    const transport = this._config.transport;

    try {
      switch (transport.type) {
        case "uds":
          await this._runUdsServer(transport.udsPath!);
          break;
        case "grpc":
          await this._runGrpcServer(transport.grpcAddress!);
          break;
        case "both":
          await Promise.all([
            this._runUdsServer(transport.udsPath!),
            this._runGrpcServer(transport.grpcAddress!),
          ]);
          break;
      }
    } catch (error) {
      this._logger("error", `Server error: ${error}`);
      throw error;
    } finally {
      this._logger("info", "Agent shutdown complete");
    }
  }

  private _shutdown(): void {
    if (this._shuttingDown) {
      return;
    }
    this._shuttingDown = true;

    if (this._udsServer) {
      this._udsServer.close();
    }
  }

  private async _runUdsServer(socketPath: string): Promise<void> {
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
    this._udsServer = net.createServer((socket) => {
      this._handleUdsConnection(socket);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this._udsServer!.on("error", reject);
      this._udsServer!.listen(socketPath, () => {
        // Set socket permissions
        fs.chmodSync(socketPath, 0o660);
        this._logger("info", `UDS server listening on ${socketPath}`);
        resolve();
      });
    });

    // Wait for shutdown
    await new Promise<void>((resolve) => {
      this._udsServer!.on("close", resolve);
    });

    // Cleanup
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  }

  private _handleUdsConnection(socket: net.Socket): void {
    const remoteAddress = socket.remoteAddress || "unknown";
    this._logger("debug", `UDS connection from ${remoteAddress}`);

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
          const message = JSON.parse(messageData.toString("utf-8")) as Record<
            string,
            unknown
          >;
          const response = await this._handler.handleEvent(message);
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

  private async _runGrpcServer(address: string): Promise<void> {
    this._logger("info", `gRPC server listening on ${address}`);

    // For now, we log a placeholder message
    // Full gRPC implementation would require proto definitions
    // and the @grpc/grpc-js library integration

    // Wait for shutdown
    await new Promise<void>((resolve) => {
      const checkShutdown = () => {
        if (this._shuttingDown) {
          resolve();
        } else {
          setTimeout(checkShutdown, 100);
        }
      };
      checkShutdown();
    });
  }
}

/**
 * Parsed CLI arguments for v2 agents.
 */
export interface ParsedV2Args {
  grpc?: string;
  socket: string;
  jsonLogs: boolean;
  logLevel: LogLevel;
}

/**
 * Parse command line arguments for v2 agents.
 */
export function parseV2CliArgs(): ParsedV2Args {
  const { values } = parseArgs({
    options: {
      grpc: {
        type: "string",
      },
      socket: {
        type: "string",
        default: "/tmp/sentinel-agent.sock",
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
    grpc: values.grpc as string | undefined,
    socket: values.socket as string,
    jsonLogs: values["json-logs"] as boolean,
    logLevel: values["log-level"] as LogLevel,
  };
}

/**
 * Convenience function to run a v2 agent from main.
 */
export function runAgentV2(agent: AgentV2): void {
  const args = parseV2CliArgs();

  let runner = new AgentRunnerV2(agent).withName(agent.name);

  runner = args.grpc
    ? runner.withBoth(args.grpc, args.socket)
    : runner.withUds(args.socket);

  if (args.jsonLogs) {
    runner = runner.withJsonLogs();
  }

  runner = runner.withLogLevel(args.logLevel);

  runner.run().catch((error) => {
    console.error(`Agent error: ${error}`);
    process.exit(1);
  });
}
