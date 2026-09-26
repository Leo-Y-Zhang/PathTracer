import { add, cross, normalize, scale, vec3, type Vec3 } from './vec3.js';
import type { Rng } from './rng.js';

/**
 * Uniform point on the unit sphere (Archimedes' hat-box: z uniform in
 * [-1, 1], azimuth uniform). Uses exactly two RNG draws - no rejection
 * loop - so the sample count per draw is fixed and deterministic.
 */
export function randomUnitVector(rng: Rng): Vec3 {
  const z = 1 - 2 * rng.float();
  const phi = 2 * Math.PI * rng.float();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return vec3(r * Math.cos(phi), r * Math.sin(phi), z);
}

/** Uniform point on the unit disk (z = 0), via the polar sqrt map. Two draws, no rejection. */
export function randomInUnitDisk(rng: Rng): Vec3 {
  const r = Math.sqrt(rng.float());
  const theta = 2 * Math.PI * rng.float();
  return vec3(r * Math.cos(theta), r * Math.sin(theta), 0);
}

/**
 * Stratified (jittered-grid) sub-pixel offset in [0, 1)^2 for sample `index` of
 * `spp`. The pixel is split into a gridN x gridN grid (gridN = floor(sqrt spp));
 * the first gridN^2 samples land one per cell (jittered), cutting variance
 * versus purely random jitter. Any samples beyond gridN^2 (spp not a perfect
 * square) are uniform over the whole pixel: folding them back onto the first
 * cells would weight those cells twice in the pixel mean and bias it toward
 * the pixel's top-left. Two RNG draws either way, so the deterministic
 * per-sample seeding is preserved.
 */
export function stratifiedOffset(index: number, spp: number, rng: Rng): { x: number; y: number } {
  const gridN = Math.max(1, Math.floor(Math.sqrt(spp)));
  if (index >= gridN * gridN) return { x: rng.float(), y: rng.float() };
  const sx = index % gridN;
  const sy = Math.floor(index / gridN);
  return { x: (sx + rng.float()) / gridN, y: (sy + rng.float()) / gridN };
}

export interface Onb {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly w: Vec3;
}

/** Orthonormal basis with w along the given unit vector. */
export function orthonormalBasis(w: Vec3): Onb {
  const a = Math.abs(w.x) > 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  const v = normalize(cross(w, a));
  const u = cross(w, v);
  return { u, v, w };
}

/**
 * Cosine-weighted hemisphere sample about `normal` (a unit vector).
 * pdf(omega) = cos(theta) / pi. Derivation: with u2 ~ U[0,1),
 * cos(theta) = sqrt(1 - u2) gives P(cos theta) proportional to cos(theta).
 * Under this pdf the analytic mean of cos(theta) is 2/3 - asserted in tests.
 */
export function cosineSampleHemisphere(normal: Vec3, rng: Rng): Vec3 {
  const u1 = rng.float();
  const u2 = rng.float();
  const phi = 2 * Math.PI * u1;
  const sinTheta = Math.sqrt(u2);
  const cosTheta = Math.sqrt(1 - u2);
  const { u, v, w } = orthonormalBasis(normal);
  return add(
    add(scale(u, Math.cos(phi) * sinTheta), scale(v, Math.sin(phi) * sinTheta)),
    scale(w, cosTheta),
  );
}
