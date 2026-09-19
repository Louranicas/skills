/**
 * TypeSafe System One client. Fail closed: missing key or a bad response is
 * an error the gate turns into deny. Never print the key.
 */

import type { JevAnswers, PolicyChoice } from "./types.ts";
import { DEFAULT_CONFIG } from "./questions.ts";

export class JevClientError extends Error {
  readonly kind:
    | "missing_key"
    | "network"
    | "http"
    | "response"
    | "timeout";
  constructor(
    kind: JevClientError["kind"],
    message: string,
  ) {
    super(message);
    this.kind = kind;
    this.name = "JevClientError";
  }
}

export function apiKeyFromEnv(
  env: { TYPESAFE_API_KEY?: string } = process.env,
): string | undefined {
  const key = env.TYPESAFE_API_KEY?.trim();
  return key || undefined;
}

function asPolicyChoice(value: unknown): PolicyChoice {
  if (value === "allow" || value === "ask" || value === "deny" || value === "other") {
    return value;
  }
  return "other";
}

function noulValue(answer: unknown): number | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const n = (answer as { noul?: unknown }).noul;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function parseSystemOne(payload: unknown): JevAnswers {
  if (!payload || typeof payload !== "object") {
    throw new JevClientError("response", "TypeSafe reply was not an object");
  }
  const body = payload as {
    model?: unknown;
    answers?: Record<string, unknown>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const answers = body.answers;
  if (!answers || typeof answers !== "object") {
    throw new JevClientError("response", "TypeSafe reply had no answers");
  }
  const policyRaw = answers.policy as
    | {
        choice?: unknown;
        confidence?: unknown;
        probabilities?: Record<string, unknown>;
      }
    | undefined;
  if (!policyRaw || typeof policyRaw !== "object") {
    throw new JevClientError("response", "TypeSafe reply had no policy Choice");
  }
  const probabilities: Record<string, number> = {};
  if (policyRaw.probabilities && typeof policyRaw.probabilities === "object") {
    for (const [k, v] of Object.entries(policyRaw.probabilities)) {
      if (typeof v === "number" && Number.isFinite(v)) probabilities[k] = v;
    }
  }
  const nouls: Record<string, number> = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (id === "policy") continue;
    const n = noulValue(answer);
    if (n !== undefined) nouls[id] = n;
  }
  const confidence =
    typeof policyRaw.confidence === "number" && Number.isFinite(policyRaw.confidence)
      ? policyRaw.confidence
      : 0;
  return {
    policy: {
      choice: asPolicyChoice(policyRaw.choice),
      confidence,
      probabilities,
    },
    nouls,
    model: typeof body.model === "string" ? body.model : DEFAULT_CONFIG.model,
    usage: body.usage,
  };
}

export async function systemOne(args: {
  state: unknown;
  questions: Record<string, unknown>;
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<JevAnswers> {
  const endpoint = args.endpoint ?? DEFAULT_CONFIG.endpoint;
  const timeoutMs = args.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;
  const fetchImpl = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        state: args.state,
        questions: args.questions,
        model: args.model ?? DEFAULT_CONFIG.model,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new JevClientError(
        "http",
        `TypeSafe HTTP ${response.status}`,
      );
    }
    const json: unknown = await response.json();
    return parseSystemOne(json);
  } catch (err) {
    if (err instanceof JevClientError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new JevClientError("timeout", "TypeSafe request timed out");
    }
    throw new JevClientError(
      "network",
      err instanceof Error ? err.message : "TypeSafe request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}
