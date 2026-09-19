# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Pi + Jev specialist

The Pi extension, two-pass skill suggestion, and labeled harness live in
`extensions/jev-pi-specialist` (skill index: `skills/jev-pi-specialist/SKILL.md`).
Offline tests: `cd extensions/jev-pi-specialist && npm test`.
Live calibration: `TYPESAFE_API_KEY` set, never printed; `npm run calibrate`.
Missing key fails closed on unvouched bash/write/edit. Rules run before Jev.
Cookbook: `extensions/jev-pi-specialist/cookbooks/USE_CASES.md`. Deploy / Firstmate typed dispatch: `extensions/jev-pi-specialist/docs/STACK_AND_DEPLOY.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
