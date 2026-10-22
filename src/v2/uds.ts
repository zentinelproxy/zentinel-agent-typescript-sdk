/**
 * Unix domain socket transport for agent protocol v2.
 *
 * Wire format (same as the Rust reference, `zentinel-agent-protocol`'s
 * `v2::uds`):
 *
 * ```text
 * +----------------+--------+------------------+
 * | length (4, BE) | type   | payload (JSON)   |
 * +----------------+--------+------------------+
 * ```
 *
 * `length` counts the type byte and the payload. The proxy opens with a
 * handshake request (0x01) and the agent answers with a handshake response
 * (0x02). When the agent has a `config { }` block, the proxy then sends a
 * Configure message (0x17) and uses the connection only after the agent has
 * acknowledged it with an agent response (0x20). Every event (0x10-0x17) is
 * answered with one agent response, which carries the event's correlation id
 * in `audit.custom.correlation_id` so the proxy can match it.
 */

import * as net from "node:net";

import { agentResponseToDict } from "../protocol.js";
import { Decision } from "../decision.js";
import { AgentHandlerV2 } from "./handler.js";
import { AgentCapabilitiesData, MAX_MESSAGE_SIZE_UDS, PROTOCOL_VERSION_2 } from "./types.js";

/** Message type bytes of the v2 UDS protocol. */
export const MessageType = {
  HandshakeRequest: 0x01,
  HandshakeResponse: 0x02,
  RequestHeaders: 0x10,
  RequestBodyChunk: 0x11,
  ResponseHeaders: 0x12,
  ResponseBodyChunk: 0x13,
  RequestComplete: 0x14,
  WebSocketFrame: 0x15,
  GuardrailInspect: 0x16,
  Configure: 0x17,
  AgentResponse: 0x20,
  HealthStatus: 0x30,
  MetricsReport: 0x31,
  ConfigUpdateRequest: 0x32,
  FlowControl: 0x33,
  Cancel: 0x40,
  Ping: 0x41,
  Pong: 0x42,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Event type numbers used in `supported_events` (the proxy's `EventType`). */
export const UDS_EVENT_NUMBERS: Record<string, number> = {
  configure: 0,
  request_headers: 1,
  request_body_chunk: 2,
  response_headers: 3,
  response_body_chunk: 4,
  request_complete: 5,
  websocket_frame: 6,
  guardrail_inspect: 7,
};

const EVENT_TYPE_BY_MESSAGE: Record<number, string> = {
  [MessageType.RequestHeaders]: "request_headers",
  [MessageType.RequestBodyChunk]: "request_body_chunk",
  [MessageType.ResponseHeaders]: "response_headers",
  [MessageType.ResponseBodyChunk]: "response_body_chunk",
  [MessageType.RequestComplete]: "request_complete",
  [MessageType.WebSocketFrame]: "websocket_frame",
  [MessageType.GuardrailInspect]: "guardrail_inspect",
  [MessageType.Configure]: "configure",
};

/**
 * Encode one frame: 4-byte big-endian length (type byte + payload), the type
 * byte, then the payload. Objects are JSON-encoded.
 */
export function encodeFrame(type: number, payload: Buffer | Record<string, unknown>): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), "utf-8");
  if (body.length > MAX_MESSAGE_SIZE_UDS) {
    throw new Error(`Message size ${body.length} exceeds maximum ${MAX_MESSAGE_SIZE_UDS}`);
  }
  const header = Buffer.alloc(5);
  header.writeUInt32BE(body.length + 1, 0);
  header.writeUInt8(type, 4);
  return Buffer.concat([header, body]);
}

/** A decoded frame. */
export interface Frame {
  type: number;
  payload: Buffer;
}

/** Incremental frame decoder for a byte stream. */
export class FrameDecoder {
  private _buffer: Buffer = Buffer.alloc(0);

  /**
   * Add bytes and return every frame now complete.
   *
   * @throws Error on a zero-length or oversized frame; the stream is then
   *   unusable and should be closed.
   */
  push(data: Buffer): Frame[] {
    this._buffer = this._buffer.length === 0 ? data : Buffer.concat([this._buffer, data]);
    const frames: Frame[] = [];
    while (this._buffer.length >= 4) {
      const length = this._buffer.readUInt32BE(0);
      if (length === 0) {
        throw new Error("Zero-length message");
      }
      if (length > MAX_MESSAGE_SIZE_UDS) {
        throw new Error(`Message size ${length} exceeds maximum ${MAX_MESSAGE_SIZE_UDS}`);
      }
      if (this._buffer.length < 4 + length) {
        break;
      }
      frames.push({
        type: this._buffer.readUInt8(4),
        payload: this._buffer.subarray(5, 4 + length),
      });
      this._buffer = this._buffer.subarray(4 + length);
    }
    return frames;
  }
}

/**
 * Capabilities in the shape of the proxy's `UdsCapabilities`: every field is
 * required, none may be null.
 */
export function capabilitiesToUds(caps: AgentCapabilitiesData): Record<string, unknown> {
  return {
    agent_id: caps.agentId,
    name: caps.name,
    version: caps.version,
    supported_events: (caps.supportedEvents ?? [])
      .map((e) => UDS_EVENT_NUMBERS[e])
      .filter((n): n is number => n !== undefined),
    features: {
      streaming_body: caps.features.streamingBody,
      websocket: caps.features.websocket,
      guardrails: caps.features.guardrails,
      config_push: caps.features.configPush,
      metrics_export: caps.features.metricsExport,
      concurrent_requests: caps.features.concurrentRequests,
      cancellation: caps.features.cancellation,
      flow_control: caps.features.flowControl,
      health_reporting: caps.features.healthReporting,
    },
    limits: {
      max_body_size: caps.limits.maxBodySize,
      max_concurrency: caps.limits.maxConcurrency ?? caps.features.concurrentRequests,
      preferred_chunk_size: caps.limits.preferredChunkSize,
    },
  };
}

