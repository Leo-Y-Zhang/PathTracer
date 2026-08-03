# PathTracer — technical design

Derived from `src/` at v1.2.0, not from the README; where the two disagreed the
code is what is written here. Requirements: [PRD.md](PRD.md).

## What every module is allowed to assume

Every module is allowed to rely on these and obliged to preserve them. Most of
the design decisions further down are consequences.

**A pixel's value depends only on `(x, y, spp, seed)` and the scene.** Not on
traversal order, not on which rows are rendered beside it, not on the thread
count. This is what makes tiling and worker-thread parallelism free, and it is
enforced by seeding a fresh `Rng` per *sample* rather than per image or per row
(`integrator.ts: samplePixel` → `rng.ts: pixelRng`).

**The estimator is unbiased.** Every material's `scatter` returns
`attenuation = f·cos/pdf` for the direction it sampled, and every direct-light
contribution is `f·cos·L/pdf` weighted by MIS. A material that cannot state a
finite BRDF declares `isSpecular = true`, which makes NEE skip it entirely
rather than sample it wrongly.

## The pipeline

One process, one pass, no state. `cli.ts` reads a JSON file; `scene.ts` turns it
into an object graph — a BVH over the primitives, a `LightList` of emissive
surfaces plus at most one environment light, a background function, and the
render defaults; the integrator estimates the rendering equation for every pixel
by Monte Carlo. The result is a linear-radiance `Float64Array`, which `png.ts`
tone-maps to 8-bit sRGB-ish bytes and encodes as a PNG. Nothing is cached
between runs, and nothing is written except the output file.

There is no database, no network and no authentication anywhere in it.

## The scene format is a public contract

Other people's `.json` files depend on it, so it is treated as a schema.

Parsed by `parseScene` in `src/scene.ts`; every field is validated with a path
in the error message.

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

Validation is asymmetric, deliberately in one direction and accidentally in
another. `roughness` is range-checked to `[0,1]`, `ior` must be finite and
positive, `intensity` non-negative, `toneMapping` an enum. But
**`render.width/height/spp/maxDepth/seed` are checked only for being finite
numbers**, not for being positive integers — while the same values arriving as
CLI flags *are* integer-checked (`cli.ts: parseIntFlag`). A hand-written scene
with `"width": 0` therefore fails later and less clearly than `--width 0` does.
Recorded here rather than buried in a comment.

Changes to the format are **additive only**. Every field added since v0.1.0 —
`environment`, `textures`, `toneMapping`, `exposure`, `mesh`, `transform`,
`rough_dielectric` — has a default reproducing the previous behaviour, so every
scene ever written still parses. The one deliberately non-additive rule, that
`environment` and `background` may not both appear, arrived with `environment`
itself and so cannot break an older scene.

Rendered *output* is a separate question. v1.2.0 changed what `ggx` means — it
now compensates for multiple scattering by default — which changes the pixels of
any scene using it. That is a corrected physical model, not a compatibility
break to be avoided. The committed gallery was re-rendered in the same commit so
the repository stays self-consistent, and `GGXConductor` keeps a
`compensate = false` constructor flag for reference comparisons.

## The in-memory graph

| Type | Where | Shape |
|---|---|---|
| `Hittable` | `hittable.ts` | `hit(ray, tMin, tMax) → HitRecord \| null`, `boundingBox() → AABB`. Everything intersectable implements it, including `BVHNode` and `Transform`, so nesting is free. |
| `HitRecord` | `hittable.ts` | `t`, `point`, `normal` **always oriented against the incident ray**, `frontFace` (dielectrics need the side), `material`, optional `uv`. |
| `Material` | `materials.ts` | `isSpecular`, `scatter`, `evalBrdf`, `scatterPdf`, `emitted`. The last three exist only because NEE needs a BRDF and a density it can MIS-weight. |
| `LightList` | `lights.ts` | `lights: LightPrimitive[]` (emissive `Rect`/`Sphere`) plus an optional `environment`. `count`, `pdf` (mixture density), `sample`. |
| `EnvironmentLight` | `envlight.ts` | `pdfValue` / `sampleTowards` / `radiance`. The same object is the miss shader and the sampler, so background and light *cannot* disagree. |
| `EnergyTable` | `ggx-energy.ts` | `E(mu)` and `E_avg`, built by deterministic quadrature at material construction, cached per `alpha` / `etaRel`. No baked data files, so the tables can never drift from the BRDF they compensate. |

