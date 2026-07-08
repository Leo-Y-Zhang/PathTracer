/**
 * JSON scene format. Schema (all vectors are [x, y, z] arrays):
 *
 * {
 *   "name": "cornell",                        // optional
 *   "camera": {
 *     "position": [x,y,z], "lookAt": [x,y,z],
 *     "up": [0,1,0],                          // optional, default +Y
 *     "vfov": 40,                             // vertical FOV, degrees
 *     "aperture": 0.0,                        // optional lens diameter
 *     "focusDist": 10                         // optional, default |lookAt-position|
 *   },
 *   "background": [r,g,b]                     // solid colour, or:
 *              | { "type": "solid", "color": [r,g,b] }
 *              | { "type": "gradient", "top": [r,g,b], "bottom": [r,g,b] },
 *   "render": { "width": 480, "height": 360, "spp": 256,
 *               "maxDepth": 32, "seed": 7 },  // optional defaults for the CLI
 *   "materials": {
 *     "name": { "type": "lambertian", "albedo": [r,g,b] }
 *           | { "type": "metal", "albedo": [r,g,b], "roughness": 0.1 }
 *           | { "type": "dielectric", "ior": 1.5 }
 *           | { "type": "emissive", "color": [r,g,b], "intensity": 15 }
 *   },
 *   "objects": [
 *     { "type": "sphere", "center": [x,y,z], "radius": r, "material": "name" },
 *     { "type": "rect", "plane": "xy"|"xz"|"yz", "min": [a,b], "max": [a,b],
 *       "k": value, "material": "name" },
 *     { "type": "box", "min": [x,y,z], "max": [x,y,z], "material": "name" },
 *     { "type": "triangle", "v0": [x,y,z], "v1": [x,y,z], "v2": [x,y,z],
 *       "material": "name" }
 *   ]
 * }
 */
import { lerp, normalize, vec3, type Vec3 } from './vec3.js';
import type { Hittable } from './hittable.js';
import { HittableList } from './hittable.js';
import { BVHNode } from './bvh.js';
import { Sphere } from './geometry/sphere.js';
import { Rect, type RectPlane } from './geometry/rect.js';
import { Box } from './geometry/box.js';
import { Triangle } from './geometry/triangle.js';
import {
  Dielectric,
  Emissive,
  GGXConductor,
  Lambertian,
  Metal,
  TexturedLambertian,
  type Material,
} from './materials.js';
import { CheckerTexture, SolidColor, type Texture } from './texture.js';
import { LightList, type LightPrimitive } from './lights.js';
import type { Background } from './integrator.js';

export interface SceneCamera {
  position: Vec3;
  lookAt: Vec3;
  up: Vec3;
  vfovDegrees: number;
  aperture: number;
  focusDist: number | undefined;
}

export interface SceneRenderDefaults {
  width: number;
  height: number;
  spp: number;
  maxDepth: number;
  seed: number;
}

export interface SceneDescription {
  name: string;
  camera: SceneCamera;
  background: Background;
  /** BVH over all objects (brute-force list when the scene is empty). */
  world: Hittable;
  /** Emissive rects/spheres, for next-event estimation (empty = pure path tracing). */
  lights: LightList;
  objectCount: number;
  defaults: SceneRenderDefaults;
}

function fail(path: string, expected: string, got: unknown): never {
  throw new Error(`scene: ${path}: expected ${expected}, got ${JSON.stringify(got)}`);
}

function asObject(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'an object', v);
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'a finite number', v);
  return v;
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'a string', v);
  return v;
}

function asVec3(v: unknown, path: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) fail(path, 'an [x, y, z] array', v);
  return vec3(asNumber(v[0], `${path}[0]`), asNumber(v[1], `${path}[1]`), asNumber(v[2], `${path}[2]`));
}

function asVec2(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) fail(path, 'an [a, b] array', v);
  return [asNumber(v[0], `${path}[0]`), asNumber(v[1], `${path}[1]`)];
}

