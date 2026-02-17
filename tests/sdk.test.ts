/**
 * Unit tests for the Zentinel Agent SDK.
 *
 * Tests the core components: Decision, Request, Response, and Agent.
 */

import { describe, it, expect } from "vitest";
import { Decision, decisions } from "../src/decision.js";
import { Request } from "../src/request.js";
import { Response } from "../src/response.js";
import { Agent, ConfigurableAgent } from "../src/agent.js";
import {
  RequestHeadersEvent,
  RequestMetadata,
  ResponseHeadersEvent,
  PROTOCOL_VERSION,
} from "../src/protocol.js";

// Helper to create a RequestHeadersEvent
function createRequestEvent(overrides: Partial<{
  method: string;
  uri: string;
  headers: Record<string, string[]>;
  metadata: Partial<RequestMetadata>;
}>): RequestHeadersEvent {
  return {
    method: overrides.method || "GET",
    uri: overrides.uri || "/",
    headers: overrides.headers || {},
    metadata: {
      correlationId: "test-correlation-id",
      requestId: "test-request-id",
      clientIp: "127.0.0.1",
      clientPort: 12345,
      protocol: "HTTP/1.1",
      ...overrides.metadata,
    },
  };
}

// Helper to create a ResponseHeadersEvent
function createResponseEvent(overrides: Partial<{
  status: number;
  headers: Record<string, string[]>;
  correlationId: string;
}>): ResponseHeadersEvent {
  return {
    correlationId: overrides.correlationId || "test-correlation-id",
    status: overrides.status ?? 200,
    headers: overrides.headers || {},
  };
}

