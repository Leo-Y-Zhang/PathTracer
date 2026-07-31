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
  vec3,
  type Vec3,
} from './vec3.js';
import { ray, type Ray } from './ray.js';
import type { HitRecord } from './hittable.js';
import type { Rng } from './rng.js';
import { cosineSampleHemisphere, randomUnitVector } from './sampling.js';
import {
  fresnelDielectric,
  fresnelSchlick,
  ggxD,
  ggxReflectPdf,
  sampleGGXNormal,
  smithG,
  smithG1,
} from './microfacet.js';
import { conductorEnergy, dielectricEnergy, type EnergyTable } from './ggx-energy.js';
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
 * (Trowbridge-Reitz distribution D, separable Smith masking G, Schlick
 * Fresnel with F0 = albedo), plus a Kulla-Conty multiple-scattering lobe that
 * returns the energy the single-scattering model discards at high roughness
 * (without it an albedo-1 furnace drops to 0.32 at roughness 1; the ms lobe
 * closes it to 1). The ms lobe is
 *
 *   f_ms(wo, wi) = F_ms (1 - E(mu_o)) (1 - E(mu_i)) / (pi (1 - E_avg))
 *
 * with E/E_avg from the deterministic quadrature tables in ggx-energy.ts and
 * F_ms = F_avg^2 E_avg / (1 - F_avg (1 - E_avg)) per channel, where
 * F_avg = (1 + 20 F0) / 21 is the analytic cosine-average of Schlick Fresnel.
 * It is symmetric in mu_o/mu_i, so the BRDF stays reciprocal; for F0 = 1 the
 * total directional albedo is E + (1 - E) = 1 exactly. Sampling mixes the GGX
 * half-vector lobe with a cosine lobe for the ms term (weighted by their
 * energies), and the pdf reports the same mixture, so NEE + MIS stay
 * consistent and `attenuation = f cos / pdf` still holds. Pass
 * `compensate = false` for the reference single-scattering behaviour.
 * `roughness` in [0, 1] is perceptual; the GGX alpha is roughness^2.
 */
export class GGXConductor implements Material {
  readonly isSpecular = false;
  private readonly alpha: number;
  private readonly energy: EnergyTable;
  /** Per-channel multiple-scattering Fresnel factor F_ms. */
  private readonly msFresnel: Vec3;
  private readonly msFresnelMean: number;

  constructor(
    readonly albedo: Vec3,
    readonly roughness: number,
    readonly compensate: boolean = true,
  ) {
    // A NaN or out-of-range roughness would silently bake an all-NaN energy
    // table (rendering pure black); fail loudly at construction instead.
    if (!(roughness >= 0 && roughness <= 1)) {
      throw new Error(`GGXConductor: roughness must be in [0, 1], got ${roughness}`);
    }
    this.alpha = Math.max(MIN_ALPHA, roughness * roughness);
    this.energy = conductorEnergy(this.alpha);
    const eavg = this.energy.average;
    // F_avg = 2 int F(mu) mu dmu is analytic for Schlick: (1 + 20 F0) / 21.
    const ms = (f0: number): number => {
      const favg = (1 + 20 * f0) / 21;
      return (favg * favg * eavg) / (1 - favg * (1 - eavg));
    };
    this.msFresnel = vec3(ms(this.albedo.x), ms(this.albedo.y), ms(this.albedo.z));
    this.msFresnelMean = (this.msFresnel.x + this.msFresnel.y + this.msFresnel.z) / 3;
  }

  /** The (1-E)(1-E)/(pi(1-E_avg)) scalar shape of the ms lobe (zero when disabled). */
  private msBrdf(muO: number, muI: number): number {
    if (!this.compensate) return 0;
    const denom = Math.PI * (1 - this.energy.average);
    if (denom < 1e-9) return 0; // vanishing ms lobe at very low roughness
    return ((1 - this.energy.directional(muO)) * (1 - this.energy.directional(muI))) / denom;
  }

  /** Probability of picking the single-scatter GGX lobe, from the lobes' energies. */
  private pSingle(muO: number): number {
    if (!this.compensate) return 1;
    const e = this.energy.directional(muO);
    return e / (e + (1 - e) * this.msFresnelMean);
  }

  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult | null {
    const n = hit.normal;
    const wo = neg(normalize(rIn.dir));
    const nwo = dot(n, wo);
    if (nwo <= 0) return null;
    let wi: Vec3;
    // Short-circuit keeps the uncompensated path's RNG draw order unchanged.
    if (!this.compensate || rng.float() < this.pSingle(nwo)) {
      const h = sampleGGXNormal(n, this.alpha, rng);
      wi = reflect(normalize(rIn.dir), h);
      if (dot(n, wi) <= 0) return null; // reflected below the surface: absorbed
    } else {
      wi = cosineSampleHemisphere(n, rng);
    }
    const pdf = this.scatterPdf(wo, wi, hit);
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
    const single = scale(fr, (d * g) / (4 * nwo * nwi));
    const msShape = this.msBrdf(nwo, nwi);
    return msShape > 0 ? add(single, scale(this.msFresnel, msShape)) : single;
  }

