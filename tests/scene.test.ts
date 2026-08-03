import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScene } from '../src/scene.js';
import { ray } from '../src/ray.js';
import { vec3 } from '../src/vec3.js';
import { encodeHdr } from '../src/hdr.js';

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

  it('parses a rough_dielectric material', () => {
    const s = parseScene({
      ...minimal,
      materials: { frost: { type: 'rough_dielectric', ior: 1.5, roughness: 0.4 } },
      objects: [{ type: 'sphere', center: [0, 0, -3], radius: 1, material: 'frost' }],
    });
    expect(s.objectCount).toBe(1);
  });

  it('rejects a rough_dielectric without an ior', () => {
    const bad = { ...minimal, materials: { frost: { type: 'rough_dielectric', roughness: 0.4 } } };
    expect(() => parseScene(bad)).toThrow(/\$\.materials\.frost\.ior/);
  });

  it('rejects rough_dielectric roughness outside [0, 1]', () => {
    const bad = { ...minimal, materials: { frost: { type: 'rough_dielectric', ior: 1.5, roughness: -0.1 } } };
    expect(() => parseScene(bad)).toThrow(/roughness/);
  });

  it('rejects a nonphysical ior for both dielectric types', () => {
    for (const ior of [0, -1.5]) {
      const smooth = { ...minimal, materials: { g: { type: 'dielectric', ior } } };
      expect(() => parseScene(smooth)).toThrow(/\$\.materials\.g\.ior/);
      const rough = { ...minimal, materials: { g: { type: 'rough_dielectric', ior, roughness: 0.4 } } };
      expect(() => parseScene(rough)).toThrow(/\$\.materials\.g\.ior/);
    }
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

  it('parses a constant environment as both miss shader and NEE light', () => {
    const s = parseScene({
      ...minimal,
      environment: { type: 'constant', color: [0.5, 0.25, 1], intensity: 2 },
    });
    expect(s.background(ray(vec3(0, 0, 0), vec3(0, 1, 0)))).toEqual(vec3(1, 0.5, 2));
    expect(s.lights.count).toBe(1); // the environment joins the light mixture
    expect(s.lights.environment).toBeDefined();
    expect(s.lights.lights.length).toBe(0); // no emissive geometry in this scene
  });

  it('parses an image environment from a .hdr file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pathtracer-'));
    try {
      const file = join(dir, 'env.hdr');
      writeFileSync(file, encodeHdr(8, 4, new Float64Array(8 * 4 * 3).fill(0.5)));
      const s = parseScene({ ...minimal, environment: { type: 'image', path: file } });
      // 0.5 is exactly representable in RGBE.
      expect(s.background(ray(vec3(0, 0, 0), vec3(1, 0, 0)))).toEqual(vec3(0.5, 0.5, 0.5));
      expect(s.lights.count).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an environment combined with a background', () => {
    const bad = {
      ...minimal,
      background: [0, 0, 0],
      environment: { type: 'constant', color: [1, 1, 1] },
    };
    expect(() => parseScene(bad)).toThrow(/cannot be combined/);
  });

  it('rejects an unknown environment type', () => {
    const bad = { ...minimal, environment: { type: 'cubemap', path: 'x.hdr' } };
    expect(() => parseScene(bad)).toThrow(/\$\.environment\.type/);
  });

  it('rejects a negative environment intensity', () => {
    const bad = { ...minimal, environment: { type: 'constant', color: [1, 1, 1], intensity: -1 } };
    expect(() => parseScene(bad)).toThrow(/\$\.environment\.intensity/);
  });
});
