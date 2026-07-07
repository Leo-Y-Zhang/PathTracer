import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { HittableList } from '../src/hittable.js';
import { BVHNode } from '../src/bvh.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Rect } from '../src/geometry/rect.js';
import { Emissive, Lambertian } from '../src/materials.js';
import { Camera } from '../src/camera.js';
import { renderScene, trace, type Background } from '../src/integrator.js';

const whiteEnv: Background = () => vec3(1, 1, 1);
const blackEnv: Background = () => vec3(0, 0, 0);

/** Mean of one colour channel over a linear HDR buffer. */
function channelMean(img: Float64Array, channel: 0 | 1 | 2): number {
  let sum = 0;
  let n = 0;
  for (let i = channel; i < img.length; i += 3) {
    sum += img[i]!;
    n++;
  }
  return sum / n;
}

describe('THE FURNACE TEST: energy conservation', () => {
  /**
   * A lambertian sphere of albedo A inside a uniform emissive environment of
   * radiance 1 must render to radiance exactly A: the rendering equation
   * gives L = A * integral(L_env * cos / pi) = A * L_env, and a convex
   * sphere never shadows itself. Any energy leak or gain in the material,
   * the cosine sampling, or the integrator shows up as a deviation.
   */
  function furnace(albedo: number, spp: number): number {
    const sphere = new Sphere(vec3(0, 0, -2), 1, new Lambertian(vec3(albedo, albedo, albedo)));
    const world = BVHNode.build([sphere]);
    // vfov 30 from 2 units away: every camera ray (even corner rays at
    // ~20.8 deg off-axis) hits the sphere, whose angular radius is 30 deg.
    const camera = new Camera({
      position: vec3(0, 0, 0),
      lookAt: vec3(0, 0, -1),
      vfovDegrees: 30,
      aspect: 1,
    });
    const img = renderScene(world, camera, whiteEnv, {
      width: 24,
      height: 24,
      spp,
      maxDepth: 16,
      seed: 42,
    });
    return (channelMean(img, 0) + channelMean(img, 1) + channelMean(img, 2)) / 3;
  }

  it('albedo 0.5 sphere renders to mean radiance 0.5 (within 0.01)', () => {
    expect(furnace(0.5, 128)).toBeCloseTo(0.5, 2);
  });

  it('albedo 0.8 sphere renders to mean radiance 0.8 (within 0.01)', () => {
    expect(furnace(0.8, 128)).toBeCloseTo(0.8, 2);
  });

  it('white furnace with multiple bounces: russian roulette is unbiased', () => {
    // Camera inside an open albedo-1.0 box, environment radiance 1. Paths
    // bounce diffusely (russian roulette active from bounce 3) until they
    // escape through the missing +z face. Perfect energy conservation means
    // every pixel must converge to exactly 1; any RR bias would shift it.
    const white = new Lambertian(vec3(1, 1, 1));
    const world = BVHNode.build([
      new Rect('xz', -1, -1, 1, 1, -1, white), // floor
      new Rect('xz', -1, -1, 1, 1, 1, white), // ceiling
      new Rect('yz', -1, -1, 1, 1, -1, white), // left
      new Rect('yz', -1, -1, 1, 1, 1, white), // right
      new Rect('xy', -1, -1, 1, 1, -1, white), // back
    ]);
    const camera = new Camera({
      position: vec3(0, 0, 0.9),
      lookAt: vec3(0, 0, -1),
      vfovDegrees: 60,
      aspect: 1,
    });
    const img = renderScene(world, camera, whiteEnv, {
      width: 16,
      height: 16,
      spp: 100,
      maxDepth: 64,
      seed: 7,
    });
    const mean = (channelMean(img, 0) + channelMean(img, 1) + channelMean(img, 2)) / 3;
    expect(mean).toBeGreaterThan(0.98);
    expect(mean).toBeLessThan(1.02);
    // Per-pixel check with a tolerance generous enough for RR variance.
    for (let i = 0; i < img.length; i++) {
      expect(img[i]!).toBeGreaterThan(0.6);
      expect(img[i]!).toBeLessThan(1.4);
    }
  });
});

describe('trace', () => {
  it('returns the background for a ray that hits nothing', () => {
    const world = new HittableList([]);
    const grad: Background = (r) => vec3(0, r.dir.y, 1);
    const c = trace(ray(vec3(0, 0, 0), vec3(0, 1, 0)), world, grad, new Rng(1), 8);
    expect(c.x).toBe(0);
    expect(c.y).toBeCloseTo(1, 12);
    expect(c.z).toBe(1);
  });

  it('returns exact emission when the camera ray hits a light directly', () => {
    const light = new Emissive(vec3(1, 0.5, 0.25), 5);
    const world = BVHNode.build([new Sphere(vec3(0, 0, -2), 1, light)]);
    const c = trace(ray(vec3(0, 0, 0), vec3(0, 0, -1)), world, blackEnv, new Rng(3), 8);
    expect(c.x).toBeCloseTo(5, 12);
    expect(c.y).toBeCloseTo(2.5, 12);
    expect(c.z).toBeCloseTo(1.25, 12);
  });

  it('returns black at maxDepth 0', () => {
    const world = new HittableList([]);
    const c = trace(ray(vec3(0, 0, 0), vec3(0, 0, -1)), world, whiteEnv, new Rng(1), 0);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.z).toBe(0);
  });

  it('a closed unlit scene stays black', () => {
    const grey = new Lambertian(vec3(0.5, 0.5, 0.5));
    const world = BVHNode.build([new Sphere(vec3(0, 0, 0), 10, grey)]);
    // Camera inside the sphere, black environment: nothing can add light.
    const c = trace(ray(vec3(0, 0, 0), vec3(0, 0, -1)), world, blackEnv, new Rng(5), 32);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.z).toBe(0);
  });
});
