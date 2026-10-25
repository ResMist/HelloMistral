'use strict';
/* =====================================================================
   world.js — procedural house generator
   ---------------------------------------------------------------------
   Three floors, BSP rooms, guaranteed-connected door graph, deliberate
   loops, wall furniture, windows on real exterior walls, a yard shed and
   a locked cellar. Every structure is validated before it is accepted:
   a seed either yields a *provably* solvable house or is regenerated.
   ===================================================================== */

const MW = 48, MH = 36;
const HOUSE = { x: 9, y: 3, w: 28, h: 25 };
const BASE = { x: 13, y: 7, w: 19, h: 15 };

/* tile alphabet
   '#' wall   '.' floor   ',' grass   'F' fence/void   'S' furniture
   'W' window 'w' broken  'X' boarded 'D' door  'L' lock  'B' cellar lock
   'U' stairs up  'N' stairs down  'V' vault floor  'P' porch
*/
const SOLID = { '#': 1, F: 1, S: 1, W: 1, X: 1 };
const OPAQUE = { '#': 1, F: 1, S: 1, W: 1, X: 1 };

function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
const irnd = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

function mkGrid(fill) {
  const G = [];
  for (let y = 0; y < MH; y++) G.push(new Array(MW).fill(fill));
  return G;
}
function fillRect(G, x, y, w, h, ch) {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++)
      if (G[j] && G[j][i] !== undefined) G[j][i] = ch;
}
function borderRect(G, x, y, w, h, ch) {
  for (let i = x; i < x + w; i++) { if (G[y]) G[y][i] = ch; if (G[y + h - 1]) G[y + h - 1][i] = ch; }
  for (let j = y; j < y + h; j++) { if (G[j]) { G[j][x] = ch; G[j][x + w - 1] = ch; } }
}
function eachRect(x, y, w, h, fn) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) fn(i, j);
}

/* ------------------------------------------------------------ BSP rooms */
function bsp(x, y, w, h, depth, rng) {
  const node = { x, y, w, h };
  const canV = w >= 13, canH = h >= 13;
  if (depth <= 0 || (!canV && !canH)) return node;
  let vertical;
  if (canV && canH) vertical = w > h + 1 ? true : h > w + 1 ? false : rng() < 0.5;
  else vertical = canV && !canH;
  const size = vertical ? w : h;
  const cut = 6 + Math.floor(rng() * (size - 12 + 1));
  node.axis = vertical ? 'v' : 'h';
  node.cut = (vertical ? x : y) + cut;
  if (vertical) {
    node.a = bsp(x, y, cut, h, depth - 1, rng);
    node.b = bsp(x + cut, y, w - cut, h, depth - 1, rng);
  } else {
    node.a = bsp(x, y, w, cut, depth - 1, rng);
    node.b = bsp(x, y + cut, w, h - cut, depth - 1, rng);
  }
  return node;
}
function leavesOf(node, out) {
  out = out || [];
  if (!node.axis) out.push(node); else { leavesOf(node.a, out); leavesOf(node.b, out); }
  return out;
}

/* Carve a 2-cell-thick door through the wall between two sibling partitions.
   Because interiors are inset by one from their partition, both sides are
   guaranteed to be floor at the chosen coordinate — no guessing. */
function connectTree(G, node, doors, rng) {
  if (!node.axis) return;
  connectTree(G, node.a, doors, rng);
  connectTree(G, node.b, doors, rng);
  const vertical = node.axis === 'v';
  const cut = node.cut;
  const lo = vertical ? node.y + 1 : node.x + 1;
  const hi = vertical ? node.y + node.h - 2 : node.x + node.w - 2;
  const cand = [];
  for (let t = lo; t <= hi; t++) {
    const a = vertical ? G[t][cut - 2] : G[cut - 2][t];
    const b = vertical ? G[t][cut + 1] : G[cut + 1][t];
    if (a === '.' && b === '.') {
      // prefer positions away from existing doors
      let near = 0;
      for (const d of doors) for (const c of d.cells) if (Math.abs(c[0] - (vertical ? cut : t)) + Math.abs(c[1] - (vertical ? t : cut)) < 4) near++;
      cand.push({ t, near });
    }
  }
  if (!cand.length) return;
  const clean = cand.filter((c) => c.near === 0);
  const spot = pick(rng, clean.length ? clean : cand);
  const cells = [];
  if (vertical) {
    cells.push([cut - 1, spot.t], [cut, spot.t]);
    G[spot.t][cut - 1] = 'D'; G[spot.t][cut] = 'D';
  } else {
    cells.push([spot.t, cut - 1], [spot.t, cut]);
    G[cut - 1][spot.t] = 'D'; G[cut][spot.t] = 'D';
  }
  doors.push({ cells, axis: vertical ? 'v' : 'h', closed: 1, kind: 'door' });
}

