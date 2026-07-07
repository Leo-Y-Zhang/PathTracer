import { axis } from './vec3.js';
import { AABB } from './aabb.js';
import type { Ray } from './ray.js';
import type { HitRecord, Hittable } from './hittable.js';

/**
 * Bounding volume hierarchy.
 *
 * Split strategy: MEDIAN SPLIT on the axis with the largest centroid extent.
 * At every node the primitives are sorted by bounding-box centroid along
 * that axis and cut at the median index. This is simpler than a
 * surface-area-heuristic build and is O(n log^2 n); for the scene sizes this
 * project targets (tens to a few thousand primitives) the traversal cost
 * difference versus SAH is negligible. Correctness (not speed) is what the
 * test suite proves: BVH hits must be identical to brute-force iteration.
 */
export class BVHNode implements Hittable {
  private constructor(
    private readonly left: Hittable,
    private readonly right: Hittable,
    private readonly box: AABB,
  ) {}

  static build(objects: readonly Hittable[]): Hittable {
    if (objects.length === 0) throw new Error('BVH requires at least one object');
    return BVHNode.buildRange(objects.map((obj) => ({ obj, box: obj.boundingBox() })));
  }

  private static buildRange(items: { obj: Hittable; box: AABB }[]): Hittable {
    if (items.length === 1) return items[0]!.obj;

    // Bounds of all centroids decide the split axis.
    let cbox = new AABB(items[0]!.box.centroid(), items[0]!.box.centroid());
    for (let i = 1; i < items.length; i++) {
      const c = items[i]!.box.centroid();
      cbox = AABB.surrounding(cbox, new AABB(c, c));
    }
    const splitAxis = cbox.longestAxis();

    items.sort((p, q) => axis(p.box.centroid(), splitAxis) - axis(q.box.centroid(), splitAxis));
    const mid = items.length >> 1;
    const left = BVHNode.buildRange(items.slice(0, mid));
    const right = BVHNode.buildRange(items.slice(mid));
    const box = AABB.surrounding(left.boundingBox(), right.boundingBox());
    return new BVHNode(left, right, box);
  }

  hit(r: Ray, tMin: number, tMax: number): HitRecord | null {
    if (!this.box.hit(r, tMin, tMax)) return null;
    const hl = this.left.hit(r, tMin, tMax);
    const hr = this.right.hit(r, tMin, hl ? hl.t : tMax);
    return hr ?? hl;
  }

  boundingBox(): AABB {
    return this.box;
  }
}
