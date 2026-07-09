/**
 * Parallel tile renderer over worker_threads. The image is split into
 * contiguous horizontal bands, one per worker; each worker re-parses the scene
 * and renders its band. Because rendering is deterministic per pixel, the merged
 * result is byte-identical to renderScene regardless of the worker count. A
 * single worker (or a missing worker script) falls back to an in-process render.
 */
import { Worker } from 'node:worker_threads';
import { cameraFor, parseScene } from './scene.js';
import { renderScene, type RenderSettings } from './integrator.js';

export interface ParallelOptions {
  workers: number;
  /** Path/URL to the built render worker (defaults to ./render-worker.js beside this module). */
  workerScript?: string | URL;
}

/** Split [0, height) into up to `n` contiguous row bands. */
export function splitRows(height: number, n: number): [number, number][] {
  const per = Math.max(1, Math.ceil(height / n));
  const bands: [number, number][] = [];
  for (let start = 0; start < height; start += per) {
    bands.push([start, Math.min(height, start + per)]);
  }
  return bands;
}

export async function renderSceneParallel(
  sceneJson: unknown,
  settings: RenderSettings,
  opts: ParallelOptions,
): Promise<Float64Array> {
  const { width, height } = settings;
  const workers = Math.max(1, Math.floor(opts.workers));
  if (workers === 1) {
    const scene = parseScene(sceneJson);
    return renderScene(
      scene.world,
      cameraFor(scene, width, height),
      scene.background,
      settings,
      undefined,
      scene.lights.count > 0 ? scene.lights : undefined,
    );
  }

  const script = opts.workerScript ?? new URL('./render-worker.js', import.meta.url);
  const bands = splitRows(height, workers);
  const full = new Float64Array(width * height * 3);
  await Promise.all(
    bands.map(
      ([rowStart, rowEnd]) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(script, { workerData: { sceneJson, settings, rowStart, rowEnd } });
          w.on('message', (msg: { rowStart: number; buffer: ArrayBuffer }) => {
            full.set(new Float64Array(msg.buffer), msg.rowStart * width * 3);
            resolve();
          });
          w.on('error', reject);
          w.on('exit', (code) => {
            if (code !== 0) reject(new Error(`render worker exited with code ${code}`));
          });
        }),
    ),
  );
  return full;
}
