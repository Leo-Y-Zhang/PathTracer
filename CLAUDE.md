# PathTracer

A physically-based Monte Carlo path tracer written in TypeScript for Node,
zero runtime dependencies, that renders JSON-described scenes to deterministic
PNGs (byte-identical output, single- or multi-threaded). Features next-event
estimation + multiple importance sampling, HDR image-based lighting (in-tree
Radiance `.hdr` decoder), energy-compensated GGX microfacet materials,
textures, OBJ meshes with smooth normals, affine transforms, filmic tone
mapping, and a worker-thread tile renderer. The test suite validates rendering
*physics* (energy conservation, unbiasedness, sampling distributions,
Fresnel), not just code paths.

## Directory layout

- `src/` — flat core modules: `vec3.ts`, `ray.ts`, `camera.ts`, `bvh.ts`,
  `integrator.ts`, `materials.ts`, `microfacet.ts`, `sampling.ts`, `sky.ts`,
  `hdr.ts`, `texture.ts`, `png.ts`, `parallel.ts`, `render-worker.ts`,
  `cli.ts`, plus `src/geometry/` (sphere/box/rect/triangle/transform) and
  `src/io/obj.ts`.
- `src/tools/` — deterministic asset generators (`make-sky-hdr.ts`,
  `make-knot-obj.ts`) invoked by `npm run assets:all`.
- `tests/` — flat, one file per concern (32 test files plus `fixtures/` and `helpers.ts`, 276 tests), including
  `skylight_scene.test.ts` (SHA-256 byte-identity across runs/threads) and
  `cli.test.ts` (spawns the built CLI as a subprocess).
- `scenes/` — JSON scene descriptions; `renders/` — committed gallery PNGs;
  `assets/` — generated `.hdr`/`.obj` fixtures.

## Install

```
npm ci
```
(canonical/CI command; the SessionStart hook uses `npm install` instead so
the container's cached `node_modules` layer is reused)

## Lint / format / typecheck

```
npm run lint        # eslint .
npm run typecheck   # tsc --noEmit
```

## Test

```
npm test            # runs `npm run build` (tsc -p tsconfig.build.json), then vitest run — 32 files, 276 tests, ~9.7s
```
Fastest useful subset — most test files import `src/*.ts` directly (vitest
transpiles TS on the fly) and need **no** prior build; only `cli.test.ts`
spawns `dist/cli.js` and needs `npm run build` first:
```
npx vitest run tests/vec3.test.ts
```

## Verification gate (source of truth)

CI's `test` job — lint, typecheck, build, `vitest run`, plus a small
deterministic CLI smoke render — is the gate; full gallery renders
(`npm run render:all`) are intentionally excluded from CI (minutes each) and
are not part of the verification signal. Within the suite, the
physics-validation tests (`ggx_energy.test.ts`, furnace-test style checks in
`materials.test.ts`/`integrator.test.ts`, and the SHA-256 determinism assert
in `skylight_scene.test.ts`) are what the README leans on as evidence the
renderer is unbiased and reproducible, not merely "runs without throwing".

## Environment caveats (from audit)

- None specific — `npm ci` and `npm test` both ran clean in this container;
  no network, browser, or GPU dependency.
- `npm audit` reports 2 moderate-severity vulnerabilities in devDependencies
  (not investigated; out of scope).
- Node `engines` requires `^20.19.0 || ^22.13.0 || >=24`.

## CI / conventions

- `ci.yml`: single `test` job on Node 24 — `npm ci`, lint, typecheck, build,
  `vitest run`, then a smoke render (`dist/cli.js render ... --spp 4 --width 64`)
  that asserts a valid PNG signature/size. Separate `gitleaks` job over full
  history.
- Zero runtime dependencies (`package.json` has no `dependencies` key).
- No coverage floor is enforced.
