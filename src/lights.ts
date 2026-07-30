import type { Vec3 } from './vec3.js';
import type { Rng } from './rng.js';
import type { Hittable } from './hittable.js';
import type { EnvironmentLight } from './envlight.js';

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
 * The set of emissive surfaces used for next-event estimation, plus at most
 * one environment (infinite-domain) light. Sampling picks one strategy
 * uniformly - the environment counts as one more pick - and samples a
 * direction toward it; `pdf` returns the resulting mixture density (averaged
 * over all strategies) for MIS weighting, which correctly accounts for a
 * direction that could have been sampled via any light.
 *
 * The environment participates in the mixture like any area light, but its
 * "visibility" is inverted: a shadow ray reaches it by escaping the scene,
 * and its pdfValue is nonzero for every direction its map has energy in (an
 * area light's pdfValue is nonzero only for directions that hit it). Both
 * facts are what keep the mixture pdf - and so the MIS weights - unbiased.
 */
export class LightList {
  constructor(
    readonly lights: readonly LightPrimitive[],
    readonly environment?: EnvironmentLight,
  ) {}

  get count(): number {
    return this.lights.length + (this.environment ? 1 : 0);
  }

  /** Mixture solid-angle pdf that this strategy produces `dir` from `origin`. */
  pdf(origin: Vec3, dir: Vec3): number {
    const n = this.count;
    if (n === 0) return 0;
    let sum = 0;
    for (const light of this.lights) sum += light.pdfValue(origin, dir);
    if (this.environment) sum += this.environment.pdfValue(origin, dir);
    return sum / n;
  }

  /** Uniformly pick a light and sample a direction toward it (with its mixture pdf). */
  sample(origin: Vec3, rng: Rng): { dir: Vec3; pdf: number } | null {
    const n = this.count;
    if (n === 0) return null;
    const idx = Math.min(n - 1, Math.floor(rng.float() * n));
    const dir =
      idx < this.lights.length
        ? this.lights[idx]!.sampleTowards(origin, rng)
        : this.environment!.sampleTowards(origin, rng);
    return { dir, pdf: this.pdf(origin, dir) };
  }
}
