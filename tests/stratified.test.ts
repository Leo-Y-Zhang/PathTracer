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
});
