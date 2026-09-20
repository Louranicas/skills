import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askJev } from "../src/jev-tool.ts";

describe("jev_ask tool", () => {
  it("fail-closes without an API key", async () => {
    const r = await askJev(
      { state: { x: 1 }, questions: { ok: { type: "noul", instructions: "yes?" } } },
      { apiKey: "" },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /TYPESAFE_API_KEY/);
  });

  it("posts state and questions and returns answers", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.questions.ok.type, "noul");
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { ok: { type: "noul", noul: 0.91 } },
        }),
        { status: 200 },
      ) as Response;
    };
    const r = await askJev(
      { state: { x: 1 }, questions: { ok: { type: "noul", instructions: "yes?" } } },
      { apiKey: "test-key", fetchImpl },
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.model, "jev-1.13.0");
      assert.equal((r.answers as { ok: { noul: number } }).ok.noul, 0.91);
    }
  });
});
