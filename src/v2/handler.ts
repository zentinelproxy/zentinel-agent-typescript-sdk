/**
 * V2 handler adapter that bridges AgentV2 to the protocol layer.
 */

import { Decision } from "../decision.js";
import {
  EventType,
  agentResponseToDict,
  createGuardrailResponse,
  guardrailResponseToDict,
  parseConfigureEvent,
  parseGuardrailInspectEvent,
  parseRequestBodyChunkEvent,
  parseRequestCompleteEvent,
  parseRequestHeadersEvent,
  parseResponseBodyChunkEvent,
  parseResponseHeadersEvent,
  parseWebSocketFrameEvent,
  ResponseHeadersEvent,
} from "../protocol.js";
import { Request } from "../request.js";
import { Response } from "../response.js";
import { AgentV2 } from "./agent.js";
import {
  AgentCapabilities,
  createSuccessHandshake,
  createFailedHandshake,
  HandshakeRequest,
  HandshakeResponse,
  HealthStatus,
  MetricsReport,
  ShutdownReason,
  DrainReason,
} from "./types.js";

type LogFn = (level: string, message: string) => void;

/** Requests whose state the handler keeps at most (see `_remember`). */
const MAX_TRACKED_REQUESTS = 10_000;

/**
 * Handler that wraps an AgentV2 and provides protocol v2 handling.
 *
 * This adapter:
 * - Handles v2 handshake with capability negotiation
 * - Routes protocol events to agent methods
 * - Manages request caching for correlation
 * - Provides health and metrics endpoints
 */
export class AgentHandlerV2 {
  private readonly _agent: AgentV2;
  private readonly _requests: Map<string, Request> = new Map();
  private readonly _requestBodies: Map<string, Buffer> = new Map();
  private readonly _responseBodies: Map<string, Buffer> = new Map();
  private readonly _responseHeaders: Map<string, ResponseHeadersEvent> = new Map();
  private readonly _logger: LogFn;

  constructor(agent: AgentV2, logger?: LogFn) {
    this._agent = agent;
    this._logger = logger || (() => {});
  }

  /**
   * Get the underlying agent.
   */
  get agent(): AgentV2 {
    return this._agent;
  }

  /**
   * Get agent capabilities.
   */
  capabilities(): AgentCapabilities {
    const caps = this._agent.capabilities();
    if (!caps.supportedEvents || caps.supportedEvents.length === 0) {
      caps.supportedEvents = this._derivedEvents();
    }
    return caps;
  }

  /** The events the agent's implemented methods handle. */
  private _derivedEvents(): string[] {
    const agent = this._agent;
    const events = ["request_headers"];
    if (agent.onRequestBody) events.push("request_body_chunk");
    if (agent.onResponse) events.push("response_headers");
    if (agent.onResponseBody) events.push("response_body_chunk");
    if (agent.onRequestComplete) events.push("request_complete");
    if (agent.onWebSocketFrame) events.push("websocket_frame");
    if (agent.onGuardrailInspect) events.push("guardrail_inspect");
    return events;
  }

