import type { Vec3 } from './vec3.js';
import type { Rng } from './rng.js';
import type { Hittable } from './hittable.js';

/**
 * A surface that can be importance-sampled as a light for next-event
 * estimation (direct lighting). Both methods work in solid-angle measure at the
 * shading point `origin`.
 */
export interface AreaLight {
  /**
   * Solid-angle probability density that `sampleTowards` would produce the unit
   * direction `dir` from `origin`. Returns 0 when `dir` does not reach the light.
   */
  pdfValue(origin: Vec3, dir: Vec3): number;
  /** Sample a unit direction from `origin` toward this light's surface. */
  sampleTowards(origin: Vec3, rng: Rng): Vec3;
}

/** A scene light: an area-samplable surface that is also intersectable. */
export type LightPrimitive = AreaLight & Hittable;

/**
 * The set of emissive surfaces used for next-event estimation. Sampling picks
 * one light uniformly and samples a direction toward it; `pdf` returns the
 * resulting mixture density (averaged over all lights) for MIS weighting, which
 * correctly accounts for a direction that could have been sampled via any light.
 */
export class LightList {
  constructor(readonly lights: readonly LightPrimitive[]) {}

  get count(): number {
    return this.lights.length;
  }

  /** Mixture solid-angle pdf that this strategy produces `dir` from `origin`. */
  pdf(origin: Vec3, dir: Vec3): number {
    const n = this.lights.length;
    if (n === 0) return 0;
    let sum = 0;
    for (const light of this.lights) sum += light.pdfValue(origin, dir);
    return sum / n;
  }

  /** Uniformly pick a light and sample a direction toward it (with its mixture pdf). */
  sample(origin: Vec3, rng: Rng): { dir: Vec3; pdf: number } | null {
    const n = this.lights.length;
    if (n === 0) return null;
    const idx = Math.min(n - 1, Math.floor(rng.float() * n));
    const dir = this.lights[idx]!.sampleTowards(origin, rng);
    return { dir, pdf: this.pdf(origin, dir) };
  }
}
