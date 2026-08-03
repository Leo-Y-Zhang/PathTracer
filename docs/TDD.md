# TDD — PathTracer

**Status:** built (written retrospectively against v1.2.0)
**Date:** 2026-08-03 · **PRD:** [PRD.md](PRD.md) · **Repo:** PathTracer

> Derived from the code in `src/`, not from the README. Where the two disagree,
> the code is what is written here. Sections of the standard template that have
> no counterpart in this project (database migrations, RLS policies) are cut
> rather than padded; the sections that replace them — trust boundaries and
> scene-format compatibility — are the real equivalents for an offline CLI tool.

## Approach

One process, one pass, no state. `cli.ts` reads a JSON file, `scene.ts` turns it
into an object graph (a BVH over the primitives, a `LightList` of emissive
surfaces plus at most one environment light, a background function, and the
render defaults), and the integrator estimates the rendering equation for every
pixel by Monte Carlo. The result is a linear-radiance `Float64Array`; `png.ts`
tone-maps it to 8-bit sRGB-ish bytes and encodes a PNG. Nothing is cached
between runs, nothing is written except the output file.

The design is organised around two invariants that every module is allowed to
assume and obliged to preserve:

1. **A pixel's value depends only on `(x, y, spp, seed)` and the scene.** Not on
   traversal order, not on which rows are rendered beside it, not on the thread
   count. This is what makes tiling and worker-thread parallelism free, and it
   is enforced by seeding a fresh `Rng` per *sample*, not per image or per row
   (`integrator.ts: samplePixel` → `rng.ts: pixelRng`).
2. **The estimator is unbiased.** Every material's `scatter` returns
   `attenuation = f·cos/pdf` for the direction it sampled, and every direct-light
   contribution is `f·cos·L/pdf` weighted by MIS. A material that cannot state a
   finite BRDF declares `isSpecular = true`, which makes NEE skip it entirely
   rather than sample it wrongly.

## Data model

