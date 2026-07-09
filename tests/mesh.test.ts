import { describe, expect, it } from 'vitest';
import { normalize, vec3 } from '../src/vec3.js';
import { ray } from '../src/ray.js';
import { Triangle } from '../src/geometry/triangle.js';
import { loadObjTriangles, parseObj } from '../src/io/obj.js';
import { Lambertian } from '../src/materials.js';
import { expectVecClose } from './helpers.js';

const mat = new Lambertian(vec3(0.5, 0.5, 0.5));
const down = ray(vec3(0.25, 0.25, 5), vec3(0, 0, -1)); // hits the z=0 plane at (0.25, 0.25) -> bary u=v=0.25

describe('Triangle smooth normals + UVs', () => {
  const v0 = vec3(0, 0, 0);
  const v1 = vec3(1, 0, 0);
  const v2 = vec3(0, 1, 0);

  it('interpolates per-vertex normals with barycentric weights', () => {
    const tri = new Triangle(v0, v1, v2, mat, [vec3(0, 0, 1), vec3(0, 0, 1), vec3(0, 1, 0)]);
    const rec = tri.hit(down, 1e-4, Infinity);
    expect(rec).not.toBeNull();
    // weights (0.5, 0.25, 0.25): 0.5*(0,0,1)+0.25*(0,0,1)+0.25*(0,1,0) = (0,0.25,0.75)
    expectVecClose(rec!.normal, normalize(vec3(0, 0.25, 0.75)));
  });

  it('interpolates per-vertex UVs', () => {
    const tri = new Triangle(v0, v1, v2, mat, undefined, [
      [0, 0],
      [2, 0],
      [0, 2],
    ]);
    const rec = tri.hit(down, 1e-4, Infinity);
    expect(rec!.uv!.u).toBeCloseTo(0.5, 9); // 0.25*2
    expect(rec!.uv!.v).toBeCloseTo(0.5, 9); // 0.25*2
  });

  it('falls back to the geometric normal and barycentric UVs without vertex data', () => {
    const tri = new Triangle(v0, v1, v2, mat);
    const rec = tri.hit(down, 1e-4, Infinity);
    expectVecClose(rec!.normal, vec3(0, 0, 1));
    expect(rec!.uv!.u).toBeCloseTo(0.25, 9);
  });
});

describe('OBJ loader', () => {
  const quad = `
# a unit quad in z=0 with +z normals
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
vn 0 0 1
vn 0 0 1
vn 0 0 1
f 1/1/1 2/2/2 3/3/3 4/4/4
`;

  it('parses v/vt/vn and one polygon face', () => {
    const mesh = parseObj(quad);
    expect(mesh.positions).toHaveLength(4);
    expect(mesh.texcoords).toHaveLength(4);
    expect(mesh.normals).toHaveLength(4);
    expect(mesh.faces).toHaveLength(1);
    expect(mesh.faces[0]!.v).toEqual([0, 1, 2, 3]);
  });

  it('fan-triangulates a quad into two triangles carrying normals + UVs', () => {
    const tris = loadObjTriangles(quad, mat);
    expect(tris).toHaveLength(2);
    for (const t of tris) {
      expect(t.normals).toBeDefined();
      expect(t.uvs).toBeDefined();
    }
    const rec = tris[0]!.hit(down, 1e-4, Infinity);
    expect(rec).not.toBeNull();
    expectVecClose(rec!.normal, vec3(0, 0, 1));
  });

  it('resolves negative indices', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
    expect(mesh.faces[0]!.v).toEqual([0, 1, 2]);
    expect(loadObjTriangles('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n', mat)).toHaveLength(1);
  });

  it('throws on an out-of-range index', () => {
    expect(() => parseObj('v 0 0 0\nf 1 2 3\n')).toThrow(/out of range/);
  });
});
