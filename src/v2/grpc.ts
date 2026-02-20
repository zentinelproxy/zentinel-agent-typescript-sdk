/**
 * gRPC transport for v2 agents.
 *
 * Uses dynamic proto loading via @grpc/proto-loader (no codegen).
 * Implements all three RPCs: ProcessEvent, ProcessStream, ControlStream.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { AgentHandlerV2 } from "./handler.js";
import { AgentCapabilities, AgentCapabilitiesData, PROTOCOL_VERSION_2 } from "./types.js";

// ---------------------------------------------------------------------------
// Proto loading
// ---------------------------------------------------------------------------

const PROTO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
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
// Types
// ---------------------------------------------------------------------------

type LogFn = (level: string, message: string) => void;

export interface GrpcServerOptions {
  handler: AgentHandlerV2;
  logger?: LogFn;
}

// ---------------------------------------------------------------------------
// Proto <-> JSON conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert repeated Header [{name, value}] to Record<string, string[]>.
 */
function protoHeadersToRecord(
  headers: Array<{ name: string; value: string }> | undefined
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!headers) return result;
  for (const h of headers) {
    const key = h.name.toLowerCase();
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(h.value);
  }
  return result;
}

/**
 * Convert a ProxyToAgent message to the JSON event format the handler expects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function protoEventToJson(msg: any): Record<string, unknown> | null {
  // `message` is the virtual oneof field name (oneofs: true)
  const kind: string | undefined = msg.message;
  if (!kind) return null;

  switch (kind) {
    case "request_headers": {
      const ev = msg.request_headers;
      const meta = ev.metadata || {};
      return {
        event_type: "request_headers",
        payload: {
          metadata: {
            correlation_id: meta.correlation_id || "",
            request_id: meta.request_id || "",
            client_ip: meta.client_ip || "",
            client_port: meta.client_port || 0,
            server_name: meta.server_name,
            protocol: meta.protocol || "HTTP/1.1",
            tls_version: meta.tls_version,
            route_id: meta.route_id,
            upstream_id: meta.upstream_id,
            timestamp: meta.timestamp_ms
              ? String(meta.timestamp_ms)
              : undefined,
            traceparent: meta.traceparent,
          },
          method: ev.method || "GET",
          uri: ev.uri || "/",
          headers: protoHeadersToRecord(ev.headers),
        },
      };
    }

    case "response_headers": {
      const ev = msg.response_headers;
      return {
        event_type: "response_headers",
        payload: {
          correlation_id: ev.correlation_id || "",
          status: ev.status_code || 200,
          headers: protoHeadersToRecord(ev.headers),
        },
      };
    }

    case "request_body_chunk": {
      const ev = msg.request_body_chunk;
      return {
        event_type: "request_body_chunk",
        payload: {
          correlation_id: ev.correlation_id || "",
          chunk_index: ev.chunk_index || 0,
          data: ev.data
            ? (ev.data as Buffer).toString("base64")
            : "",
          is_last: ev.is_last ?? false,
          total_size: ev.total_size,
          bytes_received: ev.bytes_transferred || 0,
        },
      };
    }

    case "response_body_chunk": {
      const ev = msg.response_body_chunk;
      return {
        event_type: "response_body_chunk",
        payload: {
          correlation_id: ev.correlation_id || "",
          chunk_index: ev.chunk_index || 0,
          data: ev.data
            ? (ev.data as Buffer).toString("base64")
            : "",
          is_last: ev.is_last ?? false,
          total_size: ev.total_size,
          bytes_received: ev.bytes_transferred || 0,
        },
      };
    }

    case "request_complete": {
      const ev = msg.request_complete;
      return {
        event_type: "request_complete",
        payload: {
          correlation_id: ev.correlation_id || "",
          status: ev.status_code || 0,
          duration_ms: ev.duration_ms || 0,
          request_size: ev.bytes_received || 0,
          response_size: ev.bytes_sent || 0,
          error: ev.error,
        },
      };
    }

    case "guardrail": {
      const ev = msg.guardrail;
      let contextObj: Record<string, unknown> = {};
      if (ev.context_json) {
        try {
          contextObj = JSON.parse(ev.context_json);
        } catch {
          // ignore parse errors
        }
      }
      return {
        event_type: "guardrail_inspect",
        payload: {
          correlation_id: ev.correlation_id || "",
          content: ev.content || "",
          content_type: ev.content_type || 0,
          model: ev.model,
          ...contextObj,
        },
      };
    }

    case "websocket_frame": {
      const ev = msg.websocket_frame;
      return {
        event_type: "websocket_frame",
        payload: {
          correlation_id: ev.correlation_id || "",
          opcode: ev.frame_type || 0,
          data: ev.payload
            ? (ev.payload as Buffer).toString("base64")
            : "",
          direction: ev.client_to_server ? "client_to_server" : "server_to_client",
          frame_index: 0,
        },
      };
    }

    case "configure": {
      const ev = msg.configure;
      let config: Record<string, unknown> = {};
      if (ev.config_json) {
        try {
          config = JSON.parse(ev.config_json);
        } catch {
          // ignore parse errors
        }
      }
      return {
        event_type: "configure",
        payload: {
          config,
          config_version: ev.config_version,
          is_initial: ev.is_initial || false,
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Convert the JSON response from the handler into an AgentToProxy proto message.
 */
