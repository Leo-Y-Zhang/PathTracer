import { cross, dot, normalize, sub, vec3, type Vec3 } from '../vec3.js';
import { at, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import type { Material } from '../materials.js';

const DET_EPS = 1e-12;
const PAD = 1e-4;

/** Triangle intersected with the Moller-Trumbore algorithm (double-sided). */
export class Triangle implements Hittable {
  constructor(
    readonly v0: Vec3,
    readonly v1: Vec3,
    readonly v2: Vec3,
    readonly material: Material,
  ) {}

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    const e1 = sub(this.v1, this.v0);
    const e2 = sub(this.v2, this.v0);
    const p = cross(r.dir, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < DET_EPS) return null; // parallel or degenerate

    const invDet = 1 / det;
    const s = sub(r.origin, this.v0);
    const u = dot(s, p) * invDet;
    if (u < 0 || u > 1) return null;

    const q = cross(s, e1);
    const v = dot(r.dir, q) * invDet;
    if (v < 0 || u + v > 1) return null;

    const t = dot(e2, q) * invDet;
    if (t < tMin || t > tMax) return null;

    const outward = normalize(cross(e1, e2));
    const { normal, frontFace } = faceNormal(r.dir, outward);
    // Barycentric (u, v) double as default texture coordinates.
    return { t, point: at(r, t), normal, frontFace, material: this.material, uv: { u, v } };
  }

  boundingBox(): AABB {
    const min = vec3(
      Math.min(this.v0.x, this.v1.x, this.v2.x) - PAD,
      Math.min(this.v0.y, this.v1.y, this.v2.y) - PAD,
      Math.min(this.v0.z, this.v1.z, this.v2.z) - PAD,
    );
    const max = vec3(
      Math.max(this.v0.x, this.v1.x, this.v2.x) + PAD,
      Math.max(this.v0.y, this.v1.y, this.v2.y) + PAD,
      Math.max(this.v0.z, this.v1.z, this.v2.z) + PAD,
    );
    return new AABB(min, max);
  }
}
