# Deepened Jev use-case cookbook (Pi / firstmate)

Pin **jev-1.13.0**. `POST https://api.typesafe.ai/v1/systemone` with `state`, `questions`, `model`. Jev does not generate text. Code owns rules, thresholds, and side effects.

Live index: https://docs.typesafe.ai/llms.txt  
Jaggedness: https://docs.typesafe.ai/model-jaggedness/jev-1.13.md  
Build: https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md

This package implements faces 1–3 and 7. Faces 4–6 stay as recipes until labeled.

## 0. Envelope

Hard-deny and fast-path **before** Jev. Fail closed if `TYPESAFE_API_KEY` is missing, the HTTP call fails, or Choice is `other`. Filter state (cwd, tool, command/path, user request). Do not dump the session.

## 1. Policy Choice — `allow` / `ask` / `deny` / `other`

One ordered action. Do not rebuild the verdict from a bag of Nouls. Always include `other`. Low Choice confidence → ask. Implemented: `src/questions.ts` + `src/compose.ts`.

Jagged: a yes/no Choice and a Noul on the same proposition are **not** interchangeable.

## 2. Tool-call safety gating

Rules first: force-push, chmod on `~/.ssh`, key paths, curl-to-unknown. Fast-path `ls` / `pwd` / `git status`. Unvouched bash/write/edit: one request with policy Choice plus hazard Nouls. Safety-phrased detectors: **block when `p ≤ 1-t`**. Raising `t` contracts the reject band. `secret_egress` fail-closed on unclear above `unclearMin=0.10`, never the only deny bit.

Jagged: adversarial state is data; `P(noul)+P(¬noul)` across questions is not 1.

## 3. Skill / intent routing (two-pass)

Pass 1: Choice over index lines + three Nouls (`acts_on_user_system`, `would_follow_documented_procedure`, `prose_suffices`). Invert **only** `prose_suffices`. Mean vs 0.30. Pass 2: top 3 with full text; `fits` Nouls; Choice + `none`. Suggestion is ignorable. Do **not** add a fourth TypeSafe-bias Noul in this ship.

Jagged: do not send 182 full SKILL.md files in pass 1 (context rot).

## 4. Select-don’t-generate

Find candidates in code (regex, parser). Choice whose keys are the spans, plus `none`. Copy the winner verbatim. Cookbook: pre-parsed extraction, semantic find.

Jagged: generation and counting fail; keep copies and arithmetic in code.

## 5. RAG / corpus ingest

One request per query–passage. Nouls: relevant, evidence, contradict, injection. **injection ≥ 0.7 drops.** Contradict at 0.7 is **not** a standing auto-flag. Not shipped in this package (review: out of intent).

Jagged: injection Noul is a filter, not a security boundary.

## 6. Fan-out

Independent questions in one request (policy + hazards, rank + gates). Parallel-questions cookbook: 12.2× cheaper / 10.0× faster. A second request only when the next state depends on the first answer.

## 7. Task / model routing

Choice over `simple` | `jev_specialist` | `coding` | `ask` | `other`, plus Nouls `is_trivial`, `needs_semantic_judgment`, `needs_heavy_reasoning`. Code keeps trivial work on a cheap lane even if Choice says `coding`. Implemented: `src/router.ts`. Firstmate’s fleet router is a **different** one-question rule Choice in `bin/fm-dispatch-resolve.sh` (see `docs/STACK_AND_DEPLOY.md`).

Jagged: Jev picks the lane; it does not write the patch. Do not interpolate Score levels into a fake difficulty number.

## Industry map → these faces

| Map idea | Faces |
| --- | --- |
| LLM guardrails | 1, 2, 6 |
| Model routing | 7, 3 |
| Search and retrieval | 4, 5 |
| Semantic code linting | 2, 4, 6 |
| Harness engineering | 2, 3, 5, 6, 7 |

## Don’t

- Ask Jev what code can compute.
- Hide several judgments in one question.
- Dump the whole session into state.
- Generate text by chaining Choices.
- Let Jev overrule a hard-deny.
