import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Lambertian } from '../src/materials.js';
import { expectVecClose } from './helpers.js';

const mat = new Lambertian(vec3(0.5, 0.5, 0.5));

describe('Sphere intersection (hand-computed)', () => {
  const sphere = new Sphere(vec3(0, 0, -5), 1, mat);

  it('hits head-on: origin ray to sphere at z=-5, r=1, t = 4', () => {
    const rec = sphere.hit(ray(vec3(0, 0, 0), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(4, 12);
    expectVecClose(rec!.point, vec3(0, 0, -4));
    expectVecClose(rec!.normal, vec3(0, 0, 1));
    expect(rec!.frontFace).toBe(true);
  });

  it('misses when aimed away', () => {
    expect(sphere.hit(ray(vec3(0, 0, 0), vec3(0, 1, 0)), 1e-4, Infinity)).toBeNull();
  });

  it('hand-computed off-centre hit: t = 5 - sqrt(0.75)', () => {
    // oc=(0,0.5,5) relative to centre, halfB=-5, c=0.25 -> t = 5 - sqrt(0.75)
    const rec = sphere.hit(ray(vec3(0, 0.5, 0), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(5 - Math.sqrt(0.75), 12);
    expectVecClose(rec!.normal, vec3(0, 0.5, Math.sqrt(0.75)), 9);
  });

  it('from inside: takes the far root and flips the normal against the ray', () => {
    const rec = sphere.hit(ray(vec3(0, 0, -5), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(1, 12);
    expectVecClose(rec!.point, vec3(0, 0, -6));
    expect(rec!.frontFace).toBe(false);
    // Outward normal is (0,0,-1); it must be flipped to oppose the ray.
    expectVecClose(rec!.normal, vec3(0, 0, 1));
  });

  it('respects tMax clipping', () => {
    expect(sphere.hit(ray(vec3(0, 0, 0), vec3(0, 0, -1)), 1e-4, 3.9)).toBeNull();
  });

  it('tangent ray grazes at t = 5', () => {
    const rec = sphere.hit(ray(vec3(0, 1, 0), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(5, 6);
  });

  it('bounding box is centre +/- radius', () => {
    const box = sphere.boundingBox();
    expectVecClose(box.min, vec3(-1, -1, -6));
    expectVecClose(box.max, vec3(1, 1, -4));
  });
});
