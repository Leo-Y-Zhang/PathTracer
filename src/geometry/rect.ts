import { dot, lengthSq, normalize, sub, vec3, type Vec3 } from '../vec3.js';
import { at, ray, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import type { AreaLight } from '../lights.js';
import type { Rng } from '../rng.js';
import type { Material } from '../materials.js';

export type RectPlane = 'xy' | 'xz' | 'yz';

const PAD = 1e-4;

/**
 * Axis-aligned rectangle. `plane` names the two free axes; `k` is the fixed
 * coordinate on the remaining axis. (a0, b0)-(a1, b1) are the bounds on the
 * free axes in the order the plane name lists them, e.g. for 'xz' a = x, b = z.
 */
export class Rect implements Hittable, AreaLight {
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

  /** Surface area of the rectangle. */
  private area(): number {
    return (this.a1 - this.a0) * (this.b1 - this.b0);
  }

  /** World-space point for free-axis coordinates (a, b) in this plane. */
  private pointAt(a: number, b: number): Vec3 {
    switch (this.plane) {
      case 'xy':
        return vec3(a, b, this.k);
      case 'xz':
        return vec3(a, this.k, b);
      case 'yz':
        return vec3(this.k, a, b);
    }
  }

  // Area light: sample a uniform point on the rectangle and aim at it; the
  // solid-angle pdf converts the uniform-area density 1/area by the standard
  // dA->dw Jacobian dist^2 / cos(theta_light).
  pdfValue(origin: Vec3, dir: Vec3): number {
    const rec = this.hit(ray(origin, dir), 1e-4, Infinity);
    if (!rec) return 0;
    const d = sub(rec.point, origin);
    const distSq = lengthSq(d);
    const cos = Math.abs(dot(normalize(d), rec.normal));
    if (cos < 1e-8) return 0;
    return distSq / (cos * this.area());
  }

  sampleTowards(origin: Vec3, rng: Rng): Vec3 {
    const a = rng.range(this.a0, this.a1);
    const b = rng.range(this.b0, this.b1);
    return normalize(sub(this.pointAt(a, b), origin));
  }
}
