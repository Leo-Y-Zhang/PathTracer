import { dot, neg, vec3, type Vec3 } from './vec3.js';
import type { Ray } from './ray.js';
import { AABB } from './aabb.js';
import type { Material } from './materials.js';

export interface HitRecord {
  /** Ray parameter of the hit. */
  t: number;
  point: Vec3;
  /** Unit normal, always oriented to oppose the incident ray. */
  normal: Vec3;
  /** True when the ray hit the geometric outside of the surface. */
  frontFace: boolean;
  material: Material;
  /** Surface texture coordinates in [0, 1]^2, when the geometry provides them. */
  uv?: { u: number; v: number };
}

export interface Hittable {
  hit(r: Ray, tMin: number, tMax: number): HitRecord | null;
  boundingBox(): AABB;
}

/**
 * Orient an outward geometric normal against the incident ray direction and
 * record which side was hit (needed by dielectrics to pick the IOR ratio).
 */
export function faceNormal(rayDir: Vec3, outward: Vec3): { normal: Vec3; frontFace: boolean } {
  const frontFace = dot(rayDir, outward) < 0;
  return { normal: frontFace ? outward : neg(outward), frontFace };
}

/** Brute-force container: tests every object, keeps the closest hit. */
export class HittableList implements Hittable {
  constructor(readonly objects: readonly Hittable[]) {}

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    let closest: HitRecord | null = null;
    let closestT = tMax;
    for (const obj of this.objects) {
      const rec = obj.hit(r, tMin, closestT);
      if (rec) {
        closest = rec;
        closestT = rec.t;
      }
    }
    return closest;
  }

  boundingBox(): AABB {
    if (this.objects.length === 0) return new AABB(vec3(0, 0, 0), vec3(0, 0, 0));
    let box = this.objects[0]!.boundingBox();
    for (let i = 1; i < this.objects.length; i++) {
      box = AABB.surrounding(box, this.objects[i]!.boundingBox());
    }
    return box;
  }
}
