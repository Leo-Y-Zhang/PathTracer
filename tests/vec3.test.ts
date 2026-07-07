import { describe, expect, it } from 'vitest';
import {
  add,
  axis,
  axisVec,
  cross,
  dot,
  length,
  lengthSq,
  lerp,
  maxComponent,
  mul,
  nearZero,
  neg,
  normalize,
  reflect,
  refract,
  scale,
  sub,
  vec3,
} from '../src/vec3.js';
import { expectVecClose } from './helpers.js';

describe('vec3 arithmetic', () => {
  it('adds component-wise', () => {
    expectVecClose(add(vec3(1, 2, 3), vec3(4, 5, 6)), vec3(5, 7, 9));
  });

  it('subtracts component-wise', () => {
    expectVecClose(sub(vec3(4, 5, 6), vec3(1, 2, 3)), vec3(3, 3, 3));
  });

  it('multiplies component-wise (Hadamard)', () => {
    expectVecClose(mul(vec3(1, 2, 3), vec3(4, 5, 6)), vec3(4, 10, 18));
  });

  it('scales by a scalar', () => {
    expectVecClose(scale(vec3(1, -2, 3), -2), vec3(-2, 4, -6));
  });

  it('negates', () => {
    expectVecClose(neg(vec3(1, -2, 3)), vec3(-1, 2, -3));
  });

  it('lerps between endpoints', () => {
    expectVecClose(lerp(vec3(0, 0, 0), vec3(10, 20, 30), 0.25), vec3(2.5, 5, 7.5));
    expectVecClose(lerp(vec3(1, 1, 1), vec3(2, 2, 2), 0), vec3(1, 1, 1));
    expectVecClose(lerp(vec3(1, 1, 1), vec3(2, 2, 2), 1), vec3(2, 2, 2));
  });
});

describe('vec3 products and norms', () => {
  it('dot product: (1,2,3).(4,5,6) = 32', () => {
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
  });

  it('dot of perpendicular vectors is zero', () => {
    expect(dot(vec3(1, 0, 0), vec3(0, 5, 0))).toBe(0);
  });

  it('cross product follows the right-hand rule: x cross y = z', () => {
    expectVecClose(cross(vec3(1, 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1));
  });

  it('cross product is anticommutative', () => {
    const a = vec3(1.5, -2, 0.5);
    const b = vec3(3, 1, -4);
    expectVecClose(cross(a, b), neg(cross(b, a)));
  });

  it('cross hand-computed: (1,2,3) x (4,5,6) = (-3,6,-3)', () => {
    expectVecClose(cross(vec3(1, 2, 3), vec3(4, 5, 6)), vec3(-3, 6, -3));
  });

  it('length of a 3-4-5 vector', () => {
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(lengthSq(vec3(3, 4, 0))).toBe(25);
  });

  it('normalizes to unit length preserving direction', () => {
    expectVecClose(normalize(vec3(0, 3, 4)), vec3(0, 0.6, 0.8));
  });
});

describe('reflect / refract', () => {
  it('reflects a 45-degree incident ray off a ground plane', () => {
    expectVecClose(reflect(vec3(1, -1, 0), vec3(0, 1, 0)), vec3(1, 1, 0));
  });

  it('reflection preserves length', () => {
    const v = normalize(vec3(2, -3, 1));
    expect(length(reflect(v, vec3(0, 1, 0)))).toBeCloseTo(1, 12);
  });

  it('refracts straight-through at normal incidence', () => {
    expectVecClose(refract(vec3(0, -1, 0), vec3(0, 1, 0), 1 / 1.5), vec3(0, -1, 0));
  });

  it('does not bend when the index ratio is 1', () => {
    const uv = normalize(vec3(1, -1, 0));
    expectVecClose(refract(uv, vec3(0, 1, 0), 1), uv, 9);
  });

  it('obeys Snell law: 45 deg into n=1.5 bends to sin(theta_t) = sin(45)/1.5', () => {
    const uv = normalize(vec3(1, -1, 0));
    const out = refract(uv, vec3(0, 1, 0), 1 / 1.5);
    // Hand-computed: sin(theta_t) = 0.70711/1.5 = 0.47140, cos = 0.88192
    expect(out.x).toBeCloseTo(0.4714045, 6);
    expect(out.y).toBeCloseTo(-0.8819171, 6);
    expect(out.z).toBeCloseTo(0, 12);
    expect(length(out)).toBeCloseTo(1, 9);
  });
});

describe('vec3 utilities', () => {
  it('nearZero detects tiny vectors', () => {
    expect(nearZero(vec3(1e-9, -1e-9, 0))).toBe(true);
    expect(nearZero(vec3(1e-3, 0, 0))).toBe(false);
  });

  it('maxComponent picks the largest channel', () => {
    expect(maxComponent(vec3(0.2, 0.9, 0.5))).toBe(0.9);
  });

  it('axis indexes components and axisVec builds basis vectors', () => {
    const v = vec3(7, 8, 9);
    expect(axis(v, 0)).toBe(7);
    expect(axis(v, 1)).toBe(8);
    expect(axis(v, 2)).toBe(9);
    expectVecClose(axisVec(1, -1), vec3(0, -1, 0));
  });
});
