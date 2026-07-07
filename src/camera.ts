import {
  add,
  cross,
  length,
  normalize,
  scale,
  sub,
  vec3,
  type Vec3,
} from './vec3.js';
import { ray, type Ray } from './ray.js';
import { randomInUnitDisk } from './sampling.js';
import type { Rng } from './rng.js';

export interface CameraOptions {
  position: Vec3;
  lookAt: Vec3;
  /** Defaults to +Y. */
  up?: Vec3;
  /** Vertical field of view in degrees. */
  vfovDegrees: number;
  /** Image width / height. */
  aspect: number;
  /** Lens diameter for defocus blur; 0 (default) = pinhole. */
  aperture?: number;
  /** Distance to the plane of perfect focus; defaults to |lookAt - position|. */
  focusDist?: number;
}

/** Thin-lens perspective camera. */
export class Camera {
  private readonly origin: Vec3;
  private readonly lowerLeft: Vec3;
  private readonly horizontal: Vec3;
  private readonly vertical: Vec3;
  private readonly u: Vec3;
  private readonly v: Vec3;
  private readonly lensRadius: number;

  constructor(opts: CameraOptions) {
    const up = opts.up ?? vec3(0, 1, 0);
    const theta = (opts.vfovDegrees * Math.PI) / 180;
    const halfHeight = Math.tan(theta / 2);
    const viewportHeight = 2 * halfHeight;
    const viewportWidth = opts.aspect * viewportHeight;

    const w = normalize(sub(opts.position, opts.lookAt));
    const u = normalize(cross(up, w));
    const v = cross(w, u);

    const focusDist = opts.focusDist ?? length(sub(opts.lookAt, opts.position));

    this.origin = opts.position;
    this.horizontal = scale(u, viewportWidth * focusDist);
    this.vertical = scale(v, viewportHeight * focusDist);
    this.lowerLeft = sub(
      sub(sub(this.origin, scale(this.horizontal, 0.5)), scale(this.vertical, 0.5)),
      scale(w, focusDist),
    );
    this.u = u;
    this.v = v;
    this.lensRadius = (opts.aperture ?? 0) / 2;
  }

  /**
   * Ray through viewport coordinates (s, t) in [0,1]^2, where (0,0) is the
   * lower-left corner. When the aperture is open the origin is jittered on
   * the lens disk; all lens rays converge on the focus plane.
   */
  getRay(s: number, t: number, rng: Rng): Ray {
    let origin = this.origin;
    if (this.lensRadius > 0) {
      const rd = scale(randomInUnitDisk(rng), this.lensRadius);
      origin = add(origin, add(scale(this.u, rd.x), scale(this.v, rd.y)));
    }
    const target = add(this.lowerLeft, add(scale(this.horizontal, s), scale(this.vertical, t)));
    return ray(origin, normalize(sub(target, origin)));
  }
}
