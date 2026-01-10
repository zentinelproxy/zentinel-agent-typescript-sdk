/**
 * Blocking Agent - Blocks requests to configured paths.
 *
 * Used for testing block decisions and configuration.
 */

import { ConfigurableAgent, Decision, Request, Response } from "../../../src/index.js";

interface BlockingConfig {
  blockedPaths: string[];
  blockStatus: number;
  blockMessage: string;
}

export class BlockingAgent extends ConfigurableAgent<BlockingConfig> {
  constructor() {
    super({
      blockedPaths: ["/blocked", "/admin", "/secret"],
      blockStatus: 403,
      blockMessage: "Access denied",
    });
  }

  get name() {
    return "blocking-agent";
  }

  parseConfig(configDict: Record<string, unknown>): BlockingConfig {
    return {
      blockedPaths: (configDict.blocked_paths as string[]) ?? this.config.blockedPaths,
      blockStatus: (configDict.block_status as number) ?? this.config.blockStatus,
      blockMessage: (configDict.block_message as string) ?? this.config.blockMessage,
    };
  }

  async onRequest(request: Request): Promise<Decision> {
    for (const blockedPath of this.config.blockedPaths) {
      if (request.pathStartsWith(blockedPath)) {
        return Decision.block(this.config.blockStatus)
          .withJsonBody({
            error: this.config.blockMessage,
            blocked_path: blockedPath,
            requested_path: request.pathOnly,
          })
          .withTag("blocked")
          .withRuleId("PATH_BLOCKED")
          .withMetadata("blocked_path", blockedPath)
          .addResponseHeader("X-Blocked-By", this.name)
          .addResponseHeader("X-Blocked-Path", blockedPath);
      }
    }

    return Decision.allow()
      .addResponseHeader("X-Allowed-By", this.name)
      .withTag("allowed");
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow();
  }
}
