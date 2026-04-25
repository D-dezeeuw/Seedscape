# Seedscape — Implementation Kickoff

## Purpose

Bridges the gap between "design docs exist" and "Phase 1 starts." Defines toolchain decisions, prerequisites, repo scaffolding, and the first-commit checklist.

> Read once, before writing any code. Subsequent work follows [19_roadmap.md](19_roadmap.md).

---

## Prerequisites

### Developer Environment

| Tool      | Version  | Notes                                 |
|-----------|----------|---------------------------------------|
| Node.js   | ≥ 20.x   | LTS. Required for Vite + Vitest.      |
| npm       | ≥ 10.x   | Bundled with Node 20.                 |
| Git       | ≥ 2.40   | Repo already initialized.             |
| Browser   | See below| WebGL2 required.                      |

### Browser Baseline

WebGL2 is **required** (not optional). No fallback to WebGL1.

| Browser | Min version | WebGL2 default |
|---------|-------------|----------------|
| Chrome  | 56          | yes            |
| Firefox | 51          | yes            |
| Safari  | 15          | yes (since macOS 12 / iOS 15) |
| Edge    | 79          | yes            |

If a user lacks WebGL2, show a clear "browser unsupported" message. Do not attempt to degrade.

### Asset Prerequisites

Phase 1 needs a working atlas texture before anything renders meaningfully.

| Asset            | Format             | Size              | Where           |
|------------------|--------------------|-------------------|-----------------|
| Tile atlas       | PNG (power of 2)   | 2048×2048         | `public/atlas.png` |
| Atlas manifest   | already in repo    | —                 | `data/tiles.json` |

For initial work, a **placeholder atlas** of solid-color squares is sufficient. Real art comes later. Atlas dimensions and tile size are defined in [data/tiles.json](../../../data/tiles.json) — keep code and asset in sync via that file.

---

## Toolchain Decisions

| Concern        | Choice                | Why                                              |
|----------------|-----------------------|--------------------------------------------------|
| Bundler / dev  | **Vite**              | Native ES modules, instant HMR, first-class web workers (`?worker` import). |
| Language       | **TypeScript**, strict| Type safety on a long-lived simulation engine.   |
| Test runner    | **Vitest**            | Vite-native, jest-compatible API, fast.          |
| Lint + format  | **Biome**             | Single binary, faster than ESLint+Prettier.      |
| Package manager| **npm**               | Already present with Node. No need for pnpm/yarn unless workspaces become needed. |

Lock these in `package.json`. Don't introduce alternatives without a recorded reason.

### TypeScript Config (non-negotiable flags)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "WebWorker"]
  }
}
```

### Vite Config (essentials)

- Web worker support via `import Worker from './foo.ts?worker'`
- Asset import (`import atlasUrl from './atlas.png'`)
- JSON import for data files
- Build target ES2022 (matches tsconfig)

---

## Repo Scaffolding

### Folder Layout (matches [CLAUDE.md](../../../CLAUDE.md))

Create empty folders as needed during scaffolding. Don't create folders that won't be used yet — `server/`, `client/net/`, `shared/utils/` etc. can wait.

### Phase 0 (Bootstrap) Layout

Minimal viable structure to start Phase 1:

```text
.
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── biome.json
├── public/
│   └── atlas.png             # placeholder
├── src/
│   ├── main.ts               # entry: get canvas, init WebGL2
│   ├── core/
│   │   └── canvas.ts         # canvas creation + WebGL2 context
│   └── rendering/
│       └── (empty for now)
├── data/                     # already exists
├── .claude/                  # already exists
├── CLAUDE.md                 # already exists
└── README.md
```

Add `client/`, `server/`, `shared/` only when Phase 2+ work justifies them.

---

## Bootstrap Sequence

Execute in order. Each step has a verification command.

### 1. Initialize npm

```bash
npm init -y
```

Verify: `package.json` exists.

### 2. Install dev dependencies

```bash
npm install -D vite typescript vitest @biomejs/biome @types/node
```

Verify: `node_modules/` exists, `package-lock.json` exists.

### 3. Add `tsconfig.json`

Use the config in [Toolchain Decisions](#typescript-config-non-negotiable-flags) above.

Verify: `npx tsc --noEmit` runs without error (no `.ts` files yet, so it should be clean).

### 4. Add `vite.config.ts`, `biome.json`, `index.html`

Minimal `index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Seedscape</title></head>
  <body>
    <canvas id="seedscape-canvas"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### 5. Add scripts to `package.json`

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check src/",
    "format": "biome format --write src/"
  }
}
```

### 6. Write `src/main.ts` and `src/core/canvas.ts`

- `canvas.ts` exports `createGLContext(canvas)` returning a `WebGL2RenderingContext` or throwing.
- `main.ts` queries `#seedscape-canvas`, calls `createGLContext`, clears to a recognizable color (e.g. `0.1, 0.15, 0.2, 1.0`).

### 7. Run dev server

```bash
npm run dev
```

Verify: open the URL Vite prints, see a dark blue-grey canvas filling the page.

### 8. Add a smoke test

`src/core/canvas.test.ts`:

```ts
import { describe, expect, test } from "vitest";

describe("bootstrap", () => {
  test("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

```bash
npm test
```

Verify: 1 test passes.

### 9. First commit

```bash
git add .
git commit -m "Bootstrap: Vite + TypeScript + WebGL2 canvas"
```

---

## Definition of "Phase 1 Ready"

All of the following are true:

- [ ] `npm run dev` opens a page with a cleared WebGL2 canvas, no console errors
- [ ] `npm run build` succeeds (typecheck + bundle)
- [ ] `npm test` runs at least one passing test
- [ ] `npm run lint` reports clean
- [ ] `public/atlas.png` exists (placeholder OK)
- [ ] `tsconfig.json` has strict mode + `noUncheckedIndexedAccess`
- [ ] Folder layout matches the Phase 0 structure above
- [ ] First commit landed on `main`

Once all checked, Phase 1 work begins per [19_roadmap.md](19_roadmap.md).

---

## What This Doc Does Not Cover

- WebGL pipeline implementation → [04_rendering_pipeline.md](04_rendering_pipeline.md), [15_rendering_shaders.md](15_rendering_shaders.md)
- Chunk system → [13_chunk_lifecycle.md](13_chunk_lifecycle.md)
- Worker setup → [14_worker_architecture.md](14_worker_architecture.md)
- Game content → [data/README.md](../../../data/README.md)

This doc only gets you to "ready to start Phase 1."

---

## Common Bootstrap Pitfalls

- **WebGL2 returning `null`** → user's browser doesn't support it; show error, don't fallback
- **Workers fail to load in dev** → Vite needs `?worker` suffix on imports, not raw `new Worker(url)`
- **Strict TypeScript flags too loose** → enforce `noUncheckedIndexedAccess` from day 1; retrofitting it later is painful with typed-array-heavy code
- **Skipping the smoke test** → Phase 1 has no easy place to verify the test runner works once shaders and workers exist
- **Adding ESLint and Prettier separately** → Biome covers both; don't mix toolchains