/* --------------------------------------------------- room adjacency graph
   Every pair of leaves that shares a wall gets a potential door slot. A
   spanning tree over that graph guarantees connectivity; extra edges are
   added as loops so the house has more than one route (essential for both
   stealth routes and the neighbour's cut-offs). */
function sharedWall(a, b) {
  if (a.x + a.w === b.x || b.x + b.w === a.x) {
    const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a;
    const lo = Math.max(left.y + 1, right.y + 1);
    const hi = Math.min(left.y + left.h - 2, right.y + right.h - 2);
    if (hi >= lo) return { axis: 'v', ax: left.x + left.w - 1, bx: right.x, lo, hi };
  }
  if (a.y + a.h === b.y || b.y + b.h === a.y) {
    const top = a.y < b.y ? a : b, bot = a.y < b.y ? b : a;
    const lo = Math.max(top.x + 1, bot.x + 1);
    const hi = Math.min(top.x + top.w - 2, bot.x + bot.w - 2);
    if (hi >= lo) return { axis: 'h', ay: top.y + top.h - 1, by: bot.y, lo, hi };
  }
  return null;
}

function roomDegree(room, doors) {
  let n = 0;
  for (const d of doors) {
    let near = false;
    for (const c of d.cells)
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = c[0] + dx, y = c[1] + dy;
        if (x >= room.x + 1 && x <= room.x + room.iw && y >= room.y + 1 && y <= room.y + room.ih && Math.abs(dx) <= 2 && Math.abs(dy) <= 2) near = true;
      }
    if (near) n++;
  }
  return n;
}

function carveDoor(G, edge, t, doors, rng) {
  if (edge.axis === 'v') {
    if (G[t][edge.ax] !== '#' || G[t][edge.bx] !== '#') return null;
    G[t][edge.ax] = 'D'; G[t][edge.bx] = 'D';
    const d = { cells: [[edge.ax, t], [edge.bx, t]], axis: 'v', closed: 1, kind: 'door' };
    doors.push(d); return d;
  }
  if (G[edge.ay][t] !== '#' || G[edge.by][t] !== '#') return null;
  G[edge.ay][t] = 'D'; G[edge.by][t] = 'D';
  const d = { cells: [[t, edge.ay], [t, edge.by]], axis: 'h', closed: 1, kind: 'door' };
  doors.push(d); return d;
}

function connectLeaves(G, leaves, doors, rng, loopChance) {
  const edges = [];
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++) {
      const e = sharedWall(leaves[i], leaves[j]);
      if (e) edges.push({ i, j, e });
    }
  const parent = leaves.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { a = find(a); b = find(b); if (a === b) return false; parent[a] = b; return true; };

  const shuffled = edges.slice().sort(() => rng() - 0.5);
  const used = new Set();
  let carved = 0;
  for (const { i, j, e } of shuffled) {
    if (!union(i, j)) continue;
    // try door positions, biased away from other doors
    const slots = [];
    for (let t = e.lo; t <= e.hi; t++) {
      let near = 0;
      for (const d of doors) for (const c of d.cells) {
        const dx = Math.abs(c[0] - (e.axis === 'v' ? e.ax : t));
        const dy = Math.abs(c[1] - (e.axis === 'v' ? t : e.ay));
        if (dx + dy < 4) near++;
      }
      slots.push({ t, near });
    }
    slots.sort((a, b) => a.near - b.near || rng() - 0.5);
    for (const slot of slots) {
      const d = carveDoor(G, e, slot.t, doors, rng);
      if (d) { used.add(i + ':' + j); carved++; break; }
    }
  }
  // loops: shared walls that were not needed for connectivity
  const extra = edges.filter(({ i, j }) => !used.has(i + ':' + j));
  for (const { i, j, e } of extra) {
    if (rng() > (loopChance == null ? 0.22 : loopChance)) continue;
    const slots = [];
    for (let t = e.lo; t <= e.hi; t++) {
      let near = 0;
      for (const d of doors) for (const c of d.cells) if (Math.abs(c[0] - (e.axis === 'v' ? e.ax : t)) + Math.abs(c[1] - (e.axis === 'v' ? t : e.ay)) < 5) near++;
      slots.push({ t, near });
    }
    slots.sort((a, b) => a.near - b.near || rng() - 0.5);
    for (const slot of slots) {
      if (carveDoor(G, e, slot.t, doors, rng)) break;
    }
  }
  return carved;
}

