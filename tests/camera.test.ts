import { describe, expect, it } from 'vitest';
import { length, normalize, sub, vec3 } from '../src/vec3.js';
import { at } from '../src/ray.js';
import { Camera } from '../src/camera.js';
import { Rng } from '../src/rng.js';
import { expectVecClose } from './helpers.js';

describe('Camera', () => {
  it('centre ray points from position toward lookAt', () => {
    const cam = new Camera({
      position: vec3(3, 2, 5),
      lookAt: vec3(0, 1, -1),
      vfovDegrees: 50,
      aspect: 16 / 9,
    });
    const r = cam.getRay(0.5, 0.5, new Rng(1));
    expectVecClose(r.origin, vec3(3, 2, 5));
    expectVecClose(r.dir, normalize(sub(vec3(0, 1, -1), vec3(3, 2, 5))), 9);
  });

  it('vfov 90 with aspect 2: edge rays hit hand-computed viewport corners', () => {
    const cam = new Camera({
      position: vec3(0, 0, 0),
      lookAt: vec3(0, 0, -1),
      vfovDegrees: 90,
      aspect: 2,
    });
    // Half-height = tan(45) = 1, half-width = 2 at focus distance 1.
    expectVecClose(cam.getRay(0.5, 1, new Rng(1)).dir, normalize(vec3(0, 1, -1)), 9);
    expectVecClose(cam.getRay(1, 0.5, new Rng(1)).dir, normalize(vec3(2, 0, -1)), 9);
    expectVecClose(cam.getRay(0, 0, new Rng(1)).dir, normalize(vec3(-2, -1, -1)), 9);
  });

  it('pinhole camera (aperture 0) is deterministic and needs no RNG draws', () => {
    const cam = new Camera({
      position: vec3(0, 0, 0),
      lookAt: vec3(0, 0, -1),
      vfovDegrees: 60,
      aspect: 1,
    });
    const a = cam.getRay(0.3, 0.7, new Rng(1));
    const b = cam.getRay(0.3, 0.7, new Rng(999));
    expectVecClose(a.dir, b.dir, 12);
    expectVecClose(a.origin, b.origin, 12);
  });

  // A look-at frame is undefined when up is parallel to the view direction -
  // the top-down camera with the default +Y up is the everyday way to hit it.
  // Unchecked, cross(up, w) is the zero vector, every ray direction is NaN and
  // the render comes back uniformly black with exit status 0: a wrong answer
  // presented as a result, which is the one thing this renderer must not do.
  it('rejects an up vector parallel to the view direction instead of emitting NaN rays', () => {
    expect(
      () =>
        new Camera({ position: vec3(0, 5, 0), lookAt: vec3(0, 0, 0), vfovDegrees: 40, aspect: 1 }),
    ).toThrow(/up/);
    expect(
      () =>
        new Camera({
          position: vec3(3, 0, 0),
          lookAt: vec3(0, 0, 0),
          up: vec3(1, 0, 0),
          vfovDegrees: 40,
          aspect: 1,
        }),
    ).toThrow(/up/);
    expect(
      () =>
        new Camera({
          position: vec3(0, 0, 3),
          lookAt: vec3(0, 0, 0),
          up: vec3(0, 0, 0),
          vfovDegrees: 40,
          aspect: 1,
        }),
    ).toThrow(/up/);
  });

  it('rejects a camera sitting on its own lookAt point (no view direction)', () => {
    expect(
      () =>
        new Camera({ position: vec3(1, 2, 3), lookAt: vec3(1, 2, 3), vfovDegrees: 40, aspect: 1 }),
    ).toThrow(/lookAt/);
  });

  it('defocus blur: lens rays have jittered origins but converge on the focus plane', () => {
    const cam = new Camera({
      position: vec3(0, 0, 0),
      lookAt: vec3(0, 0, -4),
      vfovDegrees: 60,
      aspect: 1,
      aperture: 0.5,
      focusDist: 4,
    });
    const r1 = cam.getRay(0.3, 0.7, new Rng(1));
    const r2 = cam.getRay(0.3, 0.7, new Rng(2));
    // Origins are jittered on the lens disk...
    expect(length(sub(r1.origin, r2.origin))).toBeGreaterThan(1e-4);
    // ...but both rays pass through the same point on the focus plane z = -4.
    const p1 = at(r1, (-4 - r1.origin.z) / r1.dir.z);
    const p2 = at(r2, (-4 - r2.origin.z) / r2.dir.z);
    expectVecClose(p1, p2, 9);
    expect(p1.z).toBeCloseTo(-4, 9);
  });
});
