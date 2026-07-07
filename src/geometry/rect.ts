import { vec3, type Vec3 } from '../vec3.js';
import { at, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import type { Material } from '../materials.js';

export type RectPlane = 'xy' | 'xz' | 'yz';

const PAD = 1e-4;

/**
 * Axis-aligned rectangle. `plane` names the two free axes; `k` is the fixed
 * coordinate on the remaining axis. (a0, b0)-(a1, b1) are the bounds on the
 * free axes in the order the plane name lists them, e.g. for 'xz' a = x, b = z.
 */
export class Rect implements Hittable {
  constructor(
    readonly plane: RectPlane,
    readonly a0: number,
    readonly b0: number,
    readonly a1: number,
    readonly b1: number,
    readonly k: number,
    readonly material: Material,
  ) {}

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    let t: number;
    let a: number;
    let b: number;
    let outward: Vec3;
    switch (this.plane) {
      case 'xy':
        if (r.dir.z === 0) return null;
        t = (this.k - r.origin.z) / r.dir.z;
        a = r.origin.x + t * r.dir.x;
        b = r.origin.y + t * r.dir.y;
        outward = vec3(0, 0, 1);
        break;
      case 'xz':
        if (r.dir.y === 0) return null;
        t = (this.k - r.origin.y) / r.dir.y;
        a = r.origin.x + t * r.dir.x;
        b = r.origin.z + t * r.dir.z;
        outward = vec3(0, 1, 0);
        break;
      case 'yz':
        if (r.dir.x === 0) return null;
        t = (this.k - r.origin.x) / r.dir.x;
        a = r.origin.y + t * r.dir.y;
        b = r.origin.z + t * r.dir.z;
        outward = vec3(1, 0, 0);
        break;
    }
    if (t < tMin || t > tMax) return null;
    if (a < this.a0 || a > this.a1 || b < this.b0 || b > this.b1) return null;
    const { normal, frontFace } = faceNormal(r.dir, outward);
    return { t, point: at(r, t), normal, frontFace, material: this.material };
  }

  boundingBox(): AABB {
    switch (this.plane) {
      case 'xy':
        return new AABB(vec3(this.a0, this.b0, this.k - PAD), vec3(this.a1, this.b1, this.k + PAD));
      case 'xz':
        return new AABB(vec3(this.a0, this.k - PAD, this.b0), vec3(this.a1, this.k + PAD, this.b1));
      case 'yz':
        return new AABB(vec3(this.k - PAD, this.a0, this.b0), vec3(this.k + PAD, this.a1, this.b1));
    }
  }
}
