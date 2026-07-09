import { describe, expect, it } from 'vitest';
import { length, normalize, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { skyBackground } from '../src/sky.js';
import { parseScene } from '../src/scene.js';
import { expectVecClose } from './helpers.js';

const sky = skyBackground({
  sunDirection: vec3(1, 0, 0),
  sunColor: vec3(1, 1, 1),
  sunIntensity: 10,
  sunAngularRadius: 0.05,
  zenith: vec3(0.3, 0.5, 1),
  horizon: vec3(0.9, 0.9, 0.95),
  ground: vec3(0.1, 0.1, 0.1),
});

const look = (d: ReturnType<typeof vec3>) => sky(ray(vec3(0, 0, 0), d));

describe('sky background', () => {
  it('returns the bright sun disk when looking at the sun', () => {
    expectVecClose(look(vec3(1, 0, 0)), vec3(10, 10, 10));
  });

  it('returns the ground colour below the horizon', () => {
    expectVecClose(look(vec3(0, -1, 0)), vec3(0.1, 0.1, 0.1));
  });

  it('returns the zenith colour straight up (sun at the horizon)', () => {
    expectVecClose(look(vec3(0, 1, 0)), vec3(0.3, 0.5, 1));
  });

  it('is brighter near the sun than away from it (glow) at equal elevation', () => {
    const near = look(normalize(vec3(1, 0.2, 0)));
    const far = look(normalize(vec3(-1, 0.2, 0)));
    expect(length(near)).toBeGreaterThan(length(far));
  });
});

describe('scene parsing of a sky background', () => {
  it('builds a sky and lights the scene from the sun direction', () => {
    const scene = parseScene({
      camera: { position: [0, 0, 0], lookAt: [0, 0, -1], vfov: 40 },
      background: { type: 'sky', sun: [0, 1, 0], sunIntensity: 12 },
      objects: [{ type: 'sphere', center: [0, 0, -1], radius: 1, material: 'm' }],
      materials: { m: { type: 'lambertian', albedo: [0.5, 0.5, 0.5] } },
    });
    // looking toward the sun (straight up) should be far brighter than the ground
    expect(length(scene.background(ray(vec3(0, 0, 0), vec3(0, 1, 0))))).toBeGreaterThan(5);
    expectVecClose(scene.background(ray(vec3(0, 0, 0), vec3(0, -1, 0))), vec3(0.2, 0.2, 0.2));
  });
});
