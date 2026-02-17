/**
 * Protocol conformance tests.
 *
 * These tests verify that the TypeScript SDK serializes data in a format
 * compatible with the Rust Zentinel proxy (using serde JSON).
 */

import { describe, it, expect } from "vitest";
import { Decision } from "../src/decision.js";
import {
  PROTOCOL_VERSION,
  agentResponseToDict,
  headerOpToDict,
  auditMetadataToDict,
  parseRequestHeadersEvent,
  parseRequestBodyChunkEvent,
  parseResponseHeadersEvent,
  parseResponseBodyChunkEvent,
  parseRequestCompleteEvent,
  parseConfigureEvent,
  encodeMessage,
  decodeMessage,
  MAX_MESSAGE_SIZE,
} from "../src/protocol.js";

describe("Protocol Version", () => {
  it("should be version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("should include version in agent response", () => {
    const response = Decision.allow().build();
    expect(response.version).toBe(1);
  });
});

describe("Decision Serialization", () => {
  describe("allow decision", () => {
    it("serializes to string 'allow'", () => {
      const response = Decision.allow().build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toBe("allow");
    });
  });

  describe("block decision", () => {
    it("uses nested object format { block: { status } }", () => {
      const response = Decision.block(403).build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({ block: { status: 403 } });
    });

    it("includes body in block object", () => {
      const response = Decision.block(403).withBody("Forbidden").build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({
        block: { status: 403, body: "Forbidden" },
      });
    });

    it("includes headers in block object", () => {
      const response = Decision.block(403)
        .withBlockHeader("X-Custom", "value")
        .build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({
        block: { status: 403, headers: { "X-Custom": "value" } },
      });
    });
  });

  describe("redirect decision", () => {
    it("uses nested object format { redirect: { url, status } }", () => {
      const response = Decision.redirect("https://example.com", 302).build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({
        redirect: { url: "https://example.com", status: 302 },
      });
    });

    it("uses status 301 for permanent redirects", () => {
      const response = Decision.redirectPermanent("https://example.com").build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({
        redirect: { url: "https://example.com", status: 301 },
      });
    });
  });

  describe("challenge decision", () => {
    it("uses nested object format { challenge: { challenge_type, params } }", () => {
      const response = Decision.challenge("captcha", { difficulty: "hard" }).build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({
        challenge: {
          challenge_type: "captcha",
          params: { difficulty: "hard" },
        },
      });
    });

    it("omits params when not provided", () => {
      const response = Decision.challenge("captcha").build();
      const dict = agentResponseToDict(response);
      expect(dict.decision).toEqual({
        challenge: { challenge_type: "captcha" },
      });
    });
  });
});

describe("Header Operation Serialization", () => {
  it("serializes set operation as { set: { name, value } }", () => {
    const op = { operation: "set" as const, name: "X-Custom", value: "value" };
    const dict = headerOpToDict(op);
    expect(dict).toEqual({ set: { name: "X-Custom", value: "value" } });
  });

  it("serializes add operation as { add: { name, value } }", () => {
    const op = { operation: "add" as const, name: "X-Custom", value: "value" };
    const dict = headerOpToDict(op);
    expect(dict).toEqual({ add: { name: "X-Custom", value: "value" } });
  });

  it("serializes remove operation as { remove: { name } }", () => {
    const op = { operation: "remove" as const, name: "X-Custom" };
    const dict = headerOpToDict(op);
    expect(dict).toEqual({ remove: { name: "X-Custom" } });
  });
});

