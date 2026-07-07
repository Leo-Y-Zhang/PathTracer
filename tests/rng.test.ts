import { describe, expect, it } from 'vitest';
import { Rng, pixelRng } from '../src/rng.js';

describe('Rng (xorshift128)', () => {
  it('is deterministic: same seed gives the same sequence', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.nextU32()).toBe(b.nextU32());
    }
  });

  it('different seeds give different sequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 20; i++) {
      if (a.nextU32() === b.nextU32()) same++;
    }
    expect(same).toBeLessThan(3);
  });

  it('floats are always in [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('float mean is close to 0.5 (uniformity smoke check)', () => {
    const rng = new Rng(123);
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += rng.float();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it('survives a zero seed (state never all-zero)', () => {
    const rng = new Rng(0);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(rng.nextU32());
    expect(seen.size).toBeGreaterThan(90);
  });
});

describe('pixelRng', () => {
  it('is a pure function of (x, y, sample, seed)', () => {
    expect(pixelRng(3, 5, 0, 7).nextU32()).toBe(pixelRng(3, 5, 0, 7).nextU32());
    expect(pixelRng(120, 99, 42, 1).float()).toBe(pixelRng(120, 99, 42, 1).float());
  });

  it('decorrelates neighbouring pixels, samples, and seeds', () => {
    const base = pixelRng(10, 10, 0, 1).nextU32();
    expect(pixelRng(11, 10, 0, 1).nextU32()).not.toBe(base);
    expect(pixelRng(10, 11, 0, 1).nextU32()).not.toBe(base);
    expect(pixelRng(10, 10, 1, 1).nextU32()).not.toBe(base);
    expect(pixelRng(10, 10, 0, 2).nextU32()).not.toBe(base);
  });

  it('does not collide (x,y) with (y,x) hashes', () => {
    expect(pixelRng(2, 9, 0, 1).nextU32()).not.toBe(pixelRng(9, 2, 0, 1).nextU32());
  });
});
