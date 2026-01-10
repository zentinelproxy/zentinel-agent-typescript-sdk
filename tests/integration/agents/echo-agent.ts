/**
 * Echo Agent - Echoes request information as response headers.
 *
 * Used for testing header mutation and request inspection.
 */

import { ConfigurableAgent, Decision, Request, Response } from "../../../src/index.js";

interface EchoConfig {
  prefix: string;
  includeBody: boolean;
}

export class EchoAgent extends ConfigurableAgent<EchoConfig> {
  constructor() {
    super({
      prefix: "X-Echo-",
      includeBody: false,
    });
  }

  get name() {
    return "echo-agent";
  }

  async onRequest(request: Request): Promise<Decision> {
    const prefix = this.config.prefix;

    return Decision.allow()
      .addResponseHeader(`${prefix}Method`, request.method)
      .addResponseHeader(`${prefix}Path`, request.pathOnly)
      .addResponseHeader(`${prefix}ClientIp`, request.clientIp)
      .addResponseHeader(`${prefix}CorrelationId`, request.correlationId)
      .withTag("echo")
      .withMetadata("echoed_path", request.pathOnly);
  }

  async onRequestBody(request: Request): Promise<Decision> {
    if (this.config.includeBody && request.body.length > 0) {
      return Decision.allow()
        .addResponseHeader(`${this.config.prefix}BodyLength`, String(request.body.length));
    }
    return Decision.allow();
  }

  async onResponse(request: Request, response: Response): Promise<Decision> {
    const prefix = this.config.prefix;

    return Decision.allow()
      .addResponseHeader(`${prefix}Status`, String(response.statusCode))
      .addResponseHeader(`${prefix}RequestUri`, request.uri);
  }
}