function parseTexture(json: unknown, path: string): Texture {
  const t = asObject(json, path);
  const type = asString(t['type'], `${path}.type`);
  switch (type) {
    case 'solid':
      return new SolidColor(asVec3(t['color'], `${path}.color`));
    case 'checker': {
      const squares = t['squares'] === undefined ? 8 : asNumber(t['squares'], `${path}.squares`);
      return new CheckerTexture(asVec3(t['a'], `${path}.a`), asVec3(t['b'], `${path}.b`), squares);
    }
    default:
      fail(`${path}.type`, 'one of solid | checker', type);
  }
}

function parseMaterial(
  json: unknown,
  path: string,
  textures: ReadonlyMap<string, Texture>,
): Material {
  const m = asObject(json, path);
  const type = asString(m['type'], `${path}.type`);
  switch (type) {
    case 'lambertian':
      return new Lambertian(asVec3(m['albedo'], `${path}.albedo`));
    case 'textured_lambertian': {
      const texName = asString(m['texture'], `${path}.texture`);
      const tex = textures.get(texName);
      if (!tex) throw new Error(`scene: ${path}.texture: unknown texture "${texName}"`);
      return new TexturedLambertian(tex);
    }
    case 'metal': {
      const roughness = m['roughness'] === undefined ? 0 : asNumber(m['roughness'], `${path}.roughness`);
      if (roughness < 0 || roughness > 1) fail(`${path}.roughness`, 'a number in [0, 1]', roughness);
      return new Metal(asVec3(m['albedo'], `${path}.albedo`), roughness);
    }
    case 'dielectric':
      return new Dielectric(asNumber(m['ior'], `${path}.ior`));
    case 'ggx': {
      const roughness = m['roughness'] === undefined ? 0.2 : asNumber(m['roughness'], `${path}.roughness`);
      if (roughness < 0 || roughness > 1) fail(`${path}.roughness`, 'a number in [0, 1]', roughness);
      return new GGXConductor(asVec3(m['albedo'], `${path}.albedo`), roughness);
    }
    case 'emissive': {
      const intensity = m['intensity'] === undefined ? 1 : asNumber(m['intensity'], `${path}.intensity`);
      return new Emissive(asVec3(m['color'], `${path}.color`), intensity);
    }
    default:
      fail(
        `${path}.type`,
        'one of lambertian | textured_lambertian | metal | dielectric | ggx | emissive',
        type,
      );
  }
}

function parseObject(
  json: unknown,
  path: string,
  materials: ReadonlyMap<string, Material>,
): Hittable {
  const o = asObject(json, path);
  const type = asString(o['type'], `${path}.type`);
  const matName = asString(o['material'], `${path}.material`);
  const material = materials.get(matName);
  if (!material) {
    throw new Error(`scene: ${path}.material: unknown material "${matName}"`);
  }
  switch (type) {
    case 'sphere':
      return new Sphere(
        asVec3(o['center'], `${path}.center`),
        asNumber(o['radius'], `${path}.radius`),
        material,
      );
    case 'rect': {
      const plane = asString(o['plane'], `${path}.plane`);
      if (plane !== 'xy' && plane !== 'xz' && plane !== 'yz') {
        fail(`${path}.plane`, 'one of xy | xz | yz', plane);
      }
      const [a0, b0] = asVec2(o['min'], `${path}.min`);
      const [a1, b1] = asVec2(o['max'], `${path}.max`);
      return new Rect(plane as RectPlane, a0, b0, a1, b1, asNumber(o['k'], `${path}.k`), material);
    }
    case 'box':
      return new Box(asVec3(o['min'], `${path}.min`), asVec3(o['max'], `${path}.max`), material);
    case 'triangle':
      return new Triangle(
        asVec3(o['v0'], `${path}.v0`),
        asVec3(o['v1'], `${path}.v1`),
        asVec3(o['v2'], `${path}.v2`),
        material,
      );
    default:
      fail(`${path}.type`, 'one of sphere | rect | box | triangle', type);
  }
}

