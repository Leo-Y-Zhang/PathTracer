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
5. [x] UVs on geometry + Texture interface + in-tree PNG decoder + textured mats
6. [x] OBJ loader + smooth normals + instance transforms
7. [x] Tone operators + sky model + stratified sampling
8. [x] worker_threads tile renderer (determinism preserved)
9. [~] ESLint+CI DONE, README/CHANGELOG+v1.0.0 DONE, gallery(+showcase) DONE;
       review wf_70bc2c38-bf0 running; then apply findings, merge+tag v1.0.0

## Progress

Steps 1-4 DONE + pushed (147 tests; furnace/determinism green):
1 materials expose evalBrdf/scatterPdf/isSpecular · 2 AreaLight
(pdfValue/sampleTowards) on Rect+Sphere (src/lights.ts) · 3 NEE+MIS integrator
(trace gains optional `lights`; scene.lights wired through cli; validated
unbiased + variance-cutting + deterministic) · 4 GGX microfacet conductor
(src/microfacet.ts) + scene 'ggx' type.

## Exact next step

DONE 5a (UVs on Sphere/Rect/Triangle + src/texture.ts SolidColor/CheckerTexture
+ TexturedLambertian + scene textures map; 156 tests). NEXT = sub-step 5b:
in-tree PNG DECODER (mirror the src/png.ts encoder: parse IHDR/IDAT, inflate via
node:zlib, unfilter scanlines) + `ImageTexture` sampling it with bilinear/nearest
lookup + scene `{type:'image', path}` texture; test against a round-trip
(encode->decode) of a known buffer. THEN step 6 (OBJ meshes + smooth normals +
instance transforms), step 7 (tone/sky/stratified), step 8 (worker_threads
tiles), step 9 (ESLint, gallery regen, README/CHANGELOG, v1.0.0, review,
merge+tag). Furnace/determinism stay green throughout.
