/** Orchestrate rules → Jev → compose. The Pi extension and tests both call this. */

import { classifyRules } from "./rules.ts";
import { buildGateState, gateQuestions, DEFAULT_CONFIG } from "./questions.ts";
import { composeFromRulesAndJev } from "./compose.ts";
import { apiKeyFromEnv, JevClientError, systemOne } from "./client.ts";
import { redactDeep } from "./redact.ts";
import type { GateConfig, GateVerdict, JevAnswers, ToolCallInput } from "./types.ts";

export async function gateToolCall(
  input: ToolCallInput,
  opts: {
    apiKey?: string;
    config?: GateConfig;
    fetchImpl?: typeof fetch;
    /** Inject recorded answers (fixture tests). */
    recorded?: JevAnswers | null;
  } = {},
): Promise<GateVerdict> {
  const config = opts.config ?? DEFAULT_CONFIG;
  const rule = classifyRules(input);
  const apiKey = opts.apiKey ?? apiKeyFromEnv();
  if (rule.terminal) {
    return composeFromRulesAndJev(input, null, Boolean(apiKey), config);
  }
  if (config.requireApiKey && !apiKey) {
    return composeFromRulesAndJev(input, null, false, config);
  }
  if (opts.recorded !== undefined) {
    return composeFromRulesAndJev(input, opts.recorded, Boolean(apiKey), config);
  }
  if (!apiKey) {
    return composeFromRulesAndJev(input, null, false, config);
  }
  try {
    const state = redactDeep(buildGateState(input));
    const answers = await systemOne({
      state,
      questions: gateQuestions(),
      apiKey,
      model: config.model,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
    return composeFromRulesAndJev(input, answers, true, config);
  } catch (err) {
    const reason =
      err instanceof JevClientError
        ? `fail closed: Jev ${err.kind}`
        : "fail closed: Jev request failed";
    return {
      action: "deny",
      source: "fail_closed",
      reason,
      rule,
      raw: {},
    };
  }
}
