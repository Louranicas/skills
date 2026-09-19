import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeRoute, routeBlock, routeQuestions } from "../src/router.ts";

describe("task/model router", () => {
  it("includes none/other on the lane Choice", () => {
    const q = routeQuestions() as { lane: { criteria: Record<string, unknown> } };
    assert.ok("other" in q.lane.criteria);
    assert.ok("simple" in q.lane.criteria);
    assert.ok("jev_specialist" in q.lane.criteria);
  });

  it("keeps trivial work on the simple lane even if Choice said coding", () => {
    const v = composeRoute({
      lane: "coding",
      confidence: 0.9,
      probabilities: { simple: 0.1, coding: 0.8, jev_specialist: 0.05, ask: 0.04, other: 0.01 },
      nouls: { is_trivial: 0.92, needs_semantic_judgment: 0.08, needs_heavy_reasoning: 0.11 },
    });
    assert.equal(v.lane, "simple");
    assert.match(v.reason, /trivial/);
  });

  it("upgrades simple to jev_specialist when a typed judgment is needed", () => {
    const v = composeRoute({
      lane: "simple",
      confidence: 0.8,
      probabilities: { simple: 0.7, coding: 0.1, jev_specialist: 0.15, ask: 0.04, other: 0.01 },
      nouls: { is_trivial: 0.2, needs_semantic_judgment: 0.88, needs_heavy_reasoning: 0.1 },
    });
    assert.equal(v.lane, "jev_specialist");
  });

  it("fail-closes Choice=other to ask", () => {
    const v = composeRoute({
      lane: "other",
      confidence: 0.4,
      probabilities: { simple: 0.2, coding: 0.2, jev_specialist: 0.2, ask: 0.1, other: 0.3 },
      nouls: { is_trivial: 0.2, needs_semantic_judgment: 0.2, needs_heavy_reasoning: 0.2 },
    });
    assert.equal(v.lane, "ask");
  });

  it("emits an ignorable route block", () => {
    const block = routeBlock({
      lane: "simple",
      source: "jev",
      reason: "trivial",
      raw: {},
    });
    assert.match(block, /do not spawn an advanced agent/);
  });
});
