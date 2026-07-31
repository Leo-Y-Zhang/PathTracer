import { describe, expect, it } from 'vitest';
import { normalize, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { fresnelDielectric } from '../src/microfacet.js';
import { dielectricEnergy } from '../src/ggx-energy.js';
import { Dielectric, GGXDielectric, schlickReflectance, type Material } from '../src/materials.js';
import { Sphere } from '../src/geometry/sphere.js';
import { BVHNode } from '../src/bvh.js';
import { Camera } from '../src/camera.js';
import { renderScene, type Background } from '../src/integrator.js';
import type { HitRecord } from '../src/hittable.js';

const whiteEnv: Background = () => vec3(1, 1, 1);
const N = vec3(0, 0, 1);

function furnace(material: Material, spp: number): number {
  const sphere = new Sphere(vec3(0, 0, -2), 1, material);
  const world = BVHNode.build([sphere]);
  const camera = new Camera({
    position: vec3(0, 0, 0),
    lookAt: vec3(0, 0, -1),
    vfovDegrees: 30,
    aspect: 1,
  });
  // Rough glass bounces internally (TIR), so give paths more depth than the
  // conductor furnace; russian roulette keeps the cost bounded.
  const img = renderScene(world, camera, whiteEnv, {
    width: 24,
    height: 24,
    spp,
    maxDepth: 32,
    seed: 42,
  });
  let sum = 0;
  for (const v of img) sum += v;
  return sum / img.length;
}

/** Mean scatter attenuation at cos(theta)=mu (rejections as zero). */
function meanAttenuation(
  material: GGXDielectric,
  mu: number,
  frontFace: boolean,
  samples: number,
): number {
  const wo = normalize(vec3(Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu));
  const hit: HitRecord = { t: 1, point: vec3(0, 0, 0), normal: N, frontFace, material };
  const rIn = ray(wo, vec3(-wo.x, -wo.y, -wo.z));
  const rng = new Rng(11);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = material.scatter(rIn, hit, rng);
    if (s) sum += s.attenuation.x;
  }
  return sum / samples;
}