  scatterPdf(wo: Vec3, wi: Vec3, hit: HitRecord): number {
    const n = hit.normal;
    const single = ggxReflectPdf(n, wo, wi, this.alpha);
    if (!this.compensate) return single;
    const nwo = dot(n, wo);
    if (nwo <= 0) return 0;
    const nwi = dot(n, wi);
    const cosinePdf = nwi > 0 ? nwi / Math.PI : 0;
    const p = this.pSingle(nwo);
    return p * single + (1 - p) * cosinePdf;
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

/**
 * Rough dielectric (frosted glass): GGX microfacet reflection and refraction
 * after Walter et al. 2007, with energy compensation so the lobe pair stays
 * lossless at every roughness. Half-vectors are sampled from the NDF; the
 * exact dielectric Fresnel picks reflection vs refraction; both lobes share
 * Walter's throughput weight G1(wo) G1(wi) (wo.h) / ((n.wo)(n.h)). That
 * single-scattering weight loses energy as roughness grows (multi-facet paths
 * are discarded), so the weight is divided by the deterministic
 * single-scattering albedo E(mu_o) from ggx-energy.ts - the Imageworks
 * scaling form of Kulla-Conty compensation, which they also use for glass
 * because a reciprocal ms lobe for refraction needs separate interior /
 * exterior lobes. Scaling trades reciprocity (a non-issue for a camera-only
 * unidirectional tracer) for an exactly closed furnace; the entering and
 * exiting sides get their own E tables (etaRel = 1/ior vs ior).
 *
 * The lobes are finite, but the material declares itself specular so NEE
 * skips it and `scatter` carries all of its energy - that costs variance
 * under small lights, never bias, and avoids the half-vector Jacobian
 * bookkeeping a transmission pdf/eval pair would need. Like the smooth
 * `Dielectric`, refraction applies no (eta_o/eta_i)^2 radiance compression;
 * for closed objects the entry and exit factors cancel.
 *
 * Convergence caveat: the estimator is unit-mean per scatter (verified per
 * incidence angle in tests) but heavy-tailed - NDF half-vector sampling has a
 * 1/(n.h) weight tail, amplified by the 1/E scaling - and deep total-internal-
 * reflection chains multiply many such weights, so furnace-level convergence
 * degrades as the index rises. Measured at roughness 1 (24x24 render, 400 spp,
 * seeds 42/7): ior 1.5 reads 0.9994/0.9971, ior 2.4 still wanders at
 * 0.9417/0.9277. That is variance, not bias; expect fireflies from high-IOR
 * frosted materials at low sample counts.
 */
export class GGXDielectric implements Material {
  readonly isSpecular = true;
  private readonly alpha: number;
  /** E(mu) for rays arriving from outside the medium (etaRel = 1/ior). */
  private readonly outside: EnergyTable;
  /** E(mu) for rays arriving from inside the medium (etaRel = ior). */
  private readonly inside: EnergyTable;

  constructor(
    readonly ior: number,
    readonly roughness: number,
    readonly compensate: boolean = true,
  ) {
    // Nonphysical inputs would silently bake garbage energy tables; the scene
    // parser rejects them too, but guard the programmatic path as well.
    if (!(Number.isFinite(ior) && ior > 0)) {
      throw new Error(`GGXDielectric: ior must be a finite positive number, got ${ior}`);
    }
    if (!(roughness >= 0 && roughness <= 1)) {
      throw new Error(`GGXDielectric: roughness must be in [0, 1], got ${roughness}`);
    }
    this.alpha = Math.max(MIN_ALPHA, roughness * roughness);
    this.outside = dielectricEnergy(this.alpha, 1 / ior);
    this.inside = dielectricEnergy(this.alpha, ior);
  }

  scatter(rIn: Ray, hit: HitRecord, rng: Rng): ScatterResult | null {
    const n = hit.normal;
    const unit = normalize(rIn.dir);
    const wo = neg(unit);
    const nwo = dot(n, wo);
    if (nwo <= 0) return null;
    const etaRel = hit.frontFace ? 1 / this.ior : this.ior;
    const h = sampleGGXNormal(n, this.alpha, rng);
    const woh = dot(wo, h);
    const nh = dot(n, h);
    if (woh <= 0 || nh <= 0) return null; // half-vector behind the view: absorbed
    const fr = fresnelDielectric(woh, etaRel);
    let wi: Vec3;
    if (rng.float() < fr) {
      wi = reflect(unit, h);
      if (dot(n, wi) <= 0) return null; // reflected below the surface: absorbed
    } else {
      wi = normalize(refract(unit, h, etaRel));
      if (dot(n, wi) >= 0) return null; // refracted into the wrong hemisphere: absorbed
    }
    // Walter's weight for NDF half-vector sampling (identical for both lobes);
    // the Fresnel factor cancelled against the lobe-selection probability.
    let weight = (smithG1(n, wo, this.alpha) * smithG1(n, wi, this.alpha) * woh) / (nwo * nh);
    if (this.compensate) {
      // Divide by the expected single-scatter throughput at this incidence,
      // measured over the same sampling process (rejections included), so the
      // scatter event returns unit energy in expectation.
      weight /= (hit.frontFace ? this.outside : this.inside).directional(nwo);
    }
    return { ray: ray(hit.point, wi), attenuation: vec3(weight, weight, weight) };
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
