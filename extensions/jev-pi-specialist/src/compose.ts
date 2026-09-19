/**
 * Compose a gate verdict. Rules win. Jev cannot overrule hard-deny or fast-path.
 *
 * Policy is the Choice. Hazard Nouls are detectors and may only add blocks
 * (or ask); they never rebuild the verdict from a bag of scores.
 */

import type {
  Band,
  ConditionResult,
  ConditionSpec,
  GateAction,
  GateConfig,
  GateVerdict,
  JevAnswers,
  PolicyChoice,
  RuleVerdict,
  ToolCallInput,
} from "./types.ts";
import { classifyRules } from "./rules.ts";
import { DEFAULT_CONFIG } from "./questions.ts";

export function bandFor(p: number, spec: ConditionSpec): Band {
  const t = spec.threshold;
  if (spec.polarity === "safe") {
    if (p >= t) return "satisfied";
    if (p <= 1 - t) return "violated";
    return "unclear";
  }
  // Hazard polarity: high p is the hazard. Detector block is p >= t
  // (equivalent to (1-p) <= 1-t on the complementary safe Noul).
  if (p >= t) return "violated";
  if (p <= 1 - t) return "satisfied";
  return "unclear";
}

export function detectorContribution(
  spec: ConditionSpec,
  band: Band,
  p?: number,
): GateAction | "ignore" {
  if (spec.mode === "detector") {
    if (band === "violated") return "deny";
    if (band === "unclear") {
      if (
        spec.unclear === "deny" &&
        spec.unclearMin !== undefined &&
        typeof p === "number" &&
        p < spec.unclearMin
      ) {
        return "ignore";
      }
      return spec.unclear;
    }
    return "ignore";
  }
  // required (intent_coverage): satisfied allows this dimension; violated
  // denies; unclear follows spec.unclear (ask by default).
  if (band === "satisfied") return "ignore";
  if (band === "violated") return "deny";
  return spec.unclear;
}

export function evaluateConditions(
  nouls: Record<string, number>,
  config: GateConfig = DEFAULT_CONFIG,
): ConditionResult[] {
  const out: ConditionResult[] = [];
  for (const spec of Object.values(config.conditions)) {
    const p = nouls[spec.id];
    if (typeof p !== "number" || !Number.isFinite(p)) continue;
    const band = bandFor(p, spec);
    out.push({
      id: spec.id,
      p,
      band,
      threshold: spec.threshold,
      contribution: detectorContribution(spec, band, p),
    });
  }
  return out;
}

function stronger(a: GateAction, b: GateAction): GateAction {
  const rank: Record<GateAction, number> = { allow: 0, ask: 1, deny: 2 };
  return rank[b] > rank[a] ? b : a;
}

function fromPolicy(
  policy: JevAnswers["policy"],
  floor: number,
): { action: GateAction; reason: string } {
  if (policy.choice === "deny") {
    return { action: "deny", reason: "policy Choice=deny" };
  }
  if (policy.choice === "ask") {
    return { action: "ask", reason: "policy Choice=ask" };
  }
  if (policy.choice === "allow") {
    if (policy.confidence < floor) {
      return {
        action: "ask",
        reason: `policy Choice=allow but confidence ${policy.confidence.toFixed(2)} < ${floor}`,
      };
    }
    return { action: "allow", reason: "policy Choice=allow" };
  }
  // other / unknown: fail closed rather than argmax-keep.
  return { action: "deny", reason: "policy Choice=other; fail closed" };
}

export function composeJev(
  answers: JevAnswers,
  config: GateConfig = DEFAULT_CONFIG,
): Pick<GateVerdict, "action" | "reason" | "conditions" | "raw"> {
  const conditions = evaluateConditions(answers.nouls, config);
  const policy = fromPolicy(answers.policy, config.policyConfidenceFloor);

  // Detectors may only raise severity. They never turn a deny into allow.
  let action: GateAction = policy.action;
  const reasons = [policy.reason];
  for (const c of conditions) {
    if (c.contribution === "ignore") continue;
    const next = stronger(action, c.contribution);
    if (next !== action) {
      reasons.push(
        `${c.id} ${c.band} p=${c.p.toFixed(2)} t=${c.threshold} → ${c.contribution}`,
      );
      action = next;
    } else if (c.contribution === "deny" && action === "deny") {
      reasons.push(
        `${c.id} ${c.band} p=${c.p.toFixed(2)} (detector, not the only deny bit)`,
      );
    }
  }

  const raw: Record<string, number> = {
    policy_confidence: answers.policy.confidence,
    ...Object.fromEntries(
      Object.entries(answers.policy.probabilities).map(([k, v]) => [
        `policy.${k}`,
        v,
      ]),
    ),
    ...answers.nouls,
  };

  return {
    action,
    reason: reasons.join("; "),
    conditions,
    raw,
  };
}

export function composeFromRulesAndJev(
  input: ToolCallInput,
  jev: JevAnswers | null,
  apiKeyPresent: boolean,
  config: GateConfig = DEFAULT_CONFIG,
): GateVerdict {
  const rule = classifyRules(input);
  if (rule.terminal) {
    return {
      action: rule.action,
      source: "rules",
      reason: rule.reason,
      rule,
      raw: {},
    };
  }

  if (config.requireApiKey && !apiKeyPresent) {
    return {
      action: "deny",
      source: "fail_closed",
      reason: "fail closed: TYPESAFE_API_KEY is missing; unvouched call not judged",
      rule,
      raw: {},
    };
  }

  if (!jev) {
    return {
      action: "deny",
      source: "fail_closed",
      reason: "fail closed: Jev returned no usable answers",
      rule,
      raw: {},
    };
  }

  const composed = composeJev(jev, config);
  return {
    action: composed.action,
    source: "jev",
    reason: composed.reason,
    rule,
    jev,
    conditions: composed.conditions,
    raw: composed.raw,
  };
}

export function missingKeyVerdict(rule: RuleVerdict): GateVerdict {
  return {
    action: "deny",
    source: "fail_closed",
    reason: "fail closed: TYPESAFE_API_KEY is missing; unvouched call not judged",
    rule,
    raw: {},
  };
}
