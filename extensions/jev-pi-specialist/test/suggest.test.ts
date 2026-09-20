import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  composeSuggest,
  GATE_THRESHOLD,
  gateMean,
  indexLine,
  INVERTED,
  stage1Questions,
  stage2Questions,
  suggestionBlock,
  type RankWideResult,
} from "../src/suggest.ts";
import type { SkillRecord } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const roster = JSON.parse(
  readFileSync(join(here, "../fixtures/roster.json"), "utf8"),
) as SkillRecord[];

describe("two-pass skill suggestion", () => {
  it("truncates index lines to ~60 characters", () => {
    const line = indexLine(roster[0], 60);
    assert.ok(line.length <= 60);
    assert.match(line, /TypeSafe\/Jev/);
  });

  it("inverts prose_suffices when averaging the gate", () => {
    assert.ok(INVERTED.has("prose_suffices"));
    const mean = gateMean({
      acts_on_user_system: 0.9,
      would_follow_documented_procedure: 0.9,
      prose_suffices: 0.9,
    });
    // 0.9, 0.9, (1-0.9)=0.1 → 1.9/3
    assert.ok(Math.abs(mean - 1.9 / 3) < 1e-9);
  });

  it("does not clear the gate on prose-suitable requests", () => {
    const mean = gateMean({
      acts_on_user_system: 0.2,
      would_follow_documented_procedure: 0.2,
      prose_suffices: 0.8,
    });
    // 0.2, 0.2, (1-0.8)=0.2 → 0.2, which is below 0.30
    assert.ok(mean < GATE_THRESHOLD);
  });

  it("stage-1 questions include none and every roster name", () => {
    const q = stage1Questions(roster) as {
      which: { criteria: Record<string, string> };
    };
    assert.ok("none" in q.which.criteria);
    for (const skill of roster) assert.ok(skill.name in q.which.criteria);
  });

  it("stage-2 questions include none plus fits Nouls", () => {
    const byName = Object.fromEntries(roster.map((s) => [s.name, s]));
    const q = stage2Questions(byName, ["typesafe-ai", "pptx"]);
    assert.ok("which" in q);
    assert.ok("fits::typesafe-ai" in q);
    assert.ok("fits::pptx" in q);
    const which = q.which as { criteria: Record<string, string> };
    assert.ok("none" in which.criteria);
  });

  it("returns nothing when the stage-1 gate is below 0.30", () => {
    const stage1: RankWideResult = {
      ranked: [["computer-use", 0.4]],
      which: "computer-use",
      gate: 0.22,
      values: {
        acts_on_user_system: 0.1,
        would_follow_documented_procedure: 0.1,
        prose_suffices: 0.9,
      },
      raw: {},
    };
    const result = composeSuggest({ stage1 });
    assert.deepEqual(result.names, []);
    assert.match(result.reason, /stage-1 gate/);
  });

  it("returns nothing when max fits is below 0.30", () => {
    const stage1: RankWideResult = {
      ranked: [["xlsx", 0.5]],
      which: "xlsx",
      gate: 0.7,
      values: {},
      raw: {},
    };
    const result = composeSuggest({
      stage1,
      stage2: { winner: "xlsx", fits: { xlsx: 0.11, pptx: 0.04 } },
    });
    assert.deepEqual(result.names, []);
    assert.match(result.reason, /nothing fits/);
  });

  it("suggests the stage-2 winner when fits clear the threshold", () => {
    const stage1: RankWideResult = {
      ranked: [["typesafe-ai", 0.8]],
      which: "typesafe-ai",
      gate: 0.72,
      values: {},
      raw: {},
    };
    const result = composeSuggest({
      stage1,
      stage2: {
        winner: "typesafe-ai",
        fits: { "typesafe-ai": 0.81, pptx: 0.02 },
      },
    });
    assert.deepEqual(result.names, ["typesafe-ai"]);
    assert.match(suggestionBlock(result.names), /Ignore this if it does not fit/);
  });

  it("suggestion with no names is an ignorable empty block", () => {
    assert.match(suggestionBlock([]), /No skill in the roster/);
  });
});
