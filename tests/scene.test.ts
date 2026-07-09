import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseScene } from '../src/scene.js';
import { ray } from '../src/ray.js';
import { vec3 } from '../src/vec3.js';

const minimal = {
  camera: { position: [0, 0, 0], lookAt: [0, 0, -1], vfov: 90 },
  materials: { grey: { type: 'lambertian', albedo: [0.5, 0.5, 0.5] } },
  objects: [{ type: 'sphere', center: [0, 0, -3], radius: 1, material: 'grey' }],
};

describe('parseScene', () => {
  it('parses a minimal scene and applies render defaults', () => {
    const s = parseScene(minimal);
    expect(s.name).toBe('scene');
    expect(s.objectCount).toBe(1);
    expect(s.defaults).toEqual({
      width: 480,
      height: 360,
      spp: 64,
      maxDepth: 32,
      seed: 1,
      toneMapping: 'linear',
      exposure: 1,
    });
    expect(s.camera.aperture).toBe(0);
    expect(s.camera.up).toEqual(vec3(0, 1, 0));
  });

  it('parses the committed fixture with all object and material types', () => {
    const s = parseScene(JSON.parse(readFileSync('tests/fixtures/tiny.json', 'utf8')));
    expect(s.name).toBe('tiny');
    expect(s.objectCount).toBe(5);
    expect(s.defaults.width).toBe(32);
    expect(s.defaults.seed).toBe(3);
    // The parsed world must actually intersect: aim at the glass sphere.
    const hit = s.world.hit(ray(vec3(-0.7, 0.5, 4), vec3(0, 0, -1)), 1e-4, Infinity);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(3.5, 9);
  });

  it('defaults the background to black', () => {
    const s = parseScene(minimal);
    expect(s.background(ray(vec3(0, 0, 0), vec3(0, 1, 0)))).toEqual(vec3(0, 0, 0));
  });

  it('accepts a bare [r,g,b] background', () => {
    const s = parseScene({ ...minimal, background: [0.1, 0.2, 0.3] });
    expect(s.background(ray(vec3(0, 0, 0), vec3(1, 0, 0)))).toEqual(vec3(0.1, 0.2, 0.3));
  });

  it('evaluates a gradient background by ray direction', () => {
    const s = parseScene({
      ...minimal,
      background: { type: 'gradient', top: [1, 1, 1], bottom: [0, 0, 0] },
    });
    const up = s.background(ray(vec3(0, 0, 0), vec3(0, 1, 0)));
    const down = s.background(ray(vec3(0, 0, 0), vec3(0, -1, 0)));
    expect(up.x).toBeCloseTo(1, 12);
    expect(down.x).toBeCloseTo(0, 12);
  });

  it('rejects an unknown material type with a path in the message', () => {
    const bad = { ...minimal, materials: { grey: { type: 'phong', albedo: [1, 1, 1] } } };
    expect(() => parseScene(bad)).toThrow(/\$\.materials\.grey\.type/);
  });

  it('rejects an object referencing a missing material', () => {
    const bad = { ...minimal, objects: [{ type: 'sphere', center: [0, 0, 0], radius: 1, material: 'nope' }] };
    expect(() => parseScene(bad)).toThrow(/unknown material "nope"/);
  });

  it('rejects an unknown object type', () => {
    const bad = { ...minimal, objects: [{ type: 'torus', material: 'grey' }] };
    expect(() => parseScene(bad)).toThrow(/\$\.objects\[0\]\.type/);
  });

  it('rejects a malformed vector', () => {
    const bad = { ...minimal, camera: { position: [0, 0], lookAt: [0, 0, -1], vfov: 90 } };
    expect(() => parseScene(bad)).toThrow(/\$\.camera\.position/);
  });

  it('rejects a non-numeric vfov', () => {
    const bad = { ...minimal, camera: { position: [0, 0, 0], lookAt: [0, 0, -1], vfov: 'wide' } };
    expect(() => parseScene(bad)).toThrow(/\$\.camera\.vfov/);
  });

  it('rejects a rect with an invalid plane', () => {
    const bad = {
      ...minimal,
      objects: [{ type: 'rect', plane: 'xw', min: [0, 0], max: [1, 1], k: 0, material: 'grey' }],
    };
    expect(() => parseScene(bad)).toThrow(/\$\.objects\[0\]\.plane/);
  });

  it('rejects metal roughness outside [0, 1]', () => {
    const bad = { ...minimal, materials: { grey: { type: 'metal', albedo: [1, 1, 1], roughness: 1.5 } } };
    expect(() => parseScene(bad)).toThrow(/roughness/);
  });

  it('rejects a scene without an objects array', () => {
    const bad = { camera: minimal.camera, materials: {} };
    expect(() => parseScene(bad)).toThrow(/\$\.objects/);
  });

  it('parses the three committed gallery scenes', () => {
    for (const file of ['scenes/cornell.json', 'scenes/spheres.json', 'scenes/night.json']) {
      const s = parseScene(JSON.parse(readFileSync(file, 'utf8')));
      expect(s.objectCount).toBeGreaterThan(0);
      expect(s.defaults.spp).toBeGreaterThan(0);
    }
  });
});
