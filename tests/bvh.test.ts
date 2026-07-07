import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { ray, type Ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { randomUnitVector } from '../src/sampling.js';
import { HittableList, type Hittable } from '../src/hittable.js';
import { BVHNode } from '../src/bvh.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Triangle } from '../src/geometry/triangle.js';
import { Box } from '../src/geometry/box.js';
import { Rect, type RectPlane } from '../src/geometry/rect.js';
import { Lambertian } from '../src/materials.js';
import { cross, length, sub } from '../src/vec3.js';

const mat = new Lambertian(vec3(0.5, 0.5, 0.5));

function randomRays(rng: Rng, n: number): Ray[] {
  const rays: Ray[] = [];
  for (let i = 0; i < n; i++) {
    const origin = vec3(rng.range(-15, 15), rng.range(-15, 15), rng.range(-15, 15));
    rays.push(ray(origin, randomUnitVector(rng)));
  }
  return rays;
}

/**
 * The BVH correctness proof: for every ray, the BVH must report exactly the
 * same closest hit (same t, same point) as brute-force iteration over all
 * primitives. Scenes and rays are generated from a seeded RNG so the test
 * is reproducible.
 */
function compareBvhToBruteForce(objects: Hittable[], rays: Ray[]): { hits: number; misses: number } {
  const brute = new HittableList(objects);
  const bvh = BVHNode.build(objects);
  let hits = 0;
  let misses = 0;
  for (const r of rays) {
    const a = brute.hit(r, 1e-4, Infinity);
    const b = bvh.hit(r, 1e-4, Infinity);
    if (a === null) {
      expect(b).toBeNull();
      misses++;
    } else {
      expect(b).not.toBeNull();
      expect(b!.t).toBeCloseTo(a.t, 9);
      expect(b!.point.x).toBeCloseTo(a.point.x, 9);
      expect(b!.point.y).toBeCloseTo(a.point.y, 9);
      expect(b!.point.z).toBeCloseTo(a.point.z, 9);
      expect(b!.material).toBe(a.material);
      hits++;
    }
  }
  return { hits, misses };
}

describe('BVH vs brute force over seeded random scenes', () => {
  it('matches on 120 random spheres x 600 random rays', () => {
    const rng = new Rng(1001);
    const objects: Hittable[] = [];
    for (let i = 0; i < 120; i++) {
      objects.push(
        new Sphere(
          vec3(rng.range(-10, 10), rng.range(-10, 10), rng.range(-10, 10)),
          rng.range(0.2, 1.5),
          mat,
        ),
      );
    }
    const { hits, misses } = compareBvhToBruteForce(objects, randomRays(rng, 600));
    // The comparison only means something if both cases occur.
    expect(hits).toBeGreaterThan(50);
    expect(misses).toBeGreaterThan(50);
  });

  it('matches on 100 random triangles x 600 random rays', () => {
    const rng = new Rng(2002);
    const objects: Hittable[] = [];
    while (objects.length < 100) {
      const v0 = vec3(rng.range(-10, 10), rng.range(-10, 10), rng.range(-10, 10));
      const v1 = vec3(v0.x + rng.range(-4, 4), v0.y + rng.range(-4, 4), v0.z + rng.range(-4, 4));
      const v2 = vec3(v0.x + rng.range(-4, 4), v0.y + rng.range(-4, 4), v0.z + rng.range(-4, 4));
      if (length(cross(sub(v1, v0), sub(v2, v0))) < 1e-6) continue; // skip degenerate
      objects.push(new Triangle(v0, v1, v2, mat));
    }
    const { hits, misses } = compareBvhToBruteForce(objects, randomRays(rng, 600));
    expect(hits).toBeGreaterThan(30);
    expect(misses).toBeGreaterThan(30);
  });

  it('matches on a mixed scene (spheres + boxes + rects + triangles) x 800 rays', () => {
    const rng = new Rng(3003);
    const objects: Hittable[] = [];
    const planes: RectPlane[] = ['xy', 'xz', 'yz'];
    for (let i = 0; i < 40; i++) {
      objects.push(
        new Sphere(
          vec3(rng.range(-10, 10), rng.range(-10, 10), rng.range(-10, 10)),
          rng.range(0.2, 1.2),
          mat,
        ),
      );
      const bmin = vec3(rng.range(-10, 10), rng.range(-10, 10), rng.range(-10, 10));
      objects.push(
        new Box(
          bmin,
          vec3(bmin.x + rng.range(0.5, 3), bmin.y + rng.range(0.5, 3), bmin.z + rng.range(0.5, 3)),
          mat,
        ),
      );
      const a0 = rng.range(-10, 10);
      const b0 = rng.range(-10, 10);
      objects.push(
        new Rect(
          planes[i % 3]!,
          a0,
          b0,
          a0 + rng.range(0.5, 4),
          b0 + rng.range(0.5, 4),
          rng.range(-10, 10),
          mat,
        ),
      );
      const v0 = vec3(rng.range(-10, 10), rng.range(-10, 10), rng.range(-10, 10));
      objects.push(
        new Triangle(
          v0,
          vec3(v0.x + rng.range(0.5, 3), v0.y, v0.z + rng.range(-1, 1)),
          vec3(v0.x, v0.y + rng.range(0.5, 3), v0.z + rng.range(-1, 1)),
          mat,
        ),
      );
    }
    expect(objects.length).toBe(160);
    const { hits, misses } = compareBvhToBruteForce(objects, randomRays(rng, 800));
    expect(hits).toBeGreaterThan(100);
    expect(misses).toBeGreaterThan(50);
  });

  it('single-object BVH degenerates to the object itself', () => {
    const s = new Sphere(vec3(0, 0, -5), 1, mat);
    const bvh = BVHNode.build([s]);
    const rec = bvh.hit(ray(vec3(0, 0, 0), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expect(rec!.t).toBeCloseTo(4, 12);
  });

  it('throws on an empty object list', () => {
    expect(() => BVHNode.build([])).toThrow(/at least one object/);
  });
});
