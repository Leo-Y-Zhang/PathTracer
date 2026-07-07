import { add, scale, type Vec3 } from './vec3.js';

export interface Ray {
  readonly origin: Vec3;
  readonly dir: Vec3;
}

export function ray(origin: Vec3, dir: Vec3): Ray {
  return { origin, dir };
}

/** Point along the ray at parameter t. */
export function at(r: Ray, t: number): Vec3 {
  return add(r.origin, scale(r.dir, t));
}
