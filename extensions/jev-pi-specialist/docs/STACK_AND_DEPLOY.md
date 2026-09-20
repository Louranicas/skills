# End-to-end stack and deployment

How Jev sits in this specialist package, how it meets Firstmate’s typed dispatch router, and how to turn each layer on. This file does not change Firstmate tracked code.

## Stack (bottom up)

```
code envelope          hard-deny / fast-path / fail-closed / quotas
        ↑
Jev System One         Choice + Noul + Score in one POST /v1/systemone
        ↑
this package           gate  →  route  →  suggest  →  calibrate
        ↑
Pi coding agent        pi -e ./extensions/jev-pi-specialist
        ↑
Firstmate (optional)   TYPESAFE_API_KEY + config/crew-dispatch.json
                       → bin/fm-dispatch-resolve.sh (Jev picks a rule)
```

| Layer | Owner | On when |
| --- | --- | --- |
| HTTP System One | TypeSafe (`jev-1.13.0` here; firstmate resolver uses `jev-latest` which answered as 1.13.0) | `TYPESAFE_API_KEY` |
| Tool gate | `src/gate.ts` + `src/rules.ts` | Pi `tool_call` on bash/write/edit |
| Task/model router | `src/router.ts` | Pi `before_agent_start` |
| Skill suggestion | `src/suggest.ts` | Same hook, roster ≥ 2 |
| Calibration | `scripts/calibrate.ts` | Operator, live key |
| Firstmate typed dispatch | `bin/fm-dispatch-resolve.sh` in the firstmate home | Key **and** `config/crew-dispatch.json` |

Jev never replaces Firstmate judgment, quota-array-dispatch, captain-approval, or `fm-spawn.sh`. A lean Choice over dispatch rules is the measured shape (20/25 rule match; confidence floor 0.6).

## Turn on Firstmate’s task router (operator, local home)

Do this in the Firstmate **home**, not in this skills worktree. Do not edit Firstmate `bin/` or `AGENTS.md` from this lane.

1. Put a non-empty `TYPESAFE_API_KEY=` line in the home `.env` (or export it for one command). Absent key = router **off**: stderr `dispatch-resolve: off`, exit 0, no network.
2. Copy [`docs/examples/crew-dispatch.json`](https://github.com/kunchenguid/firstmate) into that home’s gitignored `config/crew-dispatch.json`. Without rules, the tool returns `no rules to match` and does not call Jev.
3. Keep `approval: captain` on rules that must not auto-dispatch.
4. Smoke: `bin/fm-dispatch-resolve.sh data/<id>/brief.md --project <name>` with the key injected for that command only.
5. Regression (no live key needed): `bash tests/fm-dispatch-resolve.test.sh` in the firstmate checkout.

Environment key wins over `.env`. The resolver unsets the key in child environments. Endpoint is fixed at `https://api.typesafe.ai`, model `jev-latest`, timeout 5 s.

This worktree cannot flip that switch: isolation forbids writing outside the disposable skills tree.

On the operator home `/home/orac/firstmate`, both the key line and `config/crew-dispatch.json` (four rules + default, including a captain-approval credentials rule) are already present, so **typed dispatch is already on** for that home. Smoke with `bin/fm-dispatch-resolve.sh data/<id>/brief.md --project <name>` from the firstmate checkout; do not print the key.

## Deploy the Pi specialist

```sh
export TYPESAFE_API_KEY   # already in the environment; never print it
cd extensions/jev-pi-specialist
npm test                  # node --experimental-strip-types --test
pi -e ./extensions/jev-pi-specialist
# or copy/symlink into ~/.pi/agent/extensions/jev-pi-specialist
```

Per turn the extension:

1. Routes the user request (`simple` | `jev_specialist` | `coding` | `ask`). Trivial work stays on a cheap lane; it does not spawn an advanced agent.
2. Suggests at most one skill (two-pass, three cookbook Nouls).
3. Gates unvouched `bash` / `write` / `edit` (rules first, then one policy Choice).

Fork deliverable: https://github.com/Louranicas/skills/pull/1. Origin `typesafe-ai/skills` push/PR is 403 / PRs disabled.

## Bidirectional loop

- **Down:** Pi tool calls and turn prompts flow into Jev questions.
- **Up:** verdicts (`allow`/`deny`/`ask`, `lane=simple`, skill names) flow back into Pi as blocks, confirms, and ignorable prompt snippets.
- **Sideways:** gate, route, and suggest share one client, one key, one fail-closed policy. Calibration writes raw probabilities; thresholds move only after a labeled gap, not a guess.
