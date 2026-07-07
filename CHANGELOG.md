# Changelog

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
- CLI: `pathlight render <scene.json>` with progress on stderr; `render:all`
  regenerates the gallery deterministically.
- Physics-validated test suite: furnace test (energy conservation), white
  furnace (russian roulette bias), cosine-sampling distribution, fresnel
  normal incidence, BVH-vs-bruteforce equivalence, byte-identical
  determinism, CLI end-to-end.
