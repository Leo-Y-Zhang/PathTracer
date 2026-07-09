/** Row-major 3x3 matrices for instance transforms (rotation + scale). */
import { vec3, type Vec3 } from './vec3.js';

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const MAT3_ID: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const m: number[] = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return m as unknown as Mat3;
}

export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return vec3(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Inverse(m: Mat3): Mat3 {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-12) throw new Error('mat3Inverse: singular matrix');
  const d = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * d,
    (m[2] * m[7] - m[1] * m[8]) * d,
    (m[1] * m[5] - m[2] * m[4]) * d,
    (m[5] * m[6] - m[3] * m[8]) * d,
    (m[0] * m[8] - m[2] * m[6]) * d,
    (m[2] * m[3] - m[0] * m[5]) * d,
    (m[3] * m[7] - m[4] * m[6]) * d,
    (m[1] * m[6] - m[0] * m[7]) * d,
    (m[0] * m[4] - m[1] * m[3]) * d,
  ];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

export function rotationX(deg: number): Mat3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotationY(deg: number): Mat3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function rotationZ(deg: number): Mat3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function scaling(s: Vec3): Mat3 {
  return [s.x, 0, 0, 0, s.y, 0, 0, 0, s.z];
}
