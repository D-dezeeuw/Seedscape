# Seedscape

Infinite, procedural, tile-based farming simulation. Browser-based, GPU-driven (WebGL2 + Web Workers). Starting biome: **Bloomridge**.

> Status: Phase 0 (bootstrap) complete. Phase 1 (rendering prototype) is next.

## Stack

- **Bundler / dev:** Vite
- **Language:** TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Tests:** Vitest
- **Lint + format:** Biome (single binary; no ESLint/Prettier)
- **Persistence (MVP):** IndexedDB

## Getting Started

```bash
npm install
npm run dev      # Vite dev server with HMR
npm run build    # typecheck + production bundle
npm test         # run vitest suite
npm run lint     # biome check
npm run format   # biome format --write
```

Open the URL Vite prints to see a cleared WebGL2 canvas (dark blue-grey).

Browsers must support **WebGL2** — there is no WebGL1 fallback.

## Repo Layout

See [CLAUDE.md](CLAUDE.md) for the full convention guide and folder map. Design docs live in [.claude/context/docs/](.claude/context/docs/) (start at `00`, `17`, `19`). Game content (crops, buildings, biomes) is in [data/](data/).

## Placeholder Atlas

[public/atlas.png](public/atlas.png) is a generated placeholder (64×64 grid of distinct-colored 32×32 tiles, 2048×2048 total). Regenerate via:

```bash
node scripts/gen_placeholder_atlas.mjs
```

Real art replaces this later.
