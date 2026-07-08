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
3. [ ] Integrator NEE + MIS (power heuristic) + direct-lighting/variance tests
4. [ ] GGX microfacet material + VNDF sampling + white-furnace conductor test
5. [ ] UVs on geometry + Texture interface + in-tree PNG decoder + textured mats
6. [ ] OBJ loader + smooth normals + instance transforms
7. [ ] Tone operators + sky model + stratified sampling
8. [ ] worker_threads tile renderer (determinism preserved)
9. [ ] ESLint, gallery scenes, README/CHANGELOG, v1.0.0, review, merge+tag

## Exact next step

DONE step 1 (evalBrdf/scatterPdf/isSpecular exposed on all materials; 131 tests;
furnace still green). NEXT = step 2: add a light-sampling API to hittables that
can be area lights — `pdfValue(origin, dir): number` and
`sampleTowards(origin, rng): Vec3` — for Rect and Sphere (Box = 6 rects), with
unit tests (pdf integrates to 1 over sampled directions; sampled directions hit
the light). Then step 3 wires NEE + MIS into the integrator, gated by the
furnace tests.
