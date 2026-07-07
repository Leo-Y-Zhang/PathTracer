import { describe, expect, it } from 'vitest';
import { dot, length, normalize, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Rng } from '../src/rng.js';
import { cosineSampleHemisphere, randomInUnitDisk, randomUnitVector } from '../src/sampling.js';
import {
  Dielectric,
  Emissive,
  Lambertian,
  Metal,
  schlickReflectance,
  type Material,
} from '../src/materials.js';
import type { HitRecord } from '../src/hittable.js';
import { expectVecClose } from './helpers.js';

function hitAt(normal: { x: number; y: number; z: number }, frontFace: boolean, material: Material): HitRecord {
  return { t: 1, point: vec3(0, 0, 0), normal, frontFace, material };
}

describe('cosine-weighted hemisphere sampling', () => {
  it('mean cos(theta) matches the analytic value 2/3 under pdf = cos/pi', () => {
    const rng = new Rng(77);
    const n = vec3(0, 0, 1);
    const samples = 50_000;
    let sumCos = 0;
    let sumX = 0;
    let sumY = 0;
    let below = 0;
    for (let i = 0; i < samples; i++) {
      const d = cosineSampleHemisphere(n, rng);
      expect(length(d)).toBeCloseTo(1, 9);
      if (dot(d, n) <= 0) below++;
      sumCos += d.z;
      sumX += d.x;
      sumY += d.y;
    }
    expect(below).toBe(0); // every sample in the upper hemisphere
    expect(sumCos / samples).toBeCloseTo(2 / 3, 2);
    expect(Math.abs(sumCos / samples - 2 / 3)).toBeLessThan(0.005);
    expect(Math.abs(sumX / samples)).toBeLessThan(0.01); // azimuthal symmetry
    expect(Math.abs(sumY / samples)).toBeLessThan(0.01);
  });

  it('P(cos(theta) < 0.5) matches the analytic CDF value 0.25', () => {
    const rng = new Rng(88);
    const n = vec3(0, 0, 1);
    const samples = 50_000;
    let count = 0;
    for (let i = 0; i < samples; i++) {
      if (cosineSampleHemisphere(n, rng).z < 0.5) count++;
    }
    // CDF: P(cos < c) = integral of 2t dt from 0 to c = c^2 = 0.25 at c = 0.5.
    expect(count / samples).toBeCloseTo(0.25, 2);
  });

  it('works about a tilted normal', () => {
    const rng = new Rng(99);
    const n = normalize(vec3(1, 2, -0.5));
    for (let i = 0; i < 2_000; i++) {
      const d = cosineSampleHemisphere(n, rng);
      expect(dot(d, n)).toBeGreaterThan(0);
      expect(length(d)).toBeCloseTo(1, 9);
    }
  });
});

describe('sampling helpers', () => {
  it('randomUnitVector lies on the unit sphere with mean near zero', () => {
    const rng = new Rng(5);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const v = randomUnitVector(rng);
      expect(length(v)).toBeCloseTo(1, 9);
      sx += v.x;
      sy += v.y;
      sz += v.z;
    }
    expect(Math.abs(sx / n)).toBeLessThan(0.02);
    expect(Math.abs(sy / n)).toBeLessThan(0.02);
    expect(Math.abs(sz / n)).toBeLessThan(0.02);
  });

  it('randomInUnitDisk stays in the disk with E[r] = 2/3', () => {
    const rng = new Rng(6);
    let sumR = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const v = randomInUnitDisk(rng);
      expect(v.z).toBe(0);
      const r = Math.hypot(v.x, v.y);
      expect(r).toBeLessThanOrEqual(1);
      sumR += r;
    }
    expect(sumR / n).toBeCloseTo(2 / 3, 2);
  });
});

describe('Lambertian', () => {
  it('scatters into the upper hemisphere with attenuation = albedo', () => {
    const albedo = vec3(0.7, 0.4, 0.2);
    const m = new Lambertian(albedo);
    const rng = new Rng(1);
    const hit = hitAt(vec3(0, 1, 0), true, m);
    for (let i = 0; i < 500; i++) {
      const s = m.scatter(ray(vec3(0, 1, 0), vec3(0, -1, 0)), hit, rng);
      expect(s).not.toBeNull();
      expectVecClose(s.attenuation, albedo);
      expect(dot(s.ray.dir, hit.normal)).toBeGreaterThan(0);
    }
  });

  it('emits nothing', () => {
    expectVecClose(new Lambertian(vec3(1, 1, 1)).emitted(), vec3(0, 0, 0));
  });
});