Image buffers are `Float64Array` of `width·height·3` linear radiance, row-major,
top row first. Tone-mapped output is `Uint8Array` RGB8.

## The three contracts that hold the renderer together

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

`integrator.ts: trace` combines strategies 2 and 3 with the MIS power heuristic
(β = 2). Emission found by a BSDF bounce is weighted by
`w(pdf_bsdf, pdf_light)`; emission found by a shadow ray by
`w(pdf_light, pdf_bsdf)`.

Emission seen straight from the camera, or immediately after a specular bounce,
is taken **whole** — NEE cannot sample a delta BSDF, so there is no second
strategy to discount against. Getting that one condition wrong is the classic
way to render a scene at half brightness, which is why the furnace tests gate
every integrator change.

Russian roulette starts after three bounces with survival probability
`clamp(max(throughput), 0.05, 0.95)`, and compensates survivors by `1/p`.

## Parallelism

`renderSceneParallel(sceneJson, settings, {workers})` splits `[0, height)` into
contiguous row bands, one `Worker` each.

**The raw scene JSON is sent, not the parsed graph.** The graph holds closures
and class instances that `structuredClone` cannot carry, so each worker
re-parses and rebuilds its own BVH and energy tables. That costs a duplicate
parse per worker and buys the determinism guarantee for nothing: because a pixel
depends only on `(x, y, sampleIndex, seed)`, the concatenation of independently
rendered bands is bit-for-bit the single-threaded image.
`tests/parallel.test.ts` asserts exactly that. `workers <= 1` short-circuits to
an in-process render.

## The user-facing surface

```
pathtracer render <scene.json> [--out f.png] [--spp N] [--seed N]
                  [--width N] [--height N] [--max-depth N] [--workers N]
```

Exactly one subcommand, `render`. Anything else, or a missing scene argument,
prints usage to **stderr** and exits **1**; `--help` prints usage and exits 0.
Every flag takes a value, and the parser walks `argv` two at a time, so a
value-less flag is an error rather than being silently treated as a boolean.

`--width` alone rescales the height to preserve the scene's aspect ratio;
`--height` alone does not, and is taken literally. Asymmetric by design, because
"render this scene smaller" is the common case.

Progress goes to **stderr** — a `\r`-updated percentage single-threaded, one
line for the worker path. **stdout is never written**, so the tool composes. The
only file written is `--out`, defaulting to `renders/<scene name>.png`, and its
parent directory is created.

`src/index.ts` re-exports the vector math, RNG, sampling, geometry, BVH,
materials, camera, integrator, PNG codec and scene parser. The package is
`private: true` and unpublished, so this surface exists for the tests and for a
reader rather than as a supported API. `lights.ts`, `envlight.ts`, `hdr.ts`,
`microfacet.ts`, `ggx-energy.ts`, `texture.ts` and `parallel.ts` are *not* in the
barrel and are imported directly where needed.

## Trust boundaries

| Boundary | What crosses it | Handling |
|---|---|---|
| Scene JSON → parser | Arbitrary untyped `unknown` | Fully validated by hand-written guards; every failure names its JSON path. No `as` casts on unvalidated input, no `JSON.parse` result trusted. |
| Scene JSON → filesystem | `environment.path`, `textures[].path`, mesh `path` | Passed **directly** to `readFileSync` with no allow-list and no confinement to the repo. A scene file can name any path the user can read. Contents are then decoded as HDR/PNG/OBJ and a mismatch throws, so this is a read-attempt primitive, not an exfiltration one. **Treat a scene file as a script you are choosing to run.** |
| Scene JSON → memory | `render.width/height/spp` | Unbounded. `width·height·3` doubles are allocated up front; a scene may exhaust memory. Accepted for a local tool — see the PRD. |
| Parent → worker thread | `sceneJson`, `settings`, band bounds | Structured-cloned. The worker re-validates by re-parsing, so a worker never trusts a pre-parsed graph. |
| Renderer → filesystem | The `--out` PNG | The only write. Parent directories are created. |

Asset paths resolve against the **process working directory**, not against the
scene file's directory. `scenes/skylight.json` names `assets/sky.hdr`, so it
renders from the repo root and fails from anywhere else. That is a sharp edge
rather than a design decision, and it appears again below.