  /**
   * Remember per-request state, bounded: entries are dropped when the
   * request completes, and the oldest go first when an agent never
   * subscribes to `request_complete`.
   */
  private _remember<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_TRACKED_REQUESTS) {
      const oldest = map.keys().next().value as string;
      map.delete(oldest);
    }
  }

  /** The cached request for a correlation id, or a minimal stand-in. */
  private _requestFor(correlationId: string): Request {
    return (
      this._requests.get(correlationId) ??
      new Request({
        metadata: {
          correlationId,
          requestId: "",
          clientIp: "",
          clientPort: 0,
          protocol: "HTTP/1.1",
        },
        method: "",
        uri: "",
        headers: {},
      })
    );
  }

  /**
   * Handle v2 handshake from proxy.
   */
  async onHandshake(_request: HandshakeRequest): Promise<HandshakeResponse> {
    // The handshake carries the agent's configuration too, but it is not
    // applied here: the proxy follows the handshake with a Configure message
    // on every connection, and that is what reaches `onConfigure` (as in the
    // Rust SDK), so the agent is configured once per connection, not twice.
    try {
      return createSuccessHandshake(this.capabilities());
    } catch (error) {
      return createFailedHandshake(`Capabilities unavailable: ${error}`);
    }
  }

  /**
   * Get current health status.
   */
  healthStatus(): HealthStatus {
    if (this._agent.healthStatus) {
      return this._agent.healthStatus();
    }
    return HealthStatus.healthy(this.capabilities().agentId);
  }

  /**
   * Get current metrics report.
   */
  metricsReport(): MetricsReport | undefined {
    if (this._agent.metricsReport) {
      return this._agent.metricsReport();
    }
    return undefined;
  }

  /**
   * Handle configuration update.
   */
  async onConfigure(
    config: Record<string, unknown>,
    _version?: string
  ): Promise<boolean> {
    try {
      if (this._agent.onConfigure) {
        await this._agent.onConfigure(config);
      }
      return true;
    } catch (error) {
      this._logger("error", `Configuration failed: ${error}`);
      return false;
    }
  }

  /**
   * Handle shutdown request.
   */
  onShutdown(reason: ShutdownReason, gracePeriodMs: number): void {
    if (this._agent.onShutdown) {
      this._agent.onShutdown(reason, gracePeriodMs);
    }
  }

  /**
   * Handle drain request.
   */
  onDrain(durationMs: number, reason: DrainReason): void {
    if (this._agent.onDrain) {
      this._agent.onDrain(durationMs, reason);
    }
  }

  /**
   * Handle stream closure.
   */
  onStreamClosed(): void {
    if (this._agent.onStreamClosed) {
      this._agent.onStreamClosed();
    }
  }

  /**
   * Handle an incoming protocol event.
   */
  async handleEvent(event: Record<string, unknown>): Promise<Record<string, unknown>> {
    const eventType = (event.event_type as string) || "";
    const payload = (event.payload as Record<string, unknown>) || {};

    try {
      switch (eventType) {
        case EventType.CONFIGURE:
          return await this._handleConfigure(payload);
        case EventType.REQUEST_HEADERS:
          return await this._handleRequestHeaders(payload);
        case EventType.REQUEST_BODY_CHUNK:
          return await this._handleRequestBodyChunk(payload);
        case EventType.RESPONSE_HEADERS:
          return await this._handleResponseHeaders(payload);
        case EventType.RESPONSE_BODY_CHUNK:
          return await this._handleResponseBodyChunk(payload);
        case EventType.REQUEST_COMPLETE:
          return await this._handleRequestComplete(payload);
        case EventType.WEBSOCKET_FRAME:
          return await this._handleWebSocketFrame(payload);
        case EventType.GUARDRAIL_INSPECT:
          return await this._handleGuardrailInspect(payload);
        default:
          this._logger("warn", `Unknown event type: ${eventType}`);
          return agentResponseToDict(Decision.allow().build());
      }
    } catch (error) {
      this._logger("error", `Error handling event ${eventType}: ${error}`);
      return agentResponseToDict(Decision.allow().build());
    }
  }

  private async _handleConfigure(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseConfigureEvent(payload);
    const accepted = await this.onConfigure(event.config, payload.config_version as string | undefined);
    // The proxy waits for an agent response to its Configure message and uses
    // the connection only if it is an allow.
    return agentResponseToDict(
      accepted
        ? Decision.allow().build()
        : Decision.block(500).withBody("Configuration rejected").build()
    );
  }

  private async _handleRequestHeaders(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseRequestHeadersEvent(payload);
    const request = new Request(event);

    // Cache request for response correlation
    this._remember(this._requests, event.metadata.correlationId, request);

    const decision = this._agent.onRequest
      ? await this._agent.onRequest(request)
      : Decision.allow();

    return agentResponseToDict(decision.build());
  }

  private async _handleRequestBodyChunk(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseRequestBodyChunkEvent(payload);
    const correlationId = event.correlationId;

    // Accumulate body chunks (synchronously, before any await, so chunks
    // dispatched in order are accumulated in order)
    const existingBody = this._requestBodies.get(correlationId) ?? Buffer.alloc(0);
    const body = Buffer.concat([existingBody, event.data]);

    // Only call handler on last chunk
    if (event.isLast) {
      this._requestBodies.delete(correlationId);
      const request = this._requestFor(correlationId).withBody(body);
      const decision = this._agent.onRequestBody
        ? await this._agent.onRequestBody(request)
        : Decision.allow();
      return agentResponseToDict(decision.build());
    }
    this._remember(this._requestBodies, correlationId, body);

    // For non-final chunks, return allow with needs_more
    return agentResponseToDict(Decision.allow().needsMoreData().build());
  }

  private async _handleResponseHeaders(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseResponseHeadersEvent(payload);
    const correlationId = event.correlationId;

    const request = this._requestFor(correlationId);

    // Cache the response headers event for body phase
    if (this._agent.onResponseBody) {
      this._remember(this._responseHeaders, correlationId, event);
    }

    const response = new Response(event);

    const decision = this._agent.onResponse
      ? await this._agent.onResponse(request, response)
      : Decision.allow();

    return agentResponseToDict(decision.build());
  }

  private async _handleResponseBodyChunk(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseResponseBodyChunkEvent(payload);
    const correlationId = event.correlationId;

    // Accumulate body chunks
    const existingBody = this._responseBodies.get(correlationId) ?? Buffer.alloc(0);
    const body = Buffer.concat([existingBody, event.data]);

    // Only call handler on last chunk
    if (event.isLast) {
      this._responseBodies.delete(correlationId);
      const request = this._requestFor(correlationId);
      // Use cached response headers or create a minimal one
      const responseEvent = this._responseHeaders.get(correlationId) || {
        correlationId,
        status: 200,
        headers: {},
      };
      this._responseHeaders.delete(correlationId);
      const response = new Response(responseEvent).withBody(body);
      const decision = this._agent.onResponseBody
        ? await this._agent.onResponseBody(request, response)
        : Decision.allow();
      return agentResponseToDict(decision.build());
    }
    this._remember(this._responseBodies, correlationId, body);

    return agentResponseToDict(Decision.allow().needsMoreData().build());
  }

  private async _handleRequestComplete(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseRequestCompleteEvent(payload);
    const correlationId = event.correlationId;

    // Get and cleanup cached request
    const request = this._requests.get(correlationId);
    this._requests.delete(correlationId);
    this._requestBodies.delete(correlationId);
    this._responseBodies.delete(correlationId);
    this._responseHeaders.delete(correlationId);

    if (request && this._agent.onRequestComplete) {
      await this._agent.onRequestComplete(request, event.status, event.durationMs);
    }

    return agentResponseToDict(Decision.allow().build());
  }

  private async _handleWebSocketFrame(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseWebSocketFrameEvent(payload);
    const decision = this._agent.onWebSocketFrame
      ? await this._agent.onWebSocketFrame(event)
      : Decision.allow();
    return agentResponseToDict(decision.build());
  }

  private async _handleGuardrailInspect(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseGuardrailInspectEvent(payload);
    const response = this._agent.onGuardrailInspect
      ? await this._agent.onGuardrailInspect(event)
      : createGuardrailResponse();
    // The proxy reads an agent response for every event; the guardrail
    // result travels in its audit metadata.
    const result = agentResponseToDict(Decision.allow().build());
    result.audit = { custom: { guardrail: guardrailResponseToDict(response) } };
    return result;
  }
}
