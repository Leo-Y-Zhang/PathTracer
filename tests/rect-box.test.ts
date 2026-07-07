import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rect } from '../src/geometry/rect.js';
import { Box } from '../src/geometry/box.js';
import { Lambertian } from '../src/materials.js';
import { expectVecClose } from './helpers.js';

const mat = new Lambertian(vec3(0.5, 0.5, 0.5));

describe('Rect intersection', () => {
  it('xz rect: vertical ray hits at hand-computed t = 3', () => {
    const rect = new Rect('xz', 0, 0, 4, 4, 2, mat);
    const rec = rect.hit(ray(vec3(2, 5, 2), vec3(0, -1, 0)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(3, 12);
    expectVecClose(rec!.point, vec3(2, 2, 2));
    expectVecClose(rec!.normal, vec3(0, 1, 0));
    expect(rec!.frontFace).toBe(true);
  });

  it('misses outside the rectangle bounds', () => {
    const rect = new Rect('xz', 0, 0, 4, 4, 2, mat);
    expect(rect.hit(ray(vec3(5, 5, 5), vec3(0, -1, 0)), 1e-4, Infinity)).toBeNull();
  });

  it('misses when the ray is parallel to the plane', () => {
    const rect = new Rect('xz', 0, 0, 4, 4, 2, mat);
    expect(rect.hit(ray(vec3(2, 5, 2), vec3(1, 0, 0)), 1e-4, Infinity)).toBeNull();
  });

  it('xy rect hit with normal along z, flipped when approached from behind', () => {
    const rect = new Rect('xy', -1, -1, 1, 1, -3, mat);
    const front = rect.hit(ray(vec3(0, 0, 0), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(front).not.toBeNull();
    expect(front!.t).toBeCloseTo(3, 12);
    expectVecClose(front!.normal, vec3(0, 0, 1));
    const back = rect.hit(ray(vec3(0, 0, -6), vec3(0, 0, 1)), 1e-4, Infinity);
    expect(back).not.toBeNull();
    expectVecClose(back!.normal, vec3(0, 0, -1));
    expect(back!.frontFace).toBe(false);
  });

  it('yz rect hit with normal along x', () => {
    const rect = new Rect('yz', 0, 0, 5, 5, 10, mat);
    const rec = rect.hit(ray(vec3(0, 2, 2), vec3(1, 0, 0)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(10, 12);
    expectVecClose(rec!.normal, vec3(-1, 0, 0));
  });
});

describe('Box intersection (slab test with face normals)', () => {
  const box = new Box(vec3(0, 0, 0), vec3(2, 2, 2), mat);

  it('enters through the -x face at t = 1', () => {
    const rec = box.hit(ray(vec3(-1, 1, 1), vec3(1, 0, 0)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(1, 12);
    expectVecClose(rec!.point, vec3(0, 1, 1));
    expectVecClose(rec!.normal, vec3(-1, 0, 0));
    expect(rec!.frontFace).toBe(true);
  });

  it('enters through the +y (top) face when coming from above', () => {
    const rec = box.hit(ray(vec3(1, 5, 1), vec3(0, -1, 0)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(3, 12);
    expectVecClose(rec!.normal, vec3(0, 1, 0));
  });

  it('from inside: reports the exit face with the normal opposing the ray', () => {
    const rec = box.hit(ray(vec3(1, 1, 1), vec3(1, 0, 0)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(1, 12);
    expectVecClose(rec!.point, vec3(2, 1, 1));
    expect(rec!.frontFace).toBe(false);
    expectVecClose(rec!.normal, vec3(-1, 0, 0));
  });

  it('misses on a parallel offset ray', () => {
    expect(box.hit(ray(vec3(-1, 3, 1), vec3(1, 0, 0)), 1e-4, Infinity)).toBeNull();
  });

  it('respects tMax (hit beyond the window is ignored)', () => {
    expect(box.hit(ray(vec3(-1, 1, 1), vec3(1, 0, 0)), 1e-4, 0.5)).toBeNull();
  });

  it('diagonal ray hits the correct face', () => {
    // From (-2, 1, 1) toward (1, 0.25, 0): x reaches 0 at t=2, where y=1.5, z=1 (inside).
    const rec = box.hit(ray(vec3(-2, 1, 1), vec3(1, 0.25, 0)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(2, 12);
    expectVecClose(rec!.point, vec3(0, 1.5, 1));
    expectVecClose(rec!.normal, vec3(-1, 0, 0));
  });
});
