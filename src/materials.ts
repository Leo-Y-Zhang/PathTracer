import {
  ONE,
  ZERO,
  add,
  dot,
  neg,
  normalize,
  reflect,
  refract,
  scale,
  type Vec3,
} from './vec3.js';
import { ray, type Ray } from './ray.js';
import type { HitRecord } from './hittable.js';
import type { Rng } from './rng.js';
import { cosineSampleHemisphere, randomUnitVector } from './sampling.js';

export interface ScatterResult {
  ray: Ray;
  /**
   * Path throughput multiplier: BRDF * cos(theta) / pdf for the sampled
   * direction. For cosine-sampled lambertian this collapses to the albedo
   * because (albedo/pi) * cos / (cos/pi) = albedo.
   */
  attenuation: Vec3;
}

export interface Material {
  /** Returns null when the path is absorbed / terminated at this surface. */
  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult | null;
  /** Radiance emitted by the surface (zero for non-lights). */
  emitted(): Vec3;
}

/** Ideal diffuse reflector with cosine-weighted hemisphere importance sampling. */
export class Lambertian implements Material {
  constructor(readonly albedo: Vec3) {}

  scatter(_rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult {
    const dir = cosineSampleHemisphere(hit.normal, rng);
    return { ray: ray(hit.point, dir), attenuation: this.albedo };
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

/** Mirror reflection perturbed by `roughness` * (uniform point on unit sphere). */
export class Metal implements Material {
  constructor(
    readonly albedo: Vec3,
    readonly roughness: number,
  ) {}

  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult | null {
    const reflected = reflect(normalize(rIn.dir), hit.normal);
    const dir =
      this.roughness > 0
        ? add(reflected, scale(randomUnitVector(rng), this.roughness))
        : reflected;
    // Perturbed rays that dip below the surface are absorbed.
    if (dot(dir, hit.normal) <= 0) return null;
    return { ray: ray(hit.point, normalize(dir)), attenuation: this.albedo };
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

/**
 * Schlick's approximation to the Fresnel reflectance.
 * At normal incidence (cosine = 1) this returns exactly
 * r0 = ((1 - ratio) / (1 + ratio))^2 = ((n1 - n2) / (n1 + n2))^2,
 * which the test suite checks against the analytic Fresnel value.
 */
export function schlickReflectance(cosine: number, refractionRatio: number): number {
  let r0 = (1 - refractionRatio) / (1 + refractionRatio);
  r0 = r0 * r0;
  return r0 + (1 - r0) * Math.pow(1 - cosine, 5);
}

/** Clear dielectric (glass): refracts by Snell's law, reflects by Schlick fresnel + TIR. */
export class Dielectric implements Material {
  constructor(readonly ior: number) {}

  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult {
    const ratio = hit.frontFace ? 1 / this.ior : this.ior;
    const unit = normalize(rIn.dir);
    const cosTheta = Math.min(dot(neg(unit), hit.normal), 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));

    const cannotRefract = ratio * sinTheta > 1; // total internal reflection
    const dir =
      cannotRefract || schlickReflectance(cosTheta, ratio) > rng.float()
        ? reflect(unit, hit.normal)
        : refract(unit, hit.normal, ratio);
    return { ray: ray(hit.point, dir), attenuation: ONE };
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

/** Diffuse area light: emits `color * intensity`, absorbs all incoming paths. */
export class Emissive implements Material {
  readonly radiance: Vec3;

  constructor(color: Vec3, intensity: number) {
    this.radiance = scale(color, intensity);
  }

  scatter(): null {
    return null;
  }

  emitted(): Vec3 {
    return this.radiance;
  }
}
