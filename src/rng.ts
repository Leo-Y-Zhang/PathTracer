/**
 * Deterministic pseudo-random numbers, implemented from scratch (no
 * dependencies, no Math.random). The generator is xorshift128 (Marsaglia
 * 2003): four 32-bit words of state, period 2^128 - 1. State is expanded
 * from a single 32-bit seed with a splitmix-style avalanche hash so that
 * consecutive seeds produce uncorrelated streams.
 *
 * Every pixel sample gets its own stream, seeded from (x, y, sampleIndex,
 * globalSeed). This makes rendering fully deterministic: the same CLI
 * invocation always produces byte-identical output, independent of pixel
 * traversal order.
 */

/** One splitmix32-style avalanche step: maps a 32-bit int to a well-mixed 32-bit int. */
function mix32(x: number): number {
  let t = (x ^ (x >>> 16)) >>> 0;
  t = Math.imul(t, 0x21f0aaad) >>> 0;
  t = (t ^ (t >>> 15)) >>> 0;
  t = Math.imul(t, 0x735a2d97) >>> 0;
  return (t ^ (t >>> 15)) >>> 0;
}

/** Fold a value into a running 32-bit hash (boost::hash_combine flavour). */
export function hashCombine(h: number, v: number): number {
  const k = (v + 0x9e3779b9 + (((h << 6) >>> 0) + (h >>> 2))) >>> 0;
  return ((h ^ mix32(k)) >>> 0);
}

const GOLDEN = 0x9e3779b9;

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    let s = seed >>> 0;
    s = (s + GOLDEN) >>> 0;
    this.s0 = mix32(s);
    s = (s + GOLDEN) >>> 0;
    this.s1 = mix32(s);
    s = (s + GOLDEN) >>> 0;
    this.s2 = mix32(s);
    s = (s + GOLDEN) >>> 0;
    this.s3 = mix32(s);
    // xorshift must never have an all-zero state.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x1badf00d;
  }

  /** Next 32-bit unsigned integer. */
  nextU32(): number {
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    t = (t ^ (t << 11)) >>> 0;
    t = (t ^ (t >>> 8)) >>> 0;
    this.s0 = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.s0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }
}

/** Per-sample RNG: seeded purely from pixel coordinates, sample index, and the global seed. */
export function pixelRng(x: number, y: number, sample: number, seed: number): Rng {
  let h = 0x811c9dc5;
  h = hashCombine(h, seed >>> 0);
  h = hashCombine(h, x >>> 0);
  h = hashCombine(h, y >>> 0);
  h = hashCombine(h, sample >>> 0);
  return new Rng(h);
}
