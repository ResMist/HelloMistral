// utils.js — math, geometry and collision helpers

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function pointInRect(x, z, r) {
  return x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
}

export class AABB {
  constructor(minx, miny, minz, maxx, maxy, maxz) {
    this.min = { x: minx, y: miny, z: minz };
    this.max = { x: maxx, y: maxy, z: maxz };
  }
  static box(cx, cy, cz, sx, sy, sz) {
    return new AABB(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2);
  }
  containsXZ(x, z, pad = 0) {
    return x >= this.min.x - pad && x <= this.max.x + pad && z >= this.min.z - pad && z <= this.max.z + pad;
  }
  overlapY(feetY, headY) {
    return feetY < this.max.y && headY > this.min.y;
  }
  // Segment-AABB intersection (slab method)
  segmentHit(ax, ay, az, bx, by, bz) {
    let tmin = 0, tmax = 1;
    const axes = [
      [ax, bx, this.min.x, this.max.x],
      [ay, by, this.min.y, this.max.y],
      [az, bz, this.min.z, this.max.z],
    ];
    for (const [a, b, lo, hi] of axes) {
      if (Math.abs(b - a) < 1e-9) {
        if (a < lo || a > hi) return false;
      } else {
        let t1 = (lo - a) / (b - a);
        let t2 = (hi - a) / (b - a);
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    return true;
  }
}