describe("Decision", () => {
  describe("allow", () => {
    it("creates an allow decision", () => {
      const decision = Decision.allow();
      const response = decision.build();
      expect(response.decision).toBe("allow");
      expect(response.version).toBe(PROTOCOL_VERSION);
    });
  });

  describe("deny", () => {
    it("creates a deny decision with status 403", () => {
      const decision = Decision.deny();
      const response = decision.build();
      expect(response.decision).toEqual({ block: { status: 403 } });
    });
  });

  describe("block", () => {
    it("creates a block decision with custom status", () => {
      const decision = Decision.block(400);
      const response = decision.build();
      expect(response.decision).toEqual({ block: { status: 400 } });
    });

    it("adds body to block decision", () => {
      const decision = Decision.block(403).withBody("Access denied");
      const response = decision.build();
      expect(response.decision).toEqual({
        block: { status: 403, body: "Access denied" },
      });
    });

    it("adds JSON body to block decision", () => {
      const decision = Decision.block(400).withJsonBody({ error: "Bad request" });
      const response = decision.build();
      const blockDecision = response.decision as Record<string, Record<string, unknown>>;
      expect(blockDecision.block.body).toBe('{"error":"Bad request"}');
      expect(blockDecision.block.headers).toEqual({ "Content-Type": "application/json" });
    });

    it("adds custom headers to block decision", () => {
      const decision = Decision.block(403).withBlockHeader("X-Custom", "value");
      const response = decision.build();
      const blockDecision = response.decision as Record<string, Record<string, unknown>>;
      expect(blockDecision.block.headers).toEqual({ "X-Custom": "value" });
    });
  });

  describe("unauthorized", () => {
    it("creates a 401 block decision", () => {
      const decision = Decision.unauthorized();
      const response = decision.build();
      expect(response.decision).toEqual({ block: { status: 401 } });
    });
  });

  describe("rateLimited", () => {
    it("creates a 429 block decision", () => {
      const decision = Decision.rateLimited();
      const response = decision.build();
      expect(response.decision).toEqual({ block: { status: 429 } });
    });
  });

  describe("redirect", () => {
    it("creates a temporary redirect (302)", () => {
      const decision = Decision.redirect("https://example.com");
      const response = decision.build();
      expect(response.decision).toEqual({
        redirect: { url: "https://example.com", status: 302 },
      });
    });

    it("creates a redirect with custom status", () => {
      const decision = Decision.redirect("https://example.com", 307);
      const response = decision.build();
      expect(response.decision).toEqual({
        redirect: { url: "https://example.com", status: 307 },
      });
    });
  });

  describe("redirectPermanent", () => {
    it("creates a permanent redirect (301)", () => {
      const decision = Decision.redirectPermanent("https://example.com");
      const response = decision.build();
      expect(response.decision).toEqual({
        redirect: { url: "https://example.com", status: 301 },
      });
    });
  });

  describe("challenge", () => {
    it("creates a challenge decision", () => {
      const decision = Decision.challenge("captcha", { difficulty: "hard" });
      const response = decision.build();
      expect(response.decision).toEqual({
        challenge: { challenge_type: "captcha", params: { difficulty: "hard" } },
      });
    });
  });

  describe("header mutations", () => {
    it("adds request header", () => {
      const decision = Decision.allow().addRequestHeader("X-Custom", "value");
      const response = decision.build();
      expect(response.requestHeaders).toEqual([
        { operation: "set", name: "X-Custom", value: "value" },
      ]);
    });

    it("removes request header", () => {
      const decision = Decision.allow().removeRequestHeader("X-Remove");
      const response = decision.build();
      expect(response.requestHeaders).toEqual([
        { operation: "remove", name: "X-Remove" },
      ]);
    });

    it("adds response header", () => {
      const decision = Decision.allow().addResponseHeader("X-Custom", "value");
      const response = decision.build();
      expect(response.responseHeaders).toEqual([
        { operation: "set", name: "X-Custom", value: "value" },
      ]);
    });

    it("removes response header", () => {
      const decision = Decision.allow().removeResponseHeader("X-Remove");
      const response = decision.build();
      expect(response.responseHeaders).toEqual([
        { operation: "remove", name: "X-Remove" },
      ]);
    });
  });

  describe("audit metadata", () => {
    it("adds single tag", () => {
      const decision = Decision.allow().withTag("security");
      const response = decision.build();
      expect(response.audit.tags).toEqual(["security"]);
    });

    it("adds multiple tags", () => {
      const decision = Decision.allow().withTags(["security", "auth"]);
      const response = decision.build();
      expect(response.audit.tags).toEqual(["security", "auth"]);
    });

    it("adds rule ID", () => {
      const decision = Decision.allow().withRuleId("RULE_001");
      const response = decision.build();
      expect(response.audit.ruleIds).toEqual(["RULE_001"]);
    });

    it("sets confidence", () => {
      const decision = Decision.allow().withConfidence(0.95);
      const response = decision.build();
      expect(response.audit.confidence).toBe(0.95);
    });

    it("adds reason code", () => {
      const decision = Decision.allow().withReasonCode("IP_BLOCKED");
      const response = decision.build();
      expect(response.audit.reasonCodes).toEqual(["IP_BLOCKED"]);
    });

    it("adds custom metadata", () => {
      const decision = Decision.allow().withMetadata("user_id", "12345");
      const response = decision.build();
      expect(response.audit.custom).toEqual({ user_id: "12345" });
    });
  });

  describe("routing metadata", () => {
    it("adds routing metadata", () => {
      const decision = Decision.allow().withRoutingMetadata("upstream", "backend-1");
      const response = decision.build();
      expect(response.routingMetadata).toEqual({ upstream: "backend-1" });
    });
  });

  describe("body mutations", () => {
    it("sets request body mutation", () => {
      const decision = Decision.allow().withRequestBodyMutation(Buffer.from("modified"), 0);
      const response = decision.build();
      expect(response.requestBodyMutation).toEqual({
        data: Buffer.from("modified").toString("base64"),
        chunk_index: 0,
      });
    });

    it("sets response body mutation", () => {
      const decision = Decision.allow().withResponseBodyMutation(Buffer.from("modified"), 0);
      const response = decision.build();
      expect(response.responseBodyMutation).toEqual({
        data: Buffer.from("modified").toString("base64"),
        chunk_index: 0,
      });
    });

    it("sets null body mutation for pass-through", () => {
      const decision = Decision.allow().withRequestBodyMutation(null, 0);
      const response = decision.build();
      expect(response.requestBodyMutation).toEqual({
        data: null,
        chunk_index: 0,
      });
    });
  });

  describe("needsMoreData", () => {
    it("sets needs_more flag", () => {
      const decision = Decision.allow().needsMoreData();
      const response = decision.build();
      expect(response.needsMore).toBe(true);
    });
  });

  describe("chaining", () => {
    it("supports method chaining", () => {
      const decision = Decision.deny()
        .withBody("Blocked")
        .withTag("security")
        .withRuleId("BLOCK_001")
        .withConfidence(0.99)
        .withMetadata("reason", "suspicious")
        .addResponseHeader("X-Blocked", "true");

      const response = decision.build();
      expect(response.decision).toEqual({
        block: { status: 403, body: "Blocked" },
      });
      expect(response.audit.tags).toEqual(["security"]);
      expect(response.audit.ruleIds).toEqual(["BLOCK_001"]);
      expect(response.audit.confidence).toBe(0.99);
      expect(response.audit.custom).toEqual({ reason: "suspicious" });
      expect(response.responseHeaders).toHaveLength(1);
    });
  });
});

