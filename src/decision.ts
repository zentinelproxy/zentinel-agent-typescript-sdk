/**
 * Decision builder for fluent API responses.
 */

import {
  AgentResponse,
  createAgentResponse,
  createAuditMetadata,
  HeaderOp,
  AuditMetadata,
} from "./protocol.js";

export class Decision {
  private _decision: string | Record<string, unknown> = "allow";
  private _requestHeaders: HeaderOp[] = [];
  private _responseHeaders: HeaderOp[] = [];
  private _routingMetadata: Record<string, string> = {};
  private _audit: AuditMetadata = createAuditMetadata();
  private _needsMore = false;
  private _requestBodyMutation?: Record<string, unknown>;
  private _responseBodyMutation?: Record<string, unknown>;

  constructor(decision: string | Record<string, unknown> = "allow") {
    this._decision = decision;
  }

  static allow(): Decision {
    return new Decision("allow");
  }

  static block(status = 403): Decision {
    return new Decision({ block: { status } });
  }

  static deny(): Decision {
    return Decision.block(403);
  }

  static unauthorized(): Decision {
    return Decision.block(401);
  }

  static rateLimited(): Decision {
    return Decision.block(429);
  }

  static redirect(url: string, status = 302): Decision {
    return new Decision({ redirect: { url, status } });
  }

  static redirectPermanent(url: string): Decision {
    return Decision.redirect(url, 301);
  }

  static challenge(challengeType: string, params?: Record<string, unknown>): Decision {
    const challengeData: Record<string, unknown> = { challenge_type: challengeType };
    if (params) {
      challengeData.params = params;
    }
    return new Decision({ challenge: challengeData });
  }

  withBody(body: string): Decision {
    if (typeof this._decision === "object" && "block" in this._decision) {
      (this._decision.block as Record<string, unknown>).body = body;
    }
    return this;
  }

  withJsonBody(value: unknown): Decision {
    if (typeof this._decision === "object" && "block" in this._decision) {
      const blockDecision = this._decision.block as Record<string, unknown>;
      blockDecision.body = JSON.stringify(value);
      if (!blockDecision.headers) {
        blockDecision.headers = {};
      }
      (blockDecision.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
    return this;
  }

  withBlockHeader(name: string, value: string): Decision {
    if (typeof this._decision === "object" && "block" in this._decision) {
      const blockDecision = this._decision.block as Record<string, unknown>;
      if (!blockDecision.headers) {
        blockDecision.headers = {};
      }
      (blockDecision.headers as Record<string, string>)[name] = value;
    }
    return this;
  }

  addRequestHeader(name: string, value: string): Decision {
    this._requestHeaders.push({ operation: "set", name, value });
    return this;
  }

  removeRequestHeader(name: string): Decision {
    this._requestHeaders.push({ operation: "remove", name });
    return this;
  }

  addResponseHeader(name: string, value: string): Decision {
    this._responseHeaders.push({ operation: "set", name, value });
    return this;
  }

  removeResponseHeader(name: string): Decision {
    this._responseHeaders.push({ operation: "remove", name });
    return this;
  }

  withRoutingMetadata(key: string, value: string): Decision {
    this._routingMetadata[key] = value;
    return this;
  }

  withTag(tag: string): Decision {
    this._audit.tags.push(tag);
    return this;
  }

  withTags(tags: string[]): Decision {
    this._audit.tags.push(...tags);
    return this;
  }

  withRuleId(ruleId: string): Decision {
    this._audit.ruleIds.push(ruleId);
    return this;
  }

  withConfidence(confidence: number): Decision {
    this._audit.confidence = confidence;
    return this;
  }

  withReasonCode(code: string): Decision {
    this._audit.reasonCodes.push(code);
    return this;
  }

  withMetadata(key: string, value: unknown): Decision {
    this._audit.custom[key] = value;
    return this;
  }

  needsMoreData(): Decision {
    this._needsMore = true;
    return this;
  }

  withRequestBodyMutation(data: Buffer | null, chunkIndex = 0): Decision {
    this._requestBodyMutation = {
      data: data !== null ? data.toString("base64") : null,
      chunk_index: chunkIndex,
    };
    return this;
  }

  withResponseBodyMutation(data: Buffer | null, chunkIndex = 0): Decision {
    this._responseBodyMutation = {
      data: data !== null ? data.toString("base64") : null,
      chunk_index: chunkIndex,
    };
    return this;
  }

  build(): AgentResponse {
    const response = createAgentResponse();
    response.decision = this._decision;
    response.requestHeaders = this._requestHeaders;
    response.responseHeaders = this._responseHeaders;
    response.routingMetadata = this._routingMetadata;
    response.audit = this._audit;
    response.needsMore = this._needsMore;
    response.requestBodyMutation = this._requestBodyMutation;
    response.responseBodyMutation = this._responseBodyMutation;
    return response;
  }
}

export const decisions = {
  allow(): Decision {
    return Decision.allow();
  },

  deny(): Decision {
    return Decision.deny();
  },

  unauthorized(): Decision {
    return Decision.unauthorized();
  },

  rateLimited(): Decision {
    return Decision.rateLimited();
  },

  block(status: number, body?: string): Decision {
    const d = Decision.block(status);
    if (body) {
      d.withBody(body);
    }
    return d;
  },

  redirect(url: string, permanent = false): Decision {
    if (permanent) {
      return Decision.redirectPermanent(url);
    }
    return Decision.redirect(url);
  },
};
