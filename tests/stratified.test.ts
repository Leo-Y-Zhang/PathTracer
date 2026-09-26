import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';
import { stratifiedOffset } from '../src/sampling.js';

describe('stratified sampling', () => {
  it('spp=16 places one jittered sample in each of the 16 grid cells', () => {
    const spp = 16;
    const gridN = 4;
    const cells = new Set<number>();
    for (let s = 0; s < spp; s++) {
      const o = stratifiedOffset(s, spp, new Rng(1000 + s));
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThan(1);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThan(1);
      expect(Math.floor(o.x * gridN)).toBe(s % gridN);
      expect(Math.floor(o.y * gridN)).toBe(Math.floor(s / gridN));
      cells.add(Math.floor(o.y * gridN) * gridN + Math.floor(o.x * gridN));
    }
    expect(cells.size).toBe(16);
  });

  it('reduces estimator variance versus pure random for a smooth integrand', () => {
    // Estimate E[x] = 0.5 over the pixel with 16 samples, many trials.
    const spp = 16;
    const trials = 500;
    let seRandom = 0;
    let seStratified = 0;
    for (let t = 0; t < trials; t++) {
      let mRandom = 0;
      let mStrat = 0;
      for (let s = 0; s < spp; s++) {
        mRandom += new Rng(t * 131 + s * 7 + 1).float();
        mStrat += stratifiedOffset(s, spp, new Rng(t * 131 + s * 7 + 2)).x;
      }
      seRandom += (mRandom / spp - 0.5) ** 2;
      seStratified += (mStrat / spp - 0.5) ** 2;
    }
    expect(seStratified / trials).toBeLessThan(seRandom / trials);
  });

  it('stays unbiased when spp is not a perfect square (the extra samples cover the whole pixel)', () => {
    // The pixel estimate is the plain mean of all spp samples, so every sample
    // index must be uniform over the pixel on average; E[offset] = (0.5, 0.5).
    // Folding the samples beyond gridN^2 back onto the first grid cells would
    // weight those cells twice and pull the mean toward the pixel's top-left
    // (spp = 5: E[x] = E[y] = 0.45; spp = 250: E[y] = 0.456).
    for (const [spp, trials] of [
      [5, 4000],
      [250, 200],
    ] as const) {
      let sx = 0;
      let sy = 0;
      for (let t = 0; t < trials; t++) {
        for (let s = 0; s < spp; s++) {
          const o = stratifiedOffset(s, spp, new Rng(t * 7919 + s * 31 + 3));
          sx += o.x;
          sy += o.y;
        }
      }
      expect(Math.abs(sx / (spp * trials) - 0.5)).toBeLessThan(0.01);
      expect(Math.abs(sy / (spp * trials) - 0.5)).toBeLessThan(0.01);
    }
  });
});
