/**
 * Environment (image-based) lighting: an infinite-domain light that
 * surrounds the scene and can be importance-sampled by next-event
 * estimation. It exposes the same solid-angle sampling shape as AreaLight
 * (pdfValue / sampleTowards, both origin-independent because the light is
 * at infinity) plus the radiance a ray escaping in a direction receives -
 * so the miss shader and the light sampler are one object and cannot
 * disagree.
 */
import { normalize, scale, vec3, type Vec3 } from './vec3.js';
import type { Rng } from './rng.js';
import { randomUnitVector } from './sampling.js';
import { decodeHdr } from './hdr.js';

export interface EnvironmentLight {
  /** Solid-angle pdf of sampling unit direction `dir` (origin is ignored). */
  pdfValue(origin: Vec3, dir: Vec3): number;
  /** Sample a unit direction toward the environment. */
  sampleTowards(origin: Vec3, rng: Rng): Vec3;
  /** Radiance arriving from direction `dir` (need not be unit length). */
  radiance(dir: Vec3): Vec3;
}

/**
 * A constant-radiance environment (the furnace-test light): every direction
 * carries the same radiance, so uniform sphere sampling with the exact pdf
 * 1/(4 pi) is optimal.
 */
export class ConstantEnvironment implements EnvironmentLight {
  readonly color: Vec3;

  constructor(color: Vec3, intensity = 1) {
    this.color = scale(color, intensity);
  }

  pdfValue(_origin: Vec3, _dir: Vec3): number {
    return 1 / (4 * Math.PI);
  }

  sampleTowards(_origin: Vec3, rng: Rng): Vec3 {
    return randomUnitVector(rng);
  }

  radiance(_dir: Vec3): Vec3 {
    return this.color;
  }
}

/**
 * An equirectangular HDR environment map importance-sampled through a 2D
 * luminance CDF.
 *
 * Mapping: texel column x spans azimuth phi in [2 pi x/W, 2 pi (x+1)/W)
 * measured from +X toward +Z; row y spans polar theta in [pi y/H, pi (y+1)/H)
 * from +Y (row 0 is the zenith). dir = (sin t cos p, cos t, sin t sin p).
 *
 * Sampling: each texel is weighted by luminance * sin(theta_center) (the
 * solid-angle factor of the equirect parametrisation); a marginal CDF over
 * rows and a conditional CDF within each row invert two uniforms into a
 * (u, v) position, continuous within the chosen texel - exactly two RNG
 * draws, keeping the fixed deterministic draw order. The density in (u, v)
 * is piecewise-constant per texel, so
 *     pdf_omega(dir) = p_uv(texel) / (2 pi^2 sin theta)
 * (from d omega = 2 pi^2 sin theta du dv). pdfValue inverts a direction to
 * its texel and reports that same density, so MIS weights are consistent
 * with what sampleTowards actually does. A texel has pdf 0 exactly when its
 * radiance is black, so the sampler's support matches the light's.
 */
export class EnvironmentMap implements EnvironmentLight {
  private readonly rowCdf: Float64Array;
  private readonly colCdf: Float64Array; // height rows of width entries
  private readonly total: number;

  constructor(
    readonly width: number,
    readonly height: number,
    /** Row-major linear RGB, top row (zenith) first. */
    private readonly pixels: Float64Array,
    readonly intensity = 1,
  ) {
    if (pixels.length !== width * height * 3) {
      throw new Error(`environment map pixel length ${pixels.length} != ${width * height * 3}`);
    }
    this.rowCdf = new Float64Array(height);
    this.colCdf = new Float64Array(width * height);
    let total = 0;
    for (let y = 0; y < height; y++) {
      const sinTheta = Math.sin((Math.PI * (y + 0.5)) / height);
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        const lum = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
        rowSum += lum * sinTheta;
        this.colCdf[y * width + x] = rowSum;
      }
      total += rowSum;
      this.rowCdf[y] = total;
    }
    if (!(total > 0)) throw new Error('environment map has no energy (all texels black)');
    this.total = total;
  }

  static fromHdr(bytes: Uint8Array, intensity = 1): EnvironmentMap {
    const d = decodeHdr(bytes);
    return new EnvironmentMap(d.width, d.height, d.pixels, intensity);
  }

  /** Weight (unnormalised sampling mass) of texel (x, y). */
  private texelWeight(x: number, y: number): number {
    const base = y * this.width + x;
    const prev = x > 0 ? this.colCdf[base - 1]! : 0;
    return this.colCdf[base]! - prev;
  }

  radiance(dir: Vec3): Vec3 {
    const { x, y } = this.texelOf(normalize(dir));
    const i = (y * this.width + x) * 3;
    return scale(vec3(this.pixels[i]!, this.pixels[i + 1]!, this.pixels[i + 2]!), this.intensity);
  }

  /** Map a unit direction to its texel indices. */
  private texelOf(d: Vec3): { x: number; y: number; sinTheta: number } {
    const cosTheta = Math.min(1, Math.max(-1, d.y));
    const theta = Math.acos(cosTheta);
    let phi = Math.atan2(d.z, d.x);
    if (phi < 0) phi += 2 * Math.PI;
    const x = Math.min(this.width - 1, Math.floor((phi / (2 * Math.PI)) * this.width));
    const y = Math.min(this.height - 1, Math.floor((theta / Math.PI) * this.height));
    return { x, y, sinTheta: Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta)) };
  }

  pdfValue(_origin: Vec3, dir: Vec3): number {
    const { x, y, sinTheta } = this.texelOf(normalize(dir));
    if (sinTheta <= 0) return 0; // exact pole: a measure-zero direction
    const weight = this.texelWeight(x, y);
    if (weight <= 0) return 0;
    // p_uv = weight / total * (W * H) over the unit square, then the
    // area-measure change d omega = 2 pi^2 sin theta du dv.
    return (weight * this.width * this.height) / (this.total * 2 * Math.PI * Math.PI * sinTheta);
  }

  sampleTowards(_origin: Vec3, rng: Rng): Vec3 {
    // Invert the marginal row CDF, continuous within the row...
    const targetRow = rng.float() * this.total;
    const y = lowerBound(this.rowCdf, 0, this.height, targetRow);
    const rowStart = y > 0 ? this.rowCdf[y - 1]! : 0;
    const rowSum = this.rowCdf[y]! - rowStart;
    // ...then the conditional column CDF within that row.
    const targetCol = rng.float() * rowSum;
    const x = lowerBound(this.colCdf, y * this.width, this.width, targetCol);
    const colStart = x > 0 ? this.colCdf[y * this.width + x - 1]! : 0;
    const weight = this.colCdf[y * this.width + x]! - colStart;
    // Continuous position inside the texel from the CDF residuals (no extra
    // RNG draws; keeps the pdf piecewise-constant per texel).
    const du = weight > 0 ? Math.min(0.9999999, (targetCol - colStart) / weight) : 0.5;
    const dv = rowSum > 0 ? Math.min(0.9999999, (targetRow - rowStart) / rowSum) : 0.5;
    const theta = (Math.PI * (y + dv)) / this.height;
    const phi = (2 * Math.PI * (x + du)) / this.width;
    const sinTheta = Math.sin(theta);
    return vec3(sinTheta * Math.cos(phi), Math.cos(theta), sinTheta * Math.sin(phi));
  }
}

/**
 * First index i in [offset, offset + count) with cdf[i] > target (clamped to
 * the last index): binary search over a cumulative array.
 */
function lowerBound(cdf: Float64Array, offset: number, count: number, target: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[offset + mid]! > target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
