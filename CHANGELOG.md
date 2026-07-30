# Changelog

## v1.1.0 (2026-07-30)

HDR image-based lighting, importance-sampled by next-event estimation - the
last light source the integrator could not sample directly - with the same
guarantees as everything else: zero runtime dependencies, byte-deterministic
output, and unbiasedness proven by a furnace test.

### Rendering

- **Environment lights** (`src/envlight.ts`): a scene-level `environment`
  entry - `{type: "image", path: "sky.hdr"}` or `{type: "constant", color}` -
  that is both the miss shader and an NEE-sampled light (one object, so the
  sampler and the background cannot disagree). The equirect map is
  importance-sampled through a **luminance-weighted 2D CDF** (marginal rows +
  conditional columns, texel positions from CDF residuals so the fixed
  two-draw RNG order is kept); pdf_omega = p_uv / (2 pi^2 sin theta).
- **Environment in the NEE + MIS mixture** (`src/lights.ts`,
  `src/integrator.ts`): the environment counts as one more uniform pick in the
  LightList; a shadow ray that escapes the scene collects environment
  radiance, and a BSDF ray that escapes is MIS-weighted against the mixture
  pdf (unweighted when no environment light exists, since light sampling then
  has zero density on escaping directions). This is the subtle bookkeeping for
  an infinite-domain light, and it is furnace-proven.
- **In-tree Radiance RGBE codec** (`src/hdr.ts`): `.hdr` header parsing
  (FORMAT, EXPOSURE, orientation), new-style RLE and flat scanlines, plus an
  encoder used by the asset generator and round-trip tests. Zero runtime
  dependencies preserved.

### Validation (evidence, not assertion)

- **Environment furnace test**: an albedo-0.5 sphere lit only by a
  constant-radiance environment inside the NEE mixture renders to exactly 0.5
  (and 0.8 -> 0.8), including end-to-end through the `.hdr` file path (RGBE
  encode -> decode -> CDF). Environment + area lights in one mixture stay
  unbiased.
- **Sampling pdf validated independently**: the env pdf integrates to exactly
  1 under texel-aligned quadrature, agrees with a uniform-direction
  solid-angle Monte Carlo estimate, and E[1/pdf] over its own samples is 4 pi.
- **Determinism**: byte-identical SHA-256 output across runs and under
  worker_threads with the environment light active; every draw still comes
  from the seeded per-pixel RNG.

### Gallery & assets

- New committed **skylight** scene: a copper GGX (2,3)-torus-knot OBJ mesh with
  smooth normals under the committed HDR sky - the mesh pipeline's first
  committed render. Both assets (`assets/sky.hdr`, `assets/knot.obj`) are
  generated deterministically by in-tree scripts (`npm run assets:all`);
  nothing downloaded, nothing encumbered.
- Test count correction: the 1.0.0 notes said 190 tests, but the shipped count
  was actually 193. This release: 26 -> 30 suites, 193 -> **240 tests**.

## v1.0.0 (2026-07-09)

A production-grade upgrade: the renderer gains the physically-based sampling and
geometry features of a serious offline path tracer, while keeping its
guarantees - zero runtime dependencies, byte-deterministic output, and physics
validated against analytic ground truth (the furnace tests still hold).

### Rendering

- **Next-event estimation + multiple importance sampling** (power heuristic):
  every non-specular vertex samples a light directly (shadow ray) and combines
  it with BSDF sampling, so small lights converge fast without bias. Materials
  expose a BRDF + pdf and an `isSpecular` flag; rects and spheres expose an
  area-light sampling API (`src/lights.ts`). Tested unbiased (matches pure path
  tracing in the mean) with >40% variance cut at low spp.
- **GGX microfacet conductor** (`src/microfacet.ts`): Cook-Torrance D (GGX) /
  Smith G / Schlick F, importance-sampled, energy-conserving (white-furnace
  bounded); the NDF integrates to 1 and the BRDF is reciprocal.
- **Stratified** (jittered-grid) sub-pixel sampling; **linear / reinhard / aces**
  tone operators with exposure; an analytic **sun + sky** background.

### Geometry & assets

- **Textures** (`src/texture.ts`): procedural solid + checker and **PNG image
  textures**, decoded by a new **in-tree PNG decoder** (all five scanline
  filters, CRC-verified). UVs on spheres, rects, boxes and meshes.
- **Triangle meshes**: a Wavefront **OBJ loader** (`src/io/obj.ts`) with
  1-based/negative indices and fan-triangulation; triangles gain optional
  **smooth normals + UVs** (barycentric-interpolated).
- **Instance transforms** (`src/geometry/transform.ts`, `src/mat3.ts`): affine
  scale / rotate / translate wrapping any hittable, so geometry need not be
  axis-aligned; scene `mesh` and `transform` object types.

### Engineering

- **worker_threads tile renderer** (`src/parallel.ts`) whose output is
  byte-identical to the single-threaded pass; CLI `--workers` flag.
- ESLint added to the CI gate; a new `showcase` scene; 126 -> **190 tests**;
  still zero runtime dependencies. Gallery re-rendered with NEE at lower spp.

## v0.2.0 - naming

- Renamed Pathlight to Helios (mythological naming system). Package name is
  now `helios`; CLI usage string updated accordingly. Scene format, flags,
  and `scenes/` / `renders/` paths are unchanged.

## v0.1.0 (2026-07-07)

Initial release.

- Vec3 / ray math module (pure functions, hand-computed test cases).
- Geometry: spheres, axis-aligned rects and boxes (slab test), triangles
  (Moller-Trumbore); AABB and a median-split BVH whose hits are proven
  identical to brute-force intersection over seeded random scenes.
- Materials: lambertian (cosine-weighted hemisphere sampling), metal with
  roughness, dielectric with Schlick fresnel, diffuse emissive lights.
- Iterative path-tracing integrator with russian roulette (no next-event
  estimation - documented tradeoff), gamma 2.2 output.
- Thin-lens camera: position / lookAt / vfov plus defocus blur (aperture).
- Dependency-free PNG encoder (8-bit RGB, CRC-32 in-tree, DEFLATE injected
  from node:zlib).
- Deterministic rendering: own xorshift128 RNG seeded per pixel sample from
  (x, y, sample, seed); identical CLI runs produce byte-identical PNGs.
- JSON scene format with three committed scenes (cornell, spheres, night)
  and a rendered README gallery.
- CLI: `helios render <scene.json>` with progress on stderr; `render:all`
  regenerates the gallery deterministically.
- Physics-validated test suite: furnace test (energy conservation), white
  furnace (russian roulette bias), cosine-sampling distribution, fresnel
  normal incidence, BVH-vs-bruteforce equivalence, byte-identical
  determinism, CLI end-to-end.
