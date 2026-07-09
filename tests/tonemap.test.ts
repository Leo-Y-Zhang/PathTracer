import { describe, expect, it } from 'vitest';
import { GAMMA, toneMap } from '../src/png.js';

const g = (linear: number): number => Math.round(255 * Math.pow(Math.min(1, Math.max(0, linear)), 1 / GAMMA));

describe('toneMap', () => {
  it('linear (default) clips then gamma-encodes, matching the original behaviour', () => {
    expect(toneMap(new Float64Array([0, 0.5, 1, 5]))).toEqual(
      new Uint8Array([g(0), g(0.5), g(1), 255]),
    );
  });

  it('maps NaN to 0', () => {
    expect(toneMap(new Float64Array([NaN]))[0]).toBe(0);
  });

  it('reinhard is monotonic and never clips finite radiance to pure white', () => {
    expect(toneMap(new Float64Array([0]), 'reinhard')[0]).toBe(0);
    const lo = toneMap(new Float64Array([0.2]), 'reinhard')[0]!;
    const hi = toneMap(new Float64Array([2]), 'reinhard')[0]!;
    expect(hi).toBeGreaterThan(lo);
    expect(toneMap(new Float64Array([50]), 'reinhard')[0]!).toBeLessThan(255);
  });

  it('aces maps 0 to 0, is monotonic, and drives bright values toward white', () => {
    expect(toneMap(new Float64Array([0]), 'aces')[0]).toBe(0);
    const lo = toneMap(new Float64Array([0.3]), 'aces')[0]!;
    const hi = toneMap(new Float64Array([3]), 'aces')[0]!;
    expect(hi).toBeGreaterThan(lo);
    expect(toneMap(new Float64Array([10]), 'aces')[0]!).toBeGreaterThan(245);
  });

  it('exposure scales radiance before the operator', () => {
    const dim = toneMap(new Float64Array([0.25]), 'reinhard', 1)[0]!;
    const bright = toneMap(new Float64Array([0.25]), 'reinhard', 4)[0]!;
    expect(bright).toBeGreaterThan(dim);
  });
});
