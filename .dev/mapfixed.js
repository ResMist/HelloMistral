'use strict';
/* =====================================================================
   mapfixed.js — ONE hand-authored map, two floors.

   The ground floor is the original layout, tile for tile: same house shell,
   same rooms, same doors, same yard, same shed, same vault. The only
   addition is a narrow staircase in the foyer up to a second floor (landing,
   two bedrooms, a bathroom and a storage room).

   No procedural generation. `buildWorld()` ignores its seed on purpose.
   ===================================================================== */

const MW = 56, MH = 40;
const HOUSE = { x: 12, y: 7, w: 32, h: 24 };

const FLOOR_NAMES = ['Ground floor', 'Upstairs'];

/* small deterministic RNG — the map is fixed, this is only for runtime noise */
function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ tiles */
function blankFloor(fill) {
  const G = [];
  for (let y = 0; y < MH; y++) G.push(new Array(MW).fill(fill));
  return { G, rooms: [], furniture: [], lights: [] };
}
const box = (G, x1, y1, x2, y2, ch) => {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (G[y] && x >= 0 && x < MW) G[y][x] = ch;
};
const set = (G, list, ch) => { for (const [x, y] of list) G[y][x] = ch; };

/* Room tuple: interior extents (inclusive), floor colour, type, label. */
const GROUND_ROOMS = [
  [13, 8, 22, 16, '#e6cf9f', 'living', 'Living Room'],
  [24, 8, 33, 13, '#d9e8e4', 'kitchen', 'Kitchen'],
  [24, 15, 33, 20, '#ead9b0', 'dining', 'Dining Room'],
  [24, 22, 33, 29, '#dcdcea', 'hall', 'Foyer'],
  [13, 18, 22, 29, '#eed6e4', 'bedroom', 'Bedroom'],
  [35, 8, 42, 16, '#d9c39a', 'study', 'Study'],
  [35, 18, 42, 22, '#cde6f2', 'bathroom', 'Bathroom'],
  [35, 24, 42, 29, '#cfcfcf', 'workshop', 'Workshop'],
  [44, 25, 48, 28, '#8d97a8', 'vault', 'Vault'],
  [3, 9, 6, 12, '#dccaa6', 'shed', 'Shed'],
];
const UPPER_ROOMS = [
  [13, 8, 26, 16, '#eed6e4', 'bedroom', 'Master Bedroom'],
  [13, 18, 26, 29, '#ead9b0', 'bedroom', 'Spare Room'],
  [28, 8, 34, 29, '#dcdcea', 'hall', 'Landing'],
  [36, 8, 42, 19, '#cfcfcf', 'storage', 'Storage'],
  [36, 21, 42, 29, '#cde6f2', 'bathroom', 'Upstairs Bath'],
];

const GROUND_FURNITURE = [
  // x, y, w, h, kind, room-hint
  [14, 12, 4, 1, 'couch'],
  [15, 8, 3, 1, 'tv'],
  [15, 10, 2, 1, 'table'],
  [20, 8, 3, 1, 'shelf'],
  [24, 8, 2, 1, 'sink'],
  [27, 8, 2, 1, 'stove'],
  [29, 8, 3, 1, 'counter'],
  [32, 8, 1, 1, 'fridge'],
  [27, 11, 3, 1, 'table'],
  [27, 17, 4, 2, 'table'],
  [25, 22, 1, 1, 'cabinet'],
  [30, 22, 1, 1, 'shelf'],
  [14, 26, 3, 3, 'bed'],
  [20, 18, 3, 1, 'wardrobe'],
  [17, 26, 1, 1, 'nightstand'],
  [36, 9, 3, 1, 'desk'],
  [41, 8, 2, 1, 'bookshelf'],
  [41, 18, 1, 1, 'toilet'],
  [38, 18, 2, 1, 'basin'],
  [36, 21, 3, 1, 'tub'],
  [36, 24, 5, 1, 'bench'],
  [41, 28, 1, 1, 'rack'],
  [3, 10, 1, 1, 'toolbox'],
];
const UPPER_FURNITURE = [
  [15, 9, 3, 3, 'bed'],
  [23, 9, 2, 1, 'wardrobe'],
  [19, 9, 1, 1, 'nightstand'],
  [24, 15, 2, 1, 'dresser'],
  [15, 22, 2, 3, 'bed'],
  [22, 27, 2, 1, 'desk'],
  [13, 27, 2, 1, 'shelf'],
  [37, 10, 3, 1, 'shelf'],
  [40, 17, 1, 1, 'crate'],
  [37, 23, 3, 1, 'tub'],
  [41, 28, 1, 1, 'toilet'],
  [37, 28, 2, 1, 'basin'],
];
/* drawn but walkable-through (never solid) */
const DECOR = [
  [0, 14, 3, 1, 1, 'tree'],
  [0, 46, 4, 1, 1, 'tree'],
  [0, 48, 33, 1, 1, 'tree'],
  [0, 18, 36, 1, 1, 'tree'],
  [0, 30, 37, 1, 1, 'mailbox'],
  [0, 35, 35, 1, 1, 'trash'],
];