describe("Agent Response Serialization", () => {
  it("includes all required fields", () => {
    const response = Decision.allow().build();
    const dict = agentResponseToDict(response);

    expect(dict).toHaveProperty("version");
    expect(dict).toHaveProperty("decision");
    expect(dict).toHaveProperty("request_headers");
    expect(dict).toHaveProperty("response_headers");
    expect(dict).toHaveProperty("routing_metadata");
    expect(dict).toHaveProperty("audit");
    expect(dict).toHaveProperty("needs_more");
    expect(dict).toHaveProperty("request_body_mutation");
    expect(dict).toHaveProperty("response_body_mutation");
    expect(dict).toHaveProperty("websocket_decision");
  });

  it("serializes version correctly", () => {
    const response = Decision.allow().build();
    const dict = agentResponseToDict(response);
    expect(dict.version).toBe(PROTOCOL_VERSION);
  });

  it("serializes header operations in request_headers array", () => {
    const response = Decision.allow()
      .addRequestHeader("X-Added", "value")
      .removeRequestHeader("X-Removed")
      .build();
    const dict = agentResponseToDict(response);

    expect(dict.request_headers).toEqual([
      { set: { name: "X-Added", value: "value" } },
      { remove: { name: "X-Removed" } },
    ]);
  });

  it("serializes header operations in response_headers array", () => {
    const response = Decision.allow()
      .addResponseHeader("X-Added", "value")
      .build();
    const dict = agentResponseToDict(response);

    expect(dict.response_headers).toEqual([
      { set: { name: "X-Added", value: "value" } },
    ]);
  });

  it("serializes routing_metadata as object", () => {
    const response = Decision.allow()
      .withRoutingMetadata("upstream", "backend-1")
      .withRoutingMetadata("weight", "10")
      .build();
    const dict = agentResponseToDict(response);

    expect(dict.routing_metadata).toEqual({
      upstream: "backend-1",
      weight: "10",
    });
  });

  it("serializes needs_more as boolean", () => {
    const response = Decision.allow().needsMoreData().build();
    const dict = agentResponseToDict(response);
    expect(dict.needs_more).toBe(true);
  });
});

describe("Audit Metadata Serialization", () => {
  it("omits empty arrays from output", () => {
    const response = Decision.allow().build();
    const dict = agentResponseToDict(response);
    expect(dict.audit).toEqual({});
  });

  it("includes tags when present", () => {
    const response = Decision.allow().withTag("security").build();
    const dict = agentResponseToDict(response);
    expect(dict.audit).toEqual({ tags: ["security"] });
  });

  it("serializes rule_ids with snake_case key", () => {
    const response = Decision.allow().withRuleId("RULE_001").build();
    const dict = agentResponseToDict(response);
    expect(dict.audit).toEqual({ rule_ids: ["RULE_001"] });
  });

  it("includes confidence when set", () => {
    const response = Decision.allow().withConfidence(0.95).build();
    const dict = agentResponseToDict(response);
    expect(dict.audit).toEqual({ confidence: 0.95 });
  });

  it("serializes reason_codes with snake_case key", () => {
    const response = Decision.allow().withReasonCode("BLOCKED").build();
    const dict = agentResponseToDict(response);
    expect(dict.audit).toEqual({ reason_codes: ["BLOCKED"] });
  });

  it("includes custom metadata", () => {
    const response = Decision.allow()
      .withMetadata("user_id", "12345")
      .withMetadata("action", "login")
      .build();
    const dict = agentResponseToDict(response);
    expect(dict.audit).toEqual({
      custom: { user_id: "12345", action: "login" },
    });
  });

  it("includes all audit fields when present", () => {
    const response = Decision.allow()
      .withTag("security")
      .withRuleId("RULE_001")
      .withConfidence(0.95)
      .withReasonCode("BLOCKED")
      .withMetadata("key", "value")
      .build();
    const dict = agentResponseToDict(response);

    expect(dict.audit).toEqual({
      tags: ["security"],
      rule_ids: ["RULE_001"],
      confidence: 0.95,
      reason_codes: ["BLOCKED"],
      custom: { key: "value" },
    });
  });
});

