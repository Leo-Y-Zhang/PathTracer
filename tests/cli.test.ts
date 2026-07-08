import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG_SIGNATURE } from '../src/png.js';

const CLI = 'dist/cli.js';

function run(args: string[]): { status: number | null; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: res.status, stderr: res.stderr };
}

describe('CLI end-to-end (requires npm run build)', () => {
  it('renders a tiny scene to a valid PNG with the requested dimensions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helios-'));
    try {
      const out = join(dir, 'tiny.png');
      const { status, stderr } = run([
        'render', 'tests/fixtures/tiny.json', '--out', out, '--spp', '2', '--seed', '7', '--width', '20',
      ]);
      expect(status).toBe(0);
      expect(stderr).toContain('tiny');
      expect(stderr).toContain('wrote');
      const png = readFileSync(out);
      expect([...png.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
      // IHDR dims: width at byte 16, height at byte 20. --width 20 on a
      // 32x24 scene keeps the aspect ratio -> 20x15.
      expect(png.readUInt32BE(16)).toBe(20);
      expect(png.readUInt32BE(20)).toBe(15);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('two identical invocations write byte-identical files (equal SHA-256)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helios-'));
    try {
      const outA = join(dir, 'a.png');
      const outB = join(dir, 'b.png');
      const args = ['render', 'tests/fixtures/tiny.json', '--spp', '3', '--seed', '42', '--width', '24'];
      expect(run([...args, '--out', outA]).status).toBe(0);
      expect(run([...args, '--out', outB]).status).toBe(0);
      const hashA = createHash('sha256').update(readFileSync(outA)).digest('hex');
      const hashB = createHash('sha256').update(readFileSync(outB)).digest('hex');
      expect(hashA).toBe(hashB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with usage on a missing scene argument', () => {
    const { status, stderr } = run(['render']);
    expect(status).toBe(1);
    expect(stderr).toContain('missing scene file');
  });

  it('fails on an unknown command', () => {
    const { status, stderr } = run(['paint', 'x.json']);
    expect(status).toBe(1);
    expect(stderr).toContain('unknown command');
  });

  it('fails cleanly on a nonexistent scene file', () => {
    const { status, stderr } = run(['render', 'no-such-scene.json']);
    expect(status).toBe(1);
    expect(stderr).toContain('cannot read scene');
  });

  it('rejects a non-integer --spp', () => {
    const { status, stderr } = run(['render', 'tests/fixtures/tiny.json', '--spp', 'lots']);
    expect(status).toBe(1);
    expect(stderr).toContain('--spp');
  });
});