type LogFn = (level: string, message: string) => void;

function correlationIdOf(payload: Record<string, unknown>): string {
  if (typeof payload.correlation_id === "string") {
    return payload.correlation_id;
  }
  const metadata = payload.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata.correlation_id === "string") {
    return metadata.correlation_id;
  }
  return "";
}

/** Put the correlation id where the proxy looks for it. */
function withCorrelationId(
  response: Record<string, unknown>,
  correlationId: string
): Record<string, unknown> {
  const audit = { ...((response.audit as Record<string, unknown> | undefined) ?? {}) };
  audit.custom = {
    ...((audit.custom as Record<string, unknown> | undefined) ?? {}),
    correlation_id: correlationId,
  };
  return { ...response, audit };
}

/**
 * Serve one proxy connection: the handshake, then events until the socket
 * closes.
 */
export function serveUdsConnection(
  socket: net.Socket,
  handler: AgentHandlerV2,
  logger: LogFn = () => {}
): void {
  const decoder = new FrameDecoder();
  // Set when the handshake frame is queued, not when it is answered: the
  // frames after it can arrive in the same read.
  let handshakeSeen = false;

  const send = (type: number, payload: Buffer | Record<string, unknown>): void => {
    if (!socket.destroyed) {
      socket.write(encodeFrame(type, payload));
    }
  };

  const onHandshake = async (payload: Buffer): Promise<void> => {
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(payload.toString("utf-8")) as Record<string, unknown>;
    } catch (error) {
      logger("error", `Invalid handshake request: ${error}`);
      socket.destroy();
      return;
    }
    const versions = (request.supported_versions as number[] | undefined) ?? [];
    const result = await handler.onHandshake({
      supportedVersions: versions,
      proxyId: (request.proxy_id as string) ?? "",
      proxyVersion: (request.proxy_version as string) ?? "",
      config: (request.config as Record<string, unknown> | null) ?? undefined,
    });
    let success = result.success;
    let error = result.error ?? null;
    if (success && versions.length > 0 && !versions.includes(PROTOCOL_VERSION_2)) {
      success = false;
      error = `Unsupported protocol versions ${JSON.stringify(versions)}; this agent speaks v${PROTOCOL_VERSION_2}`;
    }
    send(MessageType.HandshakeResponse, {
      protocol_version: PROTOCOL_VERSION_2,
      capabilities: capabilitiesToUds(result.capabilities ?? handler.capabilities()),
      success,
      error,
      encoding: "json",
    });
    if (!success) {
      logger("warn", `Handshake rejected: ${error}`);
      socket.end();
      return;
    }
    logger("info", "UDS v2 handshake completed");
  };

  const onEvent = async (frame: Frame, eventType: string): Promise<void> => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(frame.payload.toString("utf-8")) as Record<string, unknown>;
    } catch (error) {
      logger("error", `Invalid ${eventType} payload: ${error}`);
      return;
    }
    const correlationId = correlationIdOf(payload);
    let response: Record<string, unknown>;
    if (eventType === "configure") {
      const accepted = await handler.onConfigure(
        (payload.config as Record<string, unknown> | null) ?? {},
        (payload.config_version as string | null) ?? undefined
      );
      response = agentResponseToDict(
        accepted
          ? Decision.allow().build()
          : Decision.block(500).withBody("Configuration rejected").build()
      );
    } else {
      response = await handler.handleEvent({ event_type: eventType, payload });
    }
    send(MessageType.AgentResponse, withCorrelationId(response, correlationId));
  };

  // Frames are dispatched in arrival order. Body chunks are accumulated
  // synchronously at the start of their handler, so concurrent requests on
  // one connection cannot reorder a request's chunks.
  let chain: Promise<void> = Promise.resolve();

  socket.on("data", (data: Buffer) => {
    let frames: Frame[];
    try {
      frames = decoder.push(data);
    } catch (error) {
      logger("error", `${error}; closing the connection`);
      socket.destroy();
      return;
    }
    for (const frame of frames) {
      if (!handshakeSeen) {
        if (frame.type !== MessageType.HandshakeRequest) {
          logger("error", `Expected a handshake request, got type 0x${frame.type.toString(16)}`);
          socket.destroy();
          return;
        }
        handshakeSeen = true;
        chain = chain.then(() => onHandshake(frame.payload));
        continue;
      }
      if (frame.type === MessageType.Ping) {
        chain = chain.then(() => send(MessageType.Pong, frame.payload));
        continue;
      }
      const eventType = EVENT_TYPE_BY_MESSAGE[frame.type];
      if (eventType === undefined) {
        if (frame.type !== MessageType.Cancel) {
          logger("debug", `Ignoring message type 0x${frame.type.toString(16)}`);
        }
        continue;
      }
      // Configure must be applied before anything after it is handled.
      const run = (): Promise<void> =>
        onEvent(frame, eventType).catch((error) => logger("error", `Error handling ${eventType}: ${error}`));
      if (eventType === "configure") {
        chain = chain.then(run);
      } else {
        chain = chain.then(() => {
          void run();
        });
      }
    }
  });

  socket.on("error", (error) => {
    logger("debug", `Socket error: ${error.message}`);
  });

  socket.on("close", () => {
    handler.onStreamClosed();
  });
}
