/**
 * Event handler for agents written against the root `Agent` interface.
 *
 * It is the v2 handler (`zentinel-agent-sdk/v2`'s `AgentHandlerV2`) with the
 * agent's capabilities derived from its name: there is one protocol, v2, and
 * one implementation of it.
 */

import { Agent } from "./agent.js";
import { asAgentV2 } from "./v2/agent.js";
import { AgentHandlerV2 } from "./v2/handler.js";

export class AgentHandler extends AgentHandlerV2 {
  constructor(agent: Agent, logger?: (level: string, message: string) => void) {
    super(asAgentV2(agent), logger);
  }
}
