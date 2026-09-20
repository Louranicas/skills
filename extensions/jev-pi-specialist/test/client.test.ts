import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiKeyFromEnv, parseSystemOne } from "../src/client.ts";
import { redact } from "../src/redact.ts";
import { gateToolCall } from "../src/gate.ts";

describe("client + redact", () => {
  it("does not treat an empty key as present", () => {
    assert.equal(apiKeyFromEnv({}), undefined);
    assert.equal(apiKeyFromEnv({ TYPESAFE_API_KEY: "  " }), undefined);
    assert.ok(apiKeyFromEnv({ TYPESAFE_API_KEY: "abc" }));
  });

  it("parses a Choice+Noul System One payload", () => {
    const answers = parseSystemOne({
      model: "jev-1.13.0",
      answers: {
        policy: {
          type: "choice",
          choice: "deny",
          confidence: 0.9,
          probabilities: { allow: 0.05, ask: 0.05, deny: 0.9, other: 0 },
        },
        secret_egress: { type: "noul", noul: 0.14 },
      },
    });
    assert.equal(answers.policy.choice, "deny");
    assert.equal(answers.nouls.secret_egress, 0.14);
  });

  it("redacts keys without echoing them", () => {
    const out = redact("export TYPESAFE_API_KEY=sk-live-secret-value Bearer abc.def");
    assert.equal(out.includes("sk-live-secret-value"), false);
    assert.match(out, /<redacted>/);
  });

  it("fail-closes unvouched calls when Jev HTTP errors", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("nope", { status: 500 }) as Response;
    const v = await gateToolCall(
      { tool: "bash", cwd: "/tmp", command: "npm publish" },
      { apiKey: "test-key", fetchImpl },
    );
    assert.equal(v.action, "deny");
    assert.equal(v.source, "fail_closed");
  });
});
