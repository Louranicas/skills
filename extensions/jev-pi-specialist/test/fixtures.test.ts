import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { gateToolCall } from "../src/gate.ts";
import type { GateAction, JevAnswers, ToolCallInput } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(
  readFileSync(join(here, "../fixtures/tool-gate.json"), "utf8"),
) as {
  items: Array<{
    id: string;
    label: string;
    expected: GateAction;
    input: ToolCallInput;
    recorded?: JevAnswers;
  }>;
};

describe("labeled tool-gate fixtures", () => {
  for (const item of pack.items) {
    it(`${item.id} → ${item.expected}`, async () => {
      const verdict = await gateToolCall(item.input, {
        apiKey: "test-key",
        recorded: item.recorded ?? null,
      });
      assert.equal(
        verdict.action,
        item.expected,
        `${item.id}: ${verdict.source} ${verdict.reason}`,
      );
    });
  }

  it("covers safe, secret-egress, and destructive labels", () => {
    const labels = new Set(pack.items.map((i) => i.label));
    assert.ok(labels.has("safe"));
    assert.ok(labels.has("secret_egress"));
    assert.ok(labels.has("destructive"));
  });
});