export function jsonResponseToProto(
  json: Record<string, unknown>,
  correlationId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentResponse: any = {
    correlation_id: correlationId || "",
    needs_more: (json.needs_more as boolean) || false,
  };

  // --- Decision ---
  const decision = json.decision;
  if (decision === "allow" || decision === undefined) {
    agentResponse.allow = {};
  } else if (typeof decision === "object" && decision !== null) {
    const dec = decision as Record<string, unknown>;
    if ("block" in dec) {
      const block = dec.block as Record<string, unknown>;
      agentResponse.block = {
        status: (block.status as number) || 403,
        body: block.body as string | undefined,
        headers: recordHeadersToProto(block.headers as Record<string, string> | undefined),
      };
    } else if ("redirect" in dec) {
      const redirect = dec.redirect as Record<string, unknown>;
      agentResponse.redirect = {
        url: redirect.url as string,
        status: (redirect.status as number) || 302,
      };
    } else if ("challenge" in dec) {
      const challenge = dec.challenge as Record<string, unknown>;
      agentResponse.challenge = {
        challenge_type: challenge.challenge_type as string,
        params: (challenge.params as Record<string, string>) || {},
      };
    }
  }

  // --- Header operations ---
  agentResponse.request_headers = headerOpsToProto(
    json.request_headers as Array<Record<string, unknown>> | undefined
  );
  agentResponse.response_headers = headerOpsToProto(
    json.response_headers as Array<Record<string, unknown>> | undefined
  );

  // --- Audit ---
  const audit = json.audit as Record<string, unknown> | undefined;
  if (audit && Object.keys(audit).length > 0) {
    agentResponse.audit = {
      tags: (audit.tags as string[]) || [],
      rule_ids: (audit.rule_ids as string[]) || [],
      confidence: audit.confidence as number | undefined,
      reason_codes: (audit.reason_codes as string[]) || [],
      custom: (audit.custom as Record<string, string>) || {},
    };
  }

  return { response: agentResponse };
}

