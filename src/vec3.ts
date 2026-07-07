/**
 * Immutable 3-component vector maths. Every function is pure: no argument is
 * mutated and a fresh object is returned. Vectors double as RGB colours.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export const ZERO: Vec3 = vec3(0, 0, 0);
export const ONE: Vec3 = vec3(1, 1, 1);

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Component-wise (Hadamard) product; used for throughput * albedo. */
export function mul(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x * b.x, a.y * b.y, a.z * b.z);
}

export function scale(a: Vec3, s: number): Vec3 {
  return vec3(a.x * s, a.y * s, a.z * s);
}

export function neg(a: Vec3): Vec3 {
  return vec3(-a.x, -a.y, -a.z);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

export function lengthSq(a: Vec3): number {
  return dot(a, a);
}

export function length(a: Vec3): number {
  return Math.sqrt(lengthSq(a));
}

export function normalize(a: Vec3): Vec3 {
  return scale(a, 1 / length(a));
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(scale(a, 1 - t), scale(b, t));
}

/** Mirror reflection of v about unit normal n. */
export function reflect(v: Vec3, n: Vec3): Vec3 {
  return sub(v, scale(n, 2 * dot(v, n)));
}

/**
 * Snell refraction. `uv` must be a unit incident direction, `n` a unit normal
 * opposing it, and `etaiOverEtat` the ratio of refractive indices n_i / n_t.
 * The caller is responsible for detecting total internal reflection first.
 */
export function refract(uv: Vec3, n: Vec3, etaiOverEtat: number): Vec3 {
  const cosTheta = Math.min(dot(neg(uv), n), 1);
  const rOutPerp = scale(add(uv, scale(n, cosTheta)), etaiOverEtat);
  const rOutParallel = scale(n, -Math.sqrt(Math.abs(1 - lengthSq(rOutPerp))));
  return add(rOutPerp, rOutParallel);
}

export function nearZero(a: Vec3, eps = 1e-8): boolean {
  return Math.abs(a.x) < eps && Math.abs(a.y) < eps && Math.abs(a.z) < eps;
}

export function maxComponent(a: Vec3): number {
  return Math.max(a.x, a.y, a.z);
}

/** Component access by axis index (0 = x, 1 = y, 2 = z). */
export function axis(a: Vec3, i: number): number {
  return i === 0 ? a.x : i === 1 ? a.y : a.z;
}

/** Unit vector along axis index, with the given sign. */
export function axisVec(i: number, sign: 1 | -1): Vec3 {
  return i === 0 ? vec3(sign, 0, 0) : i === 1 ? vec3(0, sign, 0) : vec3(0, 0, sign);
}