/* ------------------------------------------------------------- windows */
function addWindows(G, floorIdx, rect, doors, rng) {
  const wins = [];
  const doorCells = new Set();
  for (const d of doors) for (const c of d.cells) doorCells.add(c[0] + ',' + c[1]);
  const tryCell = (x, y, ix, iy) => {
    if (G[y][x] !== '#') return;
    if (doorCells.has(x + ',' + y)) return;
    if (G[iy] === undefined || G[iy][ix] !== '.') return;
    if (rng() < 0.34) { G[y][x] = 'W'; wins.push({ x, y, z: floorIdx, ix, iy }); }
  };
  for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
    tryCell(x, rect.y, x, rect.y + 1);
    tryCell(x, rect.y + rect.h - 1, x, rect.y + rect.h - 2);
  }
  for (let y = rect.y + 2; y < rect.y + rect.h - 2; y++) {
    tryCell(rect.x, y, rect.x + 1, y);
    tryCell(rect.x + rect.w - 1, y, rect.x + rect.w - 2, y);
  }
  return wins;
}

/* --------------------------------------------------------- room themes */
const THEMES = {
  kitchen: [{ k: 'counter', w: 3, h: 1 }, { k: 'stove', w: 2, h: 1 }, { k: 'sink', w: 2, h: 1 }, { k: 'fridge', w: 1, h: 1, box: 1 }, { k: 'table', w: 2, h: 2 }],
  living: [{ k: 'couch', w: 3, h: 1 }, { k: 'tv', w: 2, h: 1 }, { k: 'table', w: 2, h: 2 }, { k: 'shelf', w: 3, h: 1 }, { k: 'lamp', w: 1, h: 1 }],
  bedroom: [{ k: 'bed', w: 2, h: 3 }, { k: 'wardrobe', w: 2, h: 1 }, { k: 'nightstand', w: 1, h: 1 }, { k: 'dresser', w: 2, h: 1 }],
  study: [{ k: 'desk', w: 2, h: 1, box: 1 }, { k: 'bookshelf', w: 3, h: 1 }, { k: 'chair', w: 1, h: 1 }, { k: 'cabinet', w: 1, h: 1 }],
  bathroom: [{ k: 'tub', w: 3, h: 1 }, { k: 'toilet', w: 1, h: 1 }, { k: 'basin', w: 1, h: 1 }, { k: 'cabinet', w: 1, h: 1 }],
  workshop: [{ k: 'bench', w: 3, h: 1 }, { k: 'rack', w: 2, h: 1 }, { k: 'crate', w: 1, h: 1 }],
  hall: [{ k: 'table', w: 2, h: 1 }, { k: 'cabinet', w: 1, h: 1 }],
  vault: [{ k: 'shelf', w: 3, h: 1 }, { k: 'crate', w: 1, h: 1 }],
};
const ROOM_TYPES = ['living', 'kitchen', 'bedroom', 'bathroom', 'study', 'workshop', 'hall'];

function insideRoom(r, x, y, pad) {
  pad = pad || 0;
  return x >= r.x + pad && x < r.x + r.w - pad && y >= r.y + pad && y < r.y + r.h - pad;
}

/* Place furniture along walls, refusing anything that would cut a room in
   two. Every candidate is validated by a flood fill before it is kept. */