## Where it goes wrong, including the two things nothing catches

| What breaks | Who notices | How we detect it | How we undo it |
|---|---|---|---|
| Malformed scene JSON | The user, immediately | `parseScene` throws with the JSON path and what was expected; exit 1 | Fix the scene. No partial output is written. |
| Missing/renamed asset (`.hdr`, `.obj`, `.png`) | The user, immediately | `readFileSync` throws; the CLI's top-level catch prints `error: <message>`, exit 1 | Fix the path — or run from the repo root, since paths are cwd-relative. |
| Run from the wrong directory | The user | Same as above, but the message says "no such file" rather than "your cwd is wrong" — the error is correct and the *diagnosis* is not obvious | Documented here and in the README quickstart: run from the repo root. |
| A biased integrator change | Nobody, from the image alone — this is the dangerous one | The furnace tests fail: albedo-0.5 sphere ≠ 0.5, white furnace ≠ 1.0, or `E[1/pdf] ≠ 4π` | Revert. Every integrator change is gated on these before it lands. |
| A sampler and its pdf drifting apart | Nobody visually; variance quietly rises or energy quietly shifts | `tests/envlight.test.ts` and `tests/light_sampling.test.ts` compare each pdf against an *independent* estimate of the same integral | Revert. Two wrongs cannot agree here, because the check is external. |
| Energy tables drifting from the BRDF they compensate | Nobody | Impossible by construction: tables are computed at material construction from the same sampling code, never loaded from a file. Cross-checked against Monte Carlo in `tests/ggx_energy.test.ts` | n/a |
| Non-finite sample (NaN/Inf radiance from a degenerate path) | Nobody | **Not detected.** `samplePixel` silently drops the offending channel and still divides by `spp`, so a poisoned sample lands as 0 rather than as NaN. This trades a small downward bias for not losing the whole pixel; it is bias, it is not counted, and it is not reported | Would need a counter on the render result to surface it. Not built. |
| A worker crashes | The user | The `error`/non-zero-`exit` handlers reject and the CLI prints the error, exit 1 | Re-run with `--workers 1`, which takes the in-process path and is byte-identical. |
| A worker exits 0 without posting its band | The user, as a hang | **Not detected.** The band promise resolves only on `message`; a silent clean exit leaves `Promise.all` pending forever. Never observed, but nothing prevents it | Ctrl-C. A timeout or a settled-band count would fix it. |
| Output not byte-identical across machines | A reviewer diffing PNGs | SHA-256 determinism tests pass on one machine; the *pixels* always match, the compressed IDAT depends on the zlib build | Compare decoded pixels, not file bytes. Stated in the README limitations. |
| Out of memory on a large render | The user | Node throws on the `Float64Array` allocation | Lower `--width`/`--height`. No bound is enforced. |

## Undo, and the artefact that must revert with the code

Nothing is deployed, nothing is stateful, nothing is published. The undo for any
change is `git revert`, and it is complete: no database to migrate back, no
cache to invalidate, no client on an old version. Renders are pure functions of
`(scene, settings, code)`, so a reverted commit reproduces the previous images
exactly — checked in practice by re-running `npm run render:all` and diffing the
committed gallery.

The one artefact that must be reverted *with* the code is `renders/`. A commit
that changes rendering physics without regenerating the gallery leaves the
repository self-inconsistent, and the inconsistency is invisible until someone
runs the renders. v1.2.0 regenerated it in the same commit for exactly that
reason.

## What each test can prove

274 tests across 32 files. The gate is
`npm run lint && npm run typecheck && npm run build && npx vitest run`; CI runs
exactly that, then a 64×64 4-spp smoke render to prove the CLI end to end. Tests
run against `dist/`, so `npm test` builds first.

The suite is organised by what a test can prove rather than by file.

**Analytic ground truth** — the value is known in closed form and the test
asserts it. Furnace tests (0.5, 0.8, white furnace → 1.0), GGX NDF integrates to
1, mean `cos θ` = 2/3 under cosine sampling, Schlick at normal incidence equals
`((n1-n2)/(n1+n2))²`, TIR beyond the critical angle, `E[1/pdf] = 4π`.

**Independent estimator** — the same quantity computed a second way, by a method
sharing no code with the first. Environment pdf against a uniform solid-angle
estimate, quadrature `E(mu)` against Monte Carlo over the actual sampler, BVH
hits against brute force, NEE mean against pure path tracing.