function mkRooms(list, z) {
  return list.map((r, i) => {
    const [x1, y1, x2, y2, col, type, name] = r;
    return {
      id: z + ':' + i, z, name, type, col,
      x: x1 - 1, y: y1 - 1, iw: x2 - x1 + 1, ih: y2 - y1 + 1,
      cx: (x1 + x2) / 2, cy: (y1 + y2) / 2,
      light: 0,
    };
  });
}

function buildGround() {
  const F = blankFloor(',');
  // fence ring
  for (let x = 1; x < MW - 1; x++) { F.G[0][x] = 'F'; F.G[1][x] = 'F'; }
  // (the fence lives on row 0/1 and the outer columns, matching the old map)
  for (let y = 0; y < MH; y++) { F.G[y][0] = 'F'; }
  for (let y = 0; y < MH; y++) { F.G[y][MW - 1] = 'F'; }
  for (let x = 0; x < MW; x++) F.G[MH - 1][x] = 'F';
  F.G[0][28] = 'F';
  box(F.G, 12, 7, 43, 30, '#');
  box(F.G, 13, 8, 42, 29, '.');
  // interior walls
  box(F.G, 23, 7, 23, 30, '#');
  box(F.G, 34, 7, 34, 30, '#');
  box(F.G, 13, 17, 22, 17, '#');
  box(F.G, 24, 14, 33, 14, '#');
  box(F.G, 24, 21, 33, 21, '#');
  box(F.G, 35, 17, 42, 17, '#');
  box(F.G, 35, 23, 42, 23, '#');
  // vault shell + shed shell
  box(F.G, 43, 24, 49, 29, '#');
  box(F.G, 44, 25, 48, 28, '.');
  box(F.G, 2, 8, 7, 13, '#');
  box(F.G, 3, 9, 6, 12, '.');
  // doors (single tile, like the old map)
  set(F.G, [[23, 12], [17, 17], [23, 25], [28, 14], [28, 21], [34, 19], [34, 26],
            [28, 30], [26, 7], [7, 11]], 'D');
  set(F.G, [[34, 11]], 'L');          // study lock
  set(F.G, [[43, 27]], 'B');          // vault lock
  // windows
  set(F.G, [[12, 12], [17, 7], [12, 24], [17, 30], [30, 7], [38, 30], [43, 20], [43, 12], [38, 7], [4, 8]], 'W');
  // the gate + the path to the front door
  F.G[39][28] = ',';
  F.G[38][28] = ',';
  for (let y = 31; y <= 38; y++) F.G[y][28] = 'P';
  F.G[31][27] = 'P'; F.G[31][29] = 'P';
  // stairs up, in the foyer
  set(F.G, [[31, 26], [31, 27]], 'U');
  // the vault prize
  F.G[26][46] = 'V';
  return F;
}

function buildUpper() {
  const F = blankFloor('F');
  box(F.G, 12, 7, 43, 30, '#');
  box(F.G, 13, 8, 42, 29, '.');
  box(F.G, 27, 7, 27, 30, '#');
  box(F.G, 35, 7, 35, 30, '#');
  box(F.G, 13, 17, 27, 17, '#');      // master / spare
  box(F.G, 35, 20, 42, 20, '#');      // storage / bath
  set(F.G, [[27, 12], [27, 24], [35, 14], [35, 25]], 'D');
  set(F.G, [[12, 12], [12, 24], [31, 7], [43, 14], [43, 25], [20, 30]], 'W');
  // stairs down
  set(F.G, [[31, 26], [31, 27]], 'N');
  return F;
}

function addFurniture(F, list, z) {
  for (const [x, y, w, h, k] of list) {
    let clear = true;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (F.G[j] === undefined || F.G[j][i] === undefined) { clear = false; continue; }
      const c = F.G[j][i];
      if (c !== '.') clear = false;
    }
    if (!clear) throw new Error('furniture ' + k + ' at ' + z + ':' + x + ',' + y + ' overlaps something');
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) F.G[j][i] = 'S';
    const room = F.rooms.find((r) => x >= r.x + 1 && x + w - 1 <= r.x + r.iw && y >= r.y + 1 && y + h - 1 <= r.y + r.ih);
    F.furniture.push({ k, x, y, w, h, z, room: room ? room.id : null, box: k === 'fridge' || k === 'desk' || k === 'toolbox' ? 1 : 0 });
  }
}

