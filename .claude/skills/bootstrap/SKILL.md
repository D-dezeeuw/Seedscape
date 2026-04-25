---
name: bootstrap
description: Use when initializing the Seedscape repo, setting up toolchain (Vite, TypeScript, Vitest, Biome), scaffolding the project structure, or verifying that the project is ready to begin Phase 1. Triggers on intent like "set up the project", "bootstrap the repo", "initialize toolchain", "scaffold Seedscape".
---

# Bootstrap

Get from a documented design to a working dev loop. This skill is a one-time gate before Phase 1 begins.

## Mandatory Reading

1. [implementation kickoff](../../context/docs/20_implementation_kickoff.md) — full bootstrap sequence
2. [CLAUDE.md](../../../CLAUDE.md) — folder layout + conventions
3. [17_mvp_scope.md](../../context/docs/17_mvp_scope.md) — MVP definition (so you know what Phase 1 leads to)

## Hard Rules

- **Do not skip the toolchain decisions.** Vite + TypeScript strict + Vitest + Biome is locked. Don't substitute alternatives without an explicit user request.
- **Do not scaffold folders that won't be used.** Create `client/`, `server/`, `shared/` only when work justifies them. Day 0 is `src/` only.
- **Do not commit a placeholder atlas as final art.** Mark it explicitly as placeholder in commit message.
- **Do not skip the smoke test step.** A failing test runner discovered later is more expensive to debug.
- **Strict TS flags are non-negotiable.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` go in tsconfig from the first commit.

## Before Starting

Confirm with the user:

1. The user has Node ≥ 20 installed (`node --version`)
2. The user wants the locked toolchain (Vite + TS + Vitest + Biome) — not a substitute
3. Whether to use a placeholder atlas (default: yes) or wait for real art

## Sequence

Follow [the bootstrap sequence](../../context/docs/20_implementation_kickoff.md#bootstrap-sequence) step-by-step. Each step has a verification command — run it before moving on. Do not batch steps and skip verification.

## Definition of Done

The "Phase 1 Ready" checklist in the kickoff doc passes:

- [ ] `npm run dev` shows a cleared WebGL2 canvas
- [ ] `npm run build` succeeds (typecheck + bundle)
- [ ] `npm test` runs ≥1 passing test
- [ ] `npm run lint` clean
- [ ] Folder layout matches Phase 0 structure
- [ ] First commit on main

Report back to the user with each check ticked or with a specific failure point.

## After Done

Hand off to Phase 1 work guided by [19_roadmap.md](../../context/docs/19_roadmap.md) Phase 1 deliverables. Subsequent work uses domain-specific skills:

- Rendering → [shader-work](../shader-work/SKILL.md)
- Chunks → [chunk-work](../chunk-work/SKILL.md)
- Workers → [worker-work](../worker-work/SKILL.md)
