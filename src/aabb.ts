import { axis, scale, add, vec3, type Vec3 } from './vec3.js';
import type { Ray } from './ray.js';

/** Axis-aligned bounding box with the standard slab intersection test. */
export class AABB {
  constructor(
    readonly min: Vec3,
    readonly max: Vec3,
  ) {}

  /** True if the ray intersects the box anywhere in (tMin, tMax). */
  hit(r: Ray, tMin: number, tMax: number): boolean {
    for (let a = 0; a < 3; a++) {
      const invD = 1 / axis(r.dir, a);
      let t0 = (axis(this.min, a) - axis(r.origin, a)) * invD;
      let t1 = (axis(this.max, a) - axis(r.origin, a)) * invD;
      if (invD < 0) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tMin) tMin = t0;
      if (t1 < tMax) tMax = t1;
      if (tMax <= tMin) return false;
    }
    return true;
  }

  centroid(): Vec3 {
    return scale(add(this.min, this.max), 0.5);
  }

  /** Index of the longest side (0 = x, 1 = y, 2 = z). */
  longestAxis(): number {
    const ex = this.max.x - this.min.x;
    const ey = this.max.y - this.min.y;
    const ez = this.max.z - this.min.z;
    if (ex >= ey && ex >= ez) return 0;
    return ey >= ez ? 1 : 2;
  }

  static surrounding(a: AABB, b: AABB): AABB {
    return new AABB(
      vec3(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y), Math.min(a.min.z, b.min.z)),
      vec3(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y), Math.max(a.max.z, b.max.z)),
    );
  }
}