describe("decisions helper", () => {
  it("provides shorthand for allow", () => {
    const response = decisions.allow().build();
    expect(response.decision).toBe("allow");
  });

  it("provides shorthand for deny", () => {
    const response = decisions.deny().build();
    expect(response.decision).toEqual({ block: { status: 403 } });
  });

  it("provides shorthand for unauthorized", () => {
    const response = decisions.unauthorized().build();
    expect(response.decision).toEqual({ block: { status: 401 } });
  });

  it("provides shorthand for rateLimited", () => {
    const response = decisions.rateLimited().build();
    expect(response.decision).toEqual({ block: { status: 429 } });
  });

  it("provides shorthand for block with body", () => {
    const response = decisions.block(400, "Bad request").build();
    expect(response.decision).toEqual({
      block: { status: 400, body: "Bad request" },
    });
  });

  it("provides shorthand for redirect", () => {
    const response = decisions.redirect("https://example.com").build();
    expect(response.decision).toEqual({
      redirect: { url: "https://example.com", status: 302 },
    });
  });

  it("provides shorthand for permanent redirect", () => {
    const response = decisions.redirect("https://example.com", true).build();
    expect(response.decision).toEqual({
      redirect: { url: "https://example.com", status: 301 },
    });
  });
});

describe("Request", () => {
  describe("method", () => {
    it("returns the HTTP method", () => {
      const request = new Request(createRequestEvent({ method: "POST" }));
      expect(request.method).toBe("POST");
    });

    it("detects GET requests", () => {
      const request = new Request(createRequestEvent({ method: "GET" }));
      expect(request.isGet()).toBe(true);
      expect(request.isPost()).toBe(false);
    });

    it("detects POST requests", () => {
      const request = new Request(createRequestEvent({ method: "POST" }));
      expect(request.isPost()).toBe(true);
      expect(request.isGet()).toBe(false);
    });

    it("detects PUT requests", () => {
      const request = new Request(createRequestEvent({ method: "PUT" }));
      expect(request.isPut()).toBe(true);
    });

    it("detects DELETE requests", () => {
      const request = new Request(createRequestEvent({ method: "DELETE" }));
      expect(request.isDelete()).toBe(true);
    });

    it("detects PATCH requests", () => {
      const request = new Request(createRequestEvent({ method: "PATCH" }));
      expect(request.isPatch()).toBe(true);
    });
  });

  describe("path", () => {
    it("returns the full URI", () => {
      const request = new Request(createRequestEvent({ uri: "/api/users?page=1" }));
      expect(request.uri).toBe("/api/users?page=1");
      expect(request.path).toBe("/api/users?page=1");
    });

    it("returns path without query string", () => {
      const request = new Request(createRequestEvent({ uri: "/api/users?page=1" }));
      expect(request.pathOnly).toBe("/api/users");
    });

    it("returns query string", () => {
      const request = new Request(createRequestEvent({ uri: "/api/users?page=1&limit=10" }));
      expect(request.queryString).toBe("page=1&limit=10");
    });

    it("handles paths without query string", () => {
      const request = new Request(createRequestEvent({ uri: "/api/users" }));
      expect(request.pathOnly).toBe("/api/users");
      expect(request.queryString).toBe("");
    });
  });

  describe("pathStartsWith", () => {
    it("matches path prefix", () => {
      const request = new Request(createRequestEvent({ uri: "/api/users/123" }));
      expect(request.pathStartsWith("/api")).toBe(true);
      expect(request.pathStartsWith("/api/users")).toBe(true);
      expect(request.pathStartsWith("/admin")).toBe(false);
    });
  });

  describe("pathEquals", () => {
    it("matches exact path", () => {
      const request = new Request(createRequestEvent({ uri: "/api/users?page=1" }));
      expect(request.pathEquals("/api/users")).toBe(true);
      expect(request.pathEquals("/api/users?page=1")).toBe(false); // pathOnly comparison
      expect(request.pathEquals("/api")).toBe(false);
    });
  });

  describe("query parameters", () => {
    it("returns single query parameter", () => {
      const request = new Request(createRequestEvent({ uri: "/api?page=1&limit=10" }));
      expect(request.query("page")).toBe("1");
      expect(request.query("limit")).toBe("10");
      expect(request.query("missing")).toBeNull();
    });

    it("returns all values for multi-value parameter", () => {
      const request = new Request(createRequestEvent({ uri: "/api?tag=a&tag=b&tag=c" }));
      expect(request.queryAll("tag")).toEqual(["a", "b", "c"]);
      expect(request.queryAll("missing")).toEqual([]);
    });
  });

  describe("headers", () => {
    it("returns all headers", () => {
      const request = new Request(createRequestEvent({
        headers: {
          "Content-Type": ["application/json"],
          "X-Custom": ["value1", "value2"],
        },
      }));
      expect(request.headers).toEqual({
        "Content-Type": ["application/json"],
        "X-Custom": ["value1", "value2"],
      });
    });

    it("returns single header value (case-insensitive)", () => {
      const request = new Request(createRequestEvent({
        headers: { "Content-Type": ["application/json"] },
      }));
      expect(request.header("content-type")).toBe("application/json");
      expect(request.header("CONTENT-TYPE")).toBe("application/json");
      expect(request.header("Content-Type")).toBe("application/json");
    });

    it("returns null for missing header", () => {
      const request = new Request(createRequestEvent({}));
      expect(request.header("X-Missing")).toBeNull();
    });

    it("returns all header values", () => {
      const request = new Request(createRequestEvent({
        headers: { "Accept": ["text/html", "application/json"] },
      }));
      expect(request.headerAll("accept")).toEqual(["text/html", "application/json"]);
    });

    it("checks header existence", () => {
      const request = new Request(createRequestEvent({
        headers: { "Content-Type": ["application/json"] },
      }));
      expect(request.hasHeader("content-type")).toBe(true);
      expect(request.hasHeader("X-Missing")).toBe(false);
    });
  });

  describe("common headers", () => {
    it("returns host header", () => {
      const request = new Request(createRequestEvent({
        headers: { "Host": ["example.com"] },
      }));
      expect(request.host).toBe("example.com");
    });

    it("returns user agent", () => {
      const request = new Request(createRequestEvent({
        headers: { "User-Agent": ["Mozilla/5.0"] },
      }));
      expect(request.userAgent).toBe("Mozilla/5.0");
    });

    it("returns content type", () => {
      const request = new Request(createRequestEvent({
        headers: { "Content-Type": ["application/json"] },
      }));
      expect(request.contentType).toBe("application/json");
    });

    it("returns authorization", () => {
      const request = new Request(createRequestEvent({
        headers: { "Authorization": ["Bearer token123"] },
      }));
      expect(request.authorization).toBe("Bearer token123");
    });

    it("returns content length as number", () => {
      const request = new Request(createRequestEvent({
        headers: { "Content-Length": ["1234"] },
      }));
      expect(request.contentLength).toBe(1234);
    });

    it("returns null for invalid content length", () => {
      const request = new Request(createRequestEvent({
        headers: { "Content-Length": ["invalid"] },
      }));
      expect(request.contentLength).toBeNull();
    });
  });

  describe("content type detection", () => {
    it("detects JSON content type", () => {
      const jsonRequest = new Request(createRequestEvent({
        headers: { "Content-Type": ["application/json"] },
      }));
      expect(jsonRequest.isJson()).toBe(true);

      const htmlRequest = new Request(createRequestEvent({
        headers: { "Content-Type": ["text/html"] },
      }));
      expect(htmlRequest.isJson()).toBe(false);

      const noContentType = new Request(createRequestEvent({}));
      expect(noContentType.isJson()).toBe(false);
    });
  });

  describe("body", () => {
    it("returns raw body bytes", () => {
      const body = Buffer.from("Hello, World!");
      const request = new Request(createRequestEvent({}), body);
      expect(request.body).toEqual(body);
    });

    it("returns body as string", () => {
      const body = Buffer.from("Hello, World!");
      const request = new Request(createRequestEvent({}), body);
      expect(request.bodyStr).toBe("Hello, World!");
    });

    it("parses body as JSON", () => {
      const body = Buffer.from('{"key": "value"}');
      const request = new Request(createRequestEvent({}), body);
      expect(request.bodyJson()).toEqual({ key: "value" });
    });

    it("returns empty buffer when no body", () => {
      const request = new Request(createRequestEvent({}));
      expect(request.body).toEqual(Buffer.alloc(0));
    });
  });

  describe("metadata", () => {
    it("returns correlation ID", () => {
      const request = new Request(createRequestEvent({
        metadata: { correlationId: "abc-123" },
      }));
      expect(request.correlationId).toBe("abc-123");
    });

    it("returns client IP", () => {
      const request = new Request(createRequestEvent({
        metadata: { clientIp: "192.168.1.1" },
      }));
      expect(request.clientIp).toBe("192.168.1.1");
    });

    it("returns full metadata", () => {
      const request = new Request(createRequestEvent({
        metadata: {
          correlationId: "abc-123",
          requestId: "req-456",
          clientIp: "192.168.1.1",
          clientPort: 54321,
          protocol: "HTTP/2",
          serverName: "api.example.com",
          tlsVersion: "TLSv1.3",
        },
      }));
      expect(request.metadata.correlationId).toBe("abc-123");
      expect(request.metadata.requestId).toBe("req-456");
      expect(request.metadata.protocol).toBe("HTTP/2");
      expect(request.metadata.serverName).toBe("api.example.com");
      expect(request.metadata.tlsVersion).toBe("TLSv1.3");
    });
  });

  describe("withBody", () => {
    it("creates new request with body", () => {
      const original = new Request(createRequestEvent({ uri: "/api" }));
      const withBody = original.withBody(Buffer.from("body content"));

      expect(original.body).toEqual(Buffer.alloc(0));
      expect(withBody.body).toEqual(Buffer.from("body content"));
      expect(withBody.uri).toBe("/api"); // Preserves other properties
    });
  });

  describe("toString", () => {
    it("returns string representation", () => {
      const request = new Request(createRequestEvent({ method: "GET", uri: "/api/users" }));
      expect(request.toString()).toBe("Request(GET /api/users)");
    });
  });
});

