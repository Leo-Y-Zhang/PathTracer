#!/usr/bin/env node
/**
 * Generate the committed procedural-sky HDR asset:
 *
 *   node dist/tools/make-sky-hdr.js [out.hdr]
 *
 * A deterministic equirectangular daylight sky written with the in-tree
 * RGBE encoder - a small bright sun disk with a soft glow, a zenith-to-
 * horizon gradient, a warm horizon band and a dark ground hemisphere. Pure
 * per-texel math (no RNG, no inputs), so the asset is reproducible from
 * source and the repository stays self-contained and unencumbered.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { add, dot, lerp, normalize, scale, vec3, type Vec3 } from '../vec3.js';
import { encodeHdr } from '../hdr.js';

const WIDTH = 128;
const HEIGHT = 64;

/** Direction TO the sun: up-left of the +Z viewer, matching the showcase framing. */
const SUN = normalize(vec3(-0.5, 0.62, 0.45));
const SUN_RADIANCE = 320;
const SUN_COS_RADIUS = Math.cos(0.035); // ~2 degree angular radius

const ZENITH = vec3(0.16, 0.34, 0.9);
const HORIZON = vec3(0.78, 0.78, 0.88);
const SUN_TINT = vec3(1.0, 0.88, 0.68);
const GROUND_NEAR = vec3(0.16, 0.17, 0.2); // at the horizon: distant haze
const GROUND_FAR = vec3(0.06, 0.065, 0.08); // at the nadir

function skyRadiance(d: Vec3): Vec3 {
  const cosSun = dot(d, SUN);
  if (cosSun >= SUN_COS_RADIUS) return scale(SUN_TINT, SUN_RADIANCE);
  if (d.y < 0) return lerp(GROUND_NEAR, GROUND_FAR, -d.y);
  // Above the horizon: gradient plus a sun-tinted glow and horizon warmth.
  const base = lerp(HORIZON, ZENITH, Math.pow(d.y, 0.65));
  const glow = Math.pow(Math.max(0, cosSun), 64) * 2.2 + Math.pow(Math.max(0, cosSun), 8) * 0.35;
  const warmth = Math.pow(1 - d.y, 6) * 0.25;
  return add(base, scale(SUN_TINT, glow + warmth));
}

const out = process.argv[2] ?? 'assets/sky.hdr';
const pixels = new Float64Array(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y++) {
  const theta = (Math.PI * (y + 0.5)) / HEIGHT;
  for (let x = 0; x < WIDTH; x++) {
    const phi = (2 * Math.PI * (x + 0.5)) / WIDTH;
    const d = vec3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    const c = skyRadiance(d);
    const i = (y * WIDTH + x) * 3;
    pixels[i] = c.x;
    pixels[i + 1] = c.y;
    pixels[i + 2] = c.z;
  }
}

const bytes = encodeHdr(WIDTH, HEIGHT, pixels);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
process.stderr.write(`wrote ${out} (${WIDTH}x${HEIGHT}, ${bytes.length} bytes)\n`);