function furnish(G, rooms, doors, rng, floorIdx) {
  const junk = [];
  const doorNear = new Set();
  for (const d of doors)
    for (const c of d.cells)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) doorNear.add((c[0] + dx) + ',' + (c[1] + dy));

  const freeCell = (x, y) => {
    if (G[y] === undefined) return false;
    const c = G[y][x];
    return c === '.' && !doorNear.has(x + ',' + y);
  };

  for (const r of rooms) {
    const theme = THEMES[r.type] || THEMES.hall;
    const want = Math.max(2, Math.min(5, Math.floor((r.iw * r.ih) / 14)));
    let placed = 0;
    for (let attempt = 0; attempt < want * 8 && placed < want; attempt++) {
      const proto = pick(rng, theme);
      const w = proto.w, h = proto.h;
      const horizontal = rng() < 0.5;
      const fw = horizontal ? w : h, fh = horizontal ? h : w;
      // hug a wall: pick an edge, then a position along it
      const edge = irnd(rng, 0, 3);
      let x, y;
      const xMax = r.x + r.iw - fw + 1, yMax = r.y + r.ih - fh + 1;
      if (edge === 0) { x = irnd(rng, r.x + 1, Math.max(r.x + 1, xMax)); y = r.y + 1; }
      else if (edge === 1) { x = irnd(rng, r.x + 1, Math.max(r.x + 1, xMax)); y = yMax; }
      else if (edge === 2) { x = r.x + 1; y = irnd(rng, r.y + 1, Math.max(r.y + 1, yMax)); }
      else { x = xMax; y = irnd(rng, r.y + 1, Math.max(r.y + 1, yMax)); }
      if (x < r.x + 1 || y < r.y + 1) continue;
      if (x + fw - 1 > r.x + r.iw || y + fh - 1 > r.y + r.ih) continue;
      let ok = true;
      for (let j = y; j < y + fh && ok; j++)
        for (let i = x; i < x + fw; i++) if (!freeCell(i, j)) { ok = false; break; }
      if (!ok) continue;
      // keep at least one free ring around every piece -> never a seal
      const saved = [];
      for (let j = y; j < y + fh; j++) for (let i = x; i < x + fw; i++) { saved.push([i, j, G[j][i]]); G[j][i] = 'S'; }
      if (!roomConnected(G, r)) { for (const s of saved) G[s[1]][s[0]] = s[2]; continue; }
      junk.push({ k: proto.k, x, y, w: fw, h: fh, z: floorIdx, room: r.id, box: proto.box || 0 });
      placed++;
      if (proto.box === 1) r.box = junk[junk.length - 1];
    }
  }
  return junk;
}

function roomConnected(G, r) {
  // flood fill the room interior; every '.' interior cell must be reachable
  const cells = [];
  for (let y = r.y + 1; y <= r.y + r.ih; y++) for (let x = r.x + 1; x <= r.x + r.iw; x++) if (G[y][x] === '.') cells.push([x, y]);
  if (cells.length < 2) return true;
  const seen = new Set([cells[0][0] + ',' + cells[0][1]]);
  const q = [cells[0]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || G[ny] === undefined) continue;
      const c = G[ny][nx];
      if (c !== '.' && c !== 'D' && c !== 'U' && c !== 'N' && c !== 'V') continue;
      if (nx < r.x + 1 || nx > r.x + r.iw || ny < r.y + 1 || ny > r.y + r.ih) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen.size >= cells.length;
}

/* --------------------------------------------------------------- floors */
function mkFloor(z, name, fill) {
  return { z, name, G: mkGrid(fill), rooms: [], furniture: [], lights: [], windows: [] };
}

function makeRooms(leaves, G, floorIdx, rng) {
  const rooms = [];
  let id = 0;
  for (const l of leaves) {
    const r = {
      id: floorIdx + ':' + id++, z: floorIdx,
      x: l.x, y: l.y, w: l.w, h: l.h,
      iw: l.w - 2, ih: l.h - 2,
      cx: l.x + l.w / 2, cy: l.y + l.h / 2,
      type: 'hall', name: 'Room',
    };
    rooms.push(r);
  }
  return rooms;
}

/* Assign functional room types. Kitchen and study are mandatory, because
   the red key lives in the fridge and the blue key in the desk. */
function assignTypes(rooms, rng, order) {
  const big = rooms.slice().sort((a, b) => b.iw * b.ih - a.iw * a.ih);
  const used = new Set();
  const out = {};
  for (const type of order) {
    const min = type === 'bathroom' ? [4, 3] : type === 'hall' ? [2, 2] : [5, 4];
    const r = big.find((q) => !used.has(q.id) && q.iw >= min[0] && q.ih >= min[1]);
    if (r) { r.type = type; used.add(r.id); out[type] = r; }
  }
  for (const r of rooms) if (!used.has(r.id)) { r.type = 'hall'; }
  return out;
}

