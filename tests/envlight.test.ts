import { describe, expect, it } from 'vitest';
import { length, vec3, type Vec3 } from '../src/vec3.js';
import { Rng } from '../src/rng.js';
import { randomUnitVector } from '../src/sampling.js';
import { encodeHdr } from '../src/hdr.js';
import { ConstantEnvironment, EnvironmentMap, type EnvironmentLight } from '../src/envlight.js';

const ORIGIN = vec3(0, 0, 0);

/** Build an equirect map from a per-texel radiance function (x, y) -> [r,g,b]. */
function makeMap(
  width: number,
  height: number,
  f: (x: number, y: number) => [number, number, number],
  intensity = 1,
): EnvironmentMap {
  const px = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = f(x, y);
      const i = (y * width + x) * 3;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
  return new EnvironmentMap(width, height, px, intensity);
}

/** A directional "sun + sky" test map: a bright block plus a dim floor. */
function sunMap(): EnvironmentMap {
  return makeMap(16, 8, (x, y) => (x >= 4 && x < 6 && y >= 2 && y < 4 ? [40, 38, 30] : [0.2, 0.3, 0.5]));
}

/** Independent uniform-direction estimate of integral f(dir) d omega. */
function integrateUniform(f: (d: Vec3) => number, rng: Rng, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(randomUnitVector(rng));
  return (sum / n) * 4 * Math.PI;
}

/** The light's own estimate of integral f d omega: mean of f/pdf over its samples. */
function integrateBySampling(env: EnvironmentLight, f: (d: Vec3) => number, rng: Rng, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const dir = env.sampleTowards(ORIGIN, rng);
    const pdf = env.pdfValue(ORIGIN, dir);
    expect(pdf).toBeGreaterThan(0); // sampled directions must be in the pdf's support
    sum += f(dir) / pdf;
  }
  return sum / n;
}

function luminance(c: Vec3): number {
  return 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z;
}

describe('ConstantEnvironment', () => {
  it('has the exact uniform-sphere pdf 1/(4 pi) and unit-length samples', () => {
    const env = new ConstantEnvironment(vec3(1, 1, 1));
    const rng = new Rng(1);
    for (let i = 0; i < 100; i++) {
      const d = env.sampleTowards(ORIGIN, rng);
      expect(length(d)).toBeCloseTo(1, 12);
      expect(env.pdfValue(ORIGIN, d)).toBeCloseTo(1 / (4 * Math.PI), 15);
    }
  });

  it('scales radiance by intensity', () => {
    const env = new ConstantEnvironment(vec3(0.5, 0.25, 1), 4);
    expect(env.radiance(vec3(0, 1, 0))).toEqual(vec3(2, 1, 4));
  });
});

