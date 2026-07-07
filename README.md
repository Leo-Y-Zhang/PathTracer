# Pathlight

A physically-based Monte Carlo path tracer written in TypeScript for Node,
with **zero runtime dependencies**. It renders JSON-described scenes to PNG
offline, **deterministically**: the same CLI invocation always produces
byte-identical bytes. The test suite validates the *rendering physics* -
energy conservation, sampling distributions, fresnel reflectance - not just
the code.

## Gallery

All three images are rendered by this repository's code via `npm run
render:all` (deterministic - re-running reproduces these exact files).

| Cornell box | Glass & metal (depth of field) | Emissive night |
| --- | --- | --- |
| ![Cornell box](renders/cornell.png) | ![Glass and metal spheres](renders/spheres.png) | ![Night scene](renders/night.png) |
| 400x400, 700 spp | 480x360, 300 spp | 480x360, 600 spp |

## Features

- **Zero runtime dependencies.** `dependencies: {}`. The PNG encoder,
  CRC-32, RNG, vector math, BVH and integrator are all in-tree; the only
  outside code is raw DEFLATE injected from the `node:zlib` builtin.
- **Geometry:** spheres, axis-aligned rects and boxes (slab test with exact
  face normals), triangles (Moller-Trumbore); AABBs and a **median-split
  BVH** (split on the axis of largest centroid extent - documented in
  `src/bvh.ts`). BVH correctness is *proven in tests* by comparing every hit
  against brute-force intersection over seeded random scenes.
- **Materials:** lambertian with cosine-weighted hemisphere importance
  sampling, metal with roughness, dielectric with Schlick fresnel and total
  internal reflection, and diffuse emissive lights.
- **Integrator:** iterative unidirectional path tracing with russian
  roulette after 3 bounces. No next-event estimation (see Limitations).
- **Camera:** thin lens - position / lookAt / vfov plus defocus blur
  (aperture + focus distance).
- **Deterministic:** own xorshift128 RNG (no `Math.random` anywhere); every
  pixel sample gets a stream seeded purely from `(x, y, sampleIndex, seed)`,
  so output is independent of traversal order and identical runs produce
  byte-identical PNGs (asserted by SHA-256 in tests).
- **Output:** 8-bit RGB PNG, gamma 2.2.

## Install

```bash
git clone <this repo>
cd Pathlight
npm ci
npm test          # build + typecheck + 126 tests
```

Requires Node >= 20. No runtime dependencies are installed - the three dev
dependencies are `typescript`, `vitest`, and `@types/node`.

## Quickstart

```bash
npm run build
node dist/cli.js render scenes/cornell.json --out renders/cornell.png --spp 256 --seed 7 --width 480
```

Real observed output (this machine, Node 25):

```text
OBSERVED_OUTPUT_PLACEHOLDER
```

`npm run render:all` regenerates the whole committed gallery
deterministically. Flags: `--out`, `--spp`, `--seed`, `--width`, `--height`,
`--max-depth`; defaults come from the scene's `render` block, and `--width`
alone preserves the scene's aspect ratio. Progress goes to stderr.

## How path tracing works (honestly)

The rendering equation says the light leaving a surface point x toward the
camera is its own emission plus the integral, over all incoming directions,
of incoming light weighted by the BRDF and the cosine of the incidence angle:

    L_o(x, w_o) = L_e(x, w_o) + INTEGRAL_hemisphere f(x, w_i, w_o) L_i(x, w_i) cos(theta_i) dw_i

That integral has no closed form for real scenes, so we estimate it with
Monte Carlo: shoot a random ray, divide by the probability density of having
chosen it. One camera ray becomes a random walk - at each bounce the path
throughput is multiplied by `BRDF * cos / pdf`, and emission found along the
way is added, weighted by throughput. Averaging many such walks per pixel
converges to the true integral because the estimator is **unbiased**: its
expected value *is* the integral. Importance sampling (cosine-weighted
directions for diffuse surfaces) and russian roulette (randomly killing long
paths and compensating survivors by 1/p) reduce variance and cost without
introducing bias.

**Why the furnace test matters:** unbiasedness is an easy thing to break
silently - a wrong pdf, a missing cosine, a normalization slip in the BRDF,
or biased roulette all still produce pretty pictures, just *wrong* ones. The
furnace test catches this class of bug: a lambertian sphere of albedo 0.5
inside a uniform emissive environment of radiance 1 must render to radiance
exactly 0.5 (the sphere is convex, so `L = albedo * L_env`). The suite
asserts the mean rendered radiance within 1%, plus a *white* furnace (albedo
1.0 box interior, forcing many bounces through russian roulette) that must
converge to exactly 1.0 - any energy leak or gain fails the test.

## The validation centerpiece

Tests validate physics against analytic ground truth, not snapshots:

| Test | Asserts |
| --- | --- |
| **Furnace test** (`tests/integrator.test.ts`) | albedo-0.5 sphere in a radiance-1 environment renders to mean 0.5 (and 0.8 -> 0.8) |
| **White furnace / russian roulette** | multi-bounce albedo-1.0 enclosure converges to 1.0 - roulette is unbiased |
| **Cosine-weighted sampling** (`tests/materials.test.ts`) | mean cos(theta) = 2/3 (analytic value under pdf = cos/pi), correct hemisphere, uniform azimuth |
| **Fresnel** | Schlick at normal incidence equals ((n1-n2)/(n1+n2))^2; grazing incidence -> 1 |
| **Intersections** (`tests/sphere.test.ts`, `triangle`, `rect-box`) | hit t, point, normal and front-face flags against hand-computed values |
| **BVH = brute force** (`tests/bvh.test.ts`) | identical hits over seeded random scenes of mixed primitives |
| **Determinism** (`tests/determinism.test.ts`, `tests/cli.test.ts`) | same seed -> identical SHA-256 of PNG bytes, in-process and via the CLI |
| **PNG format** (`tests/png.test.ts`) | signature, IHDR dimensions, chunk CRCs vs known answers, DEFLATE roundtrip |

```bash
npm test          # 126 tests
npx tsc --noEmit  # strict, noUncheckedIndexedAccess
```

## Architecture

```
src/
  vec3.ts             immutable vector math (pure functions)
  ray.ts              ray type + evaluation
  rng.ts              xorshift128 + per-pixel-sample seeding (determinism)
  sampling.ts         unit sphere / disk / cosine-hemisphere samplers
  aabb.ts             axis-aligned bounding boxes (slab test)
  hittable.ts         HitRecord, face-normal orientation, brute-force list
  geometry/
    sphere.ts         quadratic intersection
    rect.ts           axis-aligned rectangles (xy / xz / yz planes)
    box.ts            axis-aligned solid boxes (slab test + face normals)
    triangle.ts       Moller-Trumbore
  bvh.ts              median-split BVH (documented strategy)
  materials.ts        lambertian / metal / dielectric / emissive
  camera.ts           thin-lens camera (fov, aperture, focus distance)
  integrator.ts       iterative path tracer + russian roulette + render loop
  png.ts              PNG encoder (CRC-32 in-tree, DEFLATE from node:zlib), gamma 2.2 tone map
  scene.ts            JSON scene schema parser (schema documented in the file header)
  cli.ts              argument parsing, progress reporting, file output
