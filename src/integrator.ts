import { ZERO, add, maxComponent, mul, scale, vec3, type Vec3 } from './vec3.js';
import type { Ray } from './ray.js';
import type { Hittable } from './hittable.js';
import type { Camera } from './camera.js';
import { pixelRng, type Rng } from './rng.js';

/** Environment radiance for rays that leave the scene. */
export type Background = (r: Ray) => Vec3;

/** Self-intersection guard ("shadow acne" epsilon). */
const T_MIN = 1e-4;
/** Bounce index at which russian roulette starts. */
const RR_START_DEPTH = 3;
const RR_MIN_P = 0.05;
const RR_MAX_P = 0.95;

/**
 * Iterative unidirectional path tracer.
 *
 * Estimator: L = sum over bounces of throughput * emitted, where throughput
 * accumulates BRDF * cos / pdf at each vertex. Emitted light is collected
 * when a path hits an emissive surface or escapes to the background - there
 * is NO next-event estimation (see README for the honest tradeoff).
 *
 * Russian roulette starts after RR_START_DEPTH bounces: a path survives with
 * probability p = clamp(max(throughput)) and is compensated by 1/p, keeping
 * the estimator unbiased. The white-furnace test proves this numerically.
 */
export function trace(
  r: Ray,
  world: Hittable,
  background: Background,
  rng: Rng,
  maxDepth: number,
): Vec3 {
  let radiance = ZERO;
  let throughput = vec3(1, 1, 1);
  let current = r;

  for (let depth = 0; depth < maxDepth; depth++) {
    const hit = world.hit(current, T_MIN, Infinity);
    if (!hit) {
      radiance = add(radiance, mul(throughput, background(current)));
      break;
    }

    radiance = add(radiance, mul(throughput, hit.material.emitted()));

    const scattered = hit.material.scatter(current, hit, rng);
    if (!scattered) break;

    throughput = mul(throughput, scattered.attenuation);
    current = scattered.ray;

    if (depth + 1 >= RR_START_DEPTH) {
      const p = Math.min(RR_MAX_P, Math.max(RR_MIN_P, maxComponent(throughput)));
      if (rng.float() >= p) break;
      throughput = scale(throughput, 1 / p);
    }
  }

  return radiance;
}

export interface RenderSettings {
  width: number;
  height: number;
  /** Samples per pixel. */
  spp: number;
  maxDepth: number;
  seed: number;
}

/**
 * Render to a linear-radiance RGB buffer (row-major, top row first).
 * Deterministic: each sample's RNG is seeded only from (x, y, sample, seed).
 */
export function renderScene(
  world: Hittable,
  camera: Camera,
  background: Background,
  settings: RenderSettings,
  onRow?: (rowsDone: number, totalRows: number) => void,
): Float64Array {
  const { width, height, spp, maxDepth, seed } = settings;
  const img = new Float64Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < spp; s++) {
        const rng = pixelRng(x, y, s, seed);
        const u = (x + rng.float()) / width;
        const v = 1 - (y + rng.float()) / height;
        const c = trace(camera.getRay(u, v, rng), world, background, rng, maxDepth);
        // Guard against a degenerate sample poisoning the pixel.
        if (Number.isFinite(c.x)) r += c.x;
        if (Number.isFinite(c.y)) g += c.y;
        if (Number.isFinite(c.z)) b += c.z;
      }
      const i = (y * width + x) * 3;
      img[i] = r / spp;
      img[i + 1] = g / spp;
      img[i + 2] = b / spp;
    }
    onRow?.(y + 1, height);
  }

  return img;
}
