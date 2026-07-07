import { axis, axisVec, type Vec3 } from '../vec3.js';
import { at, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import type { Material } from '../materials.js';

/**
 * Axis-aligned solid box. Slab intersection that also tracks which face the
 * ray enters (or exits, when the origin is inside), so the hit normal is the
 * outward normal of that face.
 */
export class Box implements Hittable {
  constructor(
    readonly min: Vec3,
    readonly max: Vec3,
    readonly material: Material,
  ) {}

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    let tEnter = -Infinity;
    let tExit = Infinity;
    let enterAxis = 0;
    let enterMinFace = true;
    let exitAxis = 0;
    let exitMinFace = false;

    for (let a = 0; a < 3; a++) {
      const o = axis(r.origin, a);
      const invD = 1 / axis(r.dir, a);
      let t0 = (axis(this.min, a) - o) * invD;
      let t1 = (axis(this.max, a) - o) * invD;
      let nearIsMinFace = true;
      if (invD < 0) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
        nearIsMinFace = false;
      }
      if (t0 > tEnter) {
        tEnter = t0;
        enterAxis = a;
        enterMinFace = nearIsMinFace;
      }
      if (t1 < tExit) {
        tExit = t1;
        exitAxis = a;
        exitMinFace = !nearIsMinFace;
      }
      if (tExit <= tEnter) return null;
    }

    let t: number;
    let faceAxis: number;
    let minFace: boolean;
    if (tEnter > tMin && tEnter < tMax) {
      t = tEnter;
      faceAxis = enterAxis;
      minFace = enterMinFace;
    } else if (tExit > tMin && tExit < tMax) {
      t = tExit;
      faceAxis = exitAxis;
      minFace = exitMinFace;
    } else {
      return null;
    }

    const outward = axisVec(faceAxis, minFace ? -1 : 1);
    const { normal, frontFace } = faceNormal(r.dir, outward);
    return { t, point: at(r, t), normal, frontFace, material: this.material };
  }

  boundingBox(): AABB {
    return new AABB(this.min, this.max);
  }
}
