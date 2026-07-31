# Changelog

## v1.2.0 (2026-07-31)

GGX multiple-scattering energy compensation (Kulla-Conty) and a rough
dielectric (frosted glass) material. Single-scattering microfacet models
discard light that hits a second facet, so rough surfaces darken: measured on
this codebase, an albedo-1 GGX conductor furnace read 0.9075 / 0.6938 / 0.3221
at roughness 0.5 / 0.7 / 1.0. With compensation the same furnaces read
1.0008 / 1.0002 / 1.0010 - closed within Monte Carlo noise, with zero runtime
dependencies and determinism preserved.

### Rendering

- **Energy tables** (`src/ggx-energy.ts`): single-scattering directional
  albedo E(mu) and its cosine-weighted average E_avg, computed at material
  construction by deterministic midpoint quadrature over exactly the
  throughput weight the sampler produces - pure math, no RNG, no baked data
  files, so the tables can never drift from the BRDF they compensate. A
  t = sqrt(1 - u2) substitution absorbs the grazing half-vector singularity.
  Tables are cached per alpha / etaRel.
- **Conductor multiple-scattering lobe** (`src/materials.ts`): GGXConductor
  gains the reciprocal Kulla-Conty lobe
  f_ms = F_ms (1 - E(mu_o)) (1 - E(mu_i)) / (pi (1 - E_avg)), wired through
  evalBrdf / scatterPdf / scatter as an energy-weighted GGX + cosine mixture,
  so NEE + MIS stay consistent and attenuation = f cos / pdf still holds.
  `compensate = false` preserves the reference single-scattering path.
- **Rough dielectric** (`src/materials.ts`, scene type `rough_dielectric`):
  frosted glass after Walter et al. 2007 - NDF half-vector sampling, exact
  dielectric Fresnel (`fresnelDielectric` in `src/microfacet.ts`, replacing
  Schlick where eta < 1 matters), reflection + refraction lobes - scaled per
  side by 1 / E(mu_o) with separate entering / exiting tables (the Imageworks
  form of Kulla-Conty for glass). NEE-skipped like the smooth dielectric.
- **Input validation**: the scene parser rejects a nonphysical `ior`
  (zero / negative) for both dielectric types, and the GGX material
  constructors reject NaN / out-of-range inputs that would silently bake
  garbage energy tables.

### Validation (evidence, not assertion)

- **Furnace closure**: albedo-1 conductor furnaces close to within
  (0.98, 1.02) at every tested roughness (uncompensated: 0.3221 at
  roughness 1); rough-glass furnaces read 0.9990 / 0.9996 / 0.9991 at
  roughness 0.3 / 0.7 / 1.0 (uncompensated: 0.9844 / 0.6583 / 0.3556).
  Energy also closes pointwise per incident angle, entering and exiting.
- **Cross-checks**: quadrature E(mu) matches independent Monte Carlo over the
  actual sampler; E[cos / pdf] over scatter samples is pi (the reported pdf is
  the true mixture density); the BRDF stays reciprocal with the ms lobe;
  compensation only ever adds energy; exact-Fresnel identities (TIR beyond the
  critical angle, interface symmetry, analytic r0, Schlick agreement); the
  roughness-0 rough dielectric matches the smooth Dielectric.
- **Known limitation, measured**: high-IOR frosted glass converges slowly
  (heavy-tailed weights in deep TIR chains). At roughness 1, spp 400, seeds
  42 / 7: ior 1.5 furnaces read 0.9994 / 0.9971 while ior 2.4 reads
  0.9417 / 0.9277 - variance, not bias (per-scatter expectation closes);
  documented in the GGXDielectric docblock.

### Gallery & tests

- The `ggx` scene type now compensates by default, which changes ggx pixels:
  `showcase` and `skylight` were regenerated so the committed gallery stays
  byte-reproducible from source. `cornell` / `spheres` / `night` contain no
  ggx materials and are untouched.
- 30 -> 32 suites, 240 -> **274 tests**; lint + strict typecheck clean.

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
