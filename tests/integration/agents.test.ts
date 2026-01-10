/**
 * Tests for the test agents.
 *
 * Verifies that the test agents work correctly before using them
 * in integration tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EchoAgent, BlockingAgent, HeaderMutationAgent } from "./agents/index.js";
import { AgentHandler } from "../../src/handler.js";

function createRequestEvent(overrides: Partial<{
  correlationId: string;
  method: string;
  uri: string;
  headers: Record<string, string[]>;
}>) {
  return {
    event_type: "request_headers",
    payload: {
      metadata: {
        correlation_id: overrides.correlationId || "test-corr",
        request_id: "test-req",
        client_ip: "192.168.1.1",
        client_port: 12345,
      },
      method: overrides.method || "GET",
      uri: overrides.uri || "/",
      headers: overrides.headers || {},
    },
  };
}

function createResponseEvent(correlationId: string, status = 200) {
  return {
    event_type: "response_headers",
    payload: {
      correlation_id: correlationId,
      status,
      headers: {},
    },
  };
}

describe("EchoAgent", () => {
  let handler: AgentHandler;

  beforeEach(() => {
    handler = new AgentHandler(new EchoAgent());
  });

  it("echoes request method in response header", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ method: "POST", uri: "/api/test" })
    );

    const headers = response.response_headers as Array<Record<string, unknown>>;
    const methodHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Echo-Method"
    );

    expect(methodHeader).toBeDefined();
    expect((methodHeader!.set as Record<string, string>).value).toBe("POST");
  });

  it("echoes request path in response header", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/api/users?page=1" })
    );

    const headers = response.response_headers as Array<Record<string, unknown>>;
    const pathHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Echo-Path"
    );

    expect(pathHeader).toBeDefined();
    expect((pathHeader!.set as Record<string, string>).value).toBe("/api/users");
  });

  it("echoes client IP in response header", async () => {
    const response = await handler.handleEvent(createRequestEvent({}));

    const headers = response.response_headers as Array<Record<string, unknown>>;
    const ipHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Echo-ClientIp"
    );

    expect(ipHeader).toBeDefined();
    expect((ipHeader!.set as Record<string, string>).value).toBe("192.168.1.1");
  });

  it("adds echo tag to audit", async () => {
    const response = await handler.handleEvent(createRequestEvent({}));
    expect((response.audit as Record<string, unknown>).tags).toContain("echo");
  });

  it("uses custom prefix from configuration", async () => {
    const agent = new EchoAgent();
    await agent.onConfigure({ prefix: "X-Custom-" });

    const customHandler = new AgentHandler(agent);
    const response = await customHandler.handleEvent(
      createRequestEvent({ method: "DELETE" })
    );

    const headers = response.response_headers as Array<Record<string, unknown>>;
    const methodHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Custom-Method"
    );

    expect(methodHeader).toBeDefined();
  });
});

describe("BlockingAgent", () => {
  let handler: AgentHandler;

  beforeEach(() => {
    handler = new AgentHandler(new BlockingAgent());
  });

  it("blocks requests to /blocked path", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/blocked/resource" })
    );

    expect(response.decision).toEqual({
      block: {
        status: 403,
        body: expect.stringContaining("Access denied"),
        headers: { "Content-Type": "application/json" },
      },
    });
  });

  it("blocks requests to /admin path", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/admin/users" })
    );

    expect(response.decision).toHaveProperty("block");
  });

  it("blocks requests to /secret path", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/secret/data" })
    );

    expect(response.decision).toHaveProperty("block");
  });

  it("allows requests to non-blocked paths", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/api/users" })
    );

    expect(response.decision).toBe("allow");
  });

  it("adds blocked tag when blocking", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/blocked" })
    );

    expect((response.audit as Record<string, unknown>).tags).toContain("blocked");
  });

  it("adds allowed tag when allowing", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/api" })
    );

    expect((response.audit as Record<string, unknown>).tags).toContain("allowed");
  });

  it("adds X-Blocked-By header when blocking", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ uri: "/admin" })
    );

    const headers = response.response_headers as Array<Record<string, unknown>>;
    const blockedByHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Blocked-By"
    );

    expect(blockedByHeader).toBeDefined();
    expect((blockedByHeader!.set as Record<string, string>).value).toBe("blocking-agent");
  });

  it("uses custom blocked paths from configuration", async () => {
    const agent = new BlockingAgent();
    await agent.onConfigure({
      blocked_paths: ["/custom-blocked"],
      block_status: 401,
      block_message: "Custom block message",
    });

    const customHandler = new AgentHandler(agent);

    // Original paths should now be allowed
    const allowedResponse = await customHandler.handleEvent(
      createRequestEvent({ uri: "/blocked" })
    );
    expect(allowedResponse.decision).toBe("allow");

    // Custom path should be blocked with custom status
    const blockedResponse = await customHandler.handleEvent(
      createRequestEvent({ uri: "/custom-blocked" })
    );
    expect(blockedResponse.decision).toEqual({
      block: {
        status: 401,
        body: expect.stringContaining("Custom block message"),
        headers: { "Content-Type": "application/json" },
      },
    });
  });
});

describe("HeaderMutationAgent", () => {
  let handler: AgentHandler;

  beforeEach(() => {
    handler = new AgentHandler(new HeaderMutationAgent());
  });

  it("adds configured request headers", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ method: "GET", uri: "/api" })
    );

    const headers = response.request_headers as Array<Record<string, unknown>>;

    const processedHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Request-Processed"
    );
    expect(processedHeader).toBeDefined();
    expect((processedHeader!.set as Record<string, string>).value).toBe("true");

    const versionHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Agent-Version"
    );
    expect(versionHeader).toBeDefined();
  });

  it("removes configured request headers", async () => {
    const response = await handler.handleEvent(createRequestEvent({}));

    const headers = response.request_headers as Array<Record<string, unknown>>;
    const removeOp = headers.find(
      (h) => (h.remove as Record<string, string>)?.name === "X-Forwarded-For"
    );

    expect(removeOp).toBeDefined();
  });

  it("adds original method and path headers", async () => {
    const response = await handler.handleEvent(
      createRequestEvent({ method: "PUT", uri: "/api/resource/123" })
    );

    const headers = response.request_headers as Array<Record<string, unknown>>;

    const methodHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Original-Method"
    );
    expect((methodHeader!.set as Record<string, string>).value).toBe("PUT");

    const pathHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Original-Path"
    );
    expect((pathHeader!.set as Record<string, string>).value).toBe("/api/resource/123");
  });

  it("adds response headers on response phase", async () => {
    const correlationId = "response-test";

    // First send request to cache it
    await handler.handleEvent(
      createRequestEvent({ correlationId, uri: "/api" })
    );

    // Then send response headers
    const response = await handler.handleEvent(
      createResponseEvent(correlationId, 200)
    );

    const headers = response.response_headers as Array<Record<string, unknown>>;

    const processedHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Response-Processed"
    );
    expect(processedHeader).toBeDefined();

    const statusHeader = headers.find(
      (h) => (h.set as Record<string, string>)?.name === "X-Response-Status"
    );
    expect((statusHeader!.set as Record<string, string>).value).toBe("200");
  });

  it("removes configured response headers", async () => {
    const correlationId = "remove-test";

    await handler.handleEvent(
      createRequestEvent({ correlationId, uri: "/api" })
    );

    const response = await handler.handleEvent(
      createResponseEvent(correlationId)
    );

    const headers = response.response_headers as Array<Record<string, unknown>>;
    const removeOp = headers.find(
      (h) => (h.remove as Record<string, string>)?.name === "Server"
    );

    expect(removeOp).toBeDefined();
  });

  it("adds request_mutated tag on request", async () => {
    const response = await handler.handleEvent(createRequestEvent({}));
    expect((response.audit as Record<string, unknown>).tags).toContain("request_mutated");
  });

  it("adds response_mutated tag on response", async () => {
    const correlationId = "tag-test";

    await handler.handleEvent(createRequestEvent({ correlationId }));
    const response = await handler.handleEvent(createResponseEvent(correlationId));

    expect((response.audit as Record<string, unknown>).tags).toContain("response_mutated");
  });
});
