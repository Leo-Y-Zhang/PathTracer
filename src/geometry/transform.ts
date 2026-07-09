/**
 * An affine instance transform (scale, then rotate, then translate) wrapping any
 * hittable, so geometry need not be axis-aligned. The ray is pushed into object
 * space (obj = Minv*(world - T)); the object-space direction is deliberately NOT
 * renormalised, so the child's ray parameter t is already the world-space t. The
 * hit point maps back by M*p + T and the normal by the inverse-transpose.
 */
import { add, neg, normalize, sub, vec3, type Vec3 } from '../vec3.js';
import { ray, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import {
  mat3Inverse,
  mat3Mul,
  mat3MulVec,
  mat3Transpose,
  rotationX,
  rotationY,
  rotationZ,
  scaling,
  type Mat3,
} from '../mat3.js';

export interface TransformOpts {
  translate?: Vec3;
  /** Euler rotation in degrees, applied X then Y then Z. */
  rotate?: Vec3;
  scale?: Vec3 | number;
}

export class Transform implements Hittable {
  private constructor(
    private readonly child: Hittable,
    private readonly m: Mat3,
    private readonly minv: Mat3,
    private readonly minvT: Mat3,
    private readonly t: Vec3,
  ) {}

  static build(child: Hittable, opts: TransformOpts): Transform {
    const s =
      opts.scale === undefined
        ? vec3(1, 1, 1)
        : typeof opts.scale === 'number'
          ? vec3(opts.scale, opts.scale, opts.scale)
          : opts.scale;
    const rot = opts.rotate ?? vec3(0, 0, 0);
    let m = scaling(s);
    m = mat3Mul(rotationX(rot.x), m);
    m = mat3Mul(rotationY(rot.y), m);
    m = mat3Mul(rotationZ(rot.z), m);
    const minv = mat3Inverse(m);
    return new Transform(child, m, minv, mat3Transpose(minv), opts.translate ?? vec3(0, 0, 0));
  }

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    const originObj = mat3MulVec(this.minv, sub(r.origin, this.t));
    const dirObj = mat3MulVec(this.minv, r.dir);
    const rec = this.child.hit(ray(originObj, dirObj), tMin, tMax);
    if (!rec) return null;

    const pointWorld = add(mat3MulVec(this.m, rec.point), this.t);
    // Undo the child's ray-orientation flip to recover the geometric outward
    // normal, transform it by the inverse-transpose, then re-orient in world.
    const outwardObj = rec.frontFace ? rec.normal : neg(rec.normal);
    const outwardWorld = normalize(mat3MulVec(this.minvT, outwardObj));
    const { normal, frontFace } = faceNormal(r.dir, outwardWorld);

    return rec.uv !== undefined
      ? { t: rec.t, point: pointWorld, normal, frontFace, material: rec.material, uv: rec.uv }
      : { t: rec.t, point: pointWorld, normal, frontFace, material: rec.material };
  }

  boundingBox(): AABB {
    const b = this.child.boundingBox();
    let min = vec3(Infinity, Infinity, Infinity);
    let max = vec3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      const corner = vec3(
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z,
      );
      const w = add(mat3MulVec(this.m, corner), this.t);
      min = vec3(Math.min(min.x, w.x), Math.min(min.y, w.y), Math.min(min.z, w.z));
      max = vec3(Math.max(max.x, w.x), Math.max(max.y, w.y), Math.max(max.z, w.z));
    }
    return new AABB(min, max);
  }
}
