import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseScene } from '../src/scene.js';
import { renderSceneParallel } from '../src/parallel.js';
import { encodePng, toneMap } from '../src/png.js';

// The committed HDR-environment showcase scene: parses, samples its
// environment through NEE, and renders byte-identically across runs and
// across worker counts. Every random draw comes from the seeded per-pixel
// RNG, so the .hdr-driven light sampling cannot break determinism.

const json = JSON.parse(readFileSync('scenes/skylight.json', 'utf8')) as Record<string, unknown>;
const settings = { width: 40, height: 26, spp: 4, maxDepth: 8, seed: 12 };

function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('skylight scene (committed HDR environment + OBJ mesh)', () => {
  it('parses with the environment as its single NEE light', () => {
    const s = parseScene(json);
    expect(s.name).toBe('skylight');
    expect(s.objectCount).toBe(4);
    expect(s.lights.count).toBe(1);
    expect(s.lights.environment).toBeDefined();
    expect(s.defaults.toneMapping).toBe('aces');
  });

  it('renders to byte-identical SHA-256 across runs and under worker_threads (requires npm run build)', async () => {
    const single = await renderSceneParallel(json, settings, { workers: 1 });
    const again = await renderSceneParallel(json, settings, { workers: 1 });
    const parallel = await renderSceneParallel(json, settings, {
      workers: 2,
      workerScript: pathToFileURL(resolve('dist/render-worker.js')),
    });
    expect(Array.from(again)).toEqual(Array.from(single));
    expect(Array.from(parallel)).toEqual(Array.from(single));
    const png = encodePng(settings.width, settings.height, toneMap(single, 'aces'));
    const pngAgain = encodePng(settings.width, settings.height, toneMap(parallel, 'aces'));
    expect(sha256(pngAgain)).toBe(sha256(png));
  }, 60000);
});
