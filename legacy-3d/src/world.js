import * as THREE from 'three';
import { AABB, pointInRect, clamp } from './utils.js';

// world.js — the neighbor's house: layout, furniture, doors, windows,
// items, traps, cameras, navigation graph and collision.
// Everything is procedural geometry — no textures, no external assets.




export const KEY_IDS = ['red', 'blue', 'green'];
export const KEY_HEX = { red: 0xd93a3a, blue: 0x3a6fd9, green: 0x3fae4a };

const T = 0.24; // wall thickness

export class World {
  constructor(scene, memory) {
    this.scene = scene;
    this.memory = memory;
    this.colliders = [];   // { aabb, sight }
    this.floorZones = []; // flat: {x1,z1,x2,z2,y} | stair: {x1,z1,x2,z2,axis,y1,y2}
    this.doors = [];
    this.windows = [];
    this.items = [];
    this.containers = [];
    this.traps = [];
    this.cameras = [];
    this.rooms = [];
    this.nodes = [];
    this.basement = { open: false, pivot: null, locks: {} };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.build();
  }

  // ---------- materials ----------
  mat() {
    const L = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
    if (!this._m) {
      this._m = {
        wallOut: L(0x77705f),
        wallIn: L(0xa79c85),
        floorWood: L(0x6b4a2f),
        floorTile: L(0x9aa3a8),
        carpet: L(0x7a4a4a),
        concrete: L(0x5d5d63),
        wood: L(0x7a5230),
        woodDark: L(0x52371f),
        white: L(0xd9d9d9),
        dark: L(0x2e2e36),
        metal: L(0x8b929c),
        steelDark: L(0x4a4f57),
        glass: L(0xa8c8dc, { transparent: true, opacity: 0.3 }),
        grass: L(0x1c2a1c),
        path: L(0x3c3c44),
        sofa: L(0x4a6a8a),
        bed: L(0xc8c2b2),
        blanketBlue: L(0x4a6aa0),
        blanketPink: L(0xa06a90),
        tv: L(0x101014),
        fridge: L(0xe4e4e4),
        board: L(0x8a6a3a),
        trap: L(0x666670),
        leaf: L(0x14301a),
        trunk: L(0x3a2a1a),
        car: L(0x7a2a2a),
        curtain: L(0x7a5a5a),
        moon: L(0xd9d9c0, { emissive: 0x8a8a70 }),
      };
    }
    return this._m;
  }

