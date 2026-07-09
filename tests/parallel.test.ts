import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { cameraFor, parseScene } from '../src/scene.js';
import { renderRows, renderScene, type RenderSettings } from '../src/integrator.js';
import { renderSceneParallel, splitRows } from '../src/parallel.js';

const json = {
  camera: { position: [0, 0, 0], lookAt: [0, 0, -1], vfov: 40 },
  background: [0.5, 0.7, 1.0],
  objects: [
    { type: 'sphere', center: [0, 0, -1.5], radius: 0.6, material: 'red' },
    { type: 'rect', plane: 'xz', min: [-3, -3], max: [3, 3], k: -0.6, material: 'grey' },
  ],
  materials: {
    red: { type: 'lambertian', albedo: [0.8, 0.2, 0.2] },
    grey: { type: 'lambertian', albedo: [0.6, 0.6, 0.6] },
  },
};

const settings: RenderSettings = { width: 12, height: 10, spp: 8, maxDepth: 8, seed: 5 };

describe('splitRows', () => {
  it('divides the height into contiguous covering bands', () => {
    expect(splitRows(10, 3)).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ]);
    expect(splitRows(10, 1)).toEqual([[0, 10]]);
  });
});

describe('renderRows', () => {
  it('a row band is byte-identical to the same rows of a full render', () => {
    const scene = parseScene(json);
    const camera = cameraFor(scene, settings.width, settings.height);
    const full = renderScene(scene.world, camera, scene.background, settings);
    const band = renderRows(scene.world, camera, scene.background, settings, 3, 7);
    const offset = 3 * settings.width * 3;
    for (let i = 0; i < band.length; i++) expect(band[i]).toBe(full[offset + i]);
  });
});

describe('renderSceneParallel (requires npm run build for the worker)', () => {
  it('multi-worker output is byte-identical to a single-threaded render', async () => {
    const single = await renderSceneParallel(json, settings, { workers: 1 });
    const parallel = await renderSceneParallel(json, settings, {
      workers: 2,
      workerScript: pathToFileURL(resolve('dist/render-worker.js')),
    });
    expect(parallel.length).toBe(single.length);
    expect(Array.from(parallel)).toEqual(Array.from(single));
  }, 30000);
});
