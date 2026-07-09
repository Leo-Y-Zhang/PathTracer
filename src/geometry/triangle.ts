import { add, cross, dot, normalize, scale, sub, vec3, type Vec3 } from '../vec3.js';
import { at, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import type { Material } from '../materials.js';

const DET_EPS = 1e-12;
const PAD = 1e-4;

/**
 * Triangle intersected with the Moller-Trumbore algorithm (double-sided).
 * Optional per-vertex normals give smooth (Phong) shading and optional
 * per-vertex UVs give textured meshes; both are interpolated with the hit's
 * barycentric weights (v0, v1, v2 -> 1-u-v, u, v).
 */
export class Triangle implements Hittable {
  constructor(
    readonly v0: Vec3,
    readonly v1: Vec3,
    readonly v2: Vec3,
    readonly material: Material,
    readonly normals?: readonly [Vec3, Vec3, Vec3],
    readonly uvs?: readonly [[number, number], [number, number], [number, number]],
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

    const w0 = 1 - u - v;
    const w1 = u;
    const w2 = v;
    const geometric = normalize(cross(e1, e2));
    const shading = this.normals
      ? normalize(
          add(
            add(scale(this.normals[0], w0), scale(this.normals[1], w1)),
            scale(this.normals[2], w2),
          ),
        )
      : geometric;
    const { normal, frontFace } = faceNormal(r.dir, shading);
    const uv = this.uvs
      ? {
          u: w0 * this.uvs[0][0] + w1 * this.uvs[1][0] + w2 * this.uvs[2][0],
          v: w0 * this.uvs[0][1] + w1 * this.uvs[1][1] + w2 * this.uvs[2][1],
        }
      : { u, v };
    return { t, point: at(r, t), normal, frontFace, material: this.material, uv };
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
