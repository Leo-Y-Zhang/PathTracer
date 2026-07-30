import { describe, expect, it } from 'vitest';
import { dot, normalize, vec3, type Vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { cosineSampleHemisphere } from '../src/sampling.js';
import { conductorEnergy } from '../src/ggx-energy.js';
import { GGXConductor } from '../src/materials.js';
import { Sphere } from '../src/geometry/sphere.js';
import { BVHNode } from '../src/bvh.js';
import { Camera } from '../src/camera.js';
import { renderScene, type Background } from '../src/integrator.js';
import type { HitRecord } from '../src/hittable.js';
import { expectVecClose } from './helpers.js';

const whiteEnv: Background = () => vec3(1, 1, 1);
const N = vec3(0, 0, 1);

/** Per-channel mean image value of a conductor sphere in a white furnace. */
function furnace(material: GGXConductor, spp: number): Vec3 {
  const sphere = new Sphere(vec3(0, 0, -2), 1, material);
  const world = BVHNode.build([sphere]);
  const camera = new Camera({
    position: vec3(0, 0, 0),
    lookAt: vec3(0, 0, -1),
    vfovDegrees: 30,
    aspect: 1,
  });
  const img = renderScene(world, camera, whiteEnv, {
    width: 24,
    height: 24,
    spp,
    maxDepth: 16,
    seed: 42,
  });
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < img.length; i += 3) {
    r += img[i] ?? 0;
    g += img[i + 1] ?? 0;
    b += img[i + 2] ?? 0;
  }
  const n = img.length / 3;
  return vec3(r / n, g / n, b / n);
}

function hitFor(material: GGXConductor, mu: number): { hit: HitRecord; wo: Vec3 } {
  const wo = normalize(vec3(Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu));
  return { hit: { t: 1, point: vec3(0, 0, 0), normal: N, frontFace: true, material }, wo };
}

/** Mean scatter attenuation (rejections count as zero) = directional albedo. */
function meanAttenuation(material: GGXConductor, mu: number, samples: number, seed = 5): number {
  const { hit, wo } = hitFor(material, mu);
  const rIn = ray(wo, vec3(-wo.x, -wo.y, -wo.z));
  const rng = new Rng(seed);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = material.scatter(rIn, hit, rng);
    if (s) sum += s.attenuation.x;
  }
  return sum / samples;
}

describe('conductorEnergy: deterministic quadrature vs independent Monte Carlo', () => {
  it('E(mu) matches the measured mean attenuation of the uncompensated sampler', () => {
    // The table claims to be the expected throughput of a single-scatter GGX
    // event; verify against the actual sampler at the worst case (roughness 1)
    // and at a grazing angle.
    for (const [roughness, mu] of [
      [1.0, 0.3],
      [1.0, 1.0],
      [0.5, 0.15],
    ] as const) {
      const alpha = roughness * roughness;
      const single = new GGXConductor(vec3(1, 1, 1), roughness, false);
      const mc = meanAttenuation(single, mu, 200000);
      expect(Math.abs(conductorEnergy(alpha).directional(mu) - mc)).toBeLessThan(0.01);
    }
  });

  it('E_avg matches a cosine-weighted Monte Carlo average of E(mu)', () => {
    const table = conductorEnergy(1);
    const rng = new Rng(3);
    let sum = 0;
    const M = 200000;
    for (let i = 0; i < M; i++) {
      sum += table.directional(cosineSampleHemisphere(N, rng).z);
    }
    expect(Math.abs(sum / M - table.average)).toBeLessThan(0.01);
  });

  it('E decreases with roughness and approaches 1 for smooth surfaces', () => {
    expect(conductorEnergy(1e-3).directional(0.8)).toBeGreaterThan(0.995);
    const e04 = conductorEnergy(0.16).directional(0.8);
    const e1 = conductorEnergy(1).directional(0.8);
    expect(e04).toBeGreaterThan(e1);
    expect(e1).toBeGreaterThan(0.2);
    expect(e1).toBeLessThan(0.6); // measured 0.38 on this BRDF (separable Smith)
  });
});

