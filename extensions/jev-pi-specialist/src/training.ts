/**
 * Labeled threshold / training harness.
 *
 * 15-repeat only on near-threshold items. Always log raw probabilities.
 * Uncertain-band behavior is a hypothesis until the labels say otherwise.
 */

import type { GateAction, GateVerdict, ToolCallInput } from "./types.ts";
import { DEFAULT_CONFIG } from "./questions.ts";
import { composeFromRulesAndJev } from "./compose.ts";
import type { JevAnswers } from "./types.ts";

export const REPEAT_N = 15;
/** Distance to a detector threshold that counts as near-threshold. */
export const NEAR_THRESHOLD = 0.1;

export interface LabeledFixture {
  id: string;
  label: "safe" | "secret_egress" | "destructive" | "ask";
  expected: GateAction;
  input: ToolCallInput;
  /** Optional recorded Jev answers for offline replay. */
  recorded?: JevAnswers;
  /** When true, this item is in the near-threshold band and may be 15-repeated. */
  nearThreshold?: boolean;
}

export interface RepeatLog {
  id: string;
  n: number;
  raw: Array<Record<string, number>>;
  actions: GateAction[];
  agreement: number;
}

export function expectedAction(label: LabeledFixture["label"]): GateAction {
  if (label === "safe") return "allow";
  if (label === "ask") return "ask";
  return "deny";
}

export function isNearThreshold(
  raw: Record<string, number>,
  config = DEFAULT_CONFIG,
): boolean {
  for (const spec of Object.values(config.conditions)) {
    const p = raw[spec.id];
    if (typeof p !== "number") continue;
    const edges =
      spec.polarity === "safe"
        ? [spec.threshold, 1 - spec.threshold]
        : [spec.threshold, 1 - spec.threshold];
    if (edges.some((edge) => Math.abs(p - edge) <= NEAR_THRESHOLD)) {
      return true;
    }
    // Unclear band is near-threshold by definition.
    const lo = Math.min(spec.threshold, 1 - spec.threshold);
    const hi = Math.max(spec.threshold, 1 - spec.threshold);
    if (p > lo && p < hi) return true;
  }
  return false;
}

export function replayFixture(
  fixture: LabeledFixture,
  answers: JevAnswers | null,
  apiKeyPresent: boolean,
): { verdict: GateVerdict; ok: boolean } {
  const expected = fixture.expected ?? expectedAction(fixture.label);
  const verdict = composeFromRulesAndJev(
    fixture.input,
    answers,
    apiKeyPresent,
  );
  return { verdict, ok: verdict.action === expected };
}

export function summarizeRepeats(
  id: string,
  verdicts: GateVerdict[],
): RepeatLog {
  const actions = verdicts.map((v) => v.action);
  const raw = verdicts.map((v) => v.raw);
  const mode = majority(actions);
  const agreement = actions.filter((a) => a === mode).length / actions.length;
  return { id, n: verdicts.length, raw, actions, agreement };
}

function majority(actions: GateAction[]): GateAction {
  const counts: Record<GateAction, number> = { allow: 0, ask: 0, deny: 0 };
  for (const a of actions) counts[a] += 1;
  return (Object.entries(counts) as Array<[GateAction, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0][0];
}

export function shouldRepeat(fixture: LabeledFixture, raw: Record<string, number>): boolean {
  if (fixture.nearThreshold) return true;
  return isNearThreshold(raw);
}

export function bimodalGap(
  values: number[],
): { lowMax: number; highMin: number; gap: number; suggested: number } | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let best = 0;
  let idx = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > best) {
      best = d;
      idx = i;
    }
  }
  if (best < 0.15) return null;
  const lowMax = sorted[idx - 1];
  const highMin = sorted[idx];
  return {
    lowMax,
    highMin,
    gap: best,
    suggested: Number(((lowMax + highMin) / 2).toFixed(2)),
  };
}
