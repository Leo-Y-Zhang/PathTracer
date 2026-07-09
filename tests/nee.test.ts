import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { BVHNode } from '../src/bvh.js';
import { Rect } from '../src/geometry/rect.js';
import { Emissive, Lambertian } from '../src/materials.js';
import { LightList } from '../src/lights.js';
import { Camera } from '../src/camera.js';
import { renderScene, type Background } from '../src/integrator.js';

const black: Background = () => vec3(0, 0, 0);

// A grey floor lit only by a small emissive rectangle overhead: the classic
// scene where pure path tracing is noisy (paths rarely find the small light)
// but next-event estimation shines.
function buildScene(): { world: BVHNode; lights: LightList; camera: Camera } {
  const floorMat = new Lambertian(vec3(0.6, 0.6, 0.6));
  const light = new Emissive(vec3(1, 1, 1), 8);
  const floor = new Rect('xz', -2, -2, 2, 2, 0, floorMat);
  const lightRect = new Rect('xz', -0.5, -0.5, 0.5, 0.5, 3, light);
  const world = BVHNode.build([floor, lightRect]) as BVHNode;
  const camera = new Camera({
    position: vec3(0, 2.5, 3),
    lookAt: vec3(0, 0, 0),
    vfovDegrees: 45,
    aspect: 1,
  });
  return { world, lights: new LightList([lightRect]), camera };
}

function render(withNEE: boolean, spp: number, seed: number): Float64Array {
  const { world, lights, camera } = buildScene();
  return renderScene(
    world,
    camera,
    black,
    { width: 16, height: 16, spp, maxDepth: 6, seed },
    undefined,
    withNEE ? lights : undefined,
  );
}

function mean(img: Float64Array): number {
  let s = 0;
  for (const v of img) s += v;
  return s / img.length;
}

function rmse(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

describe('next-event estimation + MIS', () => {
  it('converges to the same image mean as pure path tracing (unbiased)', () => {
    const neeMean = mean(render(true, 400, 1));
    const ptMean = mean(render(false, 400, 2));
    expect(neeMean).toBeGreaterThan(0.02);
    // Two unbiased estimators of the same integral must agree up to MC error.
    expect(Math.abs(neeMean - ptMean) / neeMean).toBeLessThan(0.08);
  }, 20000);

  it('cuts variance sharply: at low spp NEE is far closer to the reference', () => {
    const reference = render(true, 1200, 99);
    const neeLow = render(true, 8, 7);
    const ptLow = render(false, 8, 7);
    const neeErr = rmse(neeLow, reference);
    const ptErr = rmse(ptLow, reference);
    expect(neeErr).toBeLessThan(ptErr * 0.6);
  }, 30000);

  it('stays deterministic under NEE (same seed -> identical buffer)', () => {
    expect(Array.from(render(true, 16, 5))).toEqual(Array.from(render(true, 16, 5)));
  }, 20000);
});