describe('EnvironmentMap pdf (validated against independent estimates)', () => {
  it('the pdf integrates to exactly 1 (texel-aligned midpoint quadrature)', () => {
    // pdf * sin(theta) is piecewise-constant per texel, so a midpoint rule
    // whose cells subdivide the texels integrates it EXACTLY - this is a
    // deterministic check of the normalisation, not a statistical one.
    const env = sunMap();
    const k = 8;
    const gt = 8 * k;
    const gp = 16 * k;
    let integral = 0;
    for (let it = 0; it < gt; it++) {
      const theta = (Math.PI * (it + 0.5)) / gt;
      for (let ip = 0; ip < gp; ip++) {
        const phi = (2 * Math.PI * (ip + 0.5)) / gp;
        const d = vec3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
        integral += env.pdfValue(ORIGIN, d) * Math.sin(theta) * (Math.PI / gt) * ((2 * Math.PI) / gp);
      }
    }
    expect(integral).toBeCloseTo(1, 9);
  });

  it('a uniform-direction Monte Carlo estimate of the pdf integral agrees', () => {
    // Independent stochastic cross-check of the same integral. The sun
    // texels give the integrand high variance: at 400k samples the standard
    // error is ~0.0065, so 0.03 is a ~4.6 sigma bound.
    const env = sunMap();
    const estimate = integrateUniform((d) => env.pdfValue(ORIGIN, d), new Rng(2), 400000);
    expect(Math.abs(estimate - 1)).toBeLessThan(0.03);
  });

  it('the sampled radiance integral matches an independent uniform-direction estimate', () => {
    const env = sunMap();
    const byUniform = integrateUniform((d) => luminance(env.radiance(d)), new Rng(3), 400000);
    const bySampling = integrateBySampling(env, (d) => luminance(env.radiance(d)), new Rng(4), 40000);
    expect(Math.abs(byUniform - bySampling) / byUniform).toBeLessThan(0.05);
  });

  it('sample and pdf are mutually consistent: E[1/pdf] over samples is 4 pi', () => {
    // Only true when every texel has energy (full support), so use a map
    // with a floor everywhere. Any mismatch between the CDF the sampler
    // draws from and the density pdfValue reports breaks this identity.
    // 1/pdf is heavy-tailed here (std err ~0.046 at 400k): 2% is >5 sigma.
    const env = sunMap();
    const estimate = integrateBySampling(env, () => 1, new Rng(5), 400000);
    expect(Math.abs(estimate - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.02);
  });

  it('importance concentrates samples in the bright region', () => {
    const env = sunMap();
    const rng = new Rng(6);
    let bright = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const d = env.sampleTowards(ORIGIN, rng);
      if (luminance(env.radiance(d)) > 1) bright++;
    }
    // The sun block is 4 of 128 texels (~4.7% of solid angle near the pole
    // band) but carries most of the energy; importance sampling must send
    // the majority of samples there.
    expect(bright / n).toBeGreaterThan(0.5);
  });

  it('samples are unit length and pdfValue is origin-independent', () => {
    const env = sunMap();
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) {
      const d = env.sampleTowards(vec3(3, -2, 9), rng);
      expect(length(d)).toBeCloseTo(1, 12);
      expect(env.pdfValue(vec3(5, 5, 5), d)).toBe(env.pdfValue(ORIGIN, d));
    }
  });

  it('a black texel has pdf 0 (support matches the radiance)', () => {
    // Bright top hemisphere rows, black bottom rows.
    const env = makeMap(8, 4, (_x, y) => (y < 2 ? [1, 1, 1] : [0, 0, 0]));
    expect(env.pdfValue(ORIGIN, vec3(0, -1, 0.2))).toBe(0);
    expect(env.pdfValue(ORIGIN, vec3(0.2, 1, 0))).toBeGreaterThan(0);
  });

  it('radiance looks up the correct texel for cardinal directions', () => {
    // Distinct colours per row band: zenith row vs nadir row.
    const env = makeMap(8, 4, (_x, y) => [y, 2 * y, 1]);
    expect(env.radiance(vec3(0, 1, 0)).x).toBe(0); // zenith -> row 0
    expect(env.radiance(vec3(0, -1, 0)).x).toBe(3); // nadir -> row 3
    // The equator theta = pi/2 is the boundary between rows 1 and 2; rows
    // span [pi y/H, pi (y+1)/H), so it belongs to row 2.
    expect(env.radiance(vec3(1, 0, 0)).x).toBe(2);
  });

  it('intensity scales radiance but leaves the pdf unchanged', () => {
    const a = sunMap();
    const b = makeMap(16, 8, (x, y) => (x >= 4 && x < 6 && y >= 2 && y < 4 ? [40, 38, 30] : [0.2, 0.3, 0.5]), 3);
    const d = vec3(0.3, 0.4, -0.2);
    expect(b.radiance(d).x).toBeCloseTo(3 * a.radiance(d).x, 12);
    expect(b.pdfValue(ORIGIN, d)).toBeCloseTo(a.pdfValue(ORIGIN, d), 15);
  });

  it('decodes straight from .hdr bytes (fromHdr)', () => {
    const px = new Float64Array(8 * 4 * 3).fill(1);
    const env = EnvironmentMap.fromHdr(encodeHdr(8, 4, px), 2);
    expect(env.width).toBe(8);
    expect(env.height).toBe(4);
    // 1.0 is exactly representable in RGBE, so the radiance is exact.
    expect(env.radiance(vec3(0, 1, 0))).toEqual(vec3(2, 2, 2));
  });

  it('rejects an all-black map (nothing to sample)', () => {
    expect(() => makeMap(4, 2, () => [0, 0, 0])).toThrow(/no energy/);
  });

  it('deterministic: the same seed reproduces the same sample sequence', () => {
    const env = sunMap();
    const a = Array.from({ length: 20 }, () => env.sampleTowards(ORIGIN, new Rng(9)).x);
    const b = Array.from({ length: 20 }, () => env.sampleTowards(ORIGIN, new Rng(9)).x);
    expect(a).toEqual(b);
  });
});