function buildFixedWorld() {
  const gF = buildGround(), uF = buildUpper();
  WORLD_FLOORS = [gF.G, uF.G];
  gF.z = 0; gF.name = FLOOR_NAMES[0];
  uF.z = 1; uF.name = FLOOR_NAMES[1];
  gF.rooms = mkRooms(GROUND_ROOMS, 0);
  uF.rooms = mkRooms(UPPER_ROOMS, 1);
  addFurniture(gF, GROUND_FURNITURE, 0);
  addFurniture(uF, UPPER_FURNITURE, 1);

  const door = (z, x, y, kind) => ({ cells: [[x, y]], axis: 'v', z, closed: 1, kind: kind || 'door' });
  const doors = [];
  const byCells = {};
  for (const F of [gF, uF]) for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const c = F.G[y][x];
    if (c !== 'D' && c !== 'L' && c !== 'B') continue;
    const d = door(F.z, x, y, c === 'L' ? 'lock' : c === 'B' ? 'cellar' : 'door');
    if (c === 'L') d.lockChar = 'L';
    if (c === 'B') d.lockChar = 'B';
    if (F.z === 0 && x === 28 && y === 30) { d.front = 1; }
    doors.push(d);
    byCells[F.z + ':' + x + ':' + y] = d;
  }
  // the shed door is a normal door too
  const shed = { x: 2, y: 8, w: 6, h: 6, interior: [], gate: { x: 28, y: 39 } };
  for (let y = 9; y <= 12; y++) for (let x = 3; x <= 6; x++) shed.interior.push([x, y]);

  const windows = [];
  for (const F of [gF, uF]) {
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (F.G[y][x] !== 'W') continue;
      // the pane looks into whichever neighbour sits inside a room
      let best = null;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        const r = F.rooms.find((q) => nx >= q.x + 1 && nx <= q.x + q.iw && ny >= q.y + 1 && ny <= q.y + q.ih);
        if (r) { best = [nx, ny]; break; }
      }
      if (!best) continue;
      windows.push({ x, y, z: F.z, ix: best[0], iy: best[1] });
    }
  }

  const containers = [];
  const cont = (id, label, gives, z, tx, ty, w) => {
    const c = { id, label, gives, z, tx, ty, w, x: tx + w / 2, y: ty + 0.5, stand: null };
    for (let i = 0; i < w; i++) { c.stand = c.stand || adjFree(z, tx + i, ty); }
    containers.push(c);
    return c;
  };
  cont('toolbox', 'toolbox', 'pick', 0, 3, 10, 1);
  cont('fridge', 'fridge', 'red', 0, 32, 8, 1);
  cont('desk', 'desk', 'blue', 0, 36, 9, 3);

  const items = [
    { x: 4.5, y: 34.5, z: 0, k: 'tomato' }, { x: 6.5, y: 34.5, z: 0, k: 'tomato' },
    { x: 8.5, y: 34.5, z: 0, k: 'tomato' }, { x: 4.5, y: 36.5, z: 0, k: 'tomato' },
    { x: 16.5, y: 14.5, z: 0, k: 'vase' }, { x: 20.5, y: 12.5, z: 0, k: 'can' },
    { x: 27.5, y: 19.5, z: 0, k: 'chair' }, { x: 39.5, y: 12.5, z: 0, k: 'box' },
    { x: 30.5, y: 24.5, z: 0, k: 'lamp' }, { x: 22.5, y: 26.5, z: 0, k: 'can' },
    { x: 17.5, y: 11.5, z: 1, k: 'vase' }, { x: 21.5, y: 20.5, z: 1, k: 'box' },
    { x: 39.5, y: 16.5, z: 1, k: 'can' }, { x: 30.5, y: 12.5, z: 1, k: 'chair' },
  ];

  const stairs = [
    { a: { x: 31, y: 26, z: 0 }, b: { x: 31, y: 26, z: 1 } },
    { a: { x: 31, y: 27, z: 0 }, b: { x: 31, y: 27, z: 1 } },
  ];
  const stairMap = {};
  for (const s of stairs) {
    stairMap[s.a.z + ':' + s.a.x + ':' + s.a.y] = { x: s.b.x, y: s.b.y, z: s.b.z };
    stairMap[s.b.z + ':' + s.b.x + ':' + s.b.y] = { x: s.a.x, y: s.a.y, z: s.a.z };
  }

  const w = {
    fixed: 1, seed: 1, attempts: 1,
    floors: [gF, uF],
    rooms: gF.rooms.concat(uF.rooms),
    doors, containers, items, windows, stairs, stairMap, shed,
    spawn: { x: 28.5, y: 37.5, z: 0 },
    front: { x: 28.5, y: 30.5, z: 0, ix: 28, iy: 30 },
    secret: { x: 46.5, y: 26.5, z: 0 },
    study: gF.rooms.find((r) => r.type === 'study'),
    kitchen: gF.rooms.find((r) => r.type === 'kitchen'),
    cellar: { door: { x: 43, y: 27, z: 0 }, stair: { x: 43, y: 27, z: 0 }, b: { x: 46.5, y: 26.5, z: 0 }, side: [44, 27] },
    up: { a: { x: 31, y: 26, z: 0 }, b: { x: 31, y: 26, z: 1 } },
    decor: DECOR,
    meta: { rooms: gF.rooms.length + uF.rooms.length, doors: doors.length, windows: windows.length, seed: 1 },
  };
  return w;
}

