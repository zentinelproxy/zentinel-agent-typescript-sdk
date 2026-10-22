/**
 * Wire protocol integration tests.
 *
 * Tests the AgentHandler event routing and message handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Agent, Decision } from "../../src/index.js";
import { AgentHandler } from "../../src/handler.js";
import { Request } from "../../src/request.js";
import { Response } from "../../src/response.js";
import { PROTOCOL_VERSION } from "../../src/protocol.js";
import { encodeFrame, FrameDecoder, MessageType } from "../../src/v2/uds.js";
import { MAX_MESSAGE_SIZE_UDS } from "../../src/v2/types.js";

// Test agent that blocks /block paths and allows everything else
class SimpleTestAgent implements Agent {
  get name() {
    return "simple-test-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    if (request.pathStartsWith("/block")) {
      return Decision.deny()
        .withBody("Path blocked")
        .withTag("blocked");
    }
    return Decision.allow()
      .addResponseHeader("X-Agent", "simple-test-agent")
      .withTag("allowed");
  }

  async onResponse(request: Request, _response: Response): Promise<Decision> {
    return Decision.allow()
      .addResponseHeader("X-Request-Path", request.path);
  }

  async onRequestComplete(
    _request: Request,
    _status: number,
    _durationMs: number
  ): Promise<void> {
    // Log completion (no-op for tests)
  }
}

describe("AgentHandler", () => {
  let handler: AgentHandler;

  beforeEach(() => {
    handler = new AgentHandler(new SimpleTestAgent());
  });

  describe("request headers event", () => {
    it("handles allow decision", async () => {
      const event = {
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "test-corr-id",
            request_id: "test-req-id",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "GET",
          uri: "/api/users",
          headers: {},
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.version).toBe(PROTOCOL_VERSION);
      expect(response.decision).toBe("allow");
      expect(response.audit).toEqual({ tags: ["allowed"] });
      expect(response.response_headers).toContainEqual({
        set: { name: "X-Agent", value: "simple-test-agent" },
      });
    });

    it("handles block decision", async () => {
      const event = {
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "test-corr-id",
            request_id: "test-req-id",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "GET",
          uri: "/block/admin",
          headers: {},
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toEqual({
        block: { status: 403, body: "Path blocked" },
      });
      expect(response.audit).toEqual({ tags: ["blocked"] });
    });
  });

  describe("request body chunk event", () => {
    it("returns needs_more for non-final chunks", async () => {
      // First send request headers to cache the request
      await handler.handleEvent({
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "body-test-corr",
            request_id: "body-test-req",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "POST",
          uri: "/api/data",
          headers: {},
        },
      });

      // Then send a non-final body chunk
      const event = {
        event_type: "request_body_chunk",
        payload: {
          correlation_id: "body-test-corr",
          data: Buffer.from("partial data").toString("base64"),
          chunk_index: 0,
          is_last: false,
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toBe("allow");
      expect(response.needs_more).toBe(true);
    });

    it("processes final chunk", async () => {
      // First send request headers
      await handler.handleEvent({
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "final-chunk-corr",
            request_id: "final-chunk-req",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "POST",
          uri: "/api/data",
          headers: {},
        },
      });

      // Then send the final body chunk
      const event = {
        event_type: "request_body_chunk",
        payload: {
          correlation_id: "final-chunk-corr",
          data: Buffer.from("complete body").toString("base64"),
          chunk_index: 0,
          is_last: true,
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toBe("allow");
      expect(response.needs_more).toBe(false);
    });
  });

  describe("response headers event", () => {
    it("handles response headers with cached request", async () => {
      // First send request headers to cache the request
      await handler.handleEvent({
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "response-test-corr",
            request_id: "response-test-req",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "GET",
          uri: "/api/users",
          headers: {},
        },
      });

      // Then send response headers
      const event = {
        event_type: "response_headers",
        payload: {
          correlation_id: "response-test-corr",
          status: 200,
          headers: {
            "Content-Type": ["application/json"],
          },
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toBe("allow");
      expect(response.response_headers).toContainEqual({
        set: { name: "X-Request-Path", value: "/api/users" },
      });
    });

    it("allows unknown correlation IDs gracefully", async () => {
      const event = {
        event_type: "response_headers",
        payload: {
          correlation_id: "unknown-corr-id",
          status: 200,
          headers: {},
        },
      };

      const response = await handler.handleEvent(event);

      // Should return allow (graceful fallback)
      expect(response.decision).toBe("allow");
    });
  });

  describe("response body chunk event", () => {
    it("processes response body chunks", async () => {
      // Setup request and response
      await handler.handleEvent({
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "resp-body-corr",
            request_id: "resp-body-req",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "GET",
          uri: "/api/data",
          headers: {},
        },
      });

      await handler.handleEvent({
        event_type: "response_headers",
        payload: {
          correlation_id: "resp-body-corr",
          status: 200,
          headers: {},
        },
      });

      // Send response body chunk
      const event = {
        event_type: "response_body_chunk",
        payload: {
          correlation_id: "resp-body-corr",
          data: Buffer.from('{"result":"ok"}').toString("base64"),
          chunk_index: 0,
          is_last: true,
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toBe("allow");
    });
  });

  describe("request complete event", () => {
    it("cleans up cached request", async () => {
      // Setup request
      await handler.handleEvent({
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "complete-test-corr",
            request_id: "complete-test-req",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "GET",
          uri: "/api/users",
          headers: {},
        },
      });

      // Send request complete
      const event = {
        event_type: "request_complete",
        payload: {
          correlation_id: "complete-test-corr",
          status: 200,
          duration_ms: 100,
          request_size: 0,
          response_size: 1024,
        },
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toBe("allow");

      // Subsequent response headers should not find cached request
      const laterResponse = await handler.handleEvent({
        event_type: "response_headers",
        payload: {
          correlation_id: "complete-test-corr",
          status: 200,
          headers: {},
        },
      });

      // Should still allow but without the cached request context
      expect(laterResponse.decision).toBe("allow");
    });
  });

  describe("configure event", () => {
    it("handles configuration", async () => {
      const event = {
        event_type: "configure",
        payload: {
          agent_id: "test-agent-001",
          config: {
            enabled: true,
            threshold: 100,
          },
        },
      };

      const response = await handler.handleEvent(event);

      // The proxy reads an agent response; allow means accepted.
      expect(response.decision).toBe("allow");
      expect(response.version).toBe(PROTOCOL_VERSION);
    });

    it("handles configuration errors gracefully", async () => {
      // Create an agent that throws on configure
      class FailingConfigAgent implements Agent {
        get name() { return "failing-config-agent"; }
        async onConfigure(_config: Record<string, unknown>): Promise<void> {
          throw new Error("Configuration failed");
        }
      }

      const failingHandler = new AgentHandler(new FailingConfigAgent());

      const event = {
        event_type: "configure",
        payload: {
          agent_id: "test-agent-001",
          config: { invalid: true },
        },
      };

      const response = await failingHandler.handleEvent(event);

      // A rejection is a block, which makes the proxy drop the connection.
      expect(response.decision).toEqual({
        block: { status: 500, body: "Configuration rejected" },
      });
    });
  });

  describe("unknown event type", () => {
    it("returns allow for unknown events", async () => {
      const event = {
        event_type: "unknown_event_type",
        payload: {},
      };

      const response = await handler.handleEvent(event);

      expect(response.decision).toBe("allow");
    });
  });

  describe("error handling", () => {
    it("returns allow on handler errors", async () => {
      // Create an agent that throws on request
      class ThrowingAgent implements Agent {
        get name() { return "throwing-agent"; }
        async onRequest(_request: Request): Promise<Decision> {
          throw new Error("Handler error");
        }
      }

      const throwingHandler = new AgentHandler(new ThrowingAgent());

      const event = {
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: "error-test",
            request_id: "error-req",
            client_ip: "127.0.0.1",
            client_port: 12345,
          },
          method: "GET",
          uri: "/api",
          headers: {},
        },
      };

      const response = await throwingHandler.handleEvent(event);

      // Should gracefully fall back to allow
      expect(response.decision).toBe("allow");
    });
  });
});

describe("Wire Protocol Round-Trip", () => {
  let handler: AgentHandler;

  beforeEach(() => {
    handler = new AgentHandler(new SimpleTestAgent());
  });

  it("handles full request lifecycle", async () => {
    const correlationId = "lifecycle-test-corr";

    // 1. Request headers
    const requestHeadersEvent = {
      event_type: "request_headers",
      payload: {
        metadata: {
          correlation_id: correlationId,
          request_id: "lifecycle-req",
          client_ip: "192.168.1.100",
          client_port: 54321,
        },
        method: "POST",
        uri: "/api/users",
        headers: {
          "Content-Type": ["application/json"],
          "Authorization": ["Bearer token123"],
        },
      },
    };

    const requestResponse = await handler.handleEvent(requestHeadersEvent);
    expect(requestResponse.decision).toBe("allow");

    // 2. Request body
    const requestBodyEvent = {
      event_type: "request_body_chunk",
      payload: {
        correlation_id: correlationId,
        data: Buffer.from('{"name":"test"}').toString("base64"),
        chunk_index: 0,
        is_last: true,
      },
    };

    const bodyResponse = await handler.handleEvent(requestBodyEvent);
    expect(bodyResponse.decision).toBe("allow");

    // 3. Response headers
    const responseHeadersEvent = {
      event_type: "response_headers",
      payload: {
        correlation_id: correlationId,
        status: 201,
        headers: {
          "Content-Type": ["application/json"],
          "Location": ["/api/users/123"],
        },
      },
    };

    const responseResponse = await handler.handleEvent(responseHeadersEvent);
    expect(responseResponse.decision).toBe("allow");

    // 4. Response body
    const responseBodyEvent = {
      event_type: "response_body_chunk",
      payload: {
        correlation_id: correlationId,
        data: Buffer.from('{"id":"123","name":"test"}').toString("base64"),
        chunk_index: 0,
        is_last: true,
      },
    };

    const respBodyResponse = await handler.handleEvent(responseBodyEvent);
    expect(respBodyResponse.decision).toBe("allow");

    // 5. Request complete
    const completeEvent = {
      event_type: "request_complete",
      payload: {
        correlation_id: correlationId,
        status: 201,
        duration_ms: 50,
        request_size: 15,
        response_size: 26,
      },
    };

    const completeResponse = await handler.handleEvent(completeEvent);
    expect(completeResponse.decision).toBe("allow");
  });
});

describe("Message Encoding (v2 UDS framing)", () => {
  it("prefixes a 4-byte big-endian length that counts the type byte", () => {
    const data = { test: "value" };
    const encoded = encodeFrame(MessageType.AgentResponse, data);

    expect(encoded.readUInt32BE(0)).toBe(encoded.length - 4);
    expect(encoded.readUInt8(4)).toBe(0x20);
    expect(JSON.parse(encoded.subarray(5).toString("utf-8"))).toEqual(data);
  });

  it("decodes frames split across reads and several in one read", () => {
    const a = encodeFrame(MessageType.Ping, { n: 1 });
    const b = encodeFrame(MessageType.Configure, { config: { nested: { v: 2 } } });
    const both = Buffer.concat([a, b]);
    const decoder = new FrameDecoder();

    expect(decoder.push(both.subarray(0, 3))).toEqual([]);
    const frames = decoder.push(both.subarray(3));
    expect(frames.map((f) => f.type)).toEqual([0x41, 0x17]);
    expect(JSON.parse(frames[1].payload.toString())).toEqual({ config: { nested: { v: 2 } } });
  });

  it("enforces the 16 MB UDS limit", () => {
    const largeData = { data: "x".repeat(MAX_MESSAGE_SIZE_UDS + 1) };
    expect(() => encodeFrame(MessageType.AgentResponse, largeData)).toThrow(/exceeds maximum/);

    const header = Buffer.alloc(5);
    header.writeUInt32BE(MAX_MESSAGE_SIZE_UDS + 2, 0);
    expect(() => new FrameDecoder().push(header)).toThrow(/exceeds maximum/);
  });

  it("rejects a zero-length frame", () => {
    expect(() => new FrameDecoder().push(Buffer.alloc(4))).toThrow(/Zero-length/);
  });
});
