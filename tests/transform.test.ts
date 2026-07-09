import { describe, expect, it } from 'vitest';
import { add, scale, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Box } from '../src/geometry/box.js';
import { Transform } from '../src/geometry/transform.js';
import { mat3Inverse, mat3Mul, mat3MulVec, rotationY, scaling } from '../src/mat3.js';
import { Lambertian } from '../src/materials.js';
import { expectVecClose } from './helpers.js';

const mat = new Lambertian(vec3(0.5, 0.5, 0.5));

describe('mat3', () => {
  it('M * inverse(M) is the identity', () => {
    const m = mat3Mul(rotationY(37), scaling(vec3(2, 0.5, 1.5)));
    const prod = mat3Mul(m, mat3Inverse(m));
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) expect(prod[i]!).toBeCloseTo(id[i]!, 9);
  });

  it('rotationY(90) maps +x to -z', () => {
    expectVecClose(mat3MulVec(rotationY(90), vec3(1, 0, 0)), vec3(0, 0, -1));
  });
});

describe('Transform', () => {
  const shoot = (h: Sphere | Box | Transform) => h.hit(ray(vec3(0, 0, 5), vec3(0, 0, -1)), 1e-4, Infinity);

  it('translates a sphere and keeps the normal correct', () => {
    const t = Transform.build(new Sphere(vec3(0, 0, 0), 1, mat), { translate: vec3(0, 0, 0) });
    // aim at a sphere translated to x=3
    const moved = Transform.build(new Sphere(vec3(0, 0, 0), 1, mat), { translate: vec3(3, 0, 0) });
    const rec = moved.hit(ray(vec3(3, 0, 5), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expectVecClose(rec!.point, vec3(3, 0, 1));
    expectVecClose(rec!.normal, vec3(0, 0, 1));
    expect(shoot(t)).not.toBeNull(); // identity transform still hits
  });

  it('rotating a unit box 45 degrees about Y presents its edge to the camera', () => {
    const box = new Box(vec3(-1, -1, -1), vec3(1, 1, 1), mat);
    const rec = shoot(Transform.build(box, { rotate: vec3(0, 45, 0) }));
    expect(rec).not.toBeNull();
    // the rotated box's nearest point along +z at x=0 is the corner at z = sqrt(2)
    expect(rec!.point.z).toBeCloseTo(Math.SQRT2, 4);
  });

  it('uniformly scales a sphere', () => {
    const rec = shoot(Transform.build(new Sphere(vec3(0, 0, 0), 1, mat), { scale: 2 }));
    expect(rec).not.toBeNull();
    expect(rec!.point.z).toBeCloseTo(2, 6); // radius scaled 1 -> 2
    expectVecClose(rec!.normal, vec3(0, 0, 1));
  });

  it('produces a hit point that lies on the world ray', () => {
    const r = ray(vec3(1, 2, 6), vec3(-0.1, -0.2, -1));
    const inst = Transform.build(new Sphere(vec3(0, 0, 0), 1, mat), {
      translate: vec3(0.5, 0, 0),
      rotate: vec3(10, 20, 30),
      scale: vec3(1.5, 1, 0.8),
    });
    const rec = inst.hit(r, 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expectVecClose(rec!.point, add(r.origin, scale(r.dir, rec!.t)));
  });

  it('bounding box encloses the transformed geometry', () => {
    const box = Transform.build(new Box(vec3(-1, -1, -1), vec3(1, 1, 1), mat), {
      rotate: vec3(0, 45, 0),
      translate: vec3(10, 0, 0),
    });
    const bb = box.boundingBox();
    expect(bb.min.x).toBeLessThanOrEqual(10 - Math.SQRT2 + 1e-6);
    expect(bb.max.x).toBeGreaterThanOrEqual(10 + Math.SQRT2 - 1e-6);
  });
});