function parseBackground(json: unknown, path: string): Background {
  if (json === undefined) {
    const black = vec3(0, 0, 0);
    return () => black;
  }
  if (Array.isArray(json)) {
    const c = asVec3(json, path);
    return () => c;
  }
  const b = asObject(json, path);
  const type = asString(b['type'], `${path}.type`);
  if (type === 'solid') {
    const c = asVec3(b['color'], `${path}.color`);
    return () => c;
  }
  if (type === 'gradient') {
    const top = asVec3(b['top'], `${path}.top`);
    const bottom = asVec3(b['bottom'], `${path}.bottom`);
    return (r) => {
      const t = 0.5 * (normalize(r.dir).y + 1);
      return lerp(bottom, top, t);
    };
  }
  fail(`${path}.type`, 'one of solid | gradient', type);
}

export function parseScene(json: unknown): SceneDescription {
  const root = asObject(json, '$');

  const cam = asObject(root['camera'], '$.camera');
  const camera: SceneCamera = {
    position: asVec3(cam['position'], '$.camera.position'),
    lookAt: asVec3(cam['lookAt'], '$.camera.lookAt'),
    up: cam['up'] === undefined ? vec3(0, 1, 0) : asVec3(cam['up'], '$.camera.up'),
    vfovDegrees: asNumber(cam['vfov'], '$.camera.vfov'),
    aperture: cam['aperture'] === undefined ? 0 : asNumber(cam['aperture'], '$.camera.aperture'),
    focusDist: cam['focusDist'] === undefined ? undefined : asNumber(cam['focusDist'], '$.camera.focusDist'),
  };

  const background = parseBackground(root['background'], '$.background');

  const rd = root['render'] === undefined ? {} : asObject(root['render'], '$.render');
  const defaults: SceneRenderDefaults = {
    width: rd['width'] === undefined ? 480 : asNumber(rd['width'], '$.render.width'),
    height: rd['height'] === undefined ? 360 : asNumber(rd['height'], '$.render.height'),
    spp: rd['spp'] === undefined ? 64 : asNumber(rd['spp'], '$.render.spp'),
    maxDepth: rd['maxDepth'] === undefined ? 32 : asNumber(rd['maxDepth'], '$.render.maxDepth'),
    seed: rd['seed'] === undefined ? 1 : asNumber(rd['seed'], '$.render.seed'),
  };

  const textures = new Map<string, Texture>();
  const texJson = asObject(root['textures'] ?? {}, '$.textures');
  for (const [name, tj] of Object.entries(texJson)) {
    textures.set(name, parseTexture(tj, `$.textures.${name}`));
  }

  const materials = new Map<string, Material>();
  const matsJson = asObject(root['materials'] ?? {}, '$.materials');
  for (const [name, matJson] of Object.entries(matsJson)) {
    materials.set(name, parseMaterial(matJson, `$.materials.${name}`, textures));
  }

  const objsJson = root['objects'];
  if (!Array.isArray(objsJson)) fail('$.objects', 'an array', objsJson);
  const objects = objsJson.map((o, i) => parseObject(o, `$.objects[${i}]`, materials));

  const world: Hittable = objects.length > 0 ? BVHNode.build(objects) : new HittableList([]);

  // Emissive rects and spheres double as importance-sampled lights for NEE.
  const lights = objects.filter(
    (o): o is LightPrimitive =>
      (o instanceof Rect || o instanceof Sphere) && o.material instanceof Emissive,
  );

  return {
    name: root['name'] === undefined ? 'scene' : asString(root['name'], '$.name'),
    camera,
    background,
    world,
    lights: new LightList(lights),
    objectCount: objects.length,
    defaults,
  };
}
