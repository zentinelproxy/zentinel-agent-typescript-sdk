/**
 * The v2 UDS transport over a real Unix socket, driven the way the proxy
 * (`zentinel-agent-protocol`'s `AgentClientV2Uds`) drives it.
 *
 * The end-to-end check is the conformance harness in CI, against a real
 * zentinel binary; these tests pin the wire details it depends on.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { Agent, Decision, Request } from "../src/index.js";
import { AgentRunner } from "../src/runner.js";
import { AgentCapabilities, AgentRunnerV2, AgentV2 } from "../src/v2/index.js";
import { encodeFrame, Frame, FrameDecoder, MessageType } from "../src/v2/uds.js";

class WireAgent implements AgentV2 {
  config: Record<string, unknown> | undefined;
  configures = 0;
  rejectConfig = false;

  get name(): string {
    return "wire";
  }

  capabilities(): AgentCapabilities {
    return new AgentCapabilities("wire", "Wire agent", "1.2.3");
  }

  async onConfigure(config: Record<string, unknown>): Promise<void> {
    this.configures += 1;
    if (this.rejectConfig) {
      throw new Error("bad config");
    }
    this.config = config;
  }

  async onRequest(request: Request): Promise<Decision> {
    if (request.pathStartsWith("/block")) {
      return Decision.block(403).withBody("blocked");
    }
    return Decision.allow().addRequestHeader("X-Hello", "from-agent");
  }

  async onRequestBody(request: Request): Promise<Decision> {
    return Decision.block(403).withBody(`body:${request.bodyStr}`);
  }
}

/** A minimal proxy-side client. */
class FakeProxy {
  private readonly decoder = new FrameDecoder();
  private readonly frames: Frame[] = [];
  private waiters: Array<() => void> = [];
  closed = false;

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (data) => {
      this.frames.push(...this.decoder.push(data));
      this.waiters.splice(0).forEach((w) => w());
    });
    socket.on("close", () => {
      this.closed = true;
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static connect(socketPath: string): Promise<FakeProxy> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath, () => resolve(new FakeProxy(socket)));
      socket.on("error", reject);
    });
  }

  send(type: number, payload: Record<string, unknown>): void {
    this.socket.write(encodeFrame(type, payload));
  }

  async next(timeoutMs = 2000): Promise<{ type: number; json: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    while (this.frames.length === 0) {
      if (this.closed) throw new Error("socket closed");
      if (Date.now() > deadline) throw new Error("timed out waiting for a frame");
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    const frame = this.frames.shift()!;
    return { type: frame.type, json: JSON.parse(frame.payload.toString("utf-8") || "null") };
  }

  async handshake(config: Record<string, unknown> | null = null) {
    // Byte for byte what the proxy's UdsHandshakeRequest serializes to.
    this.send(MessageType.HandshakeRequest, {
      supported_versions: [2],
      proxy_id: "zentinel-proxy",
      proxy_version: "0.6.50",
      config,
      supported_encodings: ["json"],
    });
    return this.next();
  }

  close(): void {
    this.socket.destroy();
  }
}

let dir: string;
let socketPath: string;
let agent: WireAgent;
let runner: AgentRunnerV2;
let running: Promise<void>;

async function waitForSocket(p: string): Promise<void> {
  for (let i = 0; i < 100 && !fs.existsSync(p); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zuds-"));
  socketPath = path.join(dir, "a.sock");
  agent = new WireAgent();
  runner = new AgentRunnerV2(agent).withUds(socketPath).withLogLevel("error");
  running = runner.run();
  await waitForSocket(socketPath);
});