describe('Metal', () => {
  it('roughness 0 is a perfect mirror (hand-computed 45-degree bounce)', () => {
    const m = new Metal(vec3(0.9, 0.9, 0.9), 0);
    const rng = new Rng(1);
    const hit = hitAt(vec3(0, 1, 0), true, m);
    const s = m.scatter(ray(vec3(-1, 1, 0), normalize(vec3(1, -1, 0))), hit, rng);
    expect(s).not.toBeNull();
    expectVecClose(s!.ray.dir, normalize(vec3(1, 1, 0)), 9);
    expectVecClose(s!.attenuation, vec3(0.9, 0.9, 0.9));
  });

  it('rough scatter never returns a direction below the surface', () => {
    const m = new Metal(vec3(0.8, 0.8, 0.8), 0.8);
    const rng = new Rng(2);
    const hit = hitAt(vec3(0, 1, 0), true, m);
    let absorbed = 0;
    for (let i = 0; i < 2_000; i++) {
      const s = m.scatter(ray(vec3(-1, 0.05, 0), normalize(vec3(1, -0.05, 0))), hit, rng);
      if (s === null) {
        absorbed++;
      } else {
        expect(dot(s.ray.dir, hit.normal)).toBeGreaterThan(0);
      }
    }
    // Grazing incidence with heavy fuzz must absorb some rays.
    expect(absorbed).toBeGreaterThan(0);
  });
});

describe('Fresnel (Schlick approximation)', () => {
  it('normal incidence equals the analytic ((n1-n2)/(n1+n2))^2 for glass', () => {
    const analytic = ((1 - 1.5) / (1 + 1.5)) ** 2; // 0.04
    expect(schlickReflectance(1, 1 / 1.5)).toBeCloseTo(analytic, 12);
    // Same value from inside the glass looking out.
    expect(schlickReflectance(1, 1.5)).toBeCloseTo(analytic, 12);
    expect(analytic).toBeCloseTo(0.04, 10);
  });

  it('normal incidence matches the analytic value for water (n = 1.33)', () => {
    const analytic = ((1 - 1.33) / (1 + 1.33)) ** 2;
    expect(schlickReflectance(1, 1 / 1.33)).toBeCloseTo(analytic, 12);
  });

  it('grazing incidence reflectance approaches 1', () => {
    expect(schlickReflectance(0, 1 / 1.5)).toBeCloseTo(1, 12);
  });

  it('is monotonically increasing as the angle steepens', () => {
    let prev = -1;
    for (let cos = 1; cos >= 0; cos -= 0.1) {
      const r = schlickReflectance(cos, 1 / 1.5);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });
});

describe('Dielectric', () => {
  it('total internal reflection beyond the critical angle (deterministic)', () => {
    // Ray travelling up at 45 deg inside glass (n=1.5); critical angle is 41.8 deg.
    const m = new Dielectric(1.5);
    const rng = new Rng(1);
    const hit = hitAt(vec3(0, -1, 0), false, m); // back face: normal flipped against ray
    const s = m.scatter(ray(vec3(0, -1, 0), normalize(vec3(1, 1, 0))), hit, rng);
    expectVecClose(s.ray.dir, normalize(vec3(1, -1, 0)), 9);
    expectVecClose(s.attenuation, vec3(1, 1, 1));
  });

  it('at normal incidence reflects with probability ~4% (Fresnel r0)', () => {
    const m = new Dielectric(1.5);
    const hit = hitAt(vec3(0, 1, 0), true, m);
    let reflected = 0;
    const n = 5_000;
    for (let i = 0; i < n; i++) {
      const s = m.scatter(ray(vec3(0, 1, 0), vec3(0, -1, 0)), hit, new Rng(i));
      if (s.ray.dir.y > 0) {
        reflected++;
      } else {
        // Refracted straight through.
        expectVecClose(s.ray.dir, vec3(0, -1, 0), 6);
      }
    }
    const fraction = reflected / n;
    expect(fraction).toBeGreaterThan(0.02);
    expect(fraction).toBeLessThan(0.065);
  });

  it('refracts at the hand-computed Snell angle when transmitting', () => {
    const m = new Dielectric(1.5);
    const hit = hitAt(vec3(0, 1, 0), true, m);
    // Find a transmitting sample; the direction must match refract().
    for (let i = 0; i < 50; i++) {
      const s = m.scatter(ray(vec3(-1, 1, 0), normalize(vec3(1, -1, 0))), hit, new Rng(i));
      if (s.ray.dir.y < 0) {
        expect(s.ray.dir.x).toBeCloseTo(0.4714045, 6);
        expect(s.ray.dir.y).toBeCloseTo(-0.8819171, 6);
        return;
      }
    }
    throw new Error('no transmitted sample found in 50 tries');
  });
});

describe('Emissive', () => {
  it('emits color * intensity and terminates the path', () => {
    const m = new Emissive(vec3(1, 0.5, 0.25), 4);
    expectVecClose(m.emitted(), vec3(4, 2, 1));
    expect(m.scatter()).toBeNull();
  });
});
