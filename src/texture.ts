import type { Vec3 } from './vec3.js';

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
