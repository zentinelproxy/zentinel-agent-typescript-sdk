#!/usr/bin/env npx tsx
/**
 * WebSocket filtering agent example.
 *
 * This example demonstrates an agent that:
 * - Inspects WebSocket text frames for suspicious patterns
 * - Blocks frames containing SQL injection or script injection
 * - Logs WebSocket traffic direction and frame metadata
 * - Allows binary and control frames through unmodified
 */

import {
  Agent,
  Decision,
  Request,
  Response,
  WebSocketFrameEvent,
  runAgent,
} from "../src/index.js";

// Patterns to block in WebSocket text messages
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/DROP\s+TABLE/i, "sql_injection"],
  [/UNION\s+SELECT/i, "sql_injection"],
  [/<script\b[^>]*>/i, "xss"],
  [/eval\s*\(/i, "code_injection"],
  [/javascript\s*:/i, "xss"],
];

class WebSocketFilterAgent implements Agent {
  private _frameCount = 0;

  get name(): string {
    return "websocket-filter";
  }

  async onRequest(request: Request): Promise<Decision> {
    return Decision.allow();
  }

  async onResponse(_request: Request, _response: Response): Promise<Decision> {
    return Decision.allow();
  }

  async onWebSocketFrame(event: WebSocketFrameEvent): Promise<Decision> {
    this._frameCount++;

    // Only inspect text frames (opcode 1)
    // Allow binary (2), ping (3), pong (4), close (5) through
    if (event.opcode !== 1) {
      return Decision.allow();
    }

    const message = event.data.toString("utf-8");
    const direction = event.direction === "client_to_server" ? "C->S" : "S->C";

    console.log(
      `[${direction}] Frame #${event.frameIndex} (${event.data.length} bytes): ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`
    );

    // Check for blocked patterns
    for (const [pattern, category] of BLOCKED_PATTERNS) {
      if (pattern.test(message)) {
        console.log(
          `[BLOCKED] ${category} detected in frame #${event.frameIndex}`
        );

        return Decision.block(403)
          .withBody("WebSocket message blocked")
          .withTag("websocket-blocked")
          .withTag(category)
          .withRuleId(`WS-${category.toUpperCase()}`)
          .withMetadata("direction", event.direction)
          .withMetadata("frame_index", event.frameIndex)
          .withConfidence(0.9);
      }
    }

    return Decision.allow();
  }

  async onRequestComplete(
    _request: Request,
    status: number,
    durationMs: number
  ): Promise<void> {
    console.log(
      `Connection closed: status=${status}, duration=${durationMs}ms, frames=${this._frameCount}`
    );
  }
}

runAgent(new WebSocketFilterAgent());
