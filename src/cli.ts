#!/usr/bin/env node
/**
 * Helios CLI.
 *
 *   node dist/cli.js render <scene.json> [--out file.png] [--spp N]
 *                    [--seed N] [--width N] [--height N] [--max-depth N]
 *
 * Flags default to the scene's "render" block. Giving --width without
 * --height keeps the scene's aspect ratio. Progress goes to stderr; the
 * only file written is the PNG at --out.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseScene } from './scene.js';
import { Camera } from './camera.js';
import { renderScene } from './integrator.js';
import { encodePng, toneMap } from './png.js';

const USAGE = `usage: helios render <scene.json> [options]

options:
  --out <file.png>   output path (default: renders/<scene name>.png)
  --spp <n>          samples per pixel (default: scene render.spp)
  --seed <n>         RNG seed (default: scene render.seed)
  --width <n>        image width (height scales to keep scene aspect unless --height given)
  --height <n>       image height
  --max-depth <n>    maximum path length (default: scene render.maxDepth)
`;

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function parseIntFlag(value: string | undefined, name: string): number {
  if (value === undefined) fail(`missing value for --${name}`);
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(`--${name} must be a positive integer, got "${value}"`);
  return n;
}

export function main(argv: readonly string[]): void {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stderr.write(USAGE);
    process.exit(args.length === 0 ? 1 : 0);
  }
  if (args[0] !== 'render') fail(`unknown command "${args[0]}"\n${USAGE}`);
  const scenePath = args[1];
  if (!scenePath || scenePath.startsWith('--')) fail(`missing scene file\n${USAGE}`);

  const flags = new Map<string, string>();
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i]!;
    if (!key.startsWith('--')) fail(`unexpected argument "${key}"`);
    const value = args[i + 1];
    if (value === undefined) fail(`missing value for ${key}`);
    flags.set(key.slice(2), value);
  }

  let sceneJson: unknown;
  try {
    sceneJson = JSON.parse(readFileSync(scenePath, 'utf8'));
  } catch (err) {
    fail(`cannot read scene "${scenePath}": ${err instanceof Error ? err.message : String(err)}`);
  }

  const scene = parseScene(sceneJson);
  const d = scene.defaults;

  const widthFlag = flags.get('width');
  const heightFlag = flags.get('height');
  const width = widthFlag !== undefined ? parseIntFlag(widthFlag, 'width') : d.width;
  const height =
    heightFlag !== undefined
      ? parseIntFlag(heightFlag, 'height')
      : widthFlag !== undefined
        ? Math.max(1, Math.round((width * d.height) / d.width))
        : d.height;
  const spp = flags.has('spp') ? parseIntFlag(flags.get('spp'), 'spp') : d.spp;
  const seed = flags.has('seed') ? parseIntFlag(flags.get('seed'), 'seed') : d.seed;
  const maxDepth = flags.has('max-depth') ? parseIntFlag(flags.get('max-depth'), 'max-depth') : d.maxDepth;
  const out = flags.get('out') ?? `renders/${scene.name}.png`;

  const camera = new Camera({
    position: scene.camera.position,
    lookAt: scene.camera.lookAt,
    up: scene.camera.up,
    vfovDegrees: scene.camera.vfovDegrees,
    aspect: width / height,
    aperture: scene.camera.aperture,
    ...(scene.camera.focusDist !== undefined ? { focusDist: scene.camera.focusDist } : {}),
  });

  process.stderr.write(
    `${scene.name}: ${width}x${height}, ${spp} spp, seed ${seed}, ${scene.objectCount} objects\n`,
  );
  const started = Date.now();
  const step = Math.max(1, Math.floor(height / 25));
  const img = renderScene(
    scene.world,
    camera,
    scene.background,
    { width, height, spp, maxDepth, seed },
    (row, rows) => {
      if (row % step === 0 || row === rows) {
        const pct = ((100 * row) / rows).toFixed(0);
        process.stderr.write(`\r${scene.name}: ${pct}% (${row}/${rows} rows)`);
      }
    },
    scene.lights,
  );

  const png = encodePng(width, height, toneMap(img, scene.defaults.toneMapping, scene.defaults.exposure));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(`\nwrote ${out} (${png.length} bytes) in ${secs}s\n`);
}

main(process.argv);
