---
name: jev-pi-specialist
license: MIT
description: >
  Pi + Jev specialist: rules-first tool gate (bash/write/edit), two-pass
  skill suggestion, labeled Jev threshold training. Use when gating Pi
  tools with TypeSafe/Jev, suggesting skills in two passes, or calibrating
  detector thresholds on fixtures.
---

# Jev specialist for Pi agents

Use Jev as a decision layer, not a chat model. Code owns control flow.
Live docs: https://docs.typesafe.ai/llms.txt. The extension lives at
`extensions/jev-pi-specialist`.

## Tool gate

Rules in code before Jev. Jev cannot overrule hard-deny or fast-path.

- Hard-deny: curl-to-unknown, key paths, chmod on `~/.ssh`, force-push.
- Fast-path: `ls`, `pwd`, `git status`.
- Fail closed if `TYPESAFE_API_KEY` is missing.
- Policy is one Choice (`allow` / `ask` / `deny` / `other`). Do not rebuild
  the verdict from a bag of Nouls.
- Hazard Nouls are detectors (`p <= 1-t` blocks on a safety-phrased Noul).
  Raising `t` contracts the reject band. Calibrate on fixtures.
- `secret_egress` is fail-closed on unclear and is never the only deny bit.

Fan-out independent questions in one request. Always include none/other on Choice.

## Skill suggestion

Two-pass, ignorable: rank the roster + need-skill Nouls, then re-read the
top 3. Mean of four gates (threshold 0.30); invert `prose_suffices` only.
The fourth gate `design_or_implement_typesafe` is not inverted.

## Training

Labeled fixtures in `extensions/jev-pi-specialist/fixtures/tool-gate.json`.
15-repeat only near-threshold items. Log raw probabilities. Do not promote
an untested threshold.

## Extract

- Extract spans: find in code, Choice+none, copy verbatim.
