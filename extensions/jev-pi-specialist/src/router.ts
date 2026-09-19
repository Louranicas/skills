/**
 * Jev task/model router. Cheap lane for trivial work; Jev specialist for
 * typed judgments; coding model for real implementation; ask when unclear.
 * Do not spawn an advanced agent for a simple task.
 */

import { DEFAULT_CONFIG } from "./questions.ts";
import { redactDeep } from "./redact.ts";

export type Lane = "simple" | "jev_specialist" | "coding" | "ask" | "other";

export interface RouteVerdict {
  lane: Lane;
  reason: string;
  source: "jev" | "fail_closed";
  raw: Record<string, number>;
}

export const ROUTE_CRITERIA = {
  simple: {
    what: "A trivial mechanical task: rename, typo, format, list files, or a one-line lookup.",
    not_for: "New behavior, safety-sensitive tool use, or multi-file design.",
    examples: ["fix a typo in README", "rename a local variable"],
  },
  jev_specialist: {
    what: "The work is a typed judgment: route, gate, rank, extract a closed set, or calibrate a threshold.",
    not_for: "Writing a large feature, or a purely mechanical edit.",
    examples: ["gate this bash command", "which skill fits this request"],
  },
  coding: {
    what: "Implementation that needs an ordinary coding model: multi-file edits, tests, refactors.",
    not_for: "A one-line typo, or a yes/no Jev question with no code change.",
    examples: ["add the tool-gate tests", "refactor compose.ts"],
  },
  ask: {
    what: "A person must choose: product scope, destructive action, or missing intent.",
    not_for: "Work the agent can finish from the request as written.",
    examples: ["delete the production branch", "which of two product directions"],
  },
  other: {
    what: "None of simple, jev_specialist, coding, or ask is a good fit.",
    not_for: "A request that is clearly one of the four.",
    examples: ["empty or contradictory request"],
  },
} as const;

export const ROUTE_NOULS: Record<string, string> = {
  is_trivial:
    "Is this request a trivial mechanical edit or lookup that a cheap fast model can finish without design?",
  needs_semantic_judgment:
    "Does this request need a typed System One judgment (route, gate, rank, extract, or yes/no over state) rather than generating code or prose?",
  needs_heavy_reasoning:
    "Does this request need a strong coding or reasoning model because it is multi-file, ambiguous, or safety-sensitive implementation?",
};

export function routeQuestions(): Record<string, unknown> {
  const questions: Record<string, unknown> = {
    lane: {
      type: "choice",
      instructions: {
        question: "Which work lane should handle this request?",
        focus:
          "Pick one. Prefer simple for trivial work. Do not send trivial work to coding. Use other when none fit.",
      },
      criteria: ROUTE_CRITERIA,
    },
  };
  for (const [id, text] of Object.entries(ROUTE_NOULS)) {
    questions[id] = { type: "noul", instructions: text };
  }
  return questions;
}

export function buildRouteState(request: string): Record<string, unknown> {
  return { request: request.slice(0, 1600) };
}

function asLane(value: unknown): Lane {
  if (
    value === "simple" ||
    value === "jev_specialist" ||
    value === "coding" ||
    value === "ask" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
}

export function composeRoute(args: {
  lane: Lane;
  confidence: number;
  probabilities: Record<string, number>;
  nouls: Record<string, number>;
  confidenceFloor?: number;
}): RouteVerdict {
  const floor = args.confidenceFloor ?? DEFAULT_CONFIG.policyConfidenceFloor;
  const trivial = args.nouls.is_trivial ?? 0;
  const semantic = args.nouls.needs_semantic_judgment ?? 0;
  const heavy = args.nouls.needs_heavy_reasoning ?? 0;
  const raw: Record<string, number> = {
    lane_confidence: args.confidence,
    ...Object.fromEntries(
      Object.entries(args.probabilities).map(([k, v]) => [`lane.${k}`, v]),
    ),
    ...args.nouls,
  };

  // Code envelope: never promote trivial work to a heavy coding lane.
  if (trivial >= 0.7 && heavy <= 0.3 && semantic < 0.6) {
    return {
      lane: "simple",
      source: "jev",
      reason: `trivial Noul ${trivial.toFixed(2)} with low heavy-reasoning; keep a cheap lane`,
      raw,
    };
  }

  let lane = args.lane;
  const reasons = [`lane Choice=${lane} conf=${args.confidence.toFixed(2)}`];
  if (lane === "other" || args.confidence < floor) {
    lane = "ask";
    reasons.push("other or low confidence → ask (fail closed)");
  }
  if (semantic >= 0.7 && lane === "simple") {
    lane = "jev_specialist";
    reasons.push(`needs_semantic_judgment ${semantic.toFixed(2)} upgrades simple`);
  }
  return { lane, source: "jev", reason: reasons.join("; "), raw };
}

export async function routeLive(args: {
  request: string;
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}): Promise<RouteVerdict> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const endpoint = args.endpoint ?? DEFAULT_CONFIG.endpoint;
  const model = args.model ?? DEFAULT_CONFIG.model;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      state: redactDeep(buildRouteState(args.request)),
      questions: routeQuestions(),
      model,
    }),
  });
  if (!response.ok) {
    return {
      lane: "ask",
      source: "fail_closed",
      reason: `fail closed: TypeSafe HTTP ${response.status}`,
      raw: {},
    };
  }
  const payload = (await response.json()) as {
    answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }>;
  };
  const answers = payload.answers ?? {};
  const laneAns = answers.lane ?? {};
  const nouls: Record<string, number> = {};
  for (const id of Object.keys(ROUTE_NOULS)) {
    const n = answers[id]?.noul;
    if (typeof n === "number") nouls[id] = n;
  }
  return composeRoute({
    lane: asLane(laneAns.choice),
    confidence: typeof laneAns.confidence === "number" ? laneAns.confidence : 0,
    probabilities: laneAns.probabilities ?? {},
    nouls,
  });
}

export function routeBlock(verdict: RouteVerdict): string {
  return `\n\n<jev_route>\nlane=${verdict.lane}. ${verdict.reason}. Trivial work stays on a cheap lane; do not spawn an advanced agent for it. Semantic judgments use Jev; implementation uses a coding model.\n</jev_route>`;
}
