import { ZERO, add, dot, maxComponent, mul, neg, normalize, scale, vec3, type Vec3 } from './vec3.js';
import { ray, type Ray } from './ray.js';
import type { Hittable } from './hittable.js';
import type { Camera } from './camera.js';
import type { LightList } from './lights.js';
import { pixelRng, type Rng } from './rng.js';

/** Environment radiance for rays that leave the scene. */
export type Background = (r: Ray) => Vec3;

/** Self-intersection guard ("shadow acne" epsilon). */
const T_MIN = 1e-4;
/** Bounce index at which russian roulette starts. */
const RR_START_DEPTH = 3;
const RR_MIN_P = 0.05;
const RR_MAX_P = 0.95;

/** MIS power heuristic (beta = 2) for one sample of each strategy. */
function powerHeuristic(a: number, b: number): number {
  const a2 = a * a;
  const denom = a2 + b * b;
  return denom > 0 ? a2 / denom : 0;
}

function isBlack(v: Vec3): boolean {
  return v.x <= 0 && v.y <= 0 && v.z <= 0;
}

/**
 * Iterative unidirectional path tracer with optional next-event estimation.
 *
 * Without `lights`, this is the classic estimator: L = sum over bounces of
 * throughput * emitted, throughput accumulating BRDF * cos / pdf at each vertex.
 *
 * With `lights`, every non-specular vertex also samples a light directly (a
 * shadow ray gives visibility for free by taking the nearest hit's emission),
 * and the two strategies - light sampling and BSDF sampling - are combined with
 * the MIS power heuristic so neither double-counts. Emission reached by a BSDF
 * bounce is weighted by w_bsdf; emission reached by the light sample by w_light.
 * Emission after a specular bounce (or straight from the camera) is taken in
 * full, since NEE cannot sample a delta BSDF. This leaves the estimator
 * unbiased (the furnace tests still hold) while cutting variance sharply.
 *
 * Russian roulette starts after RR_START_DEPTH bounces: a path survives with
 * probability p = clamp(max(throughput)) and is compensated by 1/p.
 */
export function trace(
  r: Ray,
  world: Hittable,
  background: Background,
  rng: Rng,
  maxDepth: number,
  lights?: LightList,
): Vec3 {
  let radiance = ZERO;
  let throughput = vec3(1, 1, 1);
  let current = r;
  // The camera ray behaves like a specular bounce: its emission is taken whole.
  let specular = true;
  let prevOrigin = r.origin;
  let prevPdfBsdf = 0;
  const nee = lights !== undefined && lights.count > 0;

  for (let depth = 0; depth < maxDepth; depth++) {
    const hit = world.hit(current, T_MIN, Infinity);
    if (!hit) {
      radiance = add(radiance, mul(throughput, background(current)));
      break;
    }

    const emitted = hit.material.emitted();
    if (!isBlack(emitted)) {
      if (!nee || specular) {
        radiance = add(radiance, mul(throughput, emitted));
      } else {
        // MIS-weight the emission we found by BSDF sampling against the chance
        // the light-sampling strategy would have aimed here from the last vertex.
        const w = powerHeuristic(prevPdfBsdf, lights.pdf(prevOrigin, current.dir));
        radiance = add(radiance, scale(mul(throughput, emitted), w));
      }
    }

    const m = hit.material;
    const wo = neg(normalize(current.dir));

    if (nee && !m.isSpecular) {
      const s = lights.sample(hit.point, rng);
      if (s && s.pdf > 0) {
        const cosL = dot(s.dir, hit.normal);
        if (cosL > 0) {
          const shadow = world.hit(ray(hit.point, s.dir), T_MIN, Infinity);
          if (shadow && !isBlack(shadow.material.emitted())) {
            const f = m.evalBrdf(wo, s.dir, hit);
            const w = powerHeuristic(s.pdf, m.scatterPdf(wo, s.dir, hit));
            const contrib = scale(
              mul(mul(throughput, f), shadow.material.emitted()),
              (cosL * w) / s.pdf,
            );
            radiance = add(radiance, contrib);
          }
        }
      }
    }

    const scattered = m.scatter(current, hit, rng);
    if (!scattered) break;

    throughput = mul(throughput, scattered.attenuation);
    specular = m.isSpecular;
    prevOrigin = hit.point;
    prevPdfBsdf = m.isSpecular ? 0 : m.scatterPdf(wo, scattered.ray.dir, hit);
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
  lights?: LightList,
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
        const c = trace(camera.getRay(u, v, rng), world, background, rng, maxDepth, lights);
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
