import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseScene } from '../src/scene.js';
import { Camera } from '../src/camera.js';
import { renderScene } from '../src/integrator.js';
import { encodePng, toneMap } from '../src/png.js';

function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Full pipeline: scene JSON -> parse -> render -> tone map -> PNG bytes. */
function renderPng(seed: number): Buffer {
  const scene = parseScene(JSON.parse(readFileSync('tests/fixtures/tiny.json', 'utf8')));
  const { width, height, spp, maxDepth } = scene.defaults;
  const camera = new Camera({
    position: scene.camera.position,
    lookAt: scene.camera.lookAt,
    up: scene.camera.up,
    vfovDegrees: scene.camera.vfovDegrees,
    aspect: width / height,
    aperture: scene.camera.aperture,
    ...(scene.camera.focusDist !== undefined ? { focusDist: scene.camera.focusDist } : {}),
  });
  const img = renderScene(scene.world, camera, scene.background, {
    width,
    height,
    spp,
    maxDepth,
    seed,
  });
  return encodePng(width, height, toneMap(img));
}

describe('determinism', () => {
  it('the same seed produces byte-identical PNGs (equal SHA-256)', () => {
    const a = renderPng(7);
    const b = renderPng(7);
    expect(sha256(a)).toBe(sha256(b));
    expect(a.equals(b)).toBe(true);
  });

  it('a different seed produces different PNG bytes', () => {
    expect(sha256(renderPng(7))).not.toBe(sha256(renderPng(8)));
  });

  it('the linear-radiance buffer itself is bitwise reproducible (not just the PNG)', () => {
    const scene = parseScene(JSON.parse(readFileSync('tests/fixtures/tiny.json', 'utf8')));
    const { width, height, spp, maxDepth } = scene.defaults;
    const camera = new Camera({
      position: scene.camera.position,
      lookAt: scene.camera.lookAt,
      up: scene.camera.up,
      vfovDegrees: scene.camera.vfovDegrees,
      aspect: width / height,
      aperture: scene.camera.aperture,
      ...(scene.camera.focusDist !== undefined ? { focusDist: scene.camera.focusDist } : {}),
    });
    const settings = { width, height, spp, maxDepth, seed: 3 };
    const full = renderScene(scene.world, camera, scene.background, settings);
    const again = renderScene(scene.world, camera, scene.background, settings);
    expect(full).toEqual(again);
  });
});