**Invariant** — a property that must hold whatever the inputs. Multi-worker
render byte-identical to single-threaded, same seed ⇒ same SHA-256 both
in-process and through the CLI, encode-decode round-trips for PNG and RGBE, BRDF
reciprocity, compensation only ever *adding* energy.

**Hand-computed** — intersection `t`, point, normal and front-face values worked
out by hand for spheres, triangles, rects and boxes.

**Negative** — malformed scenes rejected with a path-bearing message; an
out-of-range `roughness` or `ior` refused at parse time *and again* in the
`GGXConductor` / `GGXDielectric` constructors, since a bad value would otherwise
bake a garbage energy table; unknown material and texture names; `.hdr` headers
in the wrong orientation; `environment` combined with `background`; an unknown
CLI command; a missing scene argument.

A regression test in this repo means an *analytic* assertion wherever one
exists. A stored image proves determinism, never correctness.

## Version by version

**v0.1.0** — vec3/ray, geometry plus AABB and BVH,
lambertian/metal/dielectric/emissive, an iterative integrator with russian
roulette, a thin-lens camera, the in-tree PNG encoder, xorshift128 per-sample
seeding, JSON scenes, the CLI.

**v1.0.0** — material BRDF/pdf refactor → area-light sampling API → NEE and MIS
→ GGX conductor → UVs, textures and the PNG decoder → OBJ meshes with smooth
normals and instance transforms → tone operators, sky and stratified sampling →
worker-thread tiles. Each step landed green; the furnace tests were never red.

**v1.1.0** — in-tree RGBE codec, environment lights, luminance-CDF importance
sampling inside the NEE mixture, environment furnace test.

**v1.2.0** — deterministic energy tables, the Kulla-Conty multiple-scattering
lobe for the conductor, and `rough_dielectric` (Walter 2007 plus exact
dielectric Fresnel).

## Why there is no App Flow and no Design Brief

The estate standard asks for four documents. This project has two, and the
absence of the other two is a decision rather than an omission, so it is
recorded here instead of being left to look like one.

**No App Flow.** An app flow enumerates screens, states, and the transitions
between them, including empty and error states. There are none to enumerate.
`pathtracer render scene.json` is a single non-interactive invocation: it
validates, renders, writes one PNG, and exits. There is exactly one command,
one success path, and one failure path (usage or a named validation error to
stderr, exit 1), and all of it is specified above under *The user-facing
surface* — including the two behaviours a flow document would exist to catch,
namely that stdout is never written and that progress goes to stderr. Writing
those transitions out a second time in a different file would create a second
place to keep them true.

**No Design Brief.** This is the more interesting absence, because the output
of this program is a picture, and a picture normally has visual intent behind
it. Here it does not, and that is the whole point of the project: what an image
looks like is decided by the physics, not by taste. If a render looks wrong,
the correct response is to find the bug in the integrator, not to adjust the
image until it looks better. A brief specifying an intended look would be
actively harmful — it would give a failing render somewhere to hide.

Two decisions in the pipeline really are aesthetic, and both are already
documented where they are made rather than in a brief of their own: the tone
mapping operator (`linear` / `reinhard` / `aces`, the ACES filmic
approximation, in `src/png.ts`), which maps an unbounded HDR radiance buffer
into eight bits and is a display choice; and the composition of the gallery
scenes in `scenes/`, which are chosen to exercise features and to be
reproducible, not to be handsome. Neither reaches far enough for a document.

The accessibility floor a brief would normally set does not apply either: there
is no interface to be accessible. The nearest equivalent obligation is that
every failure message names the JSON path that caused it, which is specified in
*Trust boundaries* and enforced by the parser tests.

If this ever grows a viewer, a progressive preview, or anything a person looks
at while it runs, both documents get written before that code, not after.

## Undecided

Should `render.*` from the scene file be integer-validated like the CLI flags?
It is a one-line strictness change with a small chance of rejecting an existing
scene that currently works by accident.

Should the non-finite-sample guard count what it discards and print a warning?
Today a NaN-producing bug is silently absorbed as a small darkening — which is
the exact failure class this project exists to make visible.

Should a band promise carry a timeout, so a silently exiting worker fails
instead of hanging?
