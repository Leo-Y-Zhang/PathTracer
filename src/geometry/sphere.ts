import { add, dot, lengthSq, normalize, scale, sub, vec3, type Vec3 } from '../vec3.js';
import { at, ray, type Ray } from '../ray.js';
import { AABB } from '../aabb.js';
import { faceNormal, type HitRecord, type Hittable } from '../hittable.js';
import { orthonormalBasis, randomUnitVector } from '../sampling.js';
import type { AreaLight } from '../lights.js';
import type { Rng } from '../rng.js';
import type { Material } from '../materials.js';

/** Equirectangular texture coordinates for a unit outward normal on the sphere. */
function sphereUV(p: Vec3): { u: number; v: number } {
  const theta = Math.acos(Math.min(1, Math.max(-1, -p.y)));
  const phi = Math.atan2(-p.z, p.x) + Math.PI;
  return { u: phi / (2 * Math.PI), v: theta / Math.PI };
}

export class Sphere implements Hittable, AreaLight {
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
    return { t: root, point, normal, frontFace, material: this.material, uv: sphereUV(outward) };
  }

  boundingBox(): AABB {
    const rv = vec3(Math.abs(this.radius), Math.abs(this.radius), Math.abs(this.radius));
    return new AABB(sub(this.center, rv), add(this.center, rv));
  }

  // Area light: from outside the sphere, sample uniformly within the cone the
  // sphere subtends (efficient and exactly matched to pdfValue). From inside,
  // every direction hits, so sample a uniform direction (solid-angle pdf 1/4pi).
  pdfValue(origin: Vec3, dir: Vec3): number {
    const distSq = lengthSq(sub(this.center, origin));
    const rSq = this.radius * this.radius;
    if (distSq <= rSq) return 1 / (4 * Math.PI);
    if (!this.hit(ray(origin, dir), 1e-4, Infinity)) return 0;
    const cosThetaMax = Math.sqrt(Math.max(0, 1 - rSq / distSq));
    return 1 / (2 * Math.PI * (1 - cosThetaMax));
  }

  sampleTowards(origin: Vec3, rng: Rng): Vec3 {
    const toCenter = sub(this.center, origin);
    const distSq = lengthSq(toCenter);
    const rSq = this.radius * this.radius;
    if (distSq <= rSq) return randomUnitVector(rng);
    const dist = Math.sqrt(distSq);
    const cosThetaMax = Math.sqrt(Math.max(0, 1 - rSq / distSq));
    const u1 = rng.float();
    const u2 = rng.float();
    const cosTheta = 1 - u1 * (1 - cosThetaMax);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = 2 * Math.PI * u2;
    const onb = orthonormalBasis(scale(toCenter, 1 / dist));
    return normalize(
      add(
        add(scale(onb.u, Math.cos(phi) * sinTheta), scale(onb.v, Math.sin(phi) * sinTheta)),
        scale(onb.w, cosTheta),
      ),
    );
  }
}
