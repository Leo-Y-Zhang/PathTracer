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
import { fresnelSchlick, ggxD, ggxReflectPdf, sampleGGXNormal, smithG } from './microfacet.js';
import type { Texture } from './texture.js';

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
  /**
   * True for Dirac (mirror / glass) BSDFs whose reflection is a delta: they
   * have no finite BRDF value, so next-event estimation must skip them and let
   * `scatter` carry all their energy. False for materials with a finite BRDF.
   */
  readonly isSpecular: boolean;
  /** Returns null when the path is absorbed / terminated at this surface. */
  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult | null;
  /**
   * BRDF value f(wo, wi) at the hit — no cosine, no pdf — for MIS direct
   * lighting. wo and wi are unit world-space directions (wi points away from
   * the surface toward the light / next vertex). Zero for specular BSDFs.
   */
  evalBrdf(wo: Vec3, wi: Vec3, hit: HitRecord): Vec3;
  /**
   * Solid-angle probability density that `scatter` would have sampled `wi`.
   * Zero for specular BSDFs (their density is a delta, handled by `scatter`).
   */
  scatterPdf(wo: Vec3, wi: Vec3, hit: HitRecord): number;
  /** Radiance emitted by the surface (zero for non-lights). */
  emitted(): Vec3;
}

/** Ideal diffuse reflector with cosine-weighted hemisphere importance sampling. */
export class Lambertian implements Material {
  readonly isSpecular = false;

  constructor(readonly albedo: Vec3) {}

  scatter(_rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult {
    const dir = cosineSampleHemisphere(hit.normal, rng);
    return { ray: ray(hit.point, dir), attenuation: this.albedo };
  }

  evalBrdf(_wo: Vec3, wi: Vec3, hit: HitRecord): Vec3 {
    // Constant BRDF albedo/pi on the upper hemisphere, 0 below the surface.
    return dot(wi, hit.normal) > 0 ? scale(this.albedo, 1 / Math.PI) : ZERO;
  }

  scatterPdf(_wo: Vec3, wi: Vec3, hit: HitRecord): number {
    const cos = dot(wi, hit.normal);
    return cos > 0 ? cos / Math.PI : 0;
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

/** Diffuse reflector whose albedo is read from a texture at the hit's UVs. */
export class TexturedLambertian implements Material {
  readonly isSpecular = false;

  constructor(readonly texture: Texture) {}

  private albedoAt(hit: HitRecord): Vec3 {
    return hit.uv
      ? this.texture.sample(hit.uv.u, hit.uv.v, hit.point)
      : this.texture.sample(0, 0, hit.point);
  }

  scatter(_rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult {
    const dir = cosineSampleHemisphere(hit.normal, rng);
    return { ray: ray(hit.point, dir), attenuation: this.albedoAt(hit) };
  }

  evalBrdf(_wo: Vec3, wi: Vec3, hit: HitRecord): Vec3 {
    return dot(wi, hit.normal) > 0 ? scale(this.albedoAt(hit), 1 / Math.PI) : ZERO;
  }

  scatterPdf(_wo: Vec3, wi: Vec3, hit: HitRecord): number {
    const cos = dot(wi, hit.normal);
    return cos > 0 ? cos / Math.PI : 0;
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

/** Mirror reflection perturbed by `roughness` * (uniform point on unit sphere). */
export class Metal implements Material {
  readonly isSpecular = true;

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

  // A (near-)delta reflection: no finite BRDF for NEE to sample.
  evalBrdf(): Vec3 {
    return ZERO;
  }

  scatterPdf(): number {
    return 0;
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

const MIN_ALPHA = 1e-3;

/**
 * Physically-based rough conductor: the Cook-Torrance GGX microfacet BRDF
 * (Trowbridge-Reitz distribution D, height-correlated Smith masking G, Schlick
 * Fresnel with F0 = albedo). Unlike `Metal`'s ad-hoc sphere-perturbed
 * roughness, this is energy-preserving (up to the known single-scatter loss at
 * high roughness) and properly importance-sampled, so it exposes a finite BRDF
 * and pdf and works with next-event estimation. `roughness` in [0, 1] is
 * perceptual; the GGX alpha is roughness^2.
 */
export class GGXConductor implements Material {
  readonly isSpecular = false;
  private readonly alpha: number;

  constructor(
    readonly albedo: Vec3,
    readonly roughness: number,
  ) {
    this.alpha = Math.max(MIN_ALPHA, roughness * roughness);
  }

  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult | null {
    const n = hit.normal;
    const wo = neg(normalize(rIn.dir));
    if (dot(n, wo) <= 0) return null;
    const h = sampleGGXNormal(n, this.alpha, rng);
    const wi = reflect(normalize(rIn.dir), h);
    if (dot(n, wi) <= 0) return null; // reflected below the surface: absorbed
    const pdf = ggxReflectPdf(n, wo, wi, this.alpha);
    if (pdf <= 0) return null;
    const f = this.evalBrdf(wo, wi, hit);
    return { ray: ray(hit.point, wi), attenuation: scale(f, dot(n, wi) / pdf) };
  }

  evalBrdf(wo: Vec3, wi: Vec3, hit: HitRecord): Vec3 {
    const n = hit.normal;
    const nwo = dot(n, wo);
    const nwi = dot(n, wi);
    if (nwo <= 0 || nwi <= 0) return ZERO;
    const h = normalize(add(wo, wi));
    const d = ggxD(n, h, this.alpha);
    const g = smithG(n, wo, wi, this.alpha);
    const fr = fresnelSchlick(Math.max(0, dot(wo, h)), this.albedo);
    return scale(fr, (d * g) / (4 * nwo * nwi));
  }

  scatterPdf(wo: Vec3, wi: Vec3, hit: HitRecord): number {
    return ggxReflectPdf(hit.normal, wo, wi, this.alpha);
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
  readonly isSpecular = true;

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

  evalBrdf(): Vec3 {
    return ZERO;
  }

  scatterPdf(): number {
    return 0;
  }

  emitted(): Vec3 {
    return ZERO;
  }
}

/** Diffuse area light: emits `color * intensity`, absorbs all incoming paths. */
export class Emissive implements Material {
  readonly isSpecular = true;
  readonly radiance: Vec3;

  constructor(color: Vec3, intensity: number) {
    this.radiance = scale(color, intensity);
  }

  scatter(): null {
    return null;
  }

  evalBrdf(): Vec3 {
    return ZERO;
  }

  scatterPdf(): number {
    return 0;
  }

  emitted(): Vec3 {
    return this.radiance;
  }
}
