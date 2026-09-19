import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ingestRoute } from "../src/ingest.ts";

describe("corpus ingest", () => {
  it("drops injection >= 0.7", () => {
    const r = ingestRoute({
      injection: 0.98,
      relevant: 0.4,
      evidence: 0.4,
      contradict: 0.1,
    });
    assert.equal(r.action, "drop");
  });

  it("does not auto-flag contradict at 0.7 as a standing rule", () => {
    const r = ingestRoute({
      injection: 0.1,
      relevant: 0.35,
      evidence: 0.2,
      contradict: 0.42,
    });
    assert.equal(r.action, "review");
    assert.match(r.reason, /not an auto-flag/);
  });

  it("keeps high-relevance passages", () => {
    const r = ingestRoute({
      injection: 0.22,
      relevant: 0.98,
      evidence: 0.98,
      contradict: 0.13,
    });
    assert.equal(r.action, "keep");
  });
});
