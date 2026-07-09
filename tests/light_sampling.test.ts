import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { Rng } from '../src/rng.js';
import { randomUnitVector } from '../src/sampling.js';
import { ray } from '../src/ray.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Rect } from '../src/geometry/rect.js';
import { Lambertian } from '../src/materials.js';
import type { AreaLight } from '../src/lights.js';
import type { Hittable } from '../src/hittable.js';

const mat = new Lambertian(vec3(1, 1, 1));

/** Monte-Carlo solid angle subtended by `h` at `origin`, via uniform directions. */
function solidAngleUniform(h: Hittable, origin: ReturnType<typeof vec3>, rng: Rng, n: number): number {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (h.hit(ray(origin, randomUnitVector(rng)), 1e-4, Infinity)) hits++;
  }
  return (hits / n) * 4 * Math.PI;
}

/** Solid angle via the light sampler: the mean of 1/pdf over sampled directions. */
function solidAngleLight(
  light: AreaLight,
  origin: ReturnType<typeof vec3>,
  rng: Rng,
  n: number,
): { estimate: number; misses: number } {
  let sum = 0;
  let misses = 0;
  for (let i = 0; i < n; i++) {
    const dir = light.sampleTowards(origin, rng);
    const pdf = light.pdfValue(origin, dir);
    if (pdf > 0) sum += 1 / pdf;
    else misses++;
  }
  return { estimate: sum / n, misses };
}

describe('sphere light sampling (subtended cone)', () => {
  const sphere = new Sphere(vec3(0, 0, 0), 1, mat);
  const origin = vec3(0, 0, 5);

  it('the constant cone pdf equals the analytic subtended solid angle', () => {
    const cosThetaMax = Math.sqrt(1 - 1 / 25);
    const analytic = 2 * Math.PI * (1 - cosThetaMax);
    const { estimate, misses } = solidAngleLight(sphere, origin, new Rng(1), 40000);
    expect(misses).toBeLessThan(40); // strictly-inside-cone samples effectively always hit
    expect(estimate).toBeCloseTo(analytic, 4);
  });

  it('agrees with an independent uniform-direction estimate', () => {
    const a = solidAngleUniform(sphere, origin, new Rng(2), 400000);
    const b = solidAngleLight(sphere, origin, new Rng(3), 40000).estimate;
    expect(Math.abs(a - b) / b).toBeLessThan(0.05);
  });

  it('pdf is 0 for a direction pointing away from the sphere', () => {
    expect(sphere.pdfValue(origin, vec3(0, 0, 1))).toBe(0);
  });

  it('pdf is uniform 1/(4pi) when the origin is inside', () => {
    expect(sphere.pdfValue(vec3(0, 0, 0), vec3(1, 0, 0))).toBeCloseTo(1 / (4 * Math.PI), 12);
  });
});

describe('rect light sampling (area)', () => {
  // a 2x2 rect on the xz plane at y = 3, centred above the origin
  const rect = new Rect('xz', -1, -1, 1, 1, 3, mat);
  const origin = vec3(0, 0, 0);

  it('the light-sampler and uniform-direction solid-angle estimates agree', () => {
    const a = solidAngleUniform(rect, origin, new Rng(4), 800000);
    const b = solidAngleLight(rect, origin, new Rng(5), 80000).estimate;
    expect(Math.abs(a - b) / b).toBeLessThan(0.05);
  });

  it('sampled directions always reach the rect (pdf > 0)', () => {
    const { misses } = solidAngleLight(rect, origin, new Rng(6), 5000);
    expect(misses).toBe(0);
  });

  it('pdf is 0 for a direction that misses the rect', () => {
    expect(rect.pdfValue(origin, vec3(0, -1, 0))).toBe(0);
  });
});
