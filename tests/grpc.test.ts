/**
 * gRPC transport tests.
 *
 * Spins up a real gRPC server with a test agent and uses @grpc/grpc-js as client.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Decision } from "../src/decision.js";
import { Request } from "../src/request.js";
import { AgentV2 } from "../src/v2/agent.js";
import { AgentHandlerV2 } from "../src/v2/handler.js";
import { AgentCapabilities } from "../src/v2/types.js";
import { createGrpcServer, startGrpcServer } from "../src/v2/grpc.js";

// ---------------------------------------------------------------------------
// Test agent
// ---------------------------------------------------------------------------

class TestAgent implements AgentV2 {
  get name(): string {
    return "test-agent";
  }

  capabilities(): AgentCapabilities {
    return new AgentCapabilities("test-agent", "Test Agent", "1.0.0")
      .withGuardrails(true);
  }

  async onRequest(request: Request): Promise<Decision> {
    if (request.uri === "/block") {
      return Decision.block(403).withBody("Blocked");
    }
    return Decision.allow();
  }
}

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------

const PROTO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "v2",
  "proto",
  "agent_v2.proto"
);

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: Number,
  bytes: Buffer,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agentV2Package = (protoDescriptor.zentinel as any).agent.v2;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let server: grpc.Server;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;
let port: number;

beforeAll(async () => {
  const agent = new TestAgent();
  const handler = new AgentHandlerV2(agent);

  server = createGrpcServer({ handler });
  port = await startGrpcServer(server, "127.0.0.1:0");

  client = new agentV2Package.AgentServiceV2(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure()
  );

  // Wait for client to connect
  await new Promise<void>((resolve, reject) => {
    const deadline = new Date(Date.now() + 5000);
    client.waitForReady(deadline, (err: Error | undefined) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

afterAll(async () => {
  client?.close();
  await new Promise<void>((resolve) => {
    server.tryShutdown(() => resolve());
  });
});

// ---------------------------------------------------------------------------
// Helper to call unary RPC as a promise
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processEvent(request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.ProcessEvent(request, (err: grpc.ServiceError | null, response: any) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gRPC ProcessEvent (unary)", () => {
  it("handles handshake", async () => {
    const response = await processEvent({
      handshake: {
        supported_versions: [2],
        proxy_id: "test-proxy",
        proxy_version: "1.0.0",
      },
    });

    expect(response.message).toBe("handshake");
    expect(response.handshake.success).toBe(true);
    expect(response.handshake.protocol_version).toBe(2);
    expect(response.handshake.capabilities.name).toBe("Test Agent");
  });

  it("returns allow for normal request_headers", async () => {
    const response = await processEvent({
      request_headers: {
        metadata: {
          correlation_id: "req-1",
          request_id: "r1",
          client_ip: "127.0.0.1",
          client_port: 12345,
          protocol: "HTTP/1.1",
        },
        method: "GET",
        uri: "/hello",
        headers: [
          { name: "host", value: "example.com" },
        ],
      },
    });

    expect(response.message).toBe("response");
    expect(response.response.correlation_id).toBe("req-1");
    // Allow decision means the `allow` field is set
    expect(response.response.decision).toBe("allow");
  });

  it("returns block for /block path", async () => {
    const response = await processEvent({
      request_headers: {
        metadata: {
          correlation_id: "req-2",
          request_id: "r2",
          client_ip: "127.0.0.1",
          client_port: 12345,
          protocol: "HTTP/1.1",
        },
        method: "GET",
        uri: "/block",
        headers: [],
      },
    });

    expect(response.message).toBe("response");
    expect(response.response.correlation_id).toBe("req-2");
    expect(response.response.decision).toBe("block");
    expect(response.response.block.status).toBe(403);
    expect(response.response.block.body).toBe("Blocked");
  });

  it("handles ping", async () => {
    const now = Date.now();
    const response = await processEvent({
      ping: {
        sequence: 42,
        timestamp_ms: now,
      },
    });

    expect(response.message).toBe("pong");
    expect(response.pong.sequence).toBe(42);
    expect(response.pong.ping_timestamp_ms).toBe(now);
    expect(response.pong.timestamp_ms).toBeGreaterThanOrEqual(now);
  });
});

describe("gRPC ProcessStream (bidirectional)", () => {
  it("handles handshake then request_headers", async () => {
    const responses: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.ProcessStream();

      stream.on("data", (data: unknown) => {
        responses.push(data);
        if (responses.length === 2) {
          stream.end();
        }
      });

      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));

      // Send handshake first
      stream.write({
        handshake: {
          supported_versions: [2],
          proxy_id: "test-proxy",
          proxy_version: "1.0.0",
        },
      });

      // Then send request_headers
      stream.write({
        request_headers: {
          metadata: {
            correlation_id: "stream-1",
            request_id: "sr1",
            client_ip: "127.0.0.1",
            client_port: 12345,
            protocol: "HTTP/1.1",
          },
          method: "GET",
          uri: "/hello",
          headers: [],
        },
      });
    });

    expect(responses.length).toBe(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hsResp = responses[0] as any;
    expect(hsResp.message).toBe("handshake");
    expect(hsResp.handshake.success).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventResp = responses[1] as any;
    expect(eventResp.message).toBe("response");
    expect(eventResp.response.correlation_id).toBe("stream-1");
    expect(eventResp.response.decision).toBe("allow");
  });

  it("handles ping/pong inline", async () => {
    const responses: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.ProcessStream();

      stream.on("data", (data: unknown) => {
        responses.push(data);
        if (responses.length === 2) {
          stream.end();
        }
      });

      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));

      // Send handshake first
      stream.write({
        handshake: {
          supported_versions: [2],
          proxy_id: "test-proxy",
          proxy_version: "1.0.0",
        },
      });

      // Then ping
      stream.write({
        ping: {
          sequence: 7,
          timestamp_ms: Date.now(),
        },
      });
    });

    expect(responses.length).toBe(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pongResp = responses[1] as any;
    expect(pongResp.message).toBe("pong");
    expect(pongResp.pong.sequence).toBe(7);
  });
});

describe("gRPC graceful shutdown", () => {
  it("server shuts down gracefully", async () => {
    const agent = new TestAgent();
    const handler = new AgentHandlerV2(agent);
    const srv = createGrpcServer({ handler });
    const p = await startGrpcServer(srv, "127.0.0.1:0");
    expect(p).toBeGreaterThan(0);

    await new Promise<void>((resolve) => {
      srv.tryShutdown(() => resolve());
    });
  });
});
