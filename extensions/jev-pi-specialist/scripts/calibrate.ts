#!/usr/bin/env node
/**
 * Live calibration: unvouched fixtures through Jev. 15-repeat only on
 * near-threshold items. Writes fixtures/calibration.json with raw probabilities
 * and any bimodal-gap suggestion. Never prints TYPESAFE_API_KEY.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRules } from "../src/rules.ts";
import { gateToolCall } from "../src/gate.ts";
import { apiKeyFromEnv } from "../src/client.ts";
import {
  bimodalGap,
  isNearThreshold,
  REPEAT_N,
  shouldRepeat,
  summarizeRepeats,
  type LabeledFixture,
} from "../src/training.ts";
import type { GateVerdict } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pack = JSON.parse(
  readFileSync(join(root, "fixtures/tool-gate.json"), "utf8"),
) as { items: LabeledFixture[] };

async function main(): Promise<void> {
  const key = apiKeyFromEnv();
  if (!key) {
    console.error("fail closed: TYPESAFE_API_KEY is missing");
    process.exit(2);
  }
  const rows: Array<{
    id: string;
    label: string;
    expected: string;
    action: string;
    source: string;
    reason: string;
    raw: Record<string, number>;
    repeats?: ReturnType<typeof summarizeRepeats>;
  }> = [];
  const intent: number[] = [];

  for (const item of pack.items) {
    const rule = classifyRules(item.input);
    if (rule.terminal) {
      const verdict = await gateToolCall(item.input, { apiKey: key });
      rows.push({
        id: item.id,
        label: item.label,
        expected: item.expected,
        action: verdict.action,
        source: verdict.source,
        reason: verdict.reason,
        raw: verdict.raw,
      });
      continue;
    }
    const first = await gateToolCall(item.input, { apiKey: key });
    if (typeof first.raw.intent_coverage === "number") {
      intent.push(first.raw.intent_coverage);
    }
    let repeats: ReturnType<typeof summarizeRepeats> | undefined;
    if (shouldRepeat(item, first.raw) || isNearThreshold(first.raw)) {
      const verdicts: GateVerdict[] = [first];
      for (let i = 1; i < REPEAT_N; i++) {
        verdicts.push(await gateToolCall(item.input, { apiKey: key }));
      }
      repeats = summarizeRepeats(item.id, verdicts);
      console.log(
        `${item.id}: ${REPEAT_N}-repeat agreement=${repeats.agreement.toFixed(2)} raw[0]=${JSON.stringify(first.raw)}`,
      );
    } else {
      console.log(
        `${item.id}: ${first.action} via ${first.source} raw=${JSON.stringify(first.raw)}`,
      );
    }
    rows.push({
      id: item.id,
      label: item.label,
      expected: item.expected,
      action: first.action,
      source: first.source,
      reason: first.reason,
      raw: first.raw,
      repeats,
    });
  }

  const gap = bimodalGap(intent);
  const out: Record<string, unknown> = {
    model: "jev-1.13.0",
    recorded_at: new Date().toISOString(),
    intent_coverage_gap: gap,
    rows,
  };
  const dest = join(root, "fixtures/calibration.json");
  mkdirSync(join(root, "fixtures"), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${dest}`);
  if (gap) {
    console.log(
      `intent_coverage bimodal gap ${gap.lowMax.toFixed(2)}–${gap.highMin.toFixed(2)}; suggested t=${gap.suggested}`,
    );
  }

  const { suggestLive } = await import("../src/suggest.ts");
  const roster = JSON.parse(
    readFileSync(join(root, "fixtures/roster.json"), "utf8"),
  ) as import("../src/types.ts").SkillRecord[];
  const skills = JSON.parse(
    readFileSync(join(root, "fixtures/skill-suggestion.json"), "utf8"),
  ) as { items: Array<{ id: string; gold: string | null; request: string }> };
  const suggestRows = [];
  for (const item of skills.items) {
    const result = await suggestLive({
      request: item.request,
      roster,
      apiKey: key,
    });
    suggestRows.push({
      id: item.id,
      gold: item.gold,
      names: result.names,
      reason: result.reason,
      raw: result.raw,
    });
    console.log(
      `suggest ${item.id}: ${result.names[0] ?? "(none)"} gold=${item.gold ?? "none"} ${result.reason}`,
    );
  }
  out.skill_suggestion = suggestRows;
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
