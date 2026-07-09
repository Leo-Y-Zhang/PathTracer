/**
 * A simple analytic sky background: a horizon-to-zenith gradient, a bright sun
 * disk in a chosen direction with a soft surrounding glow, and a flat ground
 * colour below the horizon. Not a spectral/Preetham model - a plausible,
 * cheap environment beyond the built-in two-colour gradient.
 */
import { add, dot, lerp, normalize, scale, type Vec3 } from './vec3.js';
import type { Ray } from './ray.js';
import type { Background } from './integrator.js';

export interface SkyOptions {
  /** Direction TO the sun (need not be normalised). */
  sunDirection: Vec3;
  sunColor: Vec3;
  sunIntensity: number;
  /** Angular radius of the sun disk, radians. */
  sunAngularRadius: number;
  zenith: Vec3;
  horizon: Vec3;
  ground: Vec3;
}

export function skyBackground(opts: SkyOptions): Background {
  const sun = normalize(opts.sunDirection);
  const cosRadius = Math.cos(opts.sunAngularRadius);
  return (r: Ray): Vec3 => {
    const d = normalize(r.dir);
    const cosSun = dot(d, sun);
    if (cosSun >= cosRadius) return scale(opts.sunColor, opts.sunIntensity);
    if (d.y < 0) return opts.ground;
    const sky = lerp(opts.horizon, opts.zenith, d.y);
    const glow = Math.pow(Math.max(0, cosSun), 48) * opts.sunIntensity * 0.25;
    return add(sky, scale(opts.sunColor, glow));
  };
}