There is no database. Two data shapes matter: the on-disk scene format (a public
contract — other people's `.json` files depend on it) and the in-memory graph.

### Scene JSON (the stable contract)

Parsed by `parseScene` in `src/scene.ts`; every field is validated with a path
in the error message. Top-level keys:

| Key | Required | Notes |
|---|---|---|
| `name` | no | Defaults to `"scene"`; used for the default output filename. |
| `camera` | **yes** | `position`, `lookAt`, `vfov` required; `up` (default `+Y`), `aperture` (default 0), `focusDist` (default `\|lookAt-position\|`) optional. |
| `background` | no | `[r,g,b]`, or `{type: solid\|gradient\|sky}`. Absent ⇒ black. **Mutually exclusive with `environment`** — both present throws, because escaping rays would have two sources of truth. |
| `environment` | no | `{type: image, path, intensity}` (equirectangular `.hdr`) or `{type: constant, color, intensity}`. Unlike `background` this is *both* the miss shader and an NEE-sampled light. |
| `render` | no | `width` 480, `height` 360, `spp` 64, `maxDepth` 32, `seed` 1, `toneMapping` `linear`, `exposure` 1. CLI flags override each field individually. |
| `textures` | no | Named map: `solid` / `checker` / `image` (a PNG decoded in-tree). |
| `materials` | no | Named map: `lambertian`, `textured_lambertian`, `metal`, `dielectric`, `rough_dielectric`, `ggx`, `emissive`. |
| `objects` | **yes** | Array of `sphere`, `rect`, `box`, `triangle`, `mesh` (OBJ), `transform` (recursive wrapper). |

Validation is asymmetric and deliberately so: `roughness` is range-checked to
`[0,1]`, `ior` must be finite and positive, `intensity` non-negative, and
`toneMapping` is an enum. **`render.width/height/spp/maxDepth/seed` are checked
only for being finite numbers**, not for being positive integers — the same
values arriving as CLI flags *are* integer-checked (`cli.ts: parseIntFlag`). A
hand-written scene with `"width": 0` therefore fails later and less clearly than
`--width 0` does. Known asymmetry, recorded here rather than in a comment.

### In-memory graph

| Type | Where | Shape |
|---|---|---|
| `Hittable` | `hittable.ts` | `hit(ray, tMin, tMax) → HitRecord \| null`, `boundingBox() → AABB`. Everything intersectable implements it, including `BVHNode` and `Transform`, so nesting is free. |
| `HitRecord` | `hittable.ts` | `t`, `point`, `normal` **always oriented against the incident ray**, `frontFace` (dielectrics need the side), `material`, optional `uv`. |
| `Material` | `materials.ts` | `isSpecular`, `scatter`, `evalBrdf`, `scatterPdf`, `emitted`. The last three exist only because NEE needs a BRDF and a density it can MIS-weight. |
| `LightList` | `lights.ts` | `lights: LightPrimitive[]` (emissive `Rect`/`Sphere`) + optional `environment`. `count`, `pdf` (mixture density), `sample`. |
| `EnvironmentLight` | `envlight.ts` | `pdfValue` / `sampleTowards` / `radiance`. The same object is the miss shader and the sampler, so background and light *cannot* disagree. |
| `EnergyTable` | `ggx-energy.ts` | `E(mu)` + `E_avg`, built by deterministic quadrature at material construction, cached per `alpha` / `etaRel`. No baked data files, so the tables can never drift from the BRDF they compensate. |

Image buffers are `Float64Array` of `width·height·3` linear radiance, row-major,
top row first. The tone-mapped output is `Uint8Array` RGB8.

## Interfaces

### CLI (the user-facing surface)

```
pathtracer render <scene.json> [--out f.png] [--spp N] [--seed N]
                  [--width N] [--height N] [--max-depth N] [--workers N]
```

- Exactly one subcommand, `render`. Anything else, or a missing scene argument,
  prints usage to **stderr** and exits **1**. `--help` prints usage and exits 0.
- Every flag takes a value; the parser walks `argv` two at a time, so a value-less
  flag is an error rather than being silently treated as a boolean.
- `--width` alone rescales the height to preserve the scene's aspect ratio;
  `--height` alone does not (it is taken literally). Asymmetric by design —
  "render this scene smaller" is the common case.
- Progress goes to **stderr** (`\r`-updated percentage, single-threaded; a single
  line for the worker path). **stdout is never written**, so the tool composes.
- The only file written is `--out` (default `renders/<scene name>.png`); its
  parent directory is created.

### Library

`src/index.ts` re-exports the vector math, RNG, sampling, geometry, BVH,
materials, camera, integrator, PNG codec and scene parser. The package is
`private: true` and unpublished — this surface exists for the tests and for a
reader, not as a supported API. `lights.ts`, `envlight.ts`, `hdr.ts`,
`microfacet.ts`, `ggx-energy.ts`, `texture.ts` and `parallel.ts` are *not* in
the barrel and are imported directly where needed.

### The three contracts that hold the renderer together

```ts
// 1. Scattering. Returns null when the path dies here.
scatter(rIn, hit, rng): { ray, attenuation } | null   // attenuation = f·cos/pdf

// 2. Direct lighting. Zero for specular BSDFs, whose density is a delta.
evalBrdf(wo, wi, hit): Vec3        // f only: no cosine, no pdf
scatterPdf(wo, wi, hit): number    // solid-angle density that scatter() used

// 3. Light sampling, in solid-angle measure at the shading point.
pdfValue(origin, dir): number      // 0 when dir does not reach the light
sampleTowards(origin, rng): Vec3
```

The integrator (`integrator.ts: trace`) combines strategies 2 and 3 with the MIS
power heuristic (β = 2). Emission found by a BSDF bounce is weighted by
`w(pdf_bsdf, pdf_light)`; emission found by a shadow ray by
`w(pdf_light, pdf_bsdf)`. Emission seen straight from the camera, or immediately
after a specular bounce, is taken **whole** — NEE cannot sample a delta BSDF, so
there is no second strategy to discount against. Getting that single condition
wrong is the classic way to render a scene at half brightness, which is why the
furnace tests are the gate on every integrator change.

Russian roulette starts after 3 bounces with survival probability
`clamp(max(throughput), 0.05, 0.95)` and compensates survivors by `1/p`.

### Parallelism

`renderSceneParallel(sceneJson, settings, {workers})` splits `[0, height)` into
contiguous row bands, one `Worker` each. **The raw scene JSON is sent, not the
parsed graph** — the graph holds closures and class instances that
`structuredClone` cannot carry — so each worker re-parses and re-builds its own
BVH and energy tables. That costs a duplicate parse per worker and buys the
determinism guarantee for free: because a pixel depends only on
`(x, y, sampleIndex, seed)`, the concatenation of independently rendered bands is
bit-for-bit the single-threaded image. `tests/parallel.test.ts` asserts exactly
that. `workers <= 1` short-circuits to an in-process render.

## Trust boundaries

(No auth, no database, no network. This section replaces the template's access
control, and it is the one place a security question genuinely arises.)

| Boundary | What crosses it | Handling |
|---|---|---|
| Scene JSON → parser | Arbitrary untyped `unknown` | Fully validated by hand-written guards; every failure names its JSON path. No `as` casts on unvalidated input, no `JSON.parse` result trusted. |
| Scene JSON → filesystem | `environment.path`, `textures[].path`, mesh `path` | Passed **directly** to `readFileSync` with no allow-list and no confinement to the repo. A scene file can name any path the user can read. Contents are then decoded as HDR/PNG/OBJ and a mismatch throws, so this is a read-attempt primitive, not an exfiltration one. **Treat a scene file as a script you are choosing to run.** |
| Scene JSON → memory | `render.width/height/spp` | Unbounded. `width·height·3` doubles are allocated up front; a scene may exhaust memory. Accepted for a local tool (see PRD, Safety). |
| Parent → worker thread | `sceneJson`, `settings`, band bounds | Structured-cloned. The worker re-validates by re-parsing, so a worker never trusts a pre-parsed graph. |
| Renderer → filesystem | The `--out` PNG | The only write. Parent directories are created. |

Asset paths are resolved against the **process working directory**, not against
the scene file's directory. `scenes/skylight.json` names `assets/sky.hdr`, so it
renders from the repo root and fails from anywhere else. That is a real sharp
edge, not a design decision — it is listed under Failure modes.

## Scene-format compatibility

The scene format is the only thing external files depend on, so it is treated
like a schema: **additive changes only**. Every field added since v0.1.0
(`environment`, `textures`, `toneMapping`, `exposure`, `mesh`, `transform`,
`rough_dielectric`) has a default that reproduces the previous behaviour, so
every scene ever written still parses. The one deliberately *non*-additive rule
is that `environment` and `background` may not both appear — added with
`environment` itself, so it cannot break an older scene.

Rendered output is a different matter. v1.2.0 changed what `ggx` means (it now
compensates for multiple scattering by default), which changes the pixels of any
scene using it. That is a corrected physical model, not a compatibility break to
be avoided; the committed gallery was re-rendered in the same commit so the
repository stays self-consistent, and `GGXConductor` keeps a `compensate = false`
constructor flag for reference comparisons.

## Failure modes

| What breaks | Who notices | How we detect it | How we undo it |
|---|---|---|---|
| Malformed scene JSON | The user, immediately | `parseScene` throws with the JSON path and what was expected; exit 1 | Fix the scene. No partial output is written. |
| Missing/renamed asset (`.hdr`, `.obj`, `.png`) | The user, immediately | `readFileSync` throws; the CLI's top-level catch prints `error: <message>`, exit 1 | Fix the path — or run from the repo root, since paths are cwd-relative. |
| Run from the wrong directory | The user | Same as above, but the message says "no such file" rather than "your cwd is wrong" — the error is correct and the *diagnosis* is not obvious | Documented here and in the README quickstart (run from the repo root). |
| A biased integrator change | Nobody, from the image alone — this is the dangerous one | The furnace tests fail: albedo-0.5 sphere ≠ 0.5, white furnace ≠ 1.0, or `E[1/pdf] ≠ 4π` | Revert. Every integrator change is gated on these before it lands. |
| A sampler and its pdf drifting apart | Nobody visually; variance quietly rises or energy quietly shifts | `tests/envlight.test.ts` and `tests/light_sampling.test.ts` compare each pdf against an *independent* estimate of the same integral | Revert. Two wrongs cannot agree here, because the check is external. |
| Energy tables drifting from the BRDF they compensate | Nobody | Impossible by construction: tables are computed at material construction from the same sampling code, never loaded from a file. Cross-checked against Monte Carlo in `tests/ggx_energy.test.ts` | n/a |
| Non-finite sample (NaN/Inf radiance from a degenerate path) | Nobody | **Not detected.** `samplePixel` silently drops the offending channel and still divides by `spp`, so a poisoned sample lands as 0 rather than as NaN. This trades a small downward bias for not losing the whole pixel; it is bias, it is not counted, and it is not reported | Would need a counter on the render result to surface it. Not built. |
| A worker crashes | The user | The `error`/non-zero-`exit` handlers reject and the CLI prints the error, exit 1 | Re-run with `--workers 1`, which takes the in-process path and is byte-identical. |
| A worker exits 0 without posting its band | The user, as a hang | **Not detected.** The band promise resolves only on `message`; a silent clean exit leaves `Promise.all` pending forever. Never observed, but nothing prevents it | Ctrl-C. A timeout or a settled-band count would fix it. |
| Output not byte-identical across machines | A reviewer diffing PNGs | SHA-256 determinism tests pass on one machine; the *pixels* always match, the compressed IDAT depends on the zlib build | Compare decoded pixels, not file bytes. Stated in the README limitations. |
| Out of memory on a large render | The user | Node throws on the `Float64Array` allocation | Lower `--width`/`--height`. No bound is enforced. |

## Rollback

Nothing is deployed, nothing is stateful, nothing is published. The undo for any
change is `git revert`, and it is complete: there is no database to migrate back,
no cache to invalidate, no client on an old version. Renders are pure functions
of `(scene, settings, code)`, so a reverted commit reproduces the previous images
exactly — this is checked in practice by re-running `npm run render:all` and
diffing the committed gallery.

The one artefact that must be reverted *with* the code is `renders/`: a commit
that changes rendering physics and does not regenerate the gallery leaves the
repository self-inconsistent, and the inconsistency is invisible until someone
runs the renders. v1.2.0 regenerated it in the same commit for that reason.

## Test plan

274 tests across 32 files. The gate is `npm run lint && npm run typecheck &&
npm run build && npx vitest run` — CI runs exactly that, then a 64×64 4-spp smoke
render to prove the CLI end-to-end. Tests run against `dist/`, so `npm test`
builds first.

The suite is organised by what a test can *prove*, not by file:

- **Analytic ground truth** — the value is known in closed form and the test
  asserts it: furnace tests (0.5, 0.8, white furnace → 1.0), GGX NDF integrates
  to 1, mean `cos θ` = 2/3 under cosine sampling, Schlick at normal incidence
  equals `((n1-n2)/(n1+n2))²`, TIR beyond the critical angle, `E[1/pdf] = 4π`.
- **Independent estimator** — the same quantity computed a second way, by a
  method that shares no code with the first: environment pdf vs a uniform
  solid-angle estimate, quadrature `E(mu)` vs Monte Carlo over the actual
  sampler, BVH hits vs brute force, NEE mean vs pure path tracing.
- **Invariant** — a property that must hold whatever the inputs: multi-worker
  render byte-identical to single-threaded, same seed ⇒ same SHA-256 (in-process
  and through the CLI), encode→decode round-trips for PNG and RGBE, BRDF
  reciprocity, compensation only ever *adds* energy.
- **Hand-computed** — intersection `t`, point, normal and front-face values
  worked out by hand for spheres, triangles, rects and boxes.
- **Negative** — malformed scenes rejected with a path-bearing message, an
  out-of-range `roughness`/`ior` refused at parse time *and* again in the
  `GGXConductor` / `GGXDielectric` constructors (a bad value would otherwise bake
  a garbage energy table),
  unknown material/texture names, `.hdr` headers in the wrong orientation,
  `environment` combined with `background`, unknown CLI command, missing scene
  argument.

A regression test for this repo means an *analytic* assertion wherever one
exists. A stored image is used only to prove determinism, never correctness.

## Build order (as actually built)

1. v0.1.0 — vec3/ray, geometry + AABB + BVH, lambertian/metal/dielectric/emissive,
   iterative integrator with russian roulette, thin-lens camera, in-tree PNG
   encoder, xorshift128 per-sample seeding, JSON scenes, CLI.
2. v1.0.0 — material BRDF/pdf refactor → area-light sampling API → NEE + MIS →
   GGX conductor → UVs + textures + PNG decoder → OBJ meshes + smooth normals +
   instance transforms → tone operators + sky + stratified sampling →
   worker-thread tiles. Each step landed green, furnace tests never red.
3. v1.1.0 — in-tree RGBE codec, environment lights, luminance-CDF importance
   sampling inside the NEE mixture, environment furnace test.
4. v1.2.0 — deterministic energy tables, Kulla-Conty multiple-scattering lobe for
   the conductor, `rough_dielectric` (Walter 2007 + exact dielectric Fresnel).

## Open questions

1. Should `render.*` from the scene file be integer-validated like the CLI flags?
   It would be a one-line strictness change with a small chance of rejecting an
   existing scene that currently works by accident.
2. Should the non-finite-sample guard count what it discards and print a warning?
   Today a NaN-producing bug is silently absorbed as a small darkening — which is
   the exact failure class this project exists to make visible.
3. Should a band promise carry a timeout so a silently-exiting worker fails
   instead of hanging?