describe('fresnelDielectric (exact, replaces Schlick where eta < 1 matters)', () => {
  it('equals the analytic r0 at normal incidence, from either side', () => {
    const r0 = ((1 - 1.5) / (1 + 1.5)) ** 2; // 0.04 for glass
    expect(fresnelDielectric(1, 1 / 1.5)).toBeCloseTo(r0, 12);
    expect(fresnelDielectric(1, 1.5)).toBeCloseTo(r0, 12);
  });

  it('returns 1 beyond the critical angle (total internal reflection)', () => {
    // Glass-to-air critical angle: cos(theta_c) = sqrt(1 - 1/1.5^2) = 0.745.
    expect(fresnelDielectric(0.5, 1.5)).toBe(1);
    expect(fresnelDielectric(0.74, 1.5)).toBe(1);
    expect(fresnelDielectric(0.76, 1.5)).toBeLessThan(1);
  });

  it('rises monotonically toward 1 at grazing incidence', () => {
    let prev = fresnelDielectric(1, 1 / 1.5);
    for (const c of [0.8, 0.6, 0.4, 0.2, 0.05]) {
      const f = fresnelDielectric(c, 1 / 1.5);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
    expect(fresnelDielectric(0, 1 / 1.5)).toBeCloseTo(1, 9);
  });

  it('is symmetric: F(cos_i, eta) = F(cos_t, 1/eta) across the same interface', () => {
    const etaRel = 1 / 1.5;
    const cosI = 0.8;
    const sin2T = etaRel * etaRel * (1 - cosI * cosI);
    const cosT = Math.sqrt(1 - sin2T);
    expect(fresnelDielectric(cosI, etaRel)).toBeCloseTo(fresnelDielectric(cosT, 1 / etaRel), 12);
  });

  it('agrees with the Schlick approximation near normal incidence', () => {
    expect(Math.abs(fresnelDielectric(0.9, 1 / 1.5) - schlickReflectance(0.9, 1 / 1.5))).toBeLessThan(0.01);
  });
});

describe('dielectricEnergy: quadrature vs the actual sampler', () => {
  it('E(mu) matches the measured mean attenuation of the uncompensated sampler', () => {
    for (const [roughness, mu, frontFace] of [
      [1.0, 0.5, true],
      [0.5, 0.15, true],
      [1.0, 0.4, false],
    ] as const) {
      const alpha = roughness * roughness;
      const single = new GGXDielectric(1.5, roughness, false);
      const mc = meanAttenuation(single, mu, frontFace, 200000);
      const table = dielectricEnergy(alpha, frontFace ? 1 / 1.5 : 1.5);
      expect(Math.abs(table.directional(mu) - mc)).toBeLessThan(0.015);
    }
  });

  it('rough glass loses energy without compensation, more with more roughness', () => {
    const out = (roughness: number): number =>
      dielectricEnergy(roughness * roughness, 1 / 1.5).directional(0.8);
    expect(out(0.3)).toBeGreaterThan(out(0.7));
    expect(out(0.7)).toBeGreaterThan(out(1.0));
    expect(out(1.0)).toBeLessThan(0.85); // the loss compensation must repay
  });
});

describe('GGXDielectric: energy-compensated rough glass', () => {
  it('compensated scatter returns unit energy pointwise, entering and exiting', () => {
    const m = new GGXDielectric(1.5, 1.0);
    expect(Math.abs(meanAttenuation(m, 0.4, true, 200000) - 1)).toBeLessThan(0.02);
    expect(Math.abs(meanAttenuation(m, 0.4, false, 200000) - 1)).toBeLessThan(0.02);
  });

  for (const roughness of [0.3, 0.7, 1.0]) {
    it(`the furnace closes at roughness ${roughness}`, () => {
      const mean = furnace(new GGXDielectric(1.5, roughness), 200);
      expect(mean).toBeGreaterThan(0.98);
      expect(mean).toBeLessThan(1.02);
    });
  }

  it('documents the problem: uncompensated rough glass goes dark in the furnace', () => {
    // Measured on this codebase: 0.66 at roughness 0.7, 0.36 at roughness 1.
    expect(furnace(new GGXDielectric(1.5, 0.7, false), 200)).toBeLessThan(0.8);
    expect(furnace(new GGXDielectric(1.5, 1.0, false), 200)).toBeLessThan(0.5);
  });

  it('matches the smooth Dielectric in the roughness -> 0 limit', () => {
    const gradient: Background = (r) => {
      const t = 0.5 * (normalize(r.dir).y + 1);
      return vec3(t, 0.5 + 0.5 * t, 1 - 0.3 * t);
    };
    const render = (material: Material): Float64Array => {
      const sphere = new Sphere(vec3(0, 0, -2), 1, material);
      const world = BVHNode.build([sphere]);
      const camera = new Camera({
        position: vec3(0, 0, 0),
        lookAt: vec3(0, 0, -1),
        vfovDegrees: 30,
        aspect: 1,
      });
      return renderScene(world, camera, gradient, {
        width: 32,
        height: 32,
        spp: 128,
        maxDepth: 32,
        seed: 9,
      });
    };
    const rough = render(new GGXDielectric(1.5, 0));
    const smooth = render(new Dielectric(1.5));
    let sumDiff = 0;
    let meanRough = 0;
    let meanSmooth = 0;
    for (let i = 0; i < rough.length; i++) {
      sumDiff += Math.abs((rough[i] ?? 0) - (smooth[i] ?? 0));
      meanRough += rough[i] ?? 0;
      meanSmooth += smooth[i] ?? 0;
    }
    // Measured: 0.005 mean absolute difference per component, means equal to
    // 4 decimals - the GGX lobe at alpha_min is a hair wider than a delta.
    expect(sumDiff / rough.length).toBeLessThan(0.02);
    expect(Math.abs(meanRough - meanSmooth) / rough.length).toBeLessThan(0.005);
  });

  it('renders deterministically (same settings, identical buffers)', () => {
    const make = (): Float64Array => {
      const sphere = new Sphere(vec3(0, 0, -2), 1, new GGXDielectric(1.5, 0.8));
      const world = BVHNode.build([sphere]);
      const camera = new Camera({
        position: vec3(0, 0, 0),
        lookAt: vec3(0, 0, -1),
        vfovDegrees: 30,
        aspect: 1,
      });
      return renderScene(world, camera, whiteEnv, {
        width: 16,
        height: 16,
        spp: 16,
        maxDepth: 32,
        seed: 7,
      });
    };
    expect(make()).toEqual(make());
  });

  it('rejects nonphysical construction inputs that would bake garbage tables', () => {
    expect(() => new GGXDielectric(0, 0.5)).toThrow(/ior/);
    expect(() => new GGXDielectric(-1.5, 0.5)).toThrow(/ior/);
    expect(() => new GGXDielectric(Number.NaN, 0.5)).toThrow(/ior/);
    expect(() => new GGXDielectric(1.5, Number.NaN)).toThrow(/roughness/);
  });

  it('is skipped by NEE like the other transmissive material: no finite eval/pdf', () => {
    const m = new GGXDielectric(1.5, 0.6);
    expect(m.isSpecular).toBe(true);
    expect(m.evalBrdf().x).toBe(0);
    expect(m.scatterPdf()).toBe(0);
  });
});
