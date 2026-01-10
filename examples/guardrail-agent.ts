#!/usr/bin/env npx tsx
/**
 * Guardrail agent example for AI content safety.
 *
 * This example demonstrates a guardrail agent that:
 * - Detects prompt injection attempts in user input
 * - Detects PII (emails, phone numbers, SSN patterns)
 * - Returns structured detection results with confidence scores
 */

import {
  Agent,
  Decision,
  Request,
  runAgent,
  GuardrailInspectEvent,
  GuardrailResponse,
  GuardrailResponseBuilder,
  createGuardrailDetection,
  DetectionSeverity,
  GuardrailInspectionType,
} from "../src/index.js";

// Prompt injection patterns
const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i, "ignore_instructions"],
  [/disregard\s+(all\s+)?(previous|prior|above)/i, "disregard_previous"],
  [/you\s+are\s+now\s+(a|an|in)\s+/i, "role_switch"],
  [/pretend\s+(you('re|are)|to\s+be)/i, "pretend_role"],
  [/system\s*:\s*/i, "system_prompt_inject"],
  [/\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>/i, "llama_format_inject"],
  [/<\|im_start\|>|<\|im_end\|>/i, "chatml_format_inject"],
];

// PII patterns
const PII_PATTERNS: Array<[RegExp, string, string]> = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "email", "Email address"],
  [/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "phone", "Phone number"],
  [/\b\d{3}[-]?\d{2}[-]?\d{4}\b/g, "ssn", "Social Security Number"],
  [/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, "credit_card", "Credit card number"],
];

class GuardrailAgent implements Agent {
  get name(): string {
    return "guardrail-agent";
  }

  async onRequest(_request: Request): Promise<Decision> {
    // Allow all requests - guardrail inspection happens via onGuardrailInspect
    return Decision.allow();
  }

  async onGuardrailInspect(event: GuardrailInspectEvent): Promise<GuardrailResponse> {
    if (event.inspectionType === GuardrailInspectionType.PROMPT_INJECTION) {
      return this.detectPromptInjection(event.content);
    } else if (event.inspectionType === GuardrailInspectionType.PII_DETECTION) {
      return this.detectPii(event.content);
    }
    return GuardrailResponseBuilder.clean().build();
  }

  private detectPromptInjection(content: string): GuardrailResponse {
    let builder = GuardrailResponseBuilder.clean();

    for (const [pattern, category] of INJECTION_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        const detection = createGuardrailDetection(
          `prompt_injection.${category}`,
          `Potential prompt injection detected: ${category.replace(/_/g, " ")}`
        );
        detection.severity = DetectionSeverity.HIGH;
        detection.confidence = 0.85;
        detection.span = { start: match.index, end: match.index + match[0].length };

        builder = builder.addDetection(detection);
      }
    }

    return builder.build();
  }

  private detectPii(content: string): GuardrailResponse {
    let builder = GuardrailResponseBuilder.clean();
    let redacted = content;

    for (const [pattern, category, description] of PII_PATTERNS) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const detection = createGuardrailDetection(
          `pii.${category}`,
          `${description} detected`
        );
        detection.severity = DetectionSeverity.MEDIUM;
        detection.confidence = 0.95;
        detection.span = { start: match.index, end: match.index + match[0].length };

        builder = builder.addDetection(detection);
        redacted = redacted.replace(match[0], `[REDACTED_${category.toUpperCase()}]`);
      }
    }

    const response = builder.build();
    if (response.detected) {
      return builder.withRedactedContent(redacted).build();
    }

    return response;
  }
}

runAgent(new GuardrailAgent());
