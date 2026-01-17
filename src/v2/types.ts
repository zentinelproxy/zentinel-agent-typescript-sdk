/**
 * Protocol v2 type definitions.
 */

export const PROTOCOL_VERSION_2 = 2;

/**
 * Reason for agent shutdown request.
 */
export type ShutdownReason =
  | "proxy_shutdown"
  | "config_reload"
  | "admin_request"
  | "health_check_failed";

/**
 * Reason for agent drain request.
 */
export type DrainReason =
  | "config_reload"
  | "rolling_update"
  | "maintenance"
  | "load_shedding";

/**
 * Health state of the agent.
 */
export type HealthState = "healthy" | "degraded" | "unhealthy";

/**
 * Features supported by the agent.
 */
export interface AgentFeatures {
  streamingBody: boolean;
  websocket: boolean;
  guardrails: boolean;
  configPush: boolean;
  metricsExport: boolean;
  concurrentRequests: number;
  cancellation: boolean;
  flowControl: boolean;
  healthReporting: boolean;
}

/**
 * Resource limits for the agent.
 */
export interface AgentLimits {
  maxBodySize: number;
  preferredChunkSize: number;
  maxProcessingTimeMs?: number;
}

/**
 * Health reporting configuration.
 */
export interface HealthConfig {
  reportIntervalMs: number;
  timeoutMs: number;
}

/**
 * Agent capabilities for v2 handshake.
 */
export interface AgentCapabilitiesData {
  agentId: string;
  name: string;
  version: string;
  features: AgentFeatures;
  limits: AgentLimits;
  health: HealthConfig;
}

/**
 * Agent capabilities builder with fluent API.
 */
export class AgentCapabilities implements AgentCapabilitiesData {
  agentId: string;
  name: string;
  version: string;
  features: AgentFeatures;
  limits: AgentLimits;
  health: HealthConfig;

  constructor(agentId: string, name: string, version: string) {
    this.agentId = agentId;
    this.name = name;
    this.version = version;
    this.features = {
      streamingBody: false,
      websocket: false,
      guardrails: false,
      configPush: false,
      metricsExport: false,
      concurrentRequests: 10,
      cancellation: false,
      flowControl: false,
      healthReporting: false,
    };
    this.limits = {
      maxBodySize: 10 * 1024 * 1024, // 10MB
      preferredChunkSize: 64 * 1024, // 64KB
    };
    this.health = {
      reportIntervalMs: 30000,
      timeoutMs: 5000,
    };
  }

  withStreamingBody(enabled = true): this {
    this.features.streamingBody = enabled;
    return this;
  }

  withWebsocket(enabled = true): this {
    this.features.websocket = enabled;
    return this;
  }

  withGuardrails(enabled = true): this {
    this.features.guardrails = enabled;
    return this;
  }

  withConfigPush(enabled = true): this {
    this.features.configPush = enabled;
    return this;
  }

  withMetricsExport(enabled = true): this {
    this.features.metricsExport = enabled;
    return this;
  }

  withConcurrentRequests(max: number): this {
    this.features.concurrentRequests = max;
    return this;
  }

  withCancellation(enabled = true): this {
    this.features.cancellation = enabled;
    return this;
  }

  withFlowControl(enabled = true): this {
    this.features.flowControl = enabled;
    return this;
  }

  withHealthReporting(enabled = true): this {
    this.features.healthReporting = enabled;
    return this;
  }

  withMaxBodySize(size: number): this {
    this.limits.maxBodySize = size;
    return this;
  }

  withPreferredChunkSize(size: number): this {
    this.limits.preferredChunkSize = size;
    return this;
  }

  withMaxProcessingTimeMs(ms: number): this {
    this.limits.maxProcessingTimeMs = ms;
    return this;
  }

  withHealthIntervalMs(ms: number): this {
    this.health.reportIntervalMs = ms;
    return this;
  }

  toJSON(): Record<string, unknown> {
    return {
      agent_id: this.agentId,
      name: this.name,
      version: this.version,
      features: {
        streaming_body: this.features.streamingBody,
        websocket: this.features.websocket,
        guardrails: this.features.guardrails,
        config_push: this.features.configPush,
        metrics_export: this.features.metricsExport,
        concurrent_requests: this.features.concurrentRequests,
        cancellation: this.features.cancellation,
        flow_control: this.features.flowControl,
        health_reporting: this.features.healthReporting,
      },
      limits: {
        max_body_size: this.limits.maxBodySize,
        preferred_chunk_size: this.limits.preferredChunkSize,
        max_processing_time_ms: this.limits.maxProcessingTimeMs,
      },
      health: {
        report_interval_ms: this.health.reportIntervalMs,
        timeout_ms: this.health.timeoutMs,
      },
    };
  }
}

/**
 * Health status report from the agent.
 */
export interface HealthStatusData {
  agentId: string;
  state: HealthState;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Health status with factory methods.
 */
export class HealthStatus implements HealthStatusData {
  agentId: string;
  state: HealthState;
  message?: string;
  details?: Record<string, unknown>;

  constructor(agentId: string, state: HealthState = "healthy") {
    this.agentId = agentId;
    this.state = state;
  }

  isHealthy(): boolean {
    return this.state === "healthy";
  }

  static healthy(agentId: string): HealthStatus {
    return new HealthStatus(agentId, "healthy");
  }

  static degraded(agentId: string, message: string): HealthStatus {
    const status = new HealthStatus(agentId, "degraded");
    status.message = message;
    return status;
  }

  static unhealthy(agentId: string, message: string): HealthStatus {
    const status = new HealthStatus(agentId, "unhealthy");
    status.message = message;
    return status;
  }

  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      agent_id: this.agentId,
      state: this.state,
    };
    if (this.message) {
      result.message = this.message;
    }
    if (this.details) {
      result.details = this.details;
    }
    return result;
  }
}

/**
 * Metrics report from the agent.
 */
export interface MetricsReport {
  agentId: string;
  timestamp: string;
  metrics: Record<string, number>;
  labels?: Record<string, string>;
}

/**
 * Handshake request from proxy to agent.
 */
export interface HandshakeRequest {
  supportedVersions: number[];
  proxyId: string;
  proxyVersion: string;
  config?: Record<string, unknown>;
}

/**
 * Handshake response from agent to proxy.
 */
export interface HandshakeResponse {
  success: boolean;
  capabilities?: AgentCapabilitiesData;
  error?: string;
}

/**
 * Create a successful handshake response.
 */
export function createSuccessHandshake(capabilities: AgentCapabilities): HandshakeResponse {
  return {
    success: true,
    capabilities: capabilities,
  };
}

/**
 * Create a failed handshake response.
 */
export function createFailedHandshake(error: string): HandshakeResponse {
  return {
    success: false,
    error,
  };
}
