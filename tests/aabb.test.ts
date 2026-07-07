import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { AABB } from '../src/aabb.js';
import { expectVecClose } from './helpers.js';

describe('AABB slab test', () => {
  const box = new AABB(vec3(-1, -1, -1), vec3(1, 1, 1));

  it('hits a ray through the centre', () => {
    expect(box.hit(ray(vec3(-5, 0, 0), vec3(1, 0, 0)), 1e-4, Infinity)).toBe(true);
  });

  it('misses a ray passing beside the box', () => {
    expect(box.hit(ray(vec3(-5, 2, 0), vec3(1, 0, 0)), 1e-4, Infinity)).toBe(false);
  });

  it('hits when the ray starts inside', () => {
    expect(box.hit(ray(vec3(0, 0, 0), vec3(0, 1, 0)), 1e-4, Infinity)).toBe(true);
  });

  it('misses when the intersection lies outside (tMin, tMax)', () => {
    expect(box.hit(ray(vec3(-5, 0, 0), vec3(1, 0, 0)), 1e-4, 3)).toBe(false);
    expect(box.hit(ray(vec3(-5, 0, 0), vec3(1, 0, 0)), 1e-4, 5)).toBe(true);
  });

  it('handles negative direction components', () => {
    expect(box.hit(ray(vec3(5, 0.5, -0.5), vec3(-1, 0, 0)), 1e-4, Infinity)).toBe(true);
  });

  it('surrounding() covers both inputs; centroid and longestAxis are correct', () => {
    const a = new AABB(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = new AABB(vec3(2, -1, 0), vec3(3, 0.5, 4));
    const s = AABB.surrounding(a, b);
    expectVecClose(s.min, vec3(0, -1, 0));
    expectVecClose(s.max, vec3(3, 1, 4));
    expectVecClose(a.centroid(), vec3(0.5, 0.5, 0.5));
    expect(s.longestAxis()).toBe(2); // z extent 4 > x extent 3 > y extent 2
  });
});