scenes/               three committed scenes (cornell, spheres, night)
renders/              committed gallery PNGs, reproducible via render:all
tests/                14 suites / 126 tests, including the furnace tests
```

### Scene format

Documented in full in the header of `src/scene.ts`. Shape:

```jsonc
{
  "name": "cornell",
  "camera": { "position": [x,y,z], "lookAt": [x,y,z], "vfov": 40,
              "aperture": 0.0, "focusDist": 10 },        // aperture/focusDist optional
  "background": [r,g,b],                                  // or {type: gradient, top, bottom}
  "render": { "width": 480, "height": 360, "spp": 256, "maxDepth": 32, "seed": 7 },
  "materials": { "name": { "type": "lambertian|metal|dielectric|emissive", ... } },
  "objects": [ { "type": "sphere|rect|box|triangle", ..., "material": "name" } ]
}
```

## Limitations (honest)

- **No next-event estimation / light sampling.** Paths only find lights by
  hitting them, so scenes with small or dim lights converge slowly. The
  committed cornell scene compensates with a large area light and 700 spp;
  it converges to a clean image but a NEE integrator would need far fewer
  samples. This is a deliberate scope choice, not an oversight.
- **Deterministic per environment, not across environments.** Byte-identical
  output is guaranteed for repeated runs on the same Node/zlib build.
  A different zlib could compress IDAT differently (the *pixels* would still
  match; the bytes might not).
- **Single-threaded.** No worker_threads; the gallery takes a few minutes.
- **No textures, no spectral rendering, no denoising, no tone-mapping curve**
  beyond plain gamma 2.2 (not the exact sRGB transfer function).
- **Axis-aligned rects/boxes only** - no instancing or rotation transforms.
- **Schlick approximation** for fresnel (exact only at normal incidence),
  the standard tradeoff for a glass look without full Fresnel equations.

## Roadmap

- Next-event estimation with multiple importance sampling (the single
  biggest variance win available).
- worker_threads tile renderer (embarrassingly parallel; per-pixel seeding
  already makes results traversal-order independent).
- Transforms (rotate/translate instances) for non-axis-aligned boxes.
- Textures (checker, image) and a sky model beyond the two-color gradient.
- Stratified / low-discrepancy sampling per pixel.

## License

MIT - Copyright (c) 2026 GreenPandaTech. See [LICENSE](LICENSE).
