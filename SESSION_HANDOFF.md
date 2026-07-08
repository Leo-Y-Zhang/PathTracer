# Session handoff — Helios "to the max" upgrade (repo #2)

**Branch:** `upgrade/render-engine` (merge to `main` only after review + all-green).
**Spec:** `docs/superpowers/specs/2026-07-08-render-engine-max-design.md` (approved).
**Baseline:** 126 tests green, strict tsc clean, zero runtime deps, deterministic.

## Program context

Repo #2 of the max-upgrade program (bar set by Hephaestus v1.0.0). User approved:
deep-but-distinctive, showcase repos only, autonomous one-at-a-time, no per-repo
check-in. Commit identity: GreenPandaTech noreply. Clone at C:\dev\Helios (never
cloud-synced). Program memory: project-repo-max-upgrades.

## Key constraints for THIS repo

- **Furnace tests are the guardrail** — every integrator change must keep the
  albedo-0.5 sphere → 0.5 and white-furnace box → 1.0 tests exact (unbiased).
- **Determinism** — no Math.random; use seeded pixelRng with fixed draw order;
  keep SHA-256 byte-identical output (incl. under worker_threads).
- **Zero runtime deps** — new PNG decoder / OBJ loader are in-tree.
- Build model: `npm test` = `tsc -p tsconfig.build.json` then vitest (tests run
  against dist/). Run `npm run typecheck` separately.

## Build order (TDD, commit+push each green step)

1. [ ] Material BRDF-eval + pdf refactor (evalBrdf/scatterPdf/isSpecular)
2. [ ] Hittable light-sampling API (pdfValue/sampleTowards) rect + sphere
3. [ ] Integrator NEE + MIS (power heuristic) + direct-lighting/variance tests
4. [ ] GGX microfacet material + VNDF sampling + white-furnace conductor test
5. [ ] UVs on geometry + Texture interface + in-tree PNG decoder + textured mats
6. [ ] OBJ loader + smooth normals + instance transforms
7. [ ] Tone operators + sky model + stratified sampling
8. [ ] worker_threads tile renderer (determinism preserved)
9. [ ] ESLint, gallery scenes, README/CHANGELOG, v1.0.0, review, merge+tag

## Exact next step

Start step 1: extend the `Material` interface in `src/materials.ts` with
`evalBrdf(wo, wi, hit): Vec3`, `scatterPdf(wo, wi, hit): number`, and an
`isSpecular` flag; implement for Lambertian (BRDF = albedo/pi, pdf = cos/pi),
mark Metal/Dielectric specular. Keep the existing `scatter` returning
attenuation so the integrator is unchanged until step 3. Add unit tests
asserting Lambertian evalBrdf/scatterPdf match the analytic values; run
`npm test` (furnace must stay green).