describe("Event Deserialization", () => {
  describe("RequestHeadersEvent", () => {
    it("parses full event with metadata", () => {
      const data = {
        metadata: {
          correlation_id: "corr-123",
          request_id: "req-456",
          client_ip: "192.168.1.1",
          client_port: 54321,
          server_name: "api.example.com",
          protocol: "HTTP/2",
          tls_version: "TLSv1.3",
          tls_cipher: "TLS_AES_256_GCM_SHA384",
          route_id: "route-789",
          upstream_id: "upstream-101",
          timestamp: "2024-01-15T10:30:00Z",
          traceparent: "00-abc123-def456-01",
        },
        method: "POST",
        uri: "/api/users?page=1",
        headers: {
          "Content-Type": ["application/json"],
          "Accept": ["application/json", "text/plain"],
        },
      };

      const event = parseRequestHeadersEvent(data);

      expect(event.metadata.correlationId).toBe("corr-123");
      expect(event.metadata.requestId).toBe("req-456");
      expect(event.metadata.clientIp).toBe("192.168.1.1");
      expect(event.metadata.clientPort).toBe(54321);
      expect(event.metadata.serverName).toBe("api.example.com");
      expect(event.metadata.protocol).toBe("HTTP/2");
      expect(event.metadata.tlsVersion).toBe("TLSv1.3");
      expect(event.metadata.tlsCipher).toBe("TLS_AES_256_GCM_SHA384");
      expect(event.metadata.routeId).toBe("route-789");
      expect(event.metadata.upstreamId).toBe("upstream-101");
      expect(event.metadata.timestamp).toBe("2024-01-15T10:30:00Z");
      expect(event.metadata.traceparent).toBe("00-abc123-def456-01");
      expect(event.method).toBe("POST");
      expect(event.uri).toBe("/api/users?page=1");
      expect(event.headers).toEqual({
        "Content-Type": ["application/json"],
        "Accept": ["application/json", "text/plain"],
      });
    });

    it("handles missing optional metadata fields", () => {
      const data = {
        metadata: {
          correlation_id: "corr-123",
          request_id: "req-456",
          client_ip: "127.0.0.1",
          client_port: 12345,
        },
        method: "GET",
        uri: "/",
        headers: {},
      };

      const event = parseRequestHeadersEvent(data);

      expect(event.metadata.correlationId).toBe("corr-123");
      expect(event.metadata.serverName).toBeUndefined();
      expect(event.metadata.tlsVersion).toBeUndefined();
      expect(event.metadata.protocol).toBe("HTTP/1.1"); // Default
    });
  });

  describe("RequestBodyChunkEvent", () => {
    it("parses event with base64 encoded data", () => {
      const data = {
        correlation_id: "corr-123",
        data: Buffer.from("Hello, World!").toString("base64"),
        chunk_index: 0,
        is_last: true,
        total_size: 13,
        bytes_received: 13,
      };

      const event = parseRequestBodyChunkEvent(data);

      expect(event.correlationId).toBe("corr-123");
      expect(event.data.toString()).toBe("Hello, World!");
      expect(event.chunkIndex).toBe(0);
      expect(event.isLast).toBe(true);
      expect(event.totalSize).toBe(13);
      expect(event.bytesReceived).toBe(13);
    });

    it("handles empty data", () => {
      const data = {
        correlation_id: "corr-123",
        data: "",
        chunk_index: 0,
        is_last: true,
      };

      const event = parseRequestBodyChunkEvent(data);
      expect(event.data.length).toBe(0);
    });
  });

  describe("ResponseHeadersEvent", () => {
    it("parses event with status and headers", () => {
      const data = {
        correlation_id: "corr-123",
        status: 200,
        headers: {
          "Content-Type": ["application/json"],
          "X-Custom": ["value"],
        },
      };

      const event = parseResponseHeadersEvent(data);

      expect(event.correlationId).toBe("corr-123");
      expect(event.status).toBe(200);
      expect(event.headers).toEqual({
        "Content-Type": ["application/json"],
        "X-Custom": ["value"],
      });
    });
  });

  describe("ResponseBodyChunkEvent", () => {
    it("parses event with base64 encoded data", () => {
      const data = {
        correlation_id: "corr-123",
        data: Buffer.from('{"result":"ok"}').toString("base64"),
        chunk_index: 0,
        is_last: true,
      };

      const event = parseResponseBodyChunkEvent(data);

      expect(event.correlationId).toBe("corr-123");
      expect(event.data.toString()).toBe('{"result":"ok"}');
      expect(event.isLast).toBe(true);
    });
  });

  describe("RequestCompleteEvent", () => {
    it("parses event with all fields", () => {
      const data = {
        correlation_id: "corr-123",
        status: 200,
        duration_ms: 150,
        request_size: 1024,
        response_size: 2048,
        error: null,
      };

      const event = parseRequestCompleteEvent(data);

      expect(event.correlationId).toBe("corr-123");
      expect(event.status).toBe(200);
      expect(event.durationMs).toBe(150);
      expect(event.requestSize).toBe(1024);
      expect(event.responseSize).toBe(2048);
      expect(event.error).toBeFalsy(); // null or undefined
    });

    it("parses event with error", () => {
      const data = {
        correlation_id: "corr-123",
        status: 0,
        duration_ms: 50,
        request_size: 100,
        response_size: 0,
        error: "Connection timeout",
      };

      const event = parseRequestCompleteEvent(data);
      expect(event.error).toBe("Connection timeout");
    });
  });

  describe("ConfigureEvent", () => {
    it("parses event with config", () => {
      const data = {
        agent_id: "agent-001",
        config: {
          enabled: true,
          threshold: 100,
          blocked_paths: ["/admin", "/secret"],
        },
      };

      const event = parseConfigureEvent(data);

      expect(event.agentId).toBe("agent-001");
      expect(event.config).toEqual({
        enabled: true,
        threshold: 100,
        blocked_paths: ["/admin", "/secret"],
      });
    });
  });
});