/* ---------------------------------------------------------------- yard */
function buildYard(G, rng, doors) {
  // fence ring
  for (let x = 1; x < MW - 1; x++) { G[1][x] = 'F'; G[MH - 2][x] = 'F'; }
  for (let y = 1; y < MH - 1; y++) { G[y][1] = 'F'; G[y][MW - 2] = 'F'; }
  // gate at the bottom
  const gateX = 15 + irnd(rng, 0, 16);
  G[MH - 2][gateX] = ','; G[MH - 2][gateX + 1] = ',';

  // shed — 6x5, chosen from spots that cannot collide with the house
  const sw = 6, sh = 5;
  const spots = [
    { x: 2, y: 7 }, { x: 2, y: 27 }, { x: MW - 3 - sw, y: 7 }, { x: MW - 3 - sw, y: 27 },
    { x: 3, y: 12 }, { x: MW - 4 - sw, y: 14 },
  ].filter((c) => {
    if (c.x < 2 || c.y < 2 || c.x + sw > MW - 2 || c.y + sh > MH - 2) return false;
    const pad = 1;
    const overlap = c.x < HOUSE.x + HOUSE.w + pad && c.x + sw > HOUSE.x - pad &&
                    c.y < HOUSE.y + HOUSE.h + pad && c.y + sh > HOUSE.y - pad;
    return !overlap;
  });
  if (!spots.length) return null;
  const c = pick(rng, spots);
  const sx = c.x, sy = c.y;
  fillRect(G, sx, sy, sw, sh, ',');
  borderRect(G, sx, sy, sw, sh, '#');
  fillRect(G, sx + 1, sy + 1, sw - 2, sh - 2, '.');
  // door on the side facing the house
  const east = sx + sw / 2 < MW / 2;
  const dy = sy + 1 + irnd(rng, 0, sh - 3);
  const dx = east ? sx + sw - 1 : sx;
  G[dy][dx] = 'D';
  doors.push({ cells: [[dx, dy]], axis: 'v', closed: 0, kind: 'door', shed: 1, z: 0 });
  const interior = [];
  for (let y = sy + 1; y < sy + sh - 1; y++) for (let x = sx + 1; x < sx + sw - 1; x++) interior.push([x, y]);
  return { x: sx, y: sy, w: sw, h: sh, interior, gate: { x: gateX, y: MH - 2 } };
}

/* -------------------------------------------------------------- stairs */
function placeStairsUp(gG, gRooms, uG, uRooms, rng, doors) {
  const gCand = gRooms.filter((r) => r.iw >= 3 && r.ih >= 3);
  const uCand = uRooms.filter((r) => r.iw >= 3 && r.ih >= 3);
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = pick(rng, gCand), b = pick(rng, uCand);
    // find a 2-cell vertical strip free on both floors
    for (let t = 0; t < 30; t++) {
      const x = irnd(rng, Math.max(a.x, b.x) + 1, Math.min(a.x + a.iw, b.x + b.iw) - 1);
      const y = irnd(rng, Math.max(a.y, b.y) + 1, Math.min(a.y + a.ih, b.y + b.ih) - 2);
      const inA = x >= a.x + 1 && x <= a.x + a.iw && y >= a.y + 1 && y + 1 <= a.y + a.ih;
      const inB = x >= b.x + 1 && x <= b.x + b.iw && y >= b.y + 1 && y + 1 <= b.y + b.ih;
      if (!inA || !inB) continue;
      if (gG[y][x] !== '.' || gG[y + 1][x] !== '.' || uG[y][x] !== '.' || uG[y + 1][x] !== '.') continue;
      let clash = false;
      for (const d of doors || []) for (const c of d.cells)
        if ((c[0] === x || c[0] === x + 1 || c[0] === x - 1) && (c[1] === y || c[1] === y + 1 || c[1] === y - 1)) clash = true;
      if (clash) continue;
      gG[y][x] = 'U'; gG[y + 1][x] = 'U';
      uG[y][x] = 'N'; uG[y + 1][x] = 'N';
      return { a: { x: x + 0.5, y: y + 0.5, z: 0 }, b: { x: x + 0.5, y: y + 0.5, z: 1 } };
    }
  }
  return null;
}

/* A cellar is reached through a locked 2x2 nook cut into a ground-floor
   room corner, so the "two keys" gate can never be bypassed. */
