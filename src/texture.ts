import { vec3, type Vec3 } from './vec3.js';
import { GAMMA, decodePng } from './png.js';

/**
 * A spatially-varying colour, sampled at a surface's texture coordinates (and
 * world point, for solid/3D textures). Kept dependency-free and procedural;
 * an image-backed texture arrives with the in-tree PNG decoder.
 */
export interface Texture {
  sample(u: number, v: number, point: Vec3): Vec3;
}

/** A constant colour everywhere. */
export class SolidColor implements Texture {
  constructor(readonly color: Vec3) {}

  sample(_u: number, _v: number, _point: Vec3): Vec3 {
    return this.color;
  }
}

/**
 * A UV-space checkerboard of two colours. `squares` is the number of checks
 * across the [0, 1] texture range; the parity of floor(u*n)+floor(v*n) selects
 * the colour (handling negative UVs correctly).
 */
export class CheckerTexture implements Texture {
  constructor(
    readonly a: Vec3,
    readonly b: Vec3,
    readonly squares: number,
  ) {}

  sample(u: number, v: number, _point: Vec3): Vec3 {
    const s = Math.floor(u * this.squares) + Math.floor(v * this.squares);
    return (((s % 2) + 2) % 2) === 0 ? this.a : this.b;
  }
}

/**
 * An image-backed texture decoded from a PNG. UVs wrap into [0, 1); v is flipped
 * so texture row 0 is the top; nearest-neighbour lookup; the gamma-2.2-encoded
 * bytes are converted back to linear radiance (textures are authored in sRGB).
 */
export class ImageTexture implements Texture {
  private constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly channels: number,
    private readonly pixels: Uint8Array,
  ) {}

  static fromPng(bytes: Uint8Array): ImageTexture {
    const d = decodePng(bytes);
    return new ImageTexture(d.width, d.height, d.channels, d.pixels);
  }

  sample(u: number, v: number, _point: Vec3): Vec3 {
    const uu = u - Math.floor(u);
    const vv = 1 - (v - Math.floor(v));
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(uu * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(vv * this.height)));
    const i = (y * this.width + x) * this.channels;
    return vec3(
      Math.pow(this.pixels[i]! / 255, GAMMA),
      Math.pow(this.pixels[i + 1]! / 255, GAMMA),
      Math.pow(this.pixels[i + 2]! / 255, GAMMA),
    );
  }
}