afterEach(async () => {
  process.emit("SIGTERM");
  await running;
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("UDS handshake", () => {
  it("answers with the proxy's UdsHandshakeResponse schema, nothing null", async () => {
    const proxy = await FakeProxy.connect(socketPath);
    const { type, json } = await proxy.handshake();
    proxy.close();

    expect(type).toBe(MessageType.HandshakeResponse);
    expect(json.protocol_version).toBe(2);
    expect(json.success).toBe(true);
    expect(json.error).toBeNull();
    expect(json.encoding).toBe("json");
    const caps = json.capabilities as Record<string, unknown>;
    expect(caps).toMatchObject({ agent_id: "wire", name: "Wire agent", version: "1.2.3" });
    // UDS EventType numbers: request_headers = 1, request_body_chunk = 2
    expect(caps.supported_events).toEqual([1, 2]);
    for (const key of [
      "streaming_body",
      "websocket",
      "guardrails",
      "config_push",
      "metrics_export",
      "concurrent_requests",
      "cancellation",
      "flow_control",
      "health_reporting",
    ]) {
      expect((caps.features as Record<string, unknown>)[key], key).not.toBeUndefined();
      expect((caps.features as Record<string, unknown>)[key], key).not.toBeNull();
    }
    for (const key of ["max_body_size", "max_concurrency", "preferred_chunk_size"]) {
      expect(typeof (caps.limits as Record<string, unknown>)[key], key).toBe("number");
    }
  });

  it("does not apply the handshake's config: the Configure message does", async () => {
    const proxy = await FakeProxy.connect(socketPath);
    await proxy.handshake({ nested: { value: "from-handshake" } });
    proxy.close();
    expect(agent.configures).toBe(0);
  });
});

describe("UDS events", () => {
  it("acknowledges Configure with an allow carrying its correlation id", async () => {
    const proxy = await FakeProxy.connect(socketPath);
    await proxy.handshake({ nested: { value: "v" } });
    proxy.send(MessageType.Configure, {
      config: { nested: { value: "v" } },
      config_version: null,
      correlation_id: "zentinel-configure-a-0",
    });
    const { type, json } = await proxy.next();
    proxy.close();

    expect(type).toBe(MessageType.AgentResponse);
    expect(json.decision).toBe("allow");
    expect(json.version).toBe(2);
    expect((json.audit as Record<string, Record<string, unknown>>).custom.correlation_id).toBe(
      "zentinel-configure-a-0"
    );
    expect(agent.config).toEqual({ nested: { value: "v" } });
  });

  it("rejects a configuration the agent refuses with a block", async () => {
    agent.rejectConfig = true;
    const proxy = await FakeProxy.connect(socketPath);
    await proxy.handshake();
    proxy.send(MessageType.Configure, { config: {}, correlation_id: "c1" });
    const { json } = await proxy.next();
    proxy.close();
    expect(json.decision).toEqual({ block: { status: 500, body: "Configuration rejected" } });
  });

  it("answers request headers, body chunks and pings in the proxy's format", async () => {
    const proxy = await FakeProxy.connect(socketPath);
    await proxy.handshake();

    proxy.send(MessageType.RequestHeaders, {
      metadata: {
        correlation_id: "r1",
        request_id: "r1",
        client_ip: "127.0.0.1",
        client_port: 1,
        server_name: null,
        protocol: "HTTP/1.1",
        tls_version: null,
        tls_cipher: null,
        route_id: "all",
        upstream_id: null,
        timestamp: "2026-10-22T00:00:00Z",
      },
      method: "GET",
      uri: "/hello",
      headers: { host: ["x"] },
      correlation_id: "r1",
    });
    let reply = await proxy.next();
    expect(reply.type).toBe(MessageType.AgentResponse);
    expect(reply.json.request_headers).toEqual([
      { set: { name: "X-Hello", value: "from-agent" } },
    ]);
    expect((reply.json.audit as Record<string, Record<string, unknown>>).custom.correlation_id).toBe(
      "r1"
    );

    proxy.send(MessageType.RequestBodyChunk, {
      correlation_id: "r1",
      data: Buffer.from("hello ").toString("base64"),
      is_last: false,
      total_size: null,
      chunk_index: 0,
      bytes_received: 6,
    });
    reply = await proxy.next();
    expect(reply.json.needs_more).toBe(true);
    proxy.send(MessageType.RequestBodyChunk, {
      correlation_id: "r1",
      data: Buffer.from("world").toString("base64"),
      is_last: true,
      total_size: 11,
      chunk_index: 1,
      bytes_received: 11,
    });
    reply = await proxy.next();
    expect(reply.json.decision).toEqual({ block: { status: 403, body: "body:hello world" } });

    proxy.send(MessageType.Ping, { sequence: 3 });
    reply = await proxy.next();
    expect(reply.type).toBe(MessageType.Pong);
    expect(reply.json).toEqual({ sequence: 3 });
    proxy.close();
  });

  it("handles frames that arrive together with the handshake", async () => {
    const proxy = await FakeProxy.connect(socketPath);
    // Handshake and Configure in a single write.
    const socket = (proxy as unknown as { socket: net.Socket }).socket;
    socket.write(
      Buffer.concat([
        encodeFrame(MessageType.HandshakeRequest, {
          supported_versions: [2],
          proxy_id: "p",
          proxy_version: "0",
          config: null,
        }),
        encodeFrame(MessageType.Configure, { config: { a: 1 }, correlation_id: "c" }),
      ])
    );
    expect((await proxy.next()).type).toBe(MessageType.HandshakeResponse);
    expect((await proxy.next()).json.decision).toBe("allow");
    proxy.close();
  });
});

describe("root runAgent / AgentRunner", () => {
  it("speaks v2 for agents written against the root Agent interface", async () => {
    class PlainAgent implements Agent {
      get name(): string {
        return "plain";
      }
      async onRequest(): Promise<Decision> {
        return Decision.allow().addRequestHeader("X-Plain", "yes");
      }
    }
    const plainPath = path.join(dir, "plain.sock");
    const plain = new AgentRunner(new PlainAgent()).withSocket(plainPath).withLogLevel("error");
    const plainRunning = plain.run();
    await waitForSocket(plainPath);

    const proxy = await FakeProxy.connect(plainPath);
    const hs = await proxy.handshake();
    expect(hs.type).toBe(MessageType.HandshakeResponse);
    expect((hs.json.capabilities as Record<string, unknown>).agent_id).toBe("plain");
    proxy.send(MessageType.RequestHeaders, {
      metadata: { correlation_id: "p1", request_id: "p1", client_ip: "", client_port: 0, protocol: "HTTP/1.1" },
      method: "GET",
      uri: "/",
      headers: {},
    });
    const reply = await proxy.next();
    expect(reply.json.request_headers).toEqual([{ set: { name: "X-Plain", value: "yes" } }]);
    proxy.close();

    process.emit("SIGTERM");
    await plainRunning;
  });
});
