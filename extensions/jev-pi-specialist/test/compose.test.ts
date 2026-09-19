import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandFor, composeFromRulesAndJev, composeJev } from "../src/compose.ts";
import { DEFAULT_CONDITIONS } from "../src/questions.ts";
import type { JevAnswers, ToolCallInput } from "../src/types.ts";

const stressEgress: JevAnswers = {
  policy: {
    choice: "ask",
    confidence: 0.4,
    probabilities: { allow: 0.22, ask: 0.4, deny: 0.33, other: 0.05 },
  },
  nouls: {
    intent_coverage: 0.52,
    no_secret_egress: 0.86,
    secret_egress: 0.14,
    no_irreversible_damage: 0.81,
    destructive: 0.12,
  },
  model: "jev-1.13.0",
};

describe("detector bands", () => {
  it("p <= 1-t is a violation for a safety-phrased detector", () => {
    const spec = DEFAULT_CONDITIONS.no_secret_egress;
    assert.equal(bandFor(0.02, spec), "violated");
    assert.equal(bandFor(0.03, spec), "violated");
    assert.equal(bandFor(0.12, spec), "unclear");
    assert.equal(bandFor(0.97, spec), "satisfied");
  });

  it("raising t contracts the reject band", () => {
    const loose = { ...DEFAULT_CONDITIONS.no_secret_egress, threshold: 0.97 };
    const tight = { ...DEFAULT_CONDITIONS.no_secret_egress, threshold: 0.99 };
    assert.equal(bandFor(0.02, loose), "violated");
    assert.equal(bandFor(0.02, tight), "unclear");
  });

  it("hazard polarity secret_egress 0.12–0.15 is unclear at t=0.97", () => {
    const spec = DEFAULT_CONDITIONS.secret_egress;
    assert.equal(bandFor(0.12, spec), "unclear");
    assert.equal(bandFor(0.15, spec), "unclear");
    assert.equal(bandFor(0.01, spec), "satisfied");
    assert.equal(bandFor(0.97, spec), "violated");
  });
});

describe("stress composition", () => {
  it("fail-closes on unclear secret_egress (curl-of-key ~0.14)", () => {
    const composed = composeJev(stressEgress);
    assert.equal(composed.action, "deny");
    assert.match(composed.reason, /secret_egress/);
  });

  it("does not treat secret_egress as the only deny bit", () => {
    const composed = composeJev(stressEgress);
    assert.match(composed.reason, /policy Choice/);
  });

  it("Jev destructive 0.91 denies a force-push that rules missed", () => {
    const answers: JevAnswers = {
      policy: {
        choice: "allow",
        confidence: 0.7,
        probabilities: { allow: 0.7, ask: 0.1, deny: 0.2, other: 0 },
      },
      nouls: {
        intent_coverage: 0.4,
        no_secret_egress: 0.88,
        secret_egress: 0.05,
        no_irreversible_damage: 0.09,
        destructive: 0.91,
      },
      model: "jev-1.13.0",
    };
    const composed = composeJev(answers);
    assert.equal(composed.action, "deny");
    assert.match(composed.reason, /destructive|no_irreversible_damage/);
  });

  it("chmod ~/.ssh destructive 0.04 would NOT be caught by Jev, so rules must deny", () => {
    const answers: JevAnswers = {
      policy: {
        choice: "allow",
        confidence: 0.8,
        probabilities: { allow: 0.8, ask: 0.1, deny: 0.1, other: 0 },
      },
      nouls: {
        intent_coverage: 0.99,
        no_secret_egress: 0.99,
        secret_egress: 0.01,
        no_irreversible_damage: 0.99,
        destructive: 0.04,
      },
      model: "jev-1.13.0",
    };
    const composed = composeJev(answers);
    assert.notEqual(composed.action, "deny");
    const ruled = composeFromRulesAndJev(
      { tool: "bash", cwd: "/tmp", command: "chmod 777 ~/.ssh" },
      answers,
      true,
    );
    assert.equal(ruled.source, "rules");
    assert.equal(ruled.action, "deny");
  });

  it("ls/pwd/git status never reach Jev even if answers would be muddy", () => {
    for (const command of ["ls", "pwd", "git status"]) {
      const ruled = composeFromRulesAndJev(
        { tool: "bash", cwd: "/tmp", command, userRequest: "look around" },
        stressEgress,
        true,
      );
      assert.equal(ruled.source, "rules");
      assert.equal(ruled.action, "allow");
    }
  });

  it("Jev cannot overrule a hard-deny", () => {
    const allowAll: JevAnswers = {
      policy: {
        choice: "allow",
        confidence: 1,
        probabilities: { allow: 1, ask: 0, deny: 0, other: 0 },
      },
      nouls: {
        intent_coverage: 0.99,
        no_secret_egress: 0.99,
        secret_egress: 0.01,
        no_irreversible_damage: 0.99,
        destructive: 0.01,
      },
      model: "jev-1.13.0",
    };
    const input: ToolCallInput = {
      tool: "bash",
      cwd: "/tmp",
      command: "git push --force origin main",
    };
    const v = composeFromRulesAndJev(input, allowAll, true);
    assert.equal(v.source, "rules");
    assert.equal(v.action, "deny");
  });

  it("fails closed when the API key is missing on an unvouched call", () => {
    const v = composeFromRulesAndJev(
      { tool: "bash", cwd: "/tmp", command: "npm publish" },
      null,
      false,
    );
    assert.equal(v.source, "fail_closed");
    assert.equal(v.action, "deny");
  });

  it("allows a requested edit whose secret_egress sits in the live safe cluster", () => {
    const answers: JevAnswers = {
      policy: {
        choice: "allow",
        confidence: 0.98,
        probabilities: { allow: 0.99, ask: 0.01, deny: 0, other: 0 },
      },
      nouls: {
        intent_coverage: 0.88,
        no_secret_egress: 0.95,
        secret_egress: 0.05,
        no_irreversible_damage: 0.96,
        destructive: 0.34,
      },
      model: "jev-1.13.0",
    };
    const composed = composeJev(answers);
    assert.equal(composed.action, "allow");
  });

  it("Choice=other fails closed rather than rebuilding from Nouls", () => {
    const answers: JevAnswers = {
      policy: {
        choice: "other",
        confidence: 0.2,
        probabilities: { allow: 0.3, ask: 0.3, deny: 0.1, other: 0.3 },
      },
      nouls: {
        intent_coverage: 0.8,
        no_secret_egress: 0.99,
        secret_egress: 0.01,
        no_irreversible_damage: 0.99,
        destructive: 0.01,
      },
      model: "jev-1.13.0",
    };
    const composed = composeJev(answers);
    assert.equal(composed.action, "deny");
    assert.match(composed.reason, /other/);
  });
});
