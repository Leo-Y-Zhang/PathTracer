# Helios → production-grade render engine ("to the max")

**Status:** self-approved 2026-07-08 (repo #2 of the max-upgrade program, at the
Hephaestus bar). Baseline: 126 tests, strict tsc, zero runtime deps, deterministic.

## Goal

Take the physics-validated path tracer to a serious offline renderer, executing
the README roadmap and beyond — **without losing** its load-bearing guarantees:
zero runtime dependencies, byte-deterministic output (per-pixel seeding), and
physics validated against analytic ground truth (the furnace tests stay green).

## Design principles (unchanged, load-bearing)

- **Unbiased or it doesn't ship.** Every integrator change is gated by the
  furnace + white-furnace tests (albedo-0.5 sphere → 0.5, albedo-1.0 box → 1.0)
  and new analytic checks. A pretty image that fails the furnace is a bug.
- **Determinism.** No `Math.random`. Any new RNG consumption uses the seeded
  `pixelRng` streams with a fixed draw order so repeated runs stay byte-identical
  (asserted by SHA-256). Parallelism must be traversal-order independent.
- **Zero runtime deps.** New encoders/decoders/loaders (PNG decode, OBJ) are
  in-tree, like the existing PNG encoder.

## Pillar 1 — Next-event estimation + MIS (marquee)

The single biggest variance win. Requires exposing BSDF evaluation, not just
sampling:

- **Material interface** gains, alongside `scatter` (sample):
  `evalBrdf(wo, wi, hit): Vec3` (the BRDF value, no cos/pdf) and
  `scatterPdf(wo, wi, hit): number` (the sampling pdf for direction wi). A
  `isSpecular` flag marks Dirac materials (metal/dielectric) that NEE must skip.
- **Light sampling API** on hittables that can be lights:
  `pdfValue(origin, dir): number` and `sampleTowards(origin, rng): Vec3`, for
  area lights (rect, sphere; box = 6 rects). Scene gains a `lights` list built
  from emissive objects.
- **Integrator**: at each non-specular bounce, add a **direct-lighting** estimate
  by sampling a light (shadow ray + visibility), MIS-weighted (power heuristic)
  against the BSDF-sampled continuation, so both strategies combine without
  double-counting emission.
- **Validation**: furnace/white-furnace stay exact; a new **direct-lighting**
  test against an analytic configuration; and a **variance/convergence** test
  showing the NEE+MIS image matches the reference mean at far fewer spp.

## Pillar 2 — GGX microfacet materials

Replace the ad-hoc metal-roughness with a principled Cook-Torrance GGX:
`D` (Trowbridge-Reitz), `G` (Smith height-correlated), `F` (Schlick), with
`roughness` + `metallic`; importance-sampled via the visible-normal
distribution (VNDF). White-furnace energy conservation for a rough conductor.
Keep the old `metal`/`dielectric` for continuity.

## Pillar 3 — Textures + UVs

Add `uv` to `HitRecord`; compute UVs in sphere (spherical), rect/box
(parametric), triangle (barycentric, optional per-vertex UVs). `Texture`
interface: `solid`, `checker`, procedural `noise`, and `image` (via a new in-tree
**PNG decoder** — mirror of the encoder). Textured lambertian/emissive materials.

## Pillar 4 — Meshes, smooth normals, transforms

- **OBJ loader** (`src/io/obj.ts`): `v/vt/vn/f`, triangulate polygons, optional
  per-vertex normals + UVs on `Triangle` (barycentric interpolation → smooth
  shading).
- **Instance transforms**: a `Transform` hittable wrapping any hittable with
  translate/rotate/scale (fixes the axis-aligned-only limitation), transforming
  ray in / hit out with the correct normal (inverse-transpose).

## Pillar 5 — Tone mapping, sky, stratified sampling

- Tone operators: `linear` (current gamma 2.2), `reinhard`, `aces`, with
  `exposure`; selected via scene `render.toneMapping`.
- A sky/environment model beyond the 2-colour gradient (analytic sun + sky
  gradient), sampled for NEE as an infinite light.
- Stratified / jittered per-pixel sampling (and optionally a low-discrepancy
  sequence) for lower variance at equal spp — determinism preserved.

## Pillar 6 — Parallelism + engineering

- **worker_threads tile renderer**: split the image into tiles across workers;
  per-pixel seeding keeps output byte-identical regardless of worker count
  (asserted). Fall back to single-thread when workers unavailable.
- ESLint (typescript-eslint) added to CI.
- Tests ~126 → ~250+; new gallery scenes (a textured mesh, a GGX metal study,
  an NEE-lit scene converging at low spp). README/CHANGELOG. Version → 1.0.0.

## Non-goals (this iteration)

Spectral rendering, bidirectional path tracing / Metropolis, participating media
/ volumetrics, real-time/GPU, full Fresnel conductor equations, denoising.

## Build order (TDD, commit+push each green step)

1. Material BRDF-eval + pdf refactor (evalBrdf/scatterPdf/isSpecular) — furnace green
2. Hittable light-sampling API (pdfValue/sampleTowards) for rect + sphere
3. Integrator NEE + MIS (power heuristic) + direct-lighting/variance tests
4. GGX microfacet material + VNDF sampling + white-furnace conductor test
5. UVs on all geometry + Texture interface + PNG decoder + textured materials
6. OBJ loader + smooth normals + instance transforms
7. Tone operators + sky model + stratified sampling
8. worker_threads tile renderer (determinism preserved)
9. ESLint, new gallery scenes, README/CHANGELOG, v1.0.0, review, merge+tag