describe("Response", () => {
  describe("status code", () => {
    it("returns status code", () => {
      const response = new Response(createResponseEvent({ status: 200 }));
      expect(response.statusCode).toBe(200);
    });

    it("detects success status (2xx)", () => {
      expect(new Response(createResponseEvent({ status: 200 })).isSuccess()).toBe(true);
      expect(new Response(createResponseEvent({ status: 201 })).isSuccess()).toBe(true);
      expect(new Response(createResponseEvent({ status: 299 })).isSuccess()).toBe(true);
      expect(new Response(createResponseEvent({ status: 300 })).isSuccess()).toBe(false);
    });

    it("detects redirect status (3xx)", () => {
      expect(new Response(createResponseEvent({ status: 301 })).isRedirect()).toBe(true);
      expect(new Response(createResponseEvent({ status: 302 })).isRedirect()).toBe(true);
      expect(new Response(createResponseEvent({ status: 200 })).isRedirect()).toBe(false);
    });

    it("detects client error status (4xx)", () => {
      expect(new Response(createResponseEvent({ status: 400 })).isClientError()).toBe(true);
      expect(new Response(createResponseEvent({ status: 404 })).isClientError()).toBe(true);
      expect(new Response(createResponseEvent({ status: 500 })).isClientError()).toBe(false);
    });

    it("detects server error status (5xx)", () => {
      expect(new Response(createResponseEvent({ status: 500 })).isServerError()).toBe(true);
      expect(new Response(createResponseEvent({ status: 503 })).isServerError()).toBe(true);
      expect(new Response(createResponseEvent({ status: 400 })).isServerError()).toBe(false);
    });

    it("detects any error status (4xx or 5xx)", () => {
      expect(new Response(createResponseEvent({ status: 400 })).isError()).toBe(true);
      expect(new Response(createResponseEvent({ status: 500 })).isError()).toBe(true);
      expect(new Response(createResponseEvent({ status: 200 })).isError()).toBe(false);
    });
  });

  describe("headers", () => {
    it("returns all headers", () => {
      const response = new Response(createResponseEvent({
        headers: { "Content-Type": ["text/html"] },
      }));
      expect(response.headers).toEqual({ "Content-Type": ["text/html"] });
    });

    it("returns single header value (case-insensitive)", () => {
      const response = new Response(createResponseEvent({
        headers: { "Content-Type": ["text/html"] },
      }));
      expect(response.header("content-type")).toBe("text/html");
    });

    it("returns location header", () => {
      const response = new Response(createResponseEvent({
        headers: { "Location": ["https://example.com"] },
      }));
      expect(response.location).toBe("https://example.com");
    });
  });

  describe("content type detection", () => {
    it("detects JSON response", () => {
      const response = new Response(createResponseEvent({
        headers: { "Content-Type": ["application/json"] },
      }));
      expect(response.isJson()).toBe(true);
      expect(response.isHtml()).toBe(false);
    });

    it("detects HTML response", () => {
      const response = new Response(createResponseEvent({
        headers: { "Content-Type": ["text/html; charset=utf-8"] },
      }));
      expect(response.isHtml()).toBe(true);
      expect(response.isJson()).toBe(false);
    });
  });

  describe("body", () => {
    it("returns raw body bytes", () => {
      const body = Buffer.from("<html></html>");
      const response = new Response(createResponseEvent({}), body);
      expect(response.body).toEqual(body);
    });

    it("returns body as string", () => {
      const body = Buffer.from("<html></html>");
      const response = new Response(createResponseEvent({}), body);
      expect(response.bodyStr).toBe("<html></html>");
    });

    it("parses body as JSON", () => {
      const body = Buffer.from('{"result": "ok"}');
      const response = new Response(createResponseEvent({}), body);
      expect(response.bodyJson()).toEqual({ result: "ok" });
    });
  });

  describe("withBody", () => {
    it("creates new response with body", () => {
      const original = new Response(createResponseEvent({ status: 200 }));
      const withBody = original.withBody(Buffer.from("body content"));

      expect(original.body).toEqual(Buffer.alloc(0));
      expect(withBody.body).toEqual(Buffer.from("body content"));
      expect(withBody.statusCode).toBe(200);
    });
  });

  describe("toString", () => {
    it("returns string representation", () => {
      const response = new Response(createResponseEvent({ status: 404 }));
      expect(response.toString()).toBe("Response(404)");
    });
  });
});