describe('GGX multiple-scattering compensation: the furnace closes at every roughness', () => {
  // Uncompensated single-scattering GGX loses energy badly as roughness grows
  // (measured on this codebase: furnace means 0.91 / 0.69 / 0.32 at roughness
  // 0.5 / 0.7 / 1.0). With Kulla-Conty multiple-scattering compensation the
  // albedo-1 furnace must close to 1 within Monte Carlo noise everywhere.
  for (const roughness of [0.4, 0.7, 1.0]) {
    it(`albedo-1 conductor at roughness ${roughness} returns the furnace to 1`, () => {
      const mean = furnace(new GGXConductor(vec3(1, 1, 1), roughness), 200);
      expect(mean.x).toBeGreaterThan(0.98);
      expect(mean.x).toBeLessThan(1.02);
    });
  }

  it('documents the problem: uncompensated roughness 1 keeps under half the energy', () => {
    const mean = furnace(new GGXConductor(vec3(1, 1, 1), 1.0, false), 200);
    expect(mean.x).toBeLessThan(0.5); // measured 0.32
  });

  it('a colored conductor gains energy in every channel and never exceeds the furnace', () => {
    const f0 = vec3(0.9, 0.6, 0.3);
    const comp = furnace(new GGXConductor(f0, 0.9), 200);
    const single = furnace(new GGXConductor(f0, 0.9, false), 200);
    expect(comp.x).toBeGreaterThan(single.x);
    expect(comp.y).toBeGreaterThan(single.y);
    expect(comp.z).toBeGreaterThan(single.z);
    expect(comp.x).toBeLessThan(1.02);
    expect(comp.y).toBeLessThan(1.02);
    expect(comp.z).toBeLessThan(1.02);
  });
});

describe('compensated conductor: pointwise and estimator identities', () => {
  it('directional albedo is 1 for F0 = 1 at grazing and oblique incidence', () => {
    // Stronger than the furnace: the energy closes per incident angle, not
    // just integrated over the sphere.
    expect(Math.abs(meanAttenuation(new GGXConductor(vec3(1, 1, 1), 1.0), 0.3, 200000) - 1)).toBeLessThan(0.02);
    expect(Math.abs(meanAttenuation(new GGXConductor(vec3(1, 1, 1), 0.6), 0.15, 200000) - 1)).toBeLessThan(0.02);
  });

  it('scatterPdf is the true density of scatter: E[cos/pdf] over attempts is pi', () => {
    // Valid only if the reported pdf matches the actual mixed sampling
    // process (GGX lobe + cosine ms lobe, with rejections counted as zero).
    const m = new GGXConductor(vec3(0.8, 0.8, 0.8), 0.8);
    const { hit, wo } = hitFor(m, 0.7);
    const rIn = ray(wo, vec3(-wo.x, -wo.y, -wo.z));
    const rng = new Rng(77);
    let sum = 0;
    const M = 200000;
    for (let i = 0; i < M; i++) {
      const s = m.scatter(rIn, hit, rng);
      if (!s) continue;
      const wi = s.ray.dir;
      sum += dot(N, wi) / m.scatterPdf(wo, wi, hit);
    }
    expect(Math.abs(sum / M - Math.PI)).toBeLessThan(0.1);
  });

  it('the BRDF stays reciprocal with the multiple-scattering lobe active', () => {
    const m = new GGXConductor(vec3(0.9, 0.7, 0.5), 0.9);
    const { hit } = hitFor(m, 1);
    const wo = normalize(vec3(0.6, 0.1, 0.5));
    const wi = normalize(vec3(-0.2, 0.5, 0.9));
    expectVecClose(m.evalBrdf(wo, wi, hit), m.evalBrdf(wi, wo, hit));
  });

  it('compensation only ever adds energy to the BRDF', () => {
    const comp = new GGXConductor(vec3(0.9, 0.6, 0.3), 0.8);
    const single = new GGXConductor(vec3(0.9, 0.6, 0.3), 0.8, false);
    const { hit } = hitFor(comp, 1);
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) {
      const wo = cosineSampleHemisphere(N, rng);
      const wi = cosineSampleHemisphere(N, rng);
      const fc = comp.evalBrdf(wo, wi, hit);
      const fs = single.evalBrdf(wo, wi, hit);
      expect(fc.x).toBeGreaterThanOrEqual(fs.x);
      expect(fc.y).toBeGreaterThanOrEqual(fs.y);
      expect(fc.z).toBeGreaterThanOrEqual(fs.z);
    }
  });

  it('a black conductor (F0 = 0) stays finite and nearly dark', () => {
    // Schlick Fresnel keeps a grazing sheen even at F0 = 0, so the albedo is
    // small but not zero; the point is that the ms machinery divides by
    // nothing and produces no NaN or negative energy.
    const m = new GGXConductor(vec3(0, 0, 0), 0.9);
    const mean = meanAttenuation(m, 0.8, 20000, 4);
    expect(Number.isFinite(mean)).toBe(true);
    expect(mean).toBeGreaterThanOrEqual(0);
    expect(mean).toBeLessThan(0.1);
  });
});
