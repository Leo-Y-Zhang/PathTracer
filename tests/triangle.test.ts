import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Triangle } from '../src/geometry/triangle.js';
import { Lambertian } from '../src/materials.js';
import { expectVecClose } from './helpers.js';

const mat = new Lambertian(vec3(0.5, 0.5, 0.5));
// Right triangle in the z=-3 plane.
const tri = new Triangle(vec3(0, 0, -3), vec3(2, 0, -3), vec3(0, 2, -3), mat);

describe('Triangle intersection (Moller-Trumbore)', () => {
  it('hits inside the triangle at hand-computed t = 3', () => {
    const rec = tri.hit(ray(vec3(0.5, 0.5, 0), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(3, 12);
    expectVecClose(rec!.point, vec3(0.5, 0.5, -3));
    expectVecClose(rec!.normal, vec3(0, 0, 1));
    expect(rec!.frontFace).toBe(true);
  });

  it('misses outside the barycentric range (u + v > 1)', () => {
    expect(tri.hit(ray(vec3(1.5, 1.5, 0), vec3(0, 0, -1)), 1e-4, Infinity)).toBeNull();
  });

  it('misses when the ray is parallel to the plane', () => {
    expect(tri.hit(ray(vec3(0.5, 0.5, 0), vec3(1, 0, 0)), 1e-4, Infinity)).toBeNull();
  });

  it('hits the back face with the normal flipped toward the ray origin', () => {
    const rec = tri.hit(ray(vec3(0.5, 0.5, -6), vec3(0, 0, 1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(3, 12);
    expect(rec!.frontFace).toBe(false);
    expectVecClose(rec!.normal, vec3(0, 0, -1));
  });

  it('respects the (tMin, tMax) window', () => {
    expect(tri.hit(ray(vec3(0.5, 0.5, 0), vec3(0, 0, -1)), 1e-4, 2.9)).toBeNull();
    expect(tri.hit(ray(vec3(0.5, 0.5, 0), vec3(0, 0, -1)), 3.1, Infinity)).toBeNull();
  });

  it('bounding box covers all vertices (with epsilon padding)', () => {
    const box = tri.boundingBox();
    expect(box.min.x).toBeLessThanOrEqual(0);
    expect(box.max.x).toBeGreaterThanOrEqual(2);
    expect(box.min.y).toBeLessThanOrEqual(0);
    expect(box.max.y).toBeGreaterThanOrEqual(2);
    expect(box.min.z).toBeLessThanOrEqual(-3);
    expect(box.max.z).toBeGreaterThanOrEqual(-3);
  });
});
