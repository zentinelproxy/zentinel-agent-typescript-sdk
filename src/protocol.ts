/**
 * Protocol definitions for Sentinel agent communication.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB

export enum EventType {
  REQUEST_HEADERS = "request_headers",
  REQUEST_BODY_CHUNK = "request_body_chunk",
  RESPONSE_HEADERS = "response_headers",
  RESPONSE_BODY_CHUNK = "response_body_chunk",
  REQUEST_COMPLETE = "request_complete",
  WEBSOCKET_FRAME = "websocket_frame",
  CONFIGURE = "configure",
}

export interface RequestMetadata {
  correlationId: string;
  requestId: string;
  clientIp: string;
  clientPort: number;
  serverName?: string;
  protocol: string;
  tlsVersion?: string;
  tlsCipher?: string;
  routeId?: string;
  upstreamId?: string;
  timestamp?: string;
  traceparent?: string;
}

export function parseRequestMetadata(data: Record<string, unknown>): RequestMetadata {
  return {
    correlationId: (data.correlation_id as string) || "",
    requestId: (data.request_id as string) || "",
    clientIp: (data.client_ip as string) || "",
    clientPort: (data.client_port as number) || 0,
    serverName: data.server_name as string | undefined,
    protocol: (data.protocol as string) || "HTTP/1.1",
    tlsVersion: data.tls_version as string | undefined,
    tlsCipher: data.tls_cipher as string | undefined,
    routeId: data.route_id as string | undefined,
    upstreamId: data.upstream_id as string | undefined,
    timestamp: data.timestamp as string | undefined,
    traceparent: data.traceparent as string | undefined,
  };
}

export interface RequestHeadersEvent {
  metadata: RequestMetadata;
  method: string;
  uri: string;
  headers: Record<string, string[]>;
}

export function parseRequestHeadersEvent(data: Record<string, unknown>): RequestHeadersEvent {
  return {
    metadata: parseRequestMetadata((data.metadata as Record<string, unknown>) || {}),
    method: (data.method as string) || "GET",
    uri: (data.uri as string) || "/",
    headers: (data.headers as Record<string, string[]>) || {},
  };
}

export interface RequestBodyChunkEvent {
  correlationId: string;
  data: Buffer;
  chunkIndex: number;
  isLast: boolean;
  totalSize?: number;
  bytesReceived: number;
}

export function parseRequestBodyChunkEvent(data: Record<string, unknown>): RequestBodyChunkEvent {
  const rawData = (data.data as string) || "";
  const decoded = rawData ? Buffer.from(rawData, "base64") : Buffer.alloc(0);
  return {
    correlationId: (data.correlation_id as string) || "",
    data: decoded,
    chunkIndex: (data.chunk_index as number) || 0,
    isLast: (data.is_last as boolean) ?? true,
    totalSize: data.total_size as number | undefined,
    bytesReceived: (data.bytes_received as number) || 0,
  };
}

export interface ResponseHeadersEvent {
  correlationId: string;
  status: number;
  headers: Record<string, string[]>;
}

export function parseResponseHeadersEvent(data: Record<string, unknown>): ResponseHeadersEvent {
  return {
    correlationId: (data.correlation_id as string) || "",
    status: (data.status as number) || 200,
    headers: (data.headers as Record<string, string[]>) || {},
  };
}

export interface ResponseBodyChunkEvent {
  correlationId: string;
  data: Buffer;
  chunkIndex: number;
  isLast: boolean;
  totalSize?: number;
  bytesReceived: number;
}

export function parseResponseBodyChunkEvent(data: Record<string, unknown>): ResponseBodyChunkEvent {
  const rawData = (data.data as string) || "";
  const decoded = rawData ? Buffer.from(rawData, "base64") : Buffer.alloc(0);
  return {
    correlationId: (data.correlation_id as string) || "",
    data: decoded,
    chunkIndex: (data.chunk_index as number) || 0,
    isLast: (data.is_last as boolean) ?? true,
    totalSize: data.total_size as number | undefined,
    bytesReceived: (data.bytes_received as number) || 0,
  };
}

export interface RequestCompleteEvent {
  correlationId: string;
  status: number;
  durationMs: number;
  requestSize: number;
  responseSize: number;
  error?: string;
}

export function parseRequestCompleteEvent(data: Record<string, unknown>): RequestCompleteEvent {
  return {
    correlationId: (data.correlation_id as string) || "",
    status: (data.status as number) || 0,
    durationMs: (data.duration_ms as number) || 0,
    requestSize: (data.request_size as number) || 0,
    responseSize: (data.response_size as number) || 0,
    error: data.error as string | undefined,
  };
}

export interface WebSocketFrameEvent {
  correlationId: string;
  opcode: number;
  data: Buffer;
  direction: "client_to_server" | "server_to_client";
  frameIndex: number;
}

export function parseWebSocketFrameEvent(data: Record<string, unknown>): WebSocketFrameEvent {
  const rawData = (data.data as string) || "";
  const decoded = rawData ? Buffer.from(rawData, "base64") : Buffer.alloc(0);
  return {
    correlationId: (data.correlation_id as string) || "",
    opcode: (data.opcode as number) || 1,
    data: decoded,
    direction: (data.direction as "client_to_server" | "server_to_client") || "client_to_server",
    frameIndex: (data.frame_index as number) || 0,
  };
}

export interface ConfigureEvent {
  agentId: string;
  config: Record<string, unknown>;
}

export function parseConfigureEvent(data: Record<string, unknown>): ConfigureEvent {
  return {
    agentId: (data.agent_id as string) || "",
    config: (data.config as Record<string, unknown>) || {},
  };
}

export type HeaderOperation = "set" | "add" | "remove";

export interface HeaderOp {
  operation: HeaderOperation;
  name: string;
  value?: string;
}

export function headerOpToDict(op: HeaderOp): Record<string, unknown> {
  if (op.operation === "remove") {
    return { remove: { name: op.name } };
  }
  return { [op.operation]: { name: op.name, value: op.value || "" } };
}

export interface AuditMetadata {
  tags: string[];
  ruleIds: string[];
  confidence?: number;
  reasonCodes: string[];
  custom: Record<string, unknown>;
}

export function createAuditMetadata(): AuditMetadata {
  return {
    tags: [],
    ruleIds: [],
    confidence: undefined,
    reasonCodes: [],
    custom: {},
  };
}

export function auditMetadataToDict(audit: AuditMetadata): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (audit.tags.length > 0) {
    result.tags = audit.tags;
  }
  if (audit.ruleIds.length > 0) {
    result.rule_ids = audit.ruleIds;
  }
  if (audit.confidence !== undefined) {
    result.confidence = audit.confidence;
  }
  if (audit.reasonCodes.length > 0) {
    result.reason_codes = audit.reasonCodes;
  }
  if (Object.keys(audit.custom).length > 0) {
    result.custom = audit.custom;
  }
  return result;
}

export interface AgentResponse {
  version: number;
  decision: string | Record<string, unknown>;
  requestHeaders: HeaderOp[];
  responseHeaders: HeaderOp[];
  routingMetadata: Record<string, string>;
  audit: AuditMetadata;
  needsMore: boolean;
  requestBodyMutation?: Record<string, unknown>;
  responseBodyMutation?: Record<string, unknown>;
  websocketDecision?: Record<string, unknown>;
}

export function createAgentResponse(): AgentResponse {
  return {
    version: PROTOCOL_VERSION,
    decision: "allow",
    requestHeaders: [],
    responseHeaders: [],
    routingMetadata: {},
    audit: createAuditMetadata(),
    needsMore: false,
  };
}

export function agentResponseToDict(response: AgentResponse): Record<string, unknown> {
  return {
    version: response.version,
    decision: response.decision,
    request_headers: response.requestHeaders.map(headerOpToDict),
    response_headers: response.responseHeaders.map(headerOpToDict),
    routing_metadata: response.routingMetadata,
    audit: auditMetadataToDict(response.audit),
    needs_more: response.needsMore,
    request_body_mutation: response.requestBodyMutation,
    response_body_mutation: response.responseBodyMutation,
    websocket_decision: response.websocketDecision,
  };
}

export function encodeMessage(data: Record<string, unknown>): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(data), "utf-8");
  const length = jsonBytes.length;
  if (length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message size ${length} exceeds maximum ${MAX_MESSAGE_SIZE}`);
  }
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(length, 0);
  return Buffer.concat([lengthBuffer, jsonBytes]);
}

export function decodeMessage(data: Buffer): Record<string, unknown> {
  if (data.length < 4) {
    throw new Error("Message too short to contain length prefix");
  }
  const length = data.readUInt32BE(0);
  if (length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message size ${length} exceeds maximum ${MAX_MESSAGE_SIZE}`);
  }
  const jsonBytes = data.subarray(4, 4 + length);
  return JSON.parse(jsonBytes.toString("utf-8")) as Record<string, unknown>;
}