describe("Agent Request Envelope", () => {
  it("uses snake_case for event types", () => {
    // These are the event type strings expected in the envelope
    const eventTypes = [
      "request_headers",
      "request_body_chunk",
      "response_headers",
      "response_body_chunk",
      "request_complete",
      "websocket_frame",
      "configure",
    ];

    // All should be snake_case
    eventTypes.forEach((type) => {
      expect(type).toMatch(/^[a-z]+(_[a-z]+)*$/);
    });
  });
});

describe("Body Mutation Format", () => {
  it("serializes body mutation with base64 data", () => {
    const response = Decision.allow()
      .withRequestBodyMutation(Buffer.from("modified"), 0)
      .build();
    const dict = agentResponseToDict(response);

    expect(dict.request_body_mutation).toEqual({
      data: Buffer.from("modified").toString("base64"),
      chunk_index: 0,
    });
  });

  it("serializes pass-through mutation with null data", () => {
    const response = Decision.allow()
      .withRequestBodyMutation(null, 0)
      .build();
    const dict = agentResponseToDict(response);

    expect(dict.request_body_mutation).toEqual({
      data: null,
      chunk_index: 0,
    });
  });
});

describe("Wire Format", () => {
  describe("message encoding", () => {
    it("uses 4-byte big-endian length prefix", () => {
      const data = { version: 1, decision: "allow" };
      const encoded = encodeMessage(data);

      // First 4 bytes are the length prefix
      const length = encoded.readUInt32BE(0);
      expect(length).toBe(encoded.length - 4);

      // Remaining bytes are JSON
      const json = encoded.subarray(4).toString("utf-8");
      expect(JSON.parse(json)).toEqual(data);
    });

    it("decodes length-prefixed message", () => {
      const original = { version: 1, decision: "allow", test: true };
      const encoded = encodeMessage(original);
      const decoded = decodeMessage(encoded);

      expect(decoded).toEqual(original);
    });

    it("throws on message exceeding MAX_MESSAGE_SIZE", () => {
      // Create a very large object
      const largeData = { data: "x".repeat(MAX_MESSAGE_SIZE + 1) };
      expect(() => encodeMessage(largeData)).toThrow(/exceeds maximum/);
    });

    it("throws on incomplete message", () => {
      const data = Buffer.alloc(2); // Too short for length prefix
      expect(() => decodeMessage(data)).toThrow(/too short/);
    });
  });

  describe("JSON round-trip", () => {
    it("maintains format through serialize/parse cycle", () => {
      const response = Decision.deny()
        .withBody("Blocked")
        .withTag("security")
        .withRuleId("RULE_001")
        .addRequestHeader("X-Added", "value")
        .removeResponseHeader("X-Removed")
        .build();

      const dict = agentResponseToDict(response);
      const json = JSON.stringify(dict);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(PROTOCOL_VERSION);
      expect(parsed.decision).toEqual({ block: { status: 403, body: "Blocked" } });
      expect(parsed.audit.tags).toEqual(["security"]);
      expect(parsed.audit.rule_ids).toEqual(["RULE_001"]);
      expect(parsed.request_headers).toEqual([
        { set: { name: "X-Added", value: "value" } },
      ]);
      expect(parsed.response_headers).toEqual([
        { remove: { name: "X-Removed" } },
      ]);
    });
  });
});
