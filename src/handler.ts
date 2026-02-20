/**
 * Agent handler for routing protocol events to the agent.
 */

import { Agent } from "./agent.js";
import { Decision } from "./decision.js";
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
} from "./protocol.js";
import { Request } from "./request.js";
import { Response } from "./response.js";

export class AgentHandler {
  private readonly _agent: Agent;
  private readonly _requests: Map<string, Request> = new Map();
  private readonly _requestBodies: Map<string, Buffer> = new Map();
  private readonly _responseBodies: Map<string, Buffer> = new Map();
  private readonly _responseHeaders: Map<string, ResponseHeadersEvent> = new Map();
  private readonly _logger: (level: string, message: string) => void;

  constructor(agent: Agent, logger?: (level: string, message: string) => void) {
    this._agent = agent;
    this._logger = logger || ((_level, _msg) => {});
  }

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
    try {
      if (this._agent.onConfigure) {
        await this._agent.onConfigure(event.config);
      }
      this._logger("info", `Agent configured: ${event.agentId}`);
      return { success: true };
    } catch (error) {
      this._logger("error", `Configuration failed: ${error}`);
      return { success: false, error: String(error) };
    }
  }

  private async _handleRequestHeaders(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseRequestHeadersEvent(payload);
    const request = new Request(event);

    // Cache request for response correlation
    this._requests.set(event.metadata.correlationId, request);
    this._requestBodies.set(event.metadata.correlationId, Buffer.alloc(0));

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

    // Accumulate body chunks
    const existingBody = this._requestBodies.get(correlationId);
    if (existingBody !== undefined) {
      this._requestBodies.set(correlationId, Buffer.concat([existingBody, event.data]));
    }

    // Only call handler on last chunk
    if (event.isLast) {
      const cachedRequest = this._requests.get(correlationId);
      if (cachedRequest) {
        const request = cachedRequest.withBody(
          this._requestBodies.get(correlationId) || Buffer.alloc(0)
        );
        const decision = this._agent.onRequestBody
          ? await this._agent.onRequestBody(request)
          : Decision.allow();
        return agentResponseToDict(decision.build());
      }
    }

    // For non-final chunks, return allow with needs_more
    return agentResponseToDict(Decision.allow().needsMoreData().build());
  }

  private async _handleResponseHeaders(
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const event = parseResponseHeadersEvent(payload);
    const correlationId = event.correlationId;

    // Get cached request
    const request = this._requests.get(correlationId);
    if (!request) {
      this._logger("warn", `No cached request for correlation_id: ${correlationId}`);
      return agentResponseToDict(Decision.allow().build());
    }

    // Cache the response headers event for body phase
    this._responseHeaders.set(correlationId, event);

    const response = new Response(event);
    this._responseBodies.set(correlationId, Buffer.alloc(0));

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
    const existingBody = this._responseBodies.get(correlationId);
    if (existingBody !== undefined) {
      this._responseBodies.set(correlationId, Buffer.concat([existingBody, event.data]));
    }

    // Only call handler on last chunk
    if (event.isLast) {
      const request = this._requests.get(correlationId);
      if (request) {
        // Use cached response headers or create a minimal one
        const responseEvent = this._responseHeaders.get(correlationId) || {
          correlationId,
          status: 200,
          headers: {},
        };
        const response = new Response(responseEvent).withBody(
          this._responseBodies.get(correlationId) || Buffer.alloc(0)
        );
        const decision = this._agent.onResponseBody
          ? await this._agent.onResponseBody(request, response)
          : Decision.allow();
        return agentResponseToDict(decision.build());
      }
    }

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

    return { success: true };
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
    return guardrailResponseToDict(response);
  }
}