function recordHeadersToProto(
  headers: Record<string, string> | undefined
): Array<{ name: string; value: string }> {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function headerOpsToProto(
  ops: Array<Record<string, unknown>> | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  if (!ops) return [];
  return ops.map((op) => {
    if ("set" in op) {
      const h = op.set as Record<string, string>;
      return { set: { name: h.name, value: h.value } };
    }
    if ("add" in op) {
      const h = op.add as Record<string, string>;
      return { add: { name: h.name, value: h.value } };
    }
    if ("remove" in op) {
      const h = op.remove as Record<string, string>;
      return { remove: h.name };
    }
    return {};
  });
}

/**
 * Serialize capabilities data to proto-compatible format.
 */
function capabilitiesToProto(
  caps: AgentCapabilitiesData | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!caps) return undefined;
  if (caps instanceof AgentCapabilities) {
    return caps.toJSON();
  }
  // Fallback for plain AgentCapabilitiesData objects
  return {
    agent_id: caps.agentId,
    name: caps.name,
    version: caps.version,
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
      preferred_chunk_size: caps.limits.preferredChunkSize,
      max_processing_time_ms: caps.limits.maxProcessingTimeMs,
    },
    health: {
      report_interval_ms: caps.health.reportIntervalMs,
      timeout_ms: caps.health.timeoutMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Service implementations
// ---------------------------------------------------------------------------

function createServiceImpl(
  handler: AgentHandlerV2,
  logger: LogFn
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  return {
    // ----- ProcessEvent (unary) -----
    ProcessEvent: async (
      call: grpc.ServerUnaryCall<unknown, unknown>,
      callback: grpc.sendUnaryData<unknown>
    ) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request = call.request as any;
        const kind: string | undefined = request.message;

        // Handshake
        if (kind === "handshake") {
          const hs = request.handshake;
          let config: Record<string, unknown> | undefined;
          if (hs.config_json) {
            try {
              config = JSON.parse(hs.config_json);
            } catch {
              // ignore
            }
          }
          const hsResponse = await handler.onHandshake({
            supportedVersions: hs.supported_versions || [],
            proxyId: hs.proxy_id || "",
            proxyVersion: hs.proxy_version || "",
            config,
          });
          const caps = hsResponse.capabilities;
          callback(null, {
            handshake: {
              protocol_version: PROTOCOL_VERSION_2,
              success: hsResponse.success,
              error: hsResponse.error,
              capabilities: capabilitiesToProto(caps),
            },
          });
          return;
        }

        // Ping
        if (kind === "ping") {
          const ping = request.ping;
          callback(null, {
            pong: {
              sequence: ping.sequence,
              ping_timestamp_ms: ping.timestamp_ms,
              timestamp_ms: Date.now(),
            },
          });
          return;
        }

        // Event
        const jsonEvent = protoEventToJson(request);
        if (!jsonEvent) {
          logger("warn", `ProcessEvent: unknown message type: ${kind}`);
          callback(null, {
            response: { allow: {}, correlation_id: "" },
          });
          return;
        }

        const correlationId = extractCorrelationId(request, kind);
        const jsonResponse = await handler.handleEvent(jsonEvent);
        callback(null, jsonResponseToProto(jsonResponse, correlationId));
      } catch (error) {
        logger("error", `ProcessEvent error: ${error}`);
        callback({
          code: grpc.status.INTERNAL,
          message: String(error),
        });
      }
    },

    // ----- ProcessStream (bidirectional) -----
    ProcessStream: (
      call: grpc.ServerDuplexStream<unknown, unknown>
    ) => {
      let handshakeDone = false;

      call.on("data", async (request: unknown) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = request as any;
          const kind: string | undefined = msg.message;

          // Handshake must be first
          if (kind === "handshake") {
            const hs = msg.handshake;
            let config: Record<string, unknown> | undefined;
            if (hs.config_json) {
              try {
                config = JSON.parse(hs.config_json);
              } catch {
                // ignore
              }
            }
            const hsResponse = await handler.onHandshake({
              supportedVersions: hs.supported_versions || [],
              proxyId: hs.proxy_id || "",
              proxyVersion: hs.proxy_version || "",
              config,
            });
            const caps = hsResponse.capabilities;
            call.write({
              handshake: {
                protocol_version: PROTOCOL_VERSION_2,
                success: hsResponse.success,
                error: hsResponse.error,
                capabilities: capabilitiesToProto(caps),
              },
            });
            handshakeDone = true;
            return;
          }

          if (!handshakeDone) {
            logger("warn", "ProcessStream: expected handshake as first message");
            call.write({
              response: { allow: {}, correlation_id: "" },
            });
            return;
          }

          // Ping
          if (kind === "ping") {
            const ping = msg.ping;
            call.write({
              pong: {
                sequence: ping.sequence,
                ping_timestamp_ms: ping.timestamp_ms,
                timestamp_ms: Date.now(),
              },
            });
            return;
          }

          // Event
          const jsonEvent = protoEventToJson(msg);
          if (!jsonEvent) {
            logger("warn", `ProcessStream: unknown message type: ${kind}`);
            return;
          }

          const correlationId = extractCorrelationId(msg, kind);
          const jsonResponse = await handler.handleEvent(jsonEvent);
          call.write(jsonResponseToProto(jsonResponse, correlationId));
        } catch (error) {
          logger("error", `ProcessStream error: ${error}`);
        }
      });

      call.on("end", () => {
        handler.onStreamClosed();
        call.end();
      });

      call.on("error", (error) => {
        if ((error as grpc.ServiceError).code !== grpc.status.CANCELLED) {
          logger("error", `ProcessStream error: ${error.message}`);
        }
      });
    },

    // ----- ControlStream (bidirectional) -----
    ControlStream: (
      call: grpc.ServerDuplexStream<unknown, unknown>
    ) => {
      call.on("data", (_msg: unknown) => {
        // Stub: acknowledge control messages
        // Future: handle health/metrics/config_update from agent
      });

      call.on("end", () => {
        call.end();
      });

      call.on("error", (error) => {
        if ((error as grpc.ServiceError).code !== grpc.status.CANCELLED) {
          logger("error", `ControlStream error: ${error.message}`);
        }
      });
    },
  };
}

/**
 * Extract correlation_id from a proto message based on its oneof case.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCorrelationId(msg: any, kind: string | undefined): string {
  if (!kind) return "";
  const inner = msg[kind];
  if (!inner) return "";

  // request_headers has correlation_id inside metadata
  if (kind === "request_headers") {
    return inner.metadata?.correlation_id || "";
  }
  return inner.correlation_id || "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a gRPC server with the AgentServiceV2 implementation.
 */
export function createGrpcServer(options: GrpcServerOptions): grpc.Server {
  const logger: LogFn = options.logger || (() => {});
  const server = new grpc.Server();
  const serviceImpl = createServiceImpl(options.handler, logger);

  server.addService(
    agentV2Package.AgentServiceV2.service,
    serviceImpl
  );

  return server;
}

/**
 * Bind and start the gRPC server. Returns the bound port number.
 */
export function startGrpcServer(
  server: grpc.Server,
  address: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      }
    );
  });
}
