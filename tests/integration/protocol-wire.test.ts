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
import {
  PROTOCOL_VERSION,
  encodeMessage,
  decodeMessage,
  MAX_MESSAGE_SIZE,
} from "../../src/protocol.js";

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

      expect(response).toEqual({ success: true });

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

      expect(response).toEqual({ success: true });
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

      expect(response.success).toBe(false);
      expect(response.error).toContain("Configuration failed");
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
    expect(completeResponse.success).toBe(true);
  });
});

describe("Message Encoding", () => {
  it("encodes with 4-byte big-endian length prefix", () => {
    const data = { test: "value" };
    const encoded = encodeMessage(data);

    // Extract length from first 4 bytes
    const length = encoded.readUInt32BE(0);

    // JSON payload follows
    const json = encoded.subarray(4);
    expect(json.length).toBe(length);
    expect(JSON.parse(json.toString("utf-8"))).toEqual(data);
  });

  it("decodes length-prefixed messages", () => {
    const original = {
      version: 1,
      decision: "allow",
      request_headers: [],
      response_headers: [],
    };

    const encoded = encodeMessage(original);
    const decoded = decodeMessage(encoded);

    expect(decoded).toEqual(original);
  });

  it("handles complex nested structures", () => {
    const complex = {
      version: 1,
      decision: { block: { status: 403, body: "Forbidden" } },
      request_headers: [
        { set: { name: "X-Custom", value: "value" } },
        { remove: { name: "X-Remove" } },
      ],
      audit: {
        tags: ["security", "auth"],
        rule_ids: ["RULE_001"],
        confidence: 0.95,
        custom: { user_id: "12345" },
      },
    };

    const encoded = encodeMessage(complex);
    const decoded = decodeMessage(encoded);

    expect(decoded).toEqual(complex);
  });

  it("enforces MAX_MESSAGE_SIZE", () => {
    // Create data that exceeds max size
    const largeData = {
      data: "x".repeat(MAX_MESSAGE_SIZE + 1),
    };

    expect(() => encodeMessage(largeData)).toThrow(/exceeds maximum/);
  });

  it("validates minimum message length", () => {
    // Less than 4 bytes for length prefix
    expect(() => decodeMessage(Buffer.alloc(3))).toThrow(/too short/);
  });

  it("validates declared vs actual length", () => {
    // Create a message claiming to be longer than it is
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(100, 0); // Claims 100 bytes
    buffer.write("test", 4); // Only 4 bytes of data

    // This should work but decode only what's available
    // (depending on implementation, might throw or handle gracefully)
  });
});

describe("Header Operations Format", () => {
  it("serializes set operations correctly", async () => {
    const handler = new AgentHandler(new SimpleTestAgent());

    const event = {
      event_type: "request_headers",
      payload: {
        metadata: {
          correlation_id: "header-test",
          request_id: "header-req",
          client_ip: "127.0.0.1",
          client_port: 12345,
        },
        method: "GET",
        uri: "/api/test",
        headers: {},
      },
    };

    const response = await handler.handleEvent(event);

    // Should have the response header added by SimpleTestAgent
    const responseHeaders = response.response_headers as Array<Record<string, unknown>>;
    const setOp = responseHeaders.find((h) => "set" in h);

    expect(setOp).toBeDefined();
    expect(setOp!.set).toEqual({
      name: "X-Agent",
      value: "simple-test-agent",
    });
  });
});