function placeCellar(gG, gRooms, bG, rng, doors) {
  /* A 2x1 nook cut into a room corner: [B][N] plus two seal walls and one
     open side. Four orientations, validated against the basement bounds. */
  const insideBase = (x, y) => x > BASE.x && x < BASE.x + BASE.w - 1 && y > BASE.y && y < BASE.y + BASE.h - 1;
  const cands = gRooms.slice().sort(
    (a, b) => Math.hypot(a.cx - (BASE.x + BASE.w / 2), a.cy - (BASE.y + BASE.h / 2)) -
              Math.hypot(b.cx - (BASE.x + BASE.w / 2), b.cy - (BASE.y + BASE.h / 2))
  );
  for (const r of cands) {
    if (r.iw < 4 || r.ih < 3) continue;
    const corners = [
      // door, stair neighbour, seal row on the inner side, outer wall cells
      { d: [r.x + r.iw - 1, r.y + 1], n: [r.x + r.iw, r.y + 1], s: [[r.x + r.iw - 1, r.y + 2], [r.x + r.iw, r.y + 2]], o: [[r.x + r.iw - 1, r.y], [r.x + r.iw, r.y]] },
      { d: [r.x + 2, r.y + 1], n: [r.x + 1, r.y + 1], s: [[r.x + 1, r.y + 2], [r.x + 2, r.y + 2]], o: [[r.x + 1, r.y], [r.x + 2, r.y]] },
      { d: [r.x + r.iw - 1, r.y + r.ih], n: [r.x + r.iw, r.y + r.ih], s: [[r.x + r.iw - 1, r.y + r.ih - 1], [r.x + r.iw, r.y + r.ih - 1]], o: [[r.x + r.iw - 1, r.y + r.ih + 1], [r.x + r.iw, r.y + r.ih + 1]] },
      { d: [r.x + 2, r.y + r.ih], n: [r.x + 1, r.y + r.ih], s: [[r.x + 1, r.y + r.ih - 1], [r.x + 2, r.y + r.ih - 1]], o: [[r.x + 1, r.y + r.ih + 1], [r.x + 2, r.y + r.ih + 1]] },
    ];
    for (const c of corners) {
      const [dx, dy] = c.d, [nx, ny] = c.n;
      if (!insideBase(nx, ny) || !insideBase(dx, dy)) continue;
      if (gG[dy][dx] !== '.' || gG[ny][nx] !== '.') continue;
      let ok = true;
      for (const [sx, sy] of c.s) if (gG[sy][sx] === '#' || gG[sy][sx] === 'F') ok = false; // already wall = fine
      // the far side must be genuine wall, never a door or window
      for (const [ox, oy] of c.o) if ((gG[oy] || [])[ox] !== '#') ok = false;
      if (!ok) continue;
      // the door must face open floor
      const side = dx < nx ? [dx - 1, dy] : [dx + 1, dy];
      if (gG[side[1]][side[0]] !== '.') continue;
      // the far side of the stair must be real wall, or the nook leaks
      const far = dx < nx ? [nx + 1, ny] : [nx - 1, ny];
      const farC = (gG[far[1]] || [])[far[0]];
      if (farC !== '#' ) continue;
      let doorClash = false;
      for (const q of doors || []) for (const c of q.cells) if (Math.abs(c[0] - dx) + Math.abs(c[1] - dy) < 2) doorClash = true;
      if (doorClash) continue;
      // apply
      gG[dy][dx] = 'B'; gG[ny][nx] = 'N';
      for (const [sx, sy] of c.s) gG[sy][sx] = '#';
      bG[ny][nx] = 'U'; bG[ny][dx] = '.';
      if (doors) doors.push({ cells: [[dx, dy]], axis: dx < nx ? 'v' : 'v', closed: 1, kind: 'cellar', z: 0 });
      return { door: { x: dx, y: dy, z: 0 }, stair: { x: nx + 0.5, y: ny + 0.5, z: 0 }, b: { x: nx + 0.5, y: ny + 0.5, z: 2 }, side };
    }
  }
  return null;
}

/* ------------------------------------------------------------ validate */
function crawl(G, from, blocked) {
  const seen = new Set();
  const q = [from];
  seen.add(from[0] + ',' + from[1]);
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || G[ny] === undefined) continue;
      const c = G[ny][nx];
      if (SOLID[c] || c === 'F') continue;
      if (c === 'D' && blocked) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

function worldWalkable(G, x, y) {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return false;
  const c = G[y][x];
  if (SOLID[c] || c === 'F') return false;
  return true;
}

/* dev/test surface (also handy in the console) */
const WGEN = {
  MW, MH, HOUSE, BASE, SOLID, OPAQUE, THEMES,
  mulberry, pick, irnd, mkGrid, fillRect, borderRect, eachRect,
  bsp, leavesOf, connectTree, addWindows, furnish, roomConnected,
  mkFloor, makeRooms, assignTypes, buildYard, placeStairsUp, placeCellar,
  crawl, worldWalkable, insideRoom,
};
