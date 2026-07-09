/**
 * Isotropic GGX (Trowbridge-Reitz) microfacet BRDF terms and half-vector
 * sampling, in world space around an explicit surface normal.
 *
 * Kept pure and separate so the distribution, the Smith masking-shadowing, the
 * Fresnel term and the sampling pdf can each be unit-tested against their
 * analytic identities (D integrates to 1 over the hemisphere; the reflection
 * pdf is D*(n.h)/(4*(wo.h))).
 */
import { ONE, add, dot, normalize, scale, sub, type Vec3 } from './vec3.js';
import { orthonormalBasis } from './sampling.js';
import type { Rng } from './rng.js';

/** GGX normal distribution D(h): concentration of microfacets around h. */
export function ggxD(n: Vec3, h: Vec3, alpha: number): number {
  const nh = dot(n, h);
  if (nh <= 0) return 0;
  const a2 = alpha * alpha;
  const d = nh * nh * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

/** Smith masking-shadowing G1 for one direction (GGX height-correlated form). */
export function smithG1(n: Vec3, v: Vec3, alpha: number): number {
  const nv = Math.abs(dot(n, v));
  const a2 = alpha * alpha;
  return (2 * nv) / (nv + Math.sqrt(a2 + (1 - a2) * nv * nv));
}

/** Separable Smith masking-shadowing for the view and light directions. */
export function smithG(n: Vec3, wo: Vec3, wi: Vec3, alpha: number): number {
  return smithG1(n, wo, alpha) * smithG1(n, wi, alpha);
}

/** Schlick Fresnel with a spectral F0 (reflectance at normal incidence). */
export function fresnelSchlick(cosTheta: number, f0: Vec3): Vec3 {
  const m = Math.pow(Math.max(0, 1 - cosTheta), 5);
  return add(f0, scale(sub(ONE, f0), m));
}

/** Sample a half-vector from the GGX NDF around the surface normal n. */
export function sampleGGXNormal(n: Vec3, alpha: number, rng: Rng): Vec3 {
  const u1 = rng.float();
  const u2 = rng.float();
  const phi = 2 * Math.PI * u1;
  const cosTheta = Math.sqrt((1 - u2) / (1 + (alpha * alpha - 1) * u2));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const onb = orthonormalBasis(n);
  return normalize(
    add(
      add(scale(onb.u, Math.cos(phi) * sinTheta), scale(onb.v, Math.sin(phi) * sinTheta)),
      scale(onb.w, cosTheta),
    ),
  );
}

/**
 * Solid-angle pdf of the reflected direction wi produced by sampling a
 * half-vector from the GGX NDF: D(h)*(n.h) / (4*(wo.h)). Returns 0 for
 * degenerate configurations.
 */
export function ggxReflectPdf(n: Vec3, wo: Vec3, wi: Vec3, alpha: number): number {
  const h = normalize(add(wo, wi));
  const nh = dot(n, h);
  const woh = dot(wo, h);
  if (nh <= 0 || woh <= 0) return 0;
  return (ggxD(n, h, alpha) * nh) / (4 * woh);
}
