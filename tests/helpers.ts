import { expect } from 'vitest';
import type { Vec3 } from '../src/vec3.js';

export function expectVecClose(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}
