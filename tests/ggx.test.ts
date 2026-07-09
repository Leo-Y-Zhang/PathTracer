import { describe, expect, it } from 'vitest';
import { dot, normalize, scale, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { randomUnitVector } from '../src/sampling.js';
import { ggxD } from '../src/microfacet.js';
import { GGXConductor, type Material } from '../src/materials.js';
import { Sphere } from '../src/geometry/sphere.js';
import { BVHNode } from '../src/bvh.js';
import { Camera } from '../src/camera.js';
import { renderScene, type Background } from '../src/integrator.js';
import type { HitRecord } from '../src/hittable.js';
import { expectVecClose } from './helpers.js';

const whiteEnv: Background = () => vec3(1, 1, 1);

function hit(material: Material, normal = vec3(0, 0, 1)): HitRecord {
  return { t: 1, point: vec3(0, 0, 0), normal, frontFace: true, material };
}

describe('GGX microfacet math', () => {
  it('the NDF integrates to 1 over the hemisphere (integral of D*cos dw)', () => {
    const n = vec3(0, 0, 1);
    const alpha = 0.5;
    const rng = new Rng(1);
    const N = 300000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const h = randomUnitVector(rng);
      const nh = dot(n, h);
      if (nh > 0) sum += ggxD(n, h, alpha) * nh;
    }
    const integral = (sum / N) * 4 * Math.PI; // uniform-sphere estimator of the hemisphere integral
    expect(Math.abs(integral - 1)).toBeLessThan(0.05);
  });
});

describe('GGX conductor material', () => {
  it('is not specular and exposes a finite BRDF/pdf', () => {
    const g = new GGXConductor(vec3(0.9, 0.9, 0.9), 0.3);
    expect(g.isSpecular).toBe(false);
    const wo = normalize(vec3(0.2, 0.1, 1));
    const wi = normalize(vec3(-0.1, 0.3, 1));
    expect(g.scatterPdf(wo, wi, hit(g))).toBeGreaterThan(0);
    const f = g.evalBrdf(wo, wi, hit(g));
    expect(f.x).toBeGreaterThan(0);
  });

  it('the BRDF is reciprocal: f(wo, wi) == f(wi, wo)', () => {
    const g = new GGXConductor(vec3(0.9, 0.7, 0.5), 0.35);
    const wo = normalize(vec3(0.3, 0.1, 1));
    const wi = normalize(vec3(-0.2, 0.4, 1));
    expectVecClose(g.evalBrdf(wo, wi, hit(g)), g.evalBrdf(wi, wo, hit(g)));
  });

  it('scatter attenuation equals evalBrdf*(n.wi)/pdf (unbiased estimator identity)', () => {
    const g = new GGXConductor(vec3(1, 1, 1), 0.4);
    const n = vec3(0, 0, 1);
    const wo = vec3(0, 0, 1);
    const rng = new Rng(3);
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const s = g.scatter(ray(vec3(0, 0, 1), vec3(0, 0, -1)), hit(g, n), rng);
      if (!s) continue;
      const wi = s.ray.dir;
      const pdf = g.scatterPdf(wo, wi, hit(g, n));
      const f = g.evalBrdf(wo, wi, hit(g, n));
      expectVecClose(s.attenuation, scale(f, dot(n, wi) / pdf));
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe('GGX white furnace: energy conservation', () => {
  function furnace(roughness: number, spp: number): number {
    const sphere = new Sphere(vec3(0, 0, -2), 1, new GGXConductor(vec3(1, 1, 1), roughness));
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
    let sum = 0;
    for (const v of img) sum += v;
    return sum / img.length;
  }

  it('an albedo-1 rough conductor never gains energy and loses only a little', () => {
    const mean = furnace(0.25, 200);
    expect(mean).toBeGreaterThan(0.9); // single-scatter GGX loses a few % at roughness 0.25
    expect(mean).toBeLessThanOrEqual(1.02); // and must never exceed the incident radiance
  });

  it('a smoother conductor conserves energy even more tightly', () => {
    const mean = furnace(0.08, 200);
    expect(mean).toBeGreaterThan(0.96);
    expect(mean).toBeLessThanOrEqual(1.02);
  });
});
