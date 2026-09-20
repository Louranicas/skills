/**
 * Model-facing Jev access: one System One request, answers back as JSON.
 * Fail closed without TYPESAFE_API_KEY. Never print the key.
 */

import { apiKeyFromEnv, JevClientError } from "./client.ts";
import { DEFAULT_CONFIG } from "./questions.ts";
import { redactDeep } from "./redact.ts";

export interface JevAskInput {
  state: unknown;
  questions: Record<string, unknown>;
  model?: string;
}

export async function askJev(
  input: JevAskInput,
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; model: string; answers: unknown } | { ok: false; error: string }> {
  const apiKey = opts.apiKey ?? apiKeyFromEnv();
  if (!apiKey) {
    return {
      ok: false,
      error: "fail closed: TYPESAFE_API_KEY is missing; Jev was not called",
    };
  }
  if (!input.questions || typeof input.questions !== "object" || Array.isArray(input.questions)) {
    return { ok: false, error: "questions must be an object of Choice/Noul/Score specs" };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(DEFAULT_CONFIG.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        state: redactDeep(input.state ?? {}),
        questions: input.questions,
        model: input.model ?? DEFAULT_CONFIG.model,
      }),
    });
    if (!response.ok) {
      return { ok: false, error: `fail closed: TypeSafe HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { model?: string; answers?: unknown };
    return {
      ok: true,
      model: typeof payload.model === "string" ? payload.model : DEFAULT_CONFIG.model,
      answers: payload.answers ?? {},
    };
  } catch (err) {
    if (err instanceof JevClientError) {
      return { ok: false, error: `fail closed: Jev ${err.kind}` };
    }
    return { ok: false, error: "fail closed: Jev request failed" };
  }
}

export function formatJevAskResult(
  result: Awaited<ReturnType<typeof askJev>>,
): string {
  return JSON.stringify(result, null, 2);
}