function adjFree(z, x, y) {
  const G = WORLD_FLOORS[z];
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const c = (G[y + dy] || [])[x + dx];
    if (c === '.' || c === ',' || c === 'P' || c === 'V' || c === 'U' || c === 'N') return [x + dx, y + dy];
  }
  return null;
}
let WORLD_FLOORS = [];

/* --------------------------------------------------------------- public */
function buildWorld() {
  const w = buildFixedWorld();
  WORLD_FLOORS = w.floors.map((F) => F.G);
  return w;
}

function validateWorld(w) {
  const issues = [];
  if (!w || w.floors.length !== 2) return ['missing floors'];
  const walk = (z, x, y, opt) => {
    const c = String((w.floors[z].G[y] || [])[x] || 'F');
    if ('#FSWX'.includes(c)) return false;
    if (c === 'L' || c === 'B') return !!(opt && opt.keys);
    if (c === 'D') {
      if (opt && opt.openDoors) return true;
      const d = w.doors.find((q) => q.z === z && q.cells[0][0] === x && q.cells[0][1] === y);
      return !(d && d.closed);
    }
    return true;
  };
  const reach = (opt, start) => {
    const seen = new Set();
    const q = [[start.x | 0, start.y | 0, start.z | 0]];
    seen.add(q[0].join(':'));
    while (q.length) {
      const [x, y, z] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        if (!walk(z, nx, ny, opt)) continue;
        const k = z + ':' + nx + ':' + ny;
        if (seen.has(k)) continue;
        seen.add(k);
        q.push([nx, ny, z]);
        if (w.floors[z].G[ny][nx] === 'U' && z === 0) q.push([nx, ny, 1]);
        if (w.floors[z].G[ny][nx] === 'N' && z === 1) q.push([nx, ny, 0]);
      }
    }
    return seen;
  };
  const all = reach({ openDoors: true, keys: true }, w.spawn);
  for (const r of w.rooms) {
    let hit = false;
    for (let y = r.y + 1; y <= r.y + r.ih && !hit; y++) for (let x = r.x + 1; x <= r.x + r.iw && !hit; x++) if (all.has(r.z + ':' + x + ':' + y)) hit = true;
    if (!hit) issues.push('unreachable room ' + r.id + ' ' + r.name);
  }
  if (!all.has('0:' + (w.secret.x | 0) + ':' + (w.secret.y | 0))) issues.push('secret unreachable with everything unlocked');
  if (!walk(w.spawn.z, w.spawn.x | 0, w.spawn.y | 0, {})) issues.push('spawn not walkable');
  for (const s of w.stairs) {
    const A = String(w.floors[s.a.z].G[s.a.y][s.a.x]), B = String(w.floors[s.b.z].G[s.b.y][s.b.x]);
    if (A !== 'U' && A !== 'N') issues.push('stair A tile wrong: ' + A);
    if (B !== 'U' && B !== 'N') issues.push('stair B tile wrong: ' + B);
  }
  for (const c of w.containers) {
    let solid = true, adj = false;
    for (let i = 0; i < c.w; i++) {
      if (w.floors[c.z].G[c.ty][c.tx + i] !== 'S') solid = false;
      const around = adjFree(c.z, c.tx + i, c.ty);
      if (around) adj = true;
    }
    if (!solid) issues.push('container missing: ' + c.id);
    if (!adj) issues.push('container cannot be reached: ' + c.id);
  }
  for (const win of w.windows) {
    const r = w.floors[win.z].rooms.find((q) => win.ix >= q.x + 1 && win.ix <= q.x + q.iw && win.iy >= q.y + 1 && win.iy <= q.y + q.ih);
    if (!r) issues.push('window has no interior at ' + win.z + ':' + win.x + ',' + win.y);
  }
  for (const d of w.doors) {
    const c = String(w.floors[d.z].G[d.cells[0][1]][d.cells[0][0]]);
    if (!'DLB'.includes(c)) issues.push('door tile wrong: ' + c);
  }
  // the study must actually be behind its lock
  const noKeys = reach({ openDoors: true }, w.spawn);
  let deskReach = false;
  for (let i = 0; i < 3; i++) {
    if (noKeys.has('0:' + (36 + i) + ':10')) deskReach = true;
  }
  if (deskReach) issues.push('study is not locked');
  return issues;
}

const GEN = { buildWorld, validateWorld, buildFixedWorld };
