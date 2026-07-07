import { add, dot, scale, sub, vec3, type Vec3 } from '../vec3.js';
import { at, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import type { Material } from '../materials.js';

export class Sphere implements Hittable {
  constructor(
    readonly center: Vec3,
    readonly radius: number,
    readonly material: Material,
  ) {}

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    const oc = sub(r.origin, this.center);
    const a = dot(r.dir, r.dir);
    const halfB = dot(oc, r.dir);
    const c = dot(oc, oc) - this.radius * this.radius;
    const discriminant = halfB * halfB - a * c;
    if (discriminant < 0) return null;
    const sqrtD = Math.sqrt(discriminant);

    let root = (-halfB - sqrtD) / a;
    if (root < tMin || root > tMax) {
      root = (-halfB + sqrtD) / a;
      if (root < tMin || root > tMax) return null;
    }

    const point = at(r, root);
    const outward = scale(sub(point, this.center), 1 / this.radius);
    const { normal, frontFace } = faceNormal(r.dir, outward);
    return { t: root, point, normal, frontFace, material: this.material };
  }

  boundingBox(): AABB {
    const rv = vec3(Math.abs(this.radius), Math.abs(this.radius), Math.abs(this.radius));
    return new AABB(sub(this.center, rv), add(this.center, rv));
  }
}