  // ---------- primitive builders ----------
  box(cx, cy, cz, sx, sy, sz, mat, sight = false, collide = true, parent = null) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, cy, cz);
    (parent || this.group).add(m);
    if (collide) this.colliders.push({ aabb: AABB.box(cx, cy, cz, sx, sy, sz), sight });
    return m;
  }

  deco(cx, cy, cz, sx, sy, sz, mat, parent = null) {
    return this.box(cx, cy, cz, sx, sy, sz, mat, false, false, parent);
  }

  // radial-gradient blob texture used for cheap contact shadows
  shadowTexture() {
    if (!this._shadowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
      grad.addColorStop(0, 'rgba(0,0,0,0.85)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      this._shadowTex = new THREE.CanvasTexture(c);
    }
    return this._shadowTex;
  }

  blobShadow(x, y, z, r) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2, r * 2),
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture(), transparent: true, opacity: 0.5, depthWrite: false,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  // ---------- walls ----------
  // Horizontal wall: along x, at fixed z. Vertical: along z, at fixed x.
  // openings: { at, width, kind: 'door'|'window'|'arch', ... }
  wall(x1, z1, x2, z2, opts = {}) {
    const h = opts.h || 3.2;
    const y = opts.y || 0;
    const mat = opts.mat || this.mat().wallOut;
    const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const lo = horizontal ? Math.min(x1, x2) : Math.min(z1, z2);
    const hi = horizontal ? Math.max(x1, x2) : Math.max(z1, z2);
    const openings = (opts.openings || []).slice().sort((a, b) => a.at - b.at);
    let cursor = lo;
    const solid = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const len = b - a, mid = (a + b) / 2, cy = (y0 + y1) / 2, sy = y1 - y0;
      if (horizontal) this.box(mid, cy, z1, len, sy, T, mat, true, true);
      else this.box(x1, cy, mid, T, sy, len, mat, true, true);
    };
    for (const op of openings) {
      const a = op.at - op.width / 2, b = op.at + op.width / 2;
      solid(cursor, a, y, y + h);
      if (op.kind === 'door') {
        solid(a, b, y + 2.2, y + h); // lintel
        this.makeDoor(op, horizontal, x1, z1, y);
      } else if (op.kind === 'window') {
        solid(a, b, y, y + 0.9);         // sill
        solid(a, b, y + 2.2, y + h);     // lintel
        this.makeWindow(op, horizontal, x1, z1, y, a, b);
      } else {
        solid(a, b, y + 2.2, y + h);     // arch lintel
      }
      cursor = b;
    }
    solid(cursor, hi, y, y + h);
  }

  makeDoor(op, horizontal, wx, wz, y) {
    const mat = this.mat().woodDark;
    const pivot = new THREE.Group();
    const width = op.width;
    let panel;
    if (horizontal) {
      pivot.position.set(op.at - width / 2, y, wz);
      panel = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 2.1, 0.09), mat);
      panel.position.set(width / 2, 1.08, 0);
    } else {
      pivot.position.set(wx, y, op.at - width / 2);
      panel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.1, width - 0.04), mat);
      panel.position.set(0, 1.08, width / 2);
    }
    // knob
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this.mat().metal);
    if (horizontal) knob.position.set(width - 0.12, 1.05, 0.09);
    else knob.position.set(0.09, 1.05, width - 0.12);
    panel.add(knob);
    pivot.add(panel);
    this.group.add(pivot);
    const door = {
      id: op.doorId || 'door' + this.doors.length,
      name: op.name || 'Door',
      pivot, panel,
      horizontal, wx, wz, at: op.at, width, y,
      t: 0, target: 0, sign: op.sign || 1,
      locked: !!op.locked, pickable: !!op.locked,
      center: horizontal ? { x: op.at, z: wz } : { x: wx, z: op.at },
    };
    this.doors.push(door);
    return door;
  }

  doorAABB(door) {
    if (door.horizontal) return AABB.box(door.at, door.y + 1.08, door.wz, door.width, 2.16, T);
    return AABB.box(door.wx, door.y + 1.08, door.at, T, 2.16, door.width);
  }

  doorClosed(door) { return door.t < 0.3; }

  setDoor(door, open) {
    if (door.target === (open ? 1 : 0)) return;
    door.target = open ? 1 : 0;
  }

  makeWindow(op, horizontal, wx, wz, y, a, b) {
    const id = op.windowId;
    const floor1 = (y || 0) > 1.5;
    const cy = y + 1.55, mid = (a + b) / 2;
    let cx, cz, normal;
    if (horizontal) {
      cx = mid; cz = wz;
      normal = new THREE.Vector3(0, 0, op.inward === true ? -1 : 1);
      if (op.inward) normal.set(0, 0, -1);
      // outward = away from house center along z sign of wall
      normal.set(0, 0, wz > 0 ? 1 : -1);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(op.width - 0.1, 1.25, 0.05), this.mat().glass);
      glass.position.set(cx, cy, cz);
      this.group.add(glass);
      // frame
      this.deco(cx, y + 2.18, cz, op.width, 0.08, T + 0.02, this.mat().woodDark);
      this.deco(cx, y + 0.92, cz, op.width, 0.1, T + 0.02, this.mat().woodDark);
    } else {
      cx = wx; cz = mid;
      normal = new THREE.Vector3(wx > 0 ? 1 : -1, 0, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.25, op.width - 0.1), this.mat().glass);
      glass.position.set(cx, cy, cz);
      this.group.add(glass);
      this.deco(cx, y + 2.18, cz, T + 0.02, 0.08, op.width, this.mat().woodDark);
      this.deco(cx, y + 0.92, cz, T + 0.02, 0.1, op.width, this.mat().woodDark);
    }
    // curtain rod + curtains on the inside face
    {
      const wm = this.mat();
      const ix = cx - normal.x * 0.3, iz = cz - normal.z * 0.3;
      const rod = new THREE.Mesh(
        horizontal
          ? new THREE.CylinderGeometry(0.025, 0.025, op.width + 0.3, 8)
          : new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8),
        wm.metal
      );
      rod.rotation.z = horizontal ? Math.PI / 2 : 0;
      rod.rotation.x = horizontal ? 0 : Math.PI / 2;
      rod.position.set(ix, y + 2.08, iz);
      this.group.add(rod);
      const half = (op.width - 0.1) / 4;
      for (const s of [-1, 1]) {
        const cur = new THREE.Mesh(
          horizontal ? new THREE.BoxGeometry(half, 1.25, 0.05) : new THREE.BoxGeometry(0.05, 1.25, half),
          wm.curtain
        );
        cur.position.set(horizontal ? ix + s * half : ix, y + 1.42, horizontal ? iz : iz + s * half);
        this.group.add(cur);
      }
    }
    const group = new THREE.Group();
    this.group.add(group);
    // boards (nailed on the inside face)
    const inx = -normal.x * 0.16, inz = -normal.z * 0.16;
    for (let i = 0; i < 3; i++) {
      const by = y + 1.05 + i * 0.5;
      let plank;
      if (horizontal) plank = new THREE.Mesh(new THREE.BoxGeometry(op.width + 0.2, 0.2, 0.06), this.mat().board);
      else plank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, op.width + 0.2), this.mat().board);
      plank.position.set(cx + inx, by, cz + inz);
      plank.rotation.z = (i - 1) * 0.08;
      group.add(plank);
    }
    const win = {
      id, name: op.name || 'Window',
      cx, cz, cy, floor1,
      nx: normal.x, nz: normal.z,
      boarded: this.memory.shouldBoardOnBuild(id),
      boards: group,
      inX: cx - normal.x * 1.35, inZ: cz - normal.z * 1.35,
      outX: cx + normal.x * 1.6, outZ: cz + normal.z * 1.6,
      ladder: !!op.ladder,
    };
    group.visible = win.boarded;
    if (win.ladder) {
      // decorative ladder up to this window
      const lx = cx + normal.x * 0.5, lz = cz + normal.z * 0.5;
      this.deco(lx - 0.3, 2.2, lz, 0.08, 4.6, 0.08, this.mat().wood);
      this.deco(lx + 0.3, 2.2, lz, 0.08, 4.6, 0.08, this.mat().wood);
      for (let i = 0; i < 9; i++) {
        this.deco(lx, 0.4 + i * 0.48, lz, 0.62, 0.05, 0.05, this.mat().wood);
      }
    }
    this.windows.push(win);
    return win;
  }

  boardUp(win) {
    win.boarded = true;
    win.boards.visible = true;
  }

  unboard(win) {
    win.boarded = false;
    win.boards.visible = false;
  }

  // ---------- floors & ground ----------
  zone(x1, z1, x2, z2, y) {
    this.floorZones.push({ x1, z1, x2, z2, y });
  }
  stairZone(x1, z1, x2, z2, axis, y1, y2) {
    this.floorZones.push({ x1, z1, x2, z2, axis, y1, y2 });
  }

  groundHeightAt(x, z, refY) {
    let best = -Infinity;
    for (const fz of this.floorZones) {
      if (x < fz.x1 || x > fz.x2 || z < fz.z1 || z > fz.z2) continue;
      let y;
      if (fz.axis === 'x') {
        y = fz.y1 + ((x - fz.x1) / (fz.x2 - fz.x1)) * (fz.y2 - fz.y1);
      } else if (fz.axis === 'z') {
        y = fz.y1 + ((z - fz.z1) / (fz.z2 - fz.z1)) * (fz.y2 - fz.y1);
      } else {
        y = fz.y;
      }
      if (y <= refY + 0.65 && y > best) best = y;
    }
    return best > -Infinity ? best : 0;
  }

  // ---------- collision ----------
  resolveCollision(pos, r, feetY, height) {
    const test = (aabb) => {
      if (aabb.max.y <= feetY + 0.45) return; // steppable
      if (aabb.min.y >= feetY + height) return; // above head
      const cx = clamp(pos.x, aabb.min.x, aabb.max.x);
      const cz = clamp(pos.z, aabb.min.z, aabb.max.z);
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        const l = pos.x - aabb.min.x, rt = aabb.max.x - pos.x;
        const b = pos.z - aabb.min.z, t = aabb.max.z - pos.z;
        const m = Math.min(l, rt, b, t);
        if (m === l) pos.x = aabb.min.x - r;
        else if (m === rt) pos.x = aabb.max.x + r;
        else if (m === b) pos.z = aabb.min.z - r;
        else pos.z = aabb.max.z + r;
      }
    };
    for (const c of this.colliders) test(c.aabb);
    for (const d of this.doors) if (this.doorClosed(d)) test(this.doorAABB(d));
    if (!this.basement.open && this.basement.aabb) test(this.basement.aabb);
  }

  pointBlocked(x, y, z) {
    for (const c of this.colliders) {
      const a = c.aabb;
      if (x > a.min.x - 0.12 && x < a.max.x + 0.12 && z > a.min.z - 0.12 && z < a.max.z + 0.12 &&
          y > a.min.y && y < a.max.y) return true;
    }
    return false;
  }

  segmentBlocked(ax, ay, az, bx, by, bz) {
    for (const c of this.colliders) {
      if (!c.sight) continue;
      if (c.aabb.max.y < 1.2) continue;
      if (c.aabb.segmentHit(ax, ay, az, bx, by, bz)) return true;
    }
    for (const d of this.doors) {
      if (this.doorClosed(d) && this.doorAABB(d).segmentHit(ax, ay, az, bx, by, bz)) return true;
    }
    if (!this.basement.open && this.basement.aabb &&
        this.basement.aabb.segmentHit(ax, ay, az, bx, by, bz)) return true;
    return false;
  }

  roomAt(x, z, y) {
    const floor1 = y > 1.7;
    for (const r of this.rooms) {
      if ((r.floor === 1) !== floor1) continue;
      if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return r;
    }
    return null;
  }

  // ---------- navigation ----------
  node(id, x, y, z, roomId, links) {
    const n = { id, x, y, z, roomId, links: [] };
    const idx = this.nodes.length;
    this.nodes.push(n);
    for (const other of links || []) {
      n.links.push(this.nodes.findIndex((o) => o.id === other));
    }
    return idx;
  }

  link(a, b) {
    const ia = this.nodes.findIndex((n) => n.id === a);
    const ib = this.nodes.findIndex((n) => n.id === b);
    if (ia >= 0 && ib >= 0) {
      if (!this.nodes[ia].links.includes(ib)) this.nodes[ia].links.push(ib);
      if (!this.nodes[ib].links.includes(ia)) this.nodes[ib].links.push(ia);
    }
  }

  nearestNode(x, y, z) {
    const floor1 = y > 1.7;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if ((n.y > 1.7) !== floor1) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  findPath(sx, sy, sz, tx, ty, tz) {
    const start = this.nearestNode(sx, sy, sz);
    const goal = this.nearestNode(tx, ty, tz);
    if (start < 0 || goal < 0) return [{ x: tx, y: ty, z: tz }];
    const N = this.nodes.length;
    const g = new Array(N).fill(Infinity);
    const f = new Array(N).fill(Infinity);
    const came = new Array(N).fill(-1);
    const closed = new Array(N).fill(false);
    const h = (i) => {
      const n = this.nodes[i];
      return Math.hypot(n.x - this.nodes[goal].x, n.z - this.nodes[goal].z) + Math.abs(n.y - this.nodes[goal].y);
    };
    g[start] = 0; f[start] = h(start);
    const open = [start];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) break;
      closed[cur] = true;
      for (const nb of this.nodes[cur].links) {
        if (closed[nb]) continue;
        const a = this.nodes[cur], b = this.nodes[nb];
        const cost = Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y) * 0.5;
        const ng = g[cur] + cost;
        if (ng < g[nb]) {
          g[nb] = ng; came[nb] = cur; f[nb] = ng + h(nb);
          if (!open.includes(nb)) open.push(nb);
        }
      }
    }
    if (came[goal] === -1 && goal !== start) return [{ x: tx, y: ty, z: tz }];
    const path = [];
    let c = goal;
    while (c !== -1) { path.unshift(this.nodes[c]); c = came[c]; }
    return path;
  }

  // ---------- items ----------
  makeItemMesh(kind) {
    const g = new THREE.Group();
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });
    if (kind.startsWith('key_')) {
      const col = KEY_HEX[kind.slice(4)];
      const m = L(col);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 14), m);
      g.add(ring);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.18), m);
      shaft.position.set(0, -0.09, 0.08);
      g.add(shaft);
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.03), m);
      t1.position.set(0.03, -0.09, 0.14);
      g.add(t1);
      const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.028, 0.03), m);
      t2.position.set(0.03, -0.09, 0.09);
      g.add(t2);
    } else if (kind === 'crowbar') {
      const m = L(0x8a2222);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.55), m);
      g.add(bar);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), m);
      hook.position.set(0, 0.08, 0.28);
      hook.rotation.x = 0.5;
      g.add(hook);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.06), m);
      tip.position.set(0, -0.02, -0.3);
      g.add(tip);
    } else if (kind === 'lockpick') {
      const m = L(0xb0b8c4);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.24), m);
      g.add(p);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.07), L(0x333333));
      grip.position.z = -0.13;
      g.add(grip);
    } else if (kind === 'can') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), L(0xbb4433));
      g.add(body);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.061, 0.061, 0.015, 12), L(0xc8ccd0));
      lid.position.y = 0.075;
      g.add(lid);
    } else if (kind === 'box') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), L(0xa5824e));
      g.add(b);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.05, 0.29), L(0x6b4a2a));
      g.add(band);
    }
    return g;
  }

  addItem(kind, x, y, z, revealed = true, label = '') {
    const mesh = this.makeItemMesh(kind);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const item = { kind, x, y, z, mesh, revealed, taken: false, baseY: y, label: label || this.itemLabel(kind) };
    this.items.push(item);
    return item;
  }

  itemLabel(kind) {
    if (kind.startsWith('key_')) return `${kind.slice(4).toUpperCase()} key`;
    if (kind === 'crowbar') return 'crowbar';
    if (kind === 'lockpick') return 'lockpick';
    if (kind === 'can') return 'tin can';
    return 'box';
  }

  makeContainer(id, name, x, y, z, kind, label) {
    const c = { id, name, x, y, z, opened: false, itemKind: kind, itemLabel: label };
    this.containers.push(c);
    return c;
  }

  revealContainer(c) {
    c.opened = true;
    const item = this.items.find((i) => i.kind === c.itemKind && !i.revealed && !i.taken);
    if (item) {
      item.revealed = true;
      item.mesh.visible = true;
    }
  }

  // ---------- traps & cameras ----------
  placeTrap(x, y, z) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.06, 12), this.mat().trap);
    g.add(base);
    const jawGeo = new THREE.TorusGeometry(0.3, 0.035, 6, 12, Math.PI);
    const jawL = new THREE.Mesh(jawGeo, this.mat().steelDark);
    jawL.rotation.z = Math.PI;
    jawL.position.y = 0.05;
    g.add(jawL);
    const jawR = new THREE.Mesh(jawGeo, this.mat().steelDark);
    jawR.position.y = 0.05;
    g.add(jawR);
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), this.mat().steelDark);
      const ang = (i / 5) * Math.PI;
      tooth.position.set(Math.cos(ang) * 0.3, 0.12, Math.sin(ang) * 0.3);
      g.add(tooth);
    }
    g.position.set(x, y, z);
    this.group.add(g);
    const trap = { x, y, z, armed: true, mesh: g, jawL, jawR, snapT: 0 };
    jawL.rotation.x = -0.9;
    jawR.rotation.x = 0.9;
    this.traps.push(trap);
    return trap;
  }

  snapTrap(trap) {
    trap.armed = false;
    trap.snapT = 0.25;
  }

  removeTrap(trap) {
    trap.armed = false;
    trap.dead = true;
    trap.mesh.visible = false;
  }

  placeCamera(room) {
    const floor1 = room.floor === 1;
    const y = floor1 ? 5.9 : 2.7;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), this.mat().steelDark);
    pole.position.y = -0.3;
    g.add(pole);
    const head = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), this.mat().dark);
    head.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), this.mat().steelDark);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.17;
    head.add(lens);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    led.position.set(0.09, 0.05, 0.12);
    head.add(led);
    g.add(head);
    g.position.set(room.x1 + 0.6, y, room.z1 + 0.6);
    this.group.add(g);
    const cam = { room: room.id, g, head, led, seeT: 0, baseAngle: Math.random() * Math.PI * 2 };
    this.cameras.push(cam);
    return cam;
  }

  // ============================================================
  // BUILD
  // ============================================================
  build() {
    const m = this.mat();

    // --- rooms (for heat mapping / location display) ---
    const R = (id, name, floor, x1, z1, x2, z2) => this.rooms.push({ id, name, floor, x1, z1, x2, z2 });
    R('liv', 'Living Room', 0, -10, -2, -1.5, 8);
    R('cor', 'Hallway', 0, -1.5, -8, 1.5, 8);
    R('kit', 'Kitchen', 0, 1.5, 2, 10, 8);
    R('din', 'Dining Room', 0, 1.5, -2, 10, 2);
    R('bath', 'Bathroom', 0, 1.5, -8, 6, -2);
    R('work', 'Workshop', 0, 6, -8, 10, -2);
    R('gar', 'Garage', 0, -10, -8, -1.5, -2);
    R('hall2', 'Upstairs Hall', 1, -5, 2, 1.5, 8);
    R('cor2', 'Upstairs Corridor', 1, -1.5, -8, 1.5, 2);
    R('kids', "Kids' Room", 1, 1.5, 2, 10, 8);
    R('master', 'Master Bedroom', 1, -10, -8, -1.5, 2);
    R('study', 'Study', 1, 1.5, -8, 10, 2);
    R('yard', 'Front Yard', 0, -20, 8.2, 20, 20);
    R('base', 'Basement Staircase', 0, 10, -8, 14.5, -2);

    // --- ground slab & yard ---
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), m.grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.group.add(ground);

    this.box(0, -0.06, 0, 20.5, 0.12, 16.5, m.floorWood, false, false); // house floor
    this.box(0, 0.02, 13, 2, 0.1, 9, m.path, false, false); // path
    this.box(0, 0.06, 8.75, 2.2, 0.14, 1.0, m.concrete, false, false); // porch
    // porch lamp + warm light
    this.deco(0.65, 2.25, 8.6, 0.16, 0.28, 0.16, m.dark);
    const porchLight = new THREE.PointLight(0xffb060, 3.5, 7, 1.6);
    porchLight.position.set(0.65, 2.1, 8.5);
    this.scene.add(porchLight);
    // doorbell button beside the front door
    this.deco(0.65, 1.35, 8.16, 0.06, 0.12, 0.04, m.metal);

    // fence
    for (const [fx, fz, sx, sz] of [[0, 20, 40, 0.2], [0, -20, 40, 0.2], [20, 0, 0.2, 40], [-20, 0, 0.2, 40]]) {
      this.box(fx, 0.7, fz, sx, 1.4, sz, m.woodDark, false, true);
    }
    // trees
    for (const [tx, tz] of [[-15, 15], [14, 16], [-16, -12], [16, -14], [-12, 18], [12, 18]]) {
      this.deco(tx, 1.1, tz, 0.3, 2.2, 0.3, m.trunk);
      this.deco(tx, 2.8, tz, 2.4, 2.2, 2.4, m.leaf);
      this.deco(tx, 4.2, tz, 1.6, 1.6, 1.6, m.leaf);
    }
    // mailbox
    this.deco(1.6, 0.5, 12, 0.08, 1, 0.08, m.woodDark);
    this.deco(1.6, 1.1, 12, 0.3, 0.25, 0.45, m.metal);
    // moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 16), m.moon);
    moon.position.set(38, 34, -55);
    this.group.add(moon);

    // --- floor zones ---
    // 2F rooms
    this.zone(-5, 2, 1.5, 8, 3.2);       // hall A
    this.zone(-1.5, -8, 1.5, 2, 3.2);   // corridor 2
    this.zone(1.5, 2, 10, 8, 3.2);      // kids
    this.zone(-10, -8, -1.5, 2, 3.2);   // master
    this.zone(1.5, -8, 10, 2, 3.2);     // study
    // stairs
    this.stairZone(-10, 2, -7.5, 8, 'z', 0, 1.6);    // flight A up
    this.zone(-10, 7.4, -5, 8, 1.6);                 // landing
    this.stairZone(-7.5, 2, -5, 8, 'z', 3.2, 1.6);   // flight B up (z=2 -> top)
    // basement
    this.stairZone(10, -7, 13, -3, 'x', 0, -2.6);
    this.zone(13, -8, 14.5, -2, -2.6);

    // 2F slab (ground-floor ceiling) with stairwell hole x[-10,-5] z[2,8]
    this.box(-7.5, 3.1, -3, 5, 0.2, 10, m.wallOut, false, false);
    this.box(2.5, 3.1, 5, 15, 0.2, 6, m.wallOut, false, false);
    this.box(2.5, 3.1, -3, 15, 0.2, 10, m.wallOut, false, false);
    // 2F top ceiling
    this.box(0, 6.4, 0, 20.5, 0.2, 16.5, m.wallOut, false, false);

    // stair flights (solid steps)
    for (let k = 0; k < 6; k++) {
      const top = ((k + 1) / 6) * 1.6;
      this.box(-8.75, top / 2, 2 + k + 0.5, 2.5, top, 1, m.wood, true, true);      // flight A
    }
    for (let k = 0; k < 6; k++) {
      const top = 1.6 + ((k + 1) / 6) * 1.6;
      this.box(-6.25, top / 2, 8 - k - 0.5, 2.5, top, 1, m.wood, true, true);     // flight B
    }
    this.box(-7.5, 0.8, 7.7, 5, 1.6, 0.6, m.wood, true, true); // landing mass
    // railing between hall A and stairwell (opening at stair top z[2,3])
    this.box(-4.95, 3.75, 5.5, 0.1, 1.1, 5, m.woodDark, false, true);
    // handrails on the stair flights
    const railA = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 5.9), m.woodDark);
    railA.position.set(-9.88, 1.7, 5);
    railA.rotation.x = -0.26;
    this.group.add(railA);
    const railB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 5.9), m.woodDark);
    railB.position.set(-7.42, 3.3, 5);
    railB.rotation.x = 0.26;
    this.group.add(railB);

    // ================= GROUND-FLOOR WALLS =================
    // front (south) wall
    this.wall(-10, 8, 10, 8, {
      openings: [
        { at: -6.5, width: 1.6, kind: 'window', windowId: 'W1', name: 'living room window' },
        { at: 0, width: 1.1, kind: 'door', doorId: 'front', name: 'Front door', sign: -1 },
        { at: 6.5, width: 1.6, kind: 'window', windowId: 'W2', name: 'kitchen window' },
      ],
    });
    // rear (north) wall
    this.wall(-10, -8, 10, -8, {
      openings: [
        { at: 8, width: 1.6, kind: 'window', windowId: 'W6', name: 'workshop window' },
      ],
    });
    // west wall
    this.wall(-10, -8, -10, 8, {
      openings: [
        { at: 4, width: 1.6, kind: 'window', windowId: 'W3', name: 'living room side window' },
        { at: -5, width: 1.6, kind: 'window', windowId: 'W4', name: 'garage window' },
      ],
    });
    // east wall
    this.wall(10, -8, 10, 8, {
      openings: [
        { at: 5, width: 1.6, kind: 'window', windowId: 'W5', name: 'kitchen side window' },
        { at: -5, width: 1.4, kind: 'arch' }, // steel basement door opening
      ],
    });
    // corridor west wall
    this.wall(-1.5, -8, -1.5, 8, {
      mat: m.wallIn,
      openings: [
        { at: 5, width: 1.1, kind: 'door', doorId: 'living', name: 'Living room door' },
        { at: -4, width: 1.1, kind: 'door', doorId: 'garage', name: 'Garage door' },
      ],
    });
    // corridor east wall
    this.wall(1.5, -8, 1.5, 8, {
      mat: m.wallIn,
      openings: [
        { at: 5, width: 1.1, kind: 'door', doorId: 'kitchen', name: 'Kitchen door' },
        { at: 0, width: 1.8, kind: 'arch' },
        { at: -5, width: 1.0, kind: 'door', doorId: 'bath', name: 'Bathroom door' },
      ],
    });
    // living/kitchen-south boundary z=2 (kitchen-dining divider)
    this.wall(1.5, 2, 10, 2, {
      mat: m.wallIn,
      openings: [{ at: 7, width: 1.8, kind: 'arch' }],
    });
    // z=-2 divider (workshop door)
    this.wall(-10, -2, 10, -2, {
      mat: m.wallIn,
      openings: [{ at: 8, width: 1.1, kind: 'door', doorId: 'workshop', name: 'Workshop door' }],
    });
    // bathroom/workshop divider
    this.wall(6, -8, 6, -2, { mat: m.wallIn });

    // ================= UPSTAIRS WALLS =================
    // front (south) 2F
    this.wall(-10, 8, 10, 8, {
      y: 3.2,
      openings: [
        { at: -2, width: 1.6, kind: 'window', windowId: 'W10', name: 'upstairs hall window' },
        { at: 6, width: 1.6, kind: 'window', windowId: 'W7', name: "kids' room window", ladder: true },
      ],
    });
    // rear (north) 2F
    this.wall(-10, -8, 10, -8, {
      y: 3.2,
      openings: [
        { at: 6, width: 1.6, kind: 'window', windowId: 'W9', name: 'study window' },
      ],
    });
    // west 2F
    this.wall(-10, -8, -10, 8, {
      y: 3.2,
      openings: [
        { at: -3, width: 1.6, kind: 'window', windowId: 'W8', name: 'bedroom window' },
      ],
    });
    // east 2F
    this.wall(10, -8, 10, 8, {
      y: 3.2,
      openings: [
        { at: 5, width: 1.6, kind: 'window', windowId: 'W11', name: "kids' room side window" },
      ],
    });
    // hall A west boundary (stair opening)
    this.wall(-5, 2, -5, 8, {
      y: 3.2, mat: m.wallIn,
      openings: [{ at: 2.8, width: 1.8, kind: 'arch' }],
    });
    // hall A / corridor2 boundary z=2 + master north wall
    this.wall(-10, 2, 1.5, 2, {
      y: 3.2, mat: m.wallIn,
      openings: [
        { at: -4, width: 1.1, kind: 'door', doorId: 'master', name: 'Bedroom door' },
        { at: 0, width: 1.8, kind: 'arch' },
      ],
    });
    // kids west wall
    this.wall(1.5, 2, 1.5, 8, {
      y: 3.2, mat: m.wallIn,
      openings: [{ at: 5, width: 1.1, kind: 'door', doorId: 'kids', name: "Kids' room door" }],
    });
    // study west wall (locked)
    this.wall(1.5, -8, 1.5, 2, {
      y: 3.2, mat: m.wallIn,
      openings: [{ at: -4, width: 1.1, kind: 'door', doorId: 'study', name: 'Study door', locked: true }],
    });
    // master east wall
    this.wall(-1.5, -8, -1.5, 2, { y: 3.2, mat: m.wallIn });

    // ================= ROOF =================
    const roofL = new THREE.Mesh(new THREE.BoxGeometry(21, 0.3, 10.5), m.wallOut);
    roofL.position.set(0, 7.6, -4.3);
    roofL.rotation.x = 0.42;
    this.group.add(roofL);
    const roofR = new THREE.Mesh(new THREE.BoxGeometry(21, 0.3, 10.5), m.wallOut);
    roofR.position.set(0, 7.6, 4.3);
    roofR.rotation.x = -0.42;
    this.group.add(roofR);
    this.deco(4, 8.4, 0, 1, 2.2, 1, m.wallOut); // chimney

    // ================= BASEMENT BUNKER =================
    this.box(12.25, -1.35, -8.2, 4.7, 2.7, 0.24, m.concrete, true, true);   // north
    this.box(12.25, -1.35, -1.8, 4.7, 2.7, 0.24, m.concrete, true, true);    // south
    this.box(14.6, -1.35, -5, 0.24, 2.7, 6.4, m.concrete, true, true);      // east
    this.box(12.2, -2.7, -5, 4.4, 0.2, 6.4, m.concrete, false, false);      // bunker floor
    for (let k = 0; k < 10; k++) {
      const x = 10 + k * 0.3 + 0.15;
      const yTop = -((x - 10) / 3) * 2.6;
      const h = yTop + 2.6;
      this.deco(x, yTop - h / 2, -5, 0.3, h, 3.8, m.concrete);
    }
    // basement props: crates, jar shelf, hanging bulb
    this.deco(12.4, -2.35, -3.2, 0.55, 0.55, 0.55, m.woodDark);
    this.deco(13.1, -2.35, -3.4, 0.45, 0.45, 0.45, m.woodDark);
    this.deco(12.4, -1.78, -3.2, 0.5, 0.15, 0.5, m.wood);
    this.deco(12.2, -1.7, -7.2, 1.6, 0.08, 0.4, m.woodDark);
    for (let j = 0; j < 4; j++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8), m.glass);
      jar.position.set(11.6 + j * 0.4, -1.55, -7.2);
      this.group.add(jar);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    bulb.position.set(12.5, -0.9, -5);
    this.group.add(bulb);
    this.deco(12.5, -0.45, -5, 0.02, 0.9, 0.02, m.dark); // cord
    // steel door (in workshop east wall opening)
    const bp = new THREE.Group();
    bp.position.set(10, 0, -5.7);
    const steel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 1.36), m.steelDark);
    steel.position.set(0, 1.25, 0.68);
    bp.add(steel);
    this.basement.lockMeshes = {};
    KEY_IDS.forEach((k, i) => {
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.16),
        new THREE.MeshLambertMaterial({ color: KEY_HEX[k] }));
      lock.position.set(-0.13, 1.45 - i * 0.35, 0.35 + i * 0.35);
      bp.add(lock);
      this.basement.locks[k] = false;
    });
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 14), m.metal);
    wheel.position.set(-0.14, 1.25, 0.68);
    wheel.rotation.y = Math.PI / 2;
    bp.add(wheel);
    this.group.add(bp);
    this.basement.pivot = bp;
    this.basement.aabb = AABB.box(10, 1.25, -5, 0.3, 2.5, 1.4);

    // ================= FURNITURE =================
    // Living room
    this.box(-5.5, 0.21, -1.35, 2.2, 0.42, 0.85, m.sofa, false, true);
    this.box(-5.5, 0.55, -1.72, 2.2, 0.62, 0.22, m.sofa, false, true);
    this.box(-6.4, 0.32, -0.9, 0.24, 0.64, 0.8, m.sofa, false, true);
    this.box(-4.6, 0.32, -0.9, 0.24, 0.64, 0.8, m.sofa, false, true);
    this.box(-5.5, 0.19, 0.4, 1.1, 0.38, 0.6, m.wood, false, true);
    this.box(-1.95, 0.25, 5.2, 0.5, 0.5, 1.5, m.dark, false, true);
    // TV on a stand with an emissive screen facing the sofa
    this.deco(-1.9, 0.35, 5.2, 0.5, 0.7, 1.3, m.woodDark);
    this.deco(-1.9, 0.78, 5.2, 0.1, 0.08, 1.15, m.dark);
    this.deco(-1.9, 1.05, 5.2, 0.08, 0.55, 1.0, m.dark);
    const tvScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x1a2840 })
    );
    tvScreen.position.set(-1.95, 1.05, 5.2);
    tvScreen.rotation.y = -Math.PI / 2;
    this.group.add(tvScreen);
    this.box(-9.4, 0.9, 0.3, 0.5, 1.8, 1.6, m.wood, true, true);
    // shelves + books
    const bookCols = [0xd94a4a, 0x4a7ad9, 0xd9c84a, 0x4ad97a, 0xa06a90];
    for (const sy of [0.52, 1.02, 1.52]) {
      this.deco(-9.4, sy, 0.3, 0.46, 0.05, 1.56, m.woodDark);
      for (let b = 0; b < 5; b++) {
        const bh = 0.26 + (b % 3) * 0.04;
        this.deco(-9.4, sy + 0.025 + bh / 2, -0.32 + b * 0.31, 0.3, bh, 0.2,
          new THREE.MeshLambertMaterial({ color: bookCols[(b + Math.floor(sy)) % 5] }));
      }
    }
    this.box(-4, 0.4, 6.6, 0.9, 0.8, 0.9, m.sofa, false, true); // armchair
    // sofa cushions + a throw pillow
    this.deco(-6.1, 0.47, -1.35, 0.9, 0.16, 0.72, m.sofa);
    this.deco(-4.9, 0.47, -1.35, 0.9, 0.16, 0.72, m.sofa);
    this.deco(-5.5, 0.68, -1.5, 0.34, 0.34, 0.34, new THREE.MeshLambertMaterial({ color: 0xa06a90 }));
    this.deco(-1.7, 0.9, 3, 0.05, 1.8, 0.05, m.metal);
    this.deco(-1.7, 1.6, 3, 0.35, 0.3, 0.35, m.car);
    // rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), m.carpet);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-5.5, 0.012, 0.2);
    this.group.add(rug);

    // Kitchen
    this.box(9.3, 0.45, 5, 1.1, 0.9, 5, m.wood, false, true);
    this.deco(9.3, 0.95, 5, 1.1, 0.08, 5, m.dark);
    this.deco(8.1, 1.02, 4.2, 0.5, 0.12, 0.5, m.metal); // sink
    this.deco(8.1, 1.05, 6.2, 0.6, 0.14, 0.6, m.dark);  // stove
    this.box(2.4, 0.9, 7.2, 0.9, 1.8, 0.8, m.fridge, true, true);
    this.deco(2.85, 1.2, 7.2, 0.06, 0.5, 0.06, m.metal);
    this.makeContainer('fridge', 'Fridge', 2.4, 0.9, 6.9, 'key_red', 'RED key');
    this.box(5, 0.37, 4, 1.4, 0.75, 0.9, m.wood, false, true);
    this.box(4.1, 0.25, 4, 0.42, 0.5, 0.42, m.woodDark, false, true);
    this.box(5.9, 0.25, 4, 0.42, 0.5, 0.42, m.woodDark, false, true);
    for (const cz of [3, 4.2, 5.4]) this.addItem('can', 9.3, 1.06, cz, true);
    // upper kitchen cabinets (decorative)
    this.deco(9.3, 1.82, 2.9, 1.1, 0.55, 4.4, m.wood);

    // Dining
    this.box(5.5, 0.37, 0, 2.2, 0.75, 1.0, m.wood, false, true);
    for (const [cx, cz] of [[4.3, 0.9], [6.7, 0.9], [4.3, -0.9], [6.7, -0.9]]) {
      this.box(cx, 0.23, cz, 0.4, 0.46, 0.4, m.woodDark, false, true);
    }
    this.box(3, 0.6, -1.5, 1.2, 1.2, 0.5, m.wood, true, true);
    this.addItem('box', 5.5, 0.89, 0.2, true);

    // Bathroom
    this.box(5.3, 0.3, -7.2, 0.5, 0.6, 0.55, m.white, false, true);
    this.deco(5.3, 0.65, -7.2, 0.36, 0.5, 0.3, m.white);
    this.box(5.3, 0.45, -3.4, 0.5, 0.9, 0.6, m.white, false, true);
    this.deco(5.7, 1.5, -3.4, 0.04, 0.7, 0.5, m.glass);
    this.box(2.4, 0.27, -6.6, 0.85, 0.55, 1.8, m.white, false, true);
    // towel on the wall
    this.deco(1.82, 1.35, -6.6, 0.06, 0.5, 0.36, m.blanketPink);
    this.deco(1.82, 1.62, -6.6, 0.1, 0.08, 0.1, m.metal);
    this.box(2.2, 0.45, -2.6, 0.6, 0.9, 0.45, m.wood, false, true);
    this.makeContainer('cabinet', 'Bathroom cabinet', 2.2, 0.45, -2.6, 'lockpick', 'lockpick');

    // Workshop
    this.box(8, 0.45, -7.3, 2.6, 0.9, 0.9, m.wood, false, true);
    this.deco(8, 1.6, -7.9, 2.2, 1.0, 0.08, m.woodDark);
    this.box(6.6, 0.3, -6.2, 0.6, 0.6, 0.6, m.woodDark, false, true);
    this.box(6.6, 0.85, -6.2, 0.5, 0.5, 0.5, m.woodDark, false, true);

    // Garage
    this.box(-6, 0.55, -5, 3.4, 0.55, 1.6, m.car, true, true);
    this.deco(-6, 1.05, -5, 1.7, 0.42, 1.34, m.glass); // glass cabin
    for (const [wx2, wz2] of [[-7.6, -5.8], [-7.6, -4.2], [-4.4, -5.8], [-4.4, -4.2]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14), m.dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx2, 0.32, wz2);
      this.group.add(wheel);
    }
    // bumpers + head/tail lights
    this.deco(-6, 0.45, -4.1, 3.2, 0.14, 0.16, m.metal);
    this.deco(-6, 0.45, -5.9, 3.2, 0.14, 0.16, m.metal);
    for (const z2 of [-5.4, -4.6]) {
      this.deco(-4.28, 0.6, z2, 0.06, 0.14, 0.22, new THREE.MeshBasicMaterial({ color: 0xd9e8a0 }));
      this.deco(-7.72, 0.6, z2, 0.06, 0.12, 0.2, new THREE.MeshBasicMaterial({ color: 0xd93a3a }));
    }
    this.box(-9.55, 0.9, -3, 0.55, 1.8, 1.6, m.wood, true, true);
    this.makeContainer('shelf', 'Garage shelf', -9.4, 1.5, -3, 'crowbar', 'crowbar');
    this.box(-3, 0.3, -7.4, 0.7, 0.6, 0.7, m.woodDark, false, true);
    this.addItem('box', -3, 0.75, -7.4, true);

    // Corridor (ground)
    this.deco(-1.25, 0.85, 7.4, 0.08, 1.7, 0.08, m.woodDark);
    this.deco(-1.25, 1.6, 7.55, 0.2, 0.2, 0.5, m.woodDark);
    this.box(1.1, 0.35, 7.3, 0.5, 0.7, 0.4, m.wood, false, true);
    this.deco(-1.38, 1.7, 2, 0.02, 0.6, 0.8, m.blanketBlue);
    // runner carpet + framed paintings
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 12), m.carpet);
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, 0.015, 0);
    this.group.add(runner);
    this.deco(-1.37, 1.7, -3, 0.02, 0.7, 0.55, new THREE.MeshLambertMaterial({ color: 0x6a8a5a }));
    this.deco(-1.37, 1.7, -5.5, 0.02, 0.55, 0.7, new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
    this.deco(1.37, 1.7, 4, 0.02, 0.65, 0.5, new THREE.MeshLambertMaterial({ color: 0x5a6a8a }));

    // Upstairs hall
    this.box(1.0, 3.55, 7.3, 0.5, 0.7, 0.4, m.wood, false, true);
    this.deco(-4.9, 4.9, 6, 0.02, 0.7, 0.9, m.blanketPink);
    this.deco(-4.87, 4.6, 5, 0.02, 0.6, 0.8, new THREE.MeshLambertMaterial({ color: 0x7a5a8a }));
    // Corridor 2
    this.deco(1.2, 4.05, 1.4, 0.07, 1.7, 0.07, m.woodDark);
    this.deco(1.35, 5.3, 1.4, 0.25, 0.12, 0.4, m.woodDark);

    // Kids' room
    this.box(8.7, 3.4, 6.5, 2.0, 0.42, 1.05, m.wood, false, true);
    this.deco(8.7, 3.75, 6.5, 1.9, 0.22, 0.95, m.blanketPink);
    this.deco(8.7, 3.95, 6.95, 0.5, 0.12, 0.35, m.white);
    this.deco(8.7, 3.85, 7.12, 2.1, 0.55, 0.12, m.woodDark); // headboard
    this.box(3.1, 3.5, 6.8, 1.2, 0.6, 0.7, m.wood, false, true);
    this.deco(3.1, 3.86, 6.8, 1.18, 0.13, 0.68, m.woodDark);
    this.makeContainer('chest', 'Toy chest', 3.1, 3.86, 6.8, 'key_blue', 'BLUE key');
    this.box(6, 3.45, 3, 0.8, 0.5, 0.8, m.wood, false, true);
    for (let i = 0; i < 4; i++) {
      this.deco(5.6 + i * 0.28, 3.78 + (i % 2) * 0.15, 2.7 + (i % 2) * 0.3, 0.16, 0.16, 0.16,
        new THREE.MeshLambertMaterial({ color: [0xd94a4a, 0x4a7ad9, 0xd9c84a, 0x4ad97a][i] }));
    }

    // Master bedroom
    this.box(-7.5, 3.42, -6.3, 2.2, 0.45, 1.8, m.wood, false, true);
    this.deco(-7.5, 3.78, -6.3, 2.1, 0.24, 1.7, m.blanketBlue);
    this.deco(-8.3, 3.98, -6.3, 0.45, 0.12, 0.6, m.white);
    this.deco(-7.5, 3.85, -7.3, 2.3, 0.6, 0.12, m.woodDark); // headboard
    this.box(-2.1, 4.3, -4, 0.6, 2.2, 1.4, m.wood, true, true);
    this.box(-9.5, 3.65, -2.6, 1.4, 0.9, 0.5, m.wood, false, true);
    this.addItem('box', -9.5, 4.25, -2.6, true);
    this.box(-8.9, 3.55, -7.6, 0.45, 0.7, 0.45, m.wood, false, true);
    this.deco(-8.9, 4.1, -7.6, 0.3, 0.26, 0.3, m.car);

    // Study (locked room)
    this.box(8.8, 3.57, -6.5, 1.6, 0.75, 0.8, m.wood, false, true);
    this.makeContainer('desk', 'Study desk', 8.6, 4.1, -6.5, 'key_green', 'GREEN key');
    this.box(8.5, 3.55, -5.4, 0.42, 0.5, 0.42, m.woodDark, false, true);
    this.box(1.95, 4.3, -5, 0.5, 2.2, 1.6, m.wood, true, true);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshLambertMaterial({ color: 0x3a6a8a }));
    globe.position.set(3.5, 4.05, -7.2);
    this.group.add(globe);
    this.deco(3.5, 3.83, -7.2, 0.08, 0.34, 0.08, m.woodDark);

    // contact shadows under the big furniture
    this.blobShadow(-6, 0.02, -5, 2.0);        // car
    this.blobShadow(-5.5, 0.02, -1.35, 1.3);  // sofa
    this.blobShadow(-4, 0.02, 6.6, 0.7);      // armchair
    this.blobShadow(5.5, 0.02, 0, 1.3);       // dining table
    this.blobShadow(2.4, 0.02, 7.2, 0.8);     // fridge
    this.blobShadow(8, 0.02, -7.3, 1.4);      // workbench
    this.blobShadow(5.3, 0.02, -3.4, 0.6);    // toilet
    this.blobShadow(2.4, 0.02, -6.6, 0.9);    // bathtub
    this.blobShadow(-6, 3.22, -6.3, 1.4);     // master bed
    this.blobShadow(8.7, 3.22, 6.5, 1.2);     // kids bed
    this.blobShadow(8.8, 3.22, -6.5, 1.0);    // study desk
    this.blobShadow(-9.4, 0.02, 0.3, 1.0);    // bookshelf

    // hidden container items
    const fridgeItem = this.addItem('key_red', 2.4, 0.09, 6.6, false);
    fridgeItem.mesh.visible = false;
    const chestItem = this.items.find((i) => i.kind === 'key_blue'); // created by container? no:
    // (container items are created here)
    const blueItem = this.addItem('key_blue', 3.1, 4.0, 6.8, false);
    blueItem.mesh.visible = false;
    const greenItem = this.addItem('key_green', 8.6, 4.02, -6.5, false);
    greenItem.mesh.visible = false;
    const pickItem = this.addItem('lockpick', 2.2, 0.93, -2.6, false);
    pickItem.mesh.visible = false;
    const crowbarItem = this.addItem('crowbar', -9.3, 1.86, -3.1, false);
    crowbarItem.mesh.visible = false;

    // ================= LIGHTS =================
    const hemi = new THREE.HemisphereLight(0x3a4a6a, 0x1a1a20, 0.55);
    this.scene.add(hemi);
    const moonL = new THREE.DirectionalLight(0x8a9ac4, 0.9);
    moonL.position.set(30, 40, -25);
    this.scene.add(moonL);
    const pt = (x, y, z, dist = 10, ceil = 3.0) => {
      const l = new THREE.PointLight(0xffd9a0, 7, dist, 1.8);
      l.position.set(x, y, z);
      this.scene.add(l);
      this.deco(x, y + 0.18, z, 0.16, 0.1, 0.16, m.metal);
      // cord up to the ceiling
      if (ceil - y - 0.28 > 0.05) {
        this.deco(x, (y + 0.28 + ceil) / 2, z, 0.02, ceil - y - 0.28, 0.02, m.dark);
      }
    };
    pt(0, 2.7, 5.5); pt(0, 2.7, -2);
    pt(-6.5, 2.7, 4); pt(6, 2.7, 5); pt(6, 2.7, 0); pt(3.75, 2.7, -5);
    pt(8, 2.7, -5); pt(-5.5, 2.7, -5);
    pt(-1.75, 5.9, 5, 10, 6.3); pt(0, 5.9, -3, 10, 6.3); pt(6, 5.9, 5, 10, 6.3);
    pt(-5.5, 5.9, -3, 10, 6.3); pt(6, 5.9, -4, 10, 6.3);
    const redL = new THREE.PointLight(0xff3322, 5, 9, 1.6);
    redL.position.set(13.5, -1.2, -5);
    this.scene.add(redL);
    this.basementLight = redL;

    // ================= NAV GRAPH =================
    this.node('gOut', 0, 0, 10.5, 'yard', []);
    this.node('cF', 0, 0, 5.5, 'cor', ['gOut']);
    this.node('cM', 0, 0, 0, 'cor', ['cF']);
    this.node('cS', 0, 0, -5, 'cor', ['cM']);
    this.node('dCor', 0.9, 0, 5, 'cor', ['cF']);
    this.node('liv', -6, 0, 0, 'liv', []);
    this.node('livE', -3, 0, 6, 'liv', ['liv']);
    this.node('dLivB', -2.4, 0, 5, 'liv', []);
    this.node('kit', 7, 0, 5, 'kit', []);
    this.node('dKitB', 2.4, 0, 5, 'kit', []);
    this.node('din', 7, 0, 0, 'din', []);
    this.node('bath', 3.75, 0, -5, 'bath', []);
    this.node('work', 8, 0, -5, 'work', []);
    this.node('baseDoor', 9.2, 0, -5, 'work', ['work']);
    this.node('gar', -5.5, 0, -5, 'gar', []);
    this.node('dGarA', -0.7, 0, -4, 'cor', []);
    this.node('dGarB', -2.3, 0, -4, 'gar', ['gar']);
    this.node('sa_bot', -8.75, 0, 2.8, 'liv', []);
    this.node('sa_top', -8.75, 1.6, 7.6, 'liv', ['sa_bot']);
    this.node('sb_bot', -6.25, 1.6, 7.6, 'liv', ['sa_top']);
    this.node('sb_top', -6.25, 3.2, 2.6, 'hall2', ['sb_bot']);
    this.node('hA', -1.75, 3.2, 5, 'hall2', ['sb_top']);
    this.node('dHA', 0, 3.2, 2.8, 'hall2', ['hA']);
    this.node('dC2', 0, 3.2, 1.2, 'cor2', ['dHA']);
    this.node('c2', 0, 3.2, -3, 'cor2', ['dC2']);
    this.node('kids', 6, 3.2, 5, 'kids', []);
    this.node('dMasterA', -4, 3.2, 3, 'hall2', []);
    this.node('dMasterB', -4, 3.2, 0.8, 'master', []);
    this.node('master', -6, 3.2, -3, 'master', ['dMasterB']);
    this.node('dStudyA', 0.7, 3.2, -4, 'cor2', []);
    this.node('dStudyB', 2.3, 3.2, -4, 'study', []);
    this.node('study', 6, 3.2, -4, 'study', ['dStudyB']);
    // extra links
    this.link('dCor', 'dLivB');
    this.link('dLivB', 'livE');
    this.link('dCor', 'dKitB');
    this.link('dKitB', 'kit');
    this.link('cM', 'din');
    this.link('kit', 'din');
    this.link('cS', 'bath');
    this.link('din', 'work');
    this.link('cS', 'dGarA');
    this.link('dGarA', 'dGarB');
    this.link('liv', 'sa_bot');
    this.link('hA', 'kids');
    this.link('hA', 'dMasterA');
    this.link('dMasterA', 'dMasterB');
    this.link('c2', 'dStudyA');
    this.link('dStudyA', 'dStudyB');
    this.link('cM', 'cS');

    // trap/camera initial state from persistent memory is applied by Game on reset
  }

  // ---------- steel basement door ----------
  openBasement() {
    this.basement.open = true;
  }

  // ---------- per-frame ----------
  update(dt) {
    this.time += dt;
    // flickering basement light
    if (this.basementLight) {
      this.basementLight.intensity = 5 + Math.sin(this.time * 6.3) * 0.7 +
        (Math.random() < 0.015 ? -2.5 : 0);
    }
    for (const d of this.doors) {
      const dir = Math.sign(d.target - d.t);
      if (dir !== 0) d.t = clamp(d.t + dir * dt * 2.2, 0, 1);
      d.pivot.rotation.y = d.sign * d.t * 1.95;
    }
    if (this.basement.open) {
      this.basement.pivot.rotation.y = Math.max(-1.5, this.basement.pivot.rotation.y - dt * 1.2);
      this.basement.aabb = null;
    }
    for (const it of this.items) {
      if (it.taken || !it.revealed) continue;
      it.mesh.rotation.y += dt * 1.2;
      it.mesh.position.y = it.baseY + Math.sin(this.time * 2 + it.x) * 0.012;
    }
    for (const trap of this.traps) {
      if (trap.snapT > 0) {
        trap.snapT -= dt;
        trap.jawL.rotation.x = -0.05;
        trap.jawR.rotation.x = 0.05;
      }
    }
    for (const cam of this.cameras) {
      cam.head.rotation.y = cam.baseAngle + Math.sin(this.time * 0.6) * 0.9;
    }
  }
}
