/**
 * worker_threads entry: render a horizontal band of a scene. Each worker
 * re-parses the scene from JSON (so nothing non-serialisable crosses the
 * boundary) and renders its assigned rows. Per-pixel seeding makes the result
 * independent of how the rows are divided, so the merged image is byte-identical
 * to a single-threaded render.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { cameraFor, parseScene } from './scene.js';
import { renderRows, type RenderSettings } from './integrator.js';

interface WorkerInput {
  sceneJson: unknown;
  settings: RenderSettings;
  rowStart: number;
  rowEnd: number;
}

const { sceneJson, settings, rowStart, rowEnd } = workerData as WorkerInput;
const scene = parseScene(sceneJson);
const camera = cameraFor(scene, settings.width, settings.height);
const band = renderRows(
  scene.world,
  camera,
  scene.background,
  settings,
  rowStart,
  rowEnd,
  scene.lights.count > 0 ? scene.lights : undefined,
);
const buffer = band.buffer as ArrayBuffer;
parentPort?.postMessage({ rowStart, buffer }, [buffer]);
