/**
 * Core Agent interface and base classes.
 */

import { Decision } from "./decision.js";
import { Request } from "./request.js";
import { Response } from "./response.js";

/**
 * Base interface for Sentinel agents.
 *
 * Implement this interface to create a custom agent that can process
 * HTTP requests and responses in the Sentinel proxy pipeline.
 *
 * @example
 * ```typescript
 * class MyAgent implements Agent {
 *   get name(): string {
 *     return "my-agent";
 *   }
 *
 *   async onRequest(request: Request): Promise<Decision> {
 *     if (request.pathStartsWith("/blocked")) {
 *       return Decision.deny().withBody("Blocked");
 *     }
 *     return Decision.allow();
 *   }
 * }
 * ```
 */
export interface Agent {
  /**
   * Return the agent name for logging.
   */
  readonly name: string;

  /**
   * Handle configuration from the proxy.
   *
   * Called once when the agent connects to the proxy.
   * Override to validate and store configuration.
   *
   * @param config - Configuration dictionary from proxy.
   * @throws Error if configuration is invalid.
   */
  onConfigure?(config: Record<string, unknown>): Promise<void>;

  /**
   * Process incoming request headers.
   *
   * Called when request headers are received from the client.
   * Override to implement request inspection and filtering.
   *
   * @param request - The incoming request.
   * @returns A Decision indicating how to handle the request.
   */
  onRequest?(request: Request): Promise<Decision>;

  /**
   * Process request body.
   *
   * Called when request body is available (if body inspection enabled).
   * Override to inspect or modify request body content.
   *
   * @param request - The request with body populated.
   * @returns A Decision indicating how to handle the request.
   */
  onRequestBody?(request: Request): Promise<Decision>;

  /**
   * Process response headers from upstream.
   *
   * Called when response headers are received from the upstream server.
   * Override to inspect or modify response headers.
   *
   * @param request - The original request.
   * @param response - The response from upstream.
   * @returns A Decision indicating how to handle the response.
   */
  onResponse?(request: Request, response: Response): Promise<Decision>;

  /**
   * Process response body.
   *
   * Called when response body is available (if body inspection enabled).
   * Override to inspect or modify response body content.
   *
   * @param request - The original request.
   * @param response - The response with body populated.
   * @returns A Decision indicating how to handle the response.
   */
  onResponseBody?(request: Request, response: Response): Promise<Decision>;

  /**
   * Called when request processing is complete.
   *
   * Override for logging, metrics, or cleanup.
   *
   * @param request - The completed request.
   * @param status - The final response status code.
   * @param durationMs - The request duration in milliseconds.
   */
  onRequestComplete?(request: Request, status: number, durationMs: number): Promise<void>;
}

/**
 * Abstract base class for agents with typed configuration support.
 *
 * Extend this class when your agent needs structured configuration.
 *
 * @example
 * ```typescript
 * interface MyConfig {
 *   rateLimit: number;
 *   enabled: boolean;
 * }
 *
 * class MyAgent extends ConfigurableAgent<MyConfig> {
 *   constructor() {
 *     super({ rateLimit: 100, enabled: true });
 *   }
 *
 *   get name(): string {
 *     return "my-agent";
 *   }
 *
 *   async onRequest(request: Request): Promise<Decision> {
 *     if (!this.config.enabled) {
 *       return Decision.allow();
 *     }
 *     // Use this.config.rateLimit...
 *     return Decision.allow();
 *   }
 * }
 * ```
 */
export abstract class ConfigurableAgent<T> implements Agent {
  private _config: T;

  /**
   * Initialize with default configuration.
   *
   * @param defaultConfig - The default configuration instance.
   */
  constructor(defaultConfig: T) {
    this._config = defaultConfig;
  }

  /**
   * The agent name for logging.
   */
  abstract get name(): string;

  /**
   * Get the current configuration.
   */
  get config(): T {
    return this._config;
  }

  /**
   * Parse configuration dictionary into typed config.
   *
   * Override this method to customize config parsing.
   * Default implementation merges with default config.
   *
   * @param configDict - The configuration dictionary.
   * @returns The parsed configuration instance.
   */
  parseConfig(configDict: Record<string, unknown>): T {
    // Simple merge with default config
    return { ...this._config, ...configDict } as T;
  }

  /**
   * Handle configuration from the proxy.
   *
   * Parses the config dict and stores it. Override parseConfig
   * to customize parsing behavior.
   *
   * @param config - Configuration dictionary from proxy.
   */
  async onConfigure(config: Record<string, unknown>): Promise<void> {
    this._config = this.parseConfig(config);
    await this.onConfigApplied(this._config);
  }

  /**
   * Called after configuration is applied.
   *
   * Override for any post-configuration setup.
   *
   * @param config - The newly applied configuration.
   */
  async onConfigApplied(_config: T): Promise<void> {
    // Default implementation does nothing
  }

  async onRequest(_request: Request): Promise<Decision> {
    return Decision.allow();
  }

  async onRequestBody(_request: Request): Promise<Decision> {
    return Decision.allow();
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow();
  }

  async onResponseBody(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow();
  }

  async onRequestComplete(
    _request: Request,
    _status: number,
    _durationMs: number
  ): Promise<void> {
    // Default implementation does nothing
  }
}
