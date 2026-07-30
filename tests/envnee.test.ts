import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vec3.js';
import { BVHNode } from '../src/bvh.js';
import { Sphere } from '../src/geometry/sphere.js';
import { Rect } from '../src/geometry/rect.js';
import { Emissive, Lambertian } from '../src/materials.js';
import { LightList } from '../src/lights.js';
import { Camera } from '../src/camera.js';
import { renderScene, type Background } from '../src/integrator.js';
import { encodeHdr } from '../src/hdr.js';
import { ConstantEnvironment, EnvironmentMap, type EnvironmentLight } from '../src/envlight.js';

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

/**
 * The IBL furnace: an albedo-A sphere inside an environment of radiance 1,
 * rendered WITH the environment in the NEE light mixture. Exactly as in the
 * classic furnace test, the result must be A - but now the estimate combines
 * light sampling of an infinite-domain light with BSDF sampling, so any slip
 * in the mixture pdf, the escape-ray MIS weight, or the shadow-ray-to-
 * environment contribution shows up as a deviation from A.
 */
function envFurnace(albedo: number, spp: number, env: EnvironmentLight): number {
  const sphere = new Sphere(vec3(0, 0, -2), 1, new Lambertian(vec3(albedo, albedo, albedo)));
  const world = BVHNode.build([sphere]);
  const background: Background = (r) => env.radiance(r.dir);
  const camera = new Camera({
    position: vec3(0, 0, 0),
    lookAt: vec3(0, 0, -1),
    vfovDegrees: 30,
    aspect: 1,
  });
  const img = renderScene(
    world,
    camera,
    background,
    { width: 24, height: 24, spp, maxDepth: 16, seed: 42 },
    undefined,
    new LightList([], env),
  );
  return mean(img);
}

describe('THE ENVIRONMENT FURNACE TEST: NEE-sampled IBL is unbiased', () => {
  it('albedo 0.5 sphere in a constant-radiance-1 environment renders to 0.5', () => {
    expect(envFurnace(0.5, 128, new ConstantEnvironment(vec3(1, 1, 1)))).toBeCloseTo(0.5, 2);
  });

  it('albedo 0.8 sphere renders to 0.8', () => {
    expect(envFurnace(0.8, 128, new ConstantEnvironment(vec3(1, 1, 1)))).toBeCloseTo(0.8, 2);
  });

  it('holds end-to-end through the .hdr file path (RGBE encode -> decode -> CDF)', () => {
    // 1.0 is exactly representable in RGBE, so a decoded constant-1 map is
    // radiance exactly 1 - and the whole image-based pipeline (file decode,
    // luminance CDF, equirect mapping, pdf conversion) must still give 0.5.
    const px = new Float64Array(16 * 8 * 3).fill(1);
    const env = EnvironmentMap.fromHdr(encodeHdr(16, 8, px));
    expect(envFurnace(0.5, 200, env)).toBeCloseTo(0.5, 2);
  });
});

/** A directional environment: a compact bright sun block over a dim sky. */
function makeSunEnv(sunRadiance: number): EnvironmentMap {
  const width = 16;
  const height = 8;
  const px = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sun = x >= 4 && x < 6 && y >= 1 && y < 3;
      const i = (y * width + x) * 3;
      px[i] = sun ? sunRadiance : 0.22;
      px[i + 1] = sun ? sunRadiance * 0.95 : 0.26;
      px[i + 2] = sun ? sunRadiance * 0.82 : 0.35;
    }
  }
  return new EnvironmentMap(width, height, px);
}

// A floor and a matte sphere under the sun environment: direct sky light,
// sun light, and one-bounce interreflection all in play.
function buildScene(): { world: BVHNode; camera: Camera } {
  const world = BVHNode.build([
    new Rect('xz', -4, -4, 4, 4, 0, new Lambertian(vec3(0.55, 0.55, 0.55))),
    new Sphere(vec3(0, 1, 0), 1, new Lambertian(vec3(0.7, 0.4, 0.3))),
  ]) as BVHNode;
  const camera = new Camera({
    position: vec3(0, 2, 5),
    lookAt: vec3(0, 0.8, 0),
    vfovDegrees: 45,
    aspect: 1,
  });
  return { world, camera };
}

function renderSun(env: EnvironmentMap, withNee: boolean, spp: number, seed: number): Float64Array {
  const { world, camera } = buildScene();
  const background: Background = (r) => env.radiance(r.dir);
  return renderScene(
    world,
    camera,
    background,
    { width: 16, height: 16, spp, maxDepth: 6, seed },
    undefined,
    withNee ? new LightList([], env) : undefined,
  );
}

describe('environment NEE + MIS in real scenes', () => {
  it('converges to the same image mean as pure path tracing (unbiased)', () => {
    const env = makeSunEnv(8);
    const neeMean = mean(renderSun(env, true, 400, 1));
    const ptMean = mean(renderSun(env, false, 400, 2));
    expect(neeMean).toBeGreaterThan(0.05);
    expect(Math.abs(neeMean - ptMean) / neeMean).toBeLessThan(0.08);
  }, 30000);

  it('cuts variance: at low spp the env-sampled render is closer to the reference', () => {
    const env = makeSunEnv(30);
    const reference = renderSun(env, true, 1500, 99);
    const neeErr = rmse(renderSun(env, true, 12, 7), reference);
    const ptErr = rmse(renderSun(env, false, 12, 7), reference);
    expect(neeErr).toBeLessThan(ptErr * 0.6);
  }, 40000);

  it('mixes with area lights unbiasedly (env + emissive rect in one LightList)', () => {
    // The subtle mixture case: a finite area light AND the infinite
    // environment share the uniform pick. Compare against pure path tracing.
    const env = makeSunEnv(6);
    const lamp = new Rect('xz', -0.6, -0.6, 0.6, 0.6, 3.5, new Emissive(vec3(1, 1, 1), 10));
    const floor = new Rect('xz', -4, -4, 4, 4, 0, new Lambertian(vec3(0.55, 0.55, 0.55)));
    const ball = new Sphere(vec3(0, 1, 0), 1, new Lambertian(vec3(0.7, 0.4, 0.3)));
    const world = BVHNode.build([floor, ball, lamp]);
    const camera = new Camera({
      position: vec3(0, 2, 5),
      lookAt: vec3(0, 0.8, 0),
      vfovDegrees: 45,
      aspect: 1,
    });
    const background: Background = (r) => env.radiance(r.dir);
    const settings = { width: 16, height: 16, spp: 500, maxDepth: 6 };
    const withBoth = renderScene(world, camera, background, { ...settings, seed: 3 }, undefined, new LightList([lamp], env));
    const pure = renderScene(world, camera, background, { ...settings, seed: 4 });
    const a = mean(withBoth);
    const b = mean(pure);
    expect(a).toBeGreaterThan(0.05);
    expect(Math.abs(a - b) / a).toBeLessThan(0.08);
  }, 40000);

  it('stays deterministic under environment NEE (same seed -> identical buffer)', () => {
    const env = makeSunEnv(8);
    expect(Array.from(renderSun(env, true, 16, 5))).toEqual(Array.from(renderSun(env, true, 16, 5)));
  }, 20000);
});
