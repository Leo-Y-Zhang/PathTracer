import type { Vec3 } from './vec3.js';
import type { Rng } from './rng.js';

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
