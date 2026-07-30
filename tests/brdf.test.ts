import { describe, expect, it } from 'vitest';
import { dot, scale, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { Dielectric, Emissive, GGXDielectric, Lambertian, Metal, type Material } from '../src/materials.js';
import type { HitRecord } from '../src/hittable.js';
import { expectVecClose } from './helpers.js';

const N = vec3(0, 0, 1); // surface normal = +z
const WO = vec3(0, 0, 1);

function hit(material: Material): HitRecord {
  return { t: 1, point: vec3(0, 0, 0), normal: N, frontFace: true, material };
}

describe('Lambertian BRDF eval + pdf (MIS foundation)', () => {
  const albedo = vec3(0.2, 0.5, 0.9);
  const mat = new Lambertian(albedo);

  it('is not specular', () => {
    expect(mat.isSpecular).toBe(false);
  });

  it('evalBrdf is albedo/pi above the surface and zero below', () => {
    expectVecClose(mat.evalBrdf(WO, vec3(0, 0, 1), hit(mat)), scale(albedo, 1 / Math.PI));
    expectVecClose(mat.evalBrdf(WO, vec3(0, 0, -1), hit(mat)), vec3(0, 0, 0));
  });

  it('scatterPdf is cos(theta)/pi above the surface and zero below', () => {
    expect(mat.scatterPdf(WO, vec3(0, 0, 1), hit(mat))).toBeCloseTo(1 / Math.PI, 12);
    // a direction at 60 degrees from the normal has cos = 0.5
    expect(mat.scatterPdf(WO, vec3(Math.sqrt(0.75), 0, 0.5), hit(mat))).toBeCloseTo(0.5 / Math.PI, 12);
    expect(mat.scatterPdf(WO, vec3(0, 0, -1), hit(mat))).toBe(0);
  });

  it('scatter attenuation equals evalBrdf*cos/pdf (the unbiased-estimator identity)', () => {
    const rng = new Rng(1234);
    for (let i = 0; i < 128; i++) {
      const s = mat.scatter(ray(vec3(0, 0, 1), vec3(0, 0, -1)), hit(mat), rng);
      expect(s).not.toBeNull();
      const wi = s!.ray.dir;
      const cos = dot(wi, N);
      const pdf = mat.scatterPdf(WO, wi, hit(mat));
      const brdf = mat.evalBrdf(WO, wi, hit(mat));
      expectVecClose(s!.attenuation, scale(brdf, cos / pdf));
    }
  });
});

describe('specular materials expose no finite BRDF or pdf', () => {
  const specular: Material[] = [
    new Metal(vec3(1, 1, 1), 0),
    new Metal(vec3(0.8, 0.8, 0.8), 0.3),
    new Dielectric(1.5),
    new GGXDielectric(1.5, 0.5),
    new Emissive(vec3(1, 1, 1), 3),
  ];

  it('are marked specular, with zero BRDF and zero pdf', () => {
    for (const m of specular) {
      expect(m.isSpecular).toBe(true);
      expectVecClose(m.evalBrdf(WO, vec3(0, 0, 1), hit(m)), vec3(0, 0, 0));
      expect(m.scatterPdf(WO, vec3(0, 0, 1), hit(m))).toBe(0);
    }
  });
});
