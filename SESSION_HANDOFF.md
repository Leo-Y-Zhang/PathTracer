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

1. [x] Material BRDF-eval + pdf refactor (evalBrdf/scatterPdf/isSpecular)
2. [x] Hittable light-sampling API (pdfValue/sampleTowards) rect + sphere
3. [x] Integrator NEE + MIS (power heuristic) + direct-lighting/variance tests
4. [x] GGX microfacet material + VNDF sampling + white-furnace conductor test
5. [ ] UVs on geometry + Texture interface + in-tree PNG decoder + textured mats
6. [ ] OBJ loader + smooth normals + instance transforms
7. [ ] Tone operators + sky model + stratified sampling
8. [ ] worker_threads tile renderer (determinism preserved)
9. [ ] ESLint, gallery scenes, README/CHANGELOG, v1.0.0, review, merge+tag

## Progress

Steps 1-4 DONE + pushed (147 tests; furnace/determinism green):
1 materials expose evalBrdf/scatterPdf/isSpecular · 2 AreaLight
(pdfValue/sampleTowards) on Rect+Sphere (src/lights.ts) · 3 NEE+MIS integrator
(trace gains optional `lights`; scene.lights wired through cli; validated
unbiased + variance-cutting + deterministic) · 4 GGX microfacet conductor
(src/microfacet.ts) + scene 'ggx' type.

## Exact next step

NEXT = step 5 (textures + UVs). Sub-step 5a (bounded, do first): add optional
`uv?: {u,v}` to HitRecord; compute UVs in Sphere (spherical), Rect (parametric),
Triangle (barycentric); add src/texture.ts (Texture interface + SolidColor +
CheckerTexture, procedural — no PNG decoder yet); add a TexturedLambertian that
reads albedo from a Texture; scene-parse a `textures` map + the textured
material; tests for UV values + checker + textured scatter. Sub-step 5b (later):
in-tree PNG DECODER (mirror src/png.ts) + ImageTexture. Existing geometry hit()
returning no uv must keep working (uv optional).
