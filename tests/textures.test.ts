import { describe, expect, it } from 'vitest';
import { scale, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Rect } from '../src/geometry/rect.js';
import { Triangle } from '../src/geometry/triangle.js';
import { CheckerTexture, SolidColor } from '../src/texture.js';
import { Lambertian, TexturedLambertian } from '../src/materials.js';
import { parseScene } from '../src/scene.js';
import type { HitRecord } from '../src/hittable.js';
import { expectVecClose } from './helpers.js';

const grey = new Lambertian(vec3(0.5, 0.5, 0.5));

describe('geometry texture coordinates', () => {
  it('sphere: the +z point maps to (0.25, 0.5)', () => {
    const s = new Sphere(vec3(0, 0, 0), 1, grey);
    const rec = s.hit(ray(vec3(0, 0, 5), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec?.uv).toBeDefined();
    expect(rec!.uv!.u).toBeCloseTo(0.25, 6);
    expect(rec!.uv!.v).toBeCloseTo(0.5, 6);
  });

  it('rect: parametric coordinates map the free axes to [0,1]^2', () => {
    const r = new Rect('xz', -1, -1, 1, 1, 0, grey);
    const rec = r.hit(ray(vec3(0.5, 5, -0.5), vec3(0, -1, 0)), 1e-4, Infinity);
    expect(rec?.uv).toBeDefined();
    expect(rec!.uv!.u).toBeCloseTo(0.75, 6); // (0.5 - -1)/2
    expect(rec!.uv!.v).toBeCloseTo(0.25, 6); // (-0.5 - -1)/2
  });

  it('triangle: barycentric coordinates are the UVs', () => {
    const t = new Triangle(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), grey);
    const rec = t.hit(ray(vec3(0.25, 0.25, 5), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(rec?.uv).toBeDefined();
    expect(rec!.uv!.u).toBeCloseTo(0.25, 6);
    expect(rec!.uv!.v).toBeCloseTo(0.25, 6);
  });
});

describe('procedural textures', () => {
  it('solid colour is constant', () => {
    const s = new SolidColor(vec3(0.2, 0.4, 0.6));
    expectVecClose(s.sample(0.1, 0.9, vec3(0, 0, 0)), vec3(0.2, 0.4, 0.6));
  });

  it('checker alternates between the two colours', () => {
    const a = vec3(1, 1, 1);
    const b = vec3(0, 0, 0);
    const c = new CheckerTexture(a, b, 2); // 2 squares across [0,1]
    expectVecClose(c.sample(0.1, 0.1, vec3(0, 0, 0)), a); // floor(0.2)+floor(0.2)=0 -> a
    expectVecClose(c.sample(0.6, 0.1, vec3(0, 0, 0)), b); // floor(1.2)+floor(0.2)=1 -> b
    expectVecClose(c.sample(0.6, 0.6, vec3(0, 0, 0)), a); // 1+1=2 -> a
  });
});

function hitWithUv(u: number, v: number, material: HitRecord['material']): HitRecord {
  return { t: 1, point: vec3(0, 0, 0), normal: vec3(0, 0, 1), frontFace: true, material, uv: { u, v } };
}

describe('TexturedLambertian', () => {
  const checker = new CheckerTexture(vec3(0.9, 0.9, 0.9), vec3(0.1, 0.1, 0.1), 2);
  const mat = new TexturedLambertian(checker);

  it('reads its albedo from the texture at the hit UVs', () => {
    const wi = vec3(0, 0, 1);
    // an 'a' cell and a 'b' cell yield different BRDF magnitudes
    expectVecClose(mat.evalBrdf(vec3(0, 0, 1), wi, hitWithUv(0.1, 0.1, mat)), scale(vec3(0.9, 0.9, 0.9), 1 / Math.PI));
    expectVecClose(mat.evalBrdf(vec3(0, 0, 1), wi, hitWithUv(0.6, 0.1, mat)), scale(vec3(0.1, 0.1, 0.1), 1 / Math.PI));
  });

  it('scatter attenuation is the textured albedo', () => {
    const s = mat.scatter(ray(vec3(0, 0, 1), vec3(0, 0, -1)), hitWithUv(0.1, 0.1, mat), new Rng(1));
    expectVecClose(s.attenuation, vec3(0.9, 0.9, 0.9));
  });
});

describe('scene parsing of textures', () => {
  it('builds a textured_lambertian material from a textures map', () => {
    const scene = parseScene({
      camera: { position: [0, 0, 0], lookAt: [0, 0, -1], vfov: 40 },
      textures: { floor: { type: 'checker', a: [1, 1, 1], b: [0.2, 0.2, 0.2], squares: 4 } },
      materials: { ground: { type: 'textured_lambertian', texture: 'floor' } },
      objects: [{ type: 'rect', plane: 'xz', min: [-5, -5], max: [5, 5], k: 0, material: 'ground' }],
    });
    expect(scene.objectCount).toBe(1);
  });

  it('rejects an unknown texture reference', () => {
    expect(() =>
      parseScene({
        camera: { position: [0, 0, 0], lookAt: [0, 0, -1], vfov: 40 },
        materials: { ground: { type: 'textured_lambertian', texture: 'missing' } },
        objects: [{ type: 'sphere', center: [0, 0, -1], radius: 1, material: 'ground' }],
      }),
    ).toThrow(/unknown texture/);
  });
});