describe("Agent", () => {
  describe("default handlers", () => {
    it("provides default implementations via ConfigurableAgent", async () => {
      class TestAgent extends ConfigurableAgent<{}> {
        constructor() {
          super({});
        }
        get name() {
          return "test-agent";
        }
      }

      const agent = new TestAgent();
      const request = new Request(createRequestEvent({}));
      const response = new Response(createResponseEvent({}));

      // All default handlers should return allow
      const requestDecision = await agent.onRequest(request);
      expect(requestDecision.build().decision).toBe("allow");

      const requestBodyDecision = await agent.onRequestBody(request);
      expect(requestBodyDecision.build().decision).toBe("allow");

      const responseDecision = await agent.onResponse(request, response);
      expect(responseDecision.build().decision).toBe("allow");

      const responseBodyDecision = await agent.onResponseBody(request, response);
      expect(responseBodyDecision.build().decision).toBe("allow");

      // onRequestComplete should not throw
      await expect(agent.onRequestComplete(request, 200, 100)).resolves.toBeUndefined();
    });
  });
});

describe("ConfigurableAgent", () => {
  interface TestConfig {
    enabled: boolean;
    threshold: number;
  }

  class TestConfigAgent extends ConfigurableAgent<TestConfig> {
    configAppliedCalled = false;

    constructor() {
      super({ enabled: true, threshold: 100 });
    }

    get name() {
      return "test-config-agent";
    }

    async onConfigApplied(_config: TestConfig) {
      this.configAppliedCalled = true;
    }
  }

  it("provides access to default config", () => {
    const agent = new TestConfigAgent();
    expect(agent.config).toEqual({ enabled: true, threshold: 100 });
  });

  it("parses and applies configuration", async () => {
    const agent = new TestConfigAgent();
    await agent.onConfigure({ enabled: false, threshold: 50 });

    expect(agent.config).toEqual({ enabled: false, threshold: 50 });
    expect(agent.configAppliedCalled).toBe(true);
  });

  it("merges with default config", async () => {
    const agent = new TestConfigAgent();
    await agent.onConfigure({ threshold: 200 });

    expect(agent.config).toEqual({ enabled: true, threshold: 200 });
  });
});
