/**
 * Minimal Wavefront OBJ loader: v / vt / vn / f, with 1-based and negative
 * indices, and fan-triangulation of convex polygons. Produces smooth-normal,
 * optionally-textured triangles. Comments (#), materials and groups are ignored.
 */
import { vec3, type Vec3 } from '../vec3.js';
import { Triangle } from '../geometry/triangle.js';
import type { Material } from '../materials.js';

export interface ObjMesh {
  positions: Vec3[];
  normals: Vec3[];
  texcoords: [number, number][];
  /** Per-face, per-corner indices (0-based) into the arrays above. */
  faces: { v: number[]; vt: number[]; vn: number[] }[];
}

/** Resolve a 1-based (or negative-from-end) OBJ index against a running count. */
function resolveIndex(token: string, count: number): number {
  const n = Number.parseInt(token, 10);
  if (!Number.isFinite(n) || n === 0) throw new Error(`OBJ: bad index "${token}"`);
  const idx = n > 0 ? n - 1 : count + n;
  if (idx < 0 || idx >= count) throw new Error(`OBJ: index ${n} out of range (have ${count})`);
  return idx;
}

export function parseObj(text: string): ObjMesh {
  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const texcoords: [number, number][] = [];
  const faces: ObjMesh['faces'] = [];

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const kw = parts[0];
    if (kw === 'v') {
      positions.push(vec3(Number(parts[1]), Number(parts[2]), Number(parts[3])));
    } else if (kw === 'vn') {
      normals.push(vec3(Number(parts[1]), Number(parts[2]), Number(parts[3])));
    } else if (kw === 'vt') {
      texcoords.push([Number(parts[1]), parts[2] === undefined ? 0 : Number(parts[2])]);
    } else if (kw === 'f') {
      const v: number[] = [];
      const vt: number[] = [];
      const vn: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const comps = parts[i]!.split('/');
        v.push(resolveIndex(comps[0]!, positions.length));
        if (comps[1] !== undefined && comps[1] !== '') vt.push(resolveIndex(comps[1], texcoords.length));
        if (comps[2] !== undefined && comps[2] !== '') vn.push(resolveIndex(comps[2], normals.length));
      }
      if (v.length >= 3) faces.push({ v, vt, vn });
    }
  }
  return { positions, normals, texcoords, faces };
}

/** Fan-triangulate a parsed mesh into shading-ready triangles. */
export function meshToTriangles(mesh: ObjMesh, material: Material): Triangle[] {
  const tris: Triangle[] = [];
  const pos = (i: number): Vec3 => {
    const p = mesh.positions[i];
    if (!p) throw new Error(`OBJ: missing position ${i}`);
    return p;
  };
  for (const f of mesh.faces) {
    const nv = f.v.length;
    const hasN = f.vn.length === nv;
    const hasT = f.vt.length === nv;
    for (let i = 1; i < nv - 1; i++) {
      const k = [0, i, i + 1] as const;
      const normals = hasN
        ? ([mesh.normals[f.vn[k[0]]!]!, mesh.normals[f.vn[k[1]]!]!, mesh.normals[f.vn[k[2]]!]!] as [
            Vec3,
            Vec3,
            Vec3,
          ])
        : undefined;
      const uvs = hasT
        ? ([mesh.texcoords[f.vt[k[0]]!]!, mesh.texcoords[f.vt[k[1]]!]!, mesh.texcoords[f.vt[k[2]]!]!] as [
            [number, number],
            [number, number],
            [number, number],
          ])
        : undefined;
      tris.push(new Triangle(pos(f.v[k[0]]!), pos(f.v[k[1]]!), pos(f.v[k[2]]!), material, normals, uvs));
    }
  }
  return tris;
}

/** Parse OBJ text and return renderable triangles with the given material. */
export function loadObjTriangles(text: string, material: Material): Triangle[] {
  return meshToTriangles(parseObj(text), material);
}
