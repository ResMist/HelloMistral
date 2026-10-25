'use strict';
/* =====================================================================
   gen.js — assembles a complete, validated house from the primitives in
   world.js. A seed is only accepted when the result is provably solvable.
   ===================================================================== */

function hashSeed(seed, attempt) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ Math.imul(attempt + 1, 0x27d4eb2d)) >>> 0;
}

/* ------------------------------------------------------- 3D reachability */
function reach3D(w, start, opt) {
  opt = opt || {};
  const openDoors = opt.openDoors !== false;
  const study = !!opt.study;
  const cellar = !!opt.cellar;
  const key = (z, x, y) => z + ':' + x + ':' + y;
  const sx = start.x | 0, sy = start.y | 0;
  const seen = new Set([key(start.z, sx, sy)]);
  const q = [[sx, sy, start.z]];
  const stairMap = w.stairMap;
  while (q.length) {
    const [x, y, z] = q.pop();
    const F = w.floors[z];
    if (!F) continue;
    const push = (nx, ny, nz) => {
      const k = key(nz, nx, ny);
      if (seen.has(k)) return;
      const G = w.floors[nz].G;
      if (G[ny] === undefined || G[ny][nx] === undefined) return;
      const c = G[ny][nx];
      if (SOLID[c] || c === 'F') return;
      if (c === 'L' && !study) return;
      if (c === 'B' && !cellar) return;
      if (c === 'D' && !openDoors) return;
      seen.add(k); q.push([nx, ny, nz]);
    };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) push(x + dx, y + dy, z);
    const link = stairMap[key(z, x, y)];
    if (link) push(link.x, link.y, link.z);
  }
  return seen;
}

/* Every room must be enterable from its own doorway network. */
function allRoomsReachable(w, seen) {
  const bad = [];
  for (const r of w.rooms) {
    let ok = false;
    for (let y = r.y + 1; y <= r.y + r.ih && !ok; y++)
      for (let x = r.x + 1; x <= r.x + r.iw; x++)
        if (seen.has(r.z + ':' + x + ':' + y)) { ok = true; break; }
    if (!ok) bad.push(r.z + ':' + r.id);
  }
  return bad;
}

function adjacentFree(w, x, y, z) {
  const G = w.floors[z].G;
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (G[ny] === undefined) continue;
    const c = G[ny][nx];
    if (!SOLID[c] && c !== 'F') out.push([nx, ny]);
  }
  return out;
}

/* --------------------------------------------------------- containers */
function placeContainer(F, rooms, doors, spec, rng, z) {
  const r = rooms.find((q) => q.type === spec.room);
  if (!r) return null;
  const nearDoor = new Set();
  for (const d of doors) for (const c of d.cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nearDoor.add((c[0] + dx) + ',' + (c[1] + dy));
  const tries = [];
  for (let y = r.y + 1; y <= r.y + r.ih; y++) for (let x = r.x + 1; x <= r.x + r.iw - spec.w + 1; x++) {
    let ok = F.G[y][x] === '.' && !nearDoor.has(x + ',' + y);
    for (let i = 1; i < spec.w && ok; i++) if (F.G[y][x + i] !== '.') ok = false;
    if (ok) tries.push([x, y]);
  }
  // prefer hugging a wall
  tries.sort((a, b) => wallScore(F, b[0], b[1]) - wallScore(F, a[0], a[1]));
  for (const [x, y] of tries) {
    const saved = [];
    for (let i = 0; i < spec.w; i++) { saved.push([x + i, y, F.G[y][x + i]]); F.G[y][x + i] = 'S'; }
    const freeAfter = adjacentFree({ floors: [F] }, x, y, 0);
    for (let i = 1; i < spec.w; i++) for (const a of adjacentFree({ floors: [F] }, x + i, y, 0)) if (!freeAfter.some((q) => q[0] === a[0] && q[1] === a[1])) freeAfter.push(a);
    if (roomConnected(F.G, r) && freeAfter.length) {
      const stand = freeAfter[0];
      F.furniture.push({ k: spec.k, x, y, w: spec.w, h: 1, z, room: r.id, box: 1 });
      return { id: spec.id, x: x + spec.w / 2, y: y + 0.5, tx: x, ty: y, w: spec.w, z, label: spec.label, gives: spec.gives, stand };
    }
    for (const s of saved) F.G[s[1]][s[0]] = s[2];
  }
  return null;
}
function wallScore(F, x, y) {
  let s = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = (F.G[y + dy] || [])[x + dx];
    if (c === '#' || c === 'W' || c === 'S') s++;
  }
  return s;
}

/* ------------------------------------------------------------- items */
function scatterItems(F, rooms, rng, n, z) {
  const out = [];
  const spots = [];
  for (const r of rooms) {
    if (r.type === 'vault') continue;
    for (let y = r.y + 1; y <= r.y + r.ih; y++) for (let x = r.x + 1; x <= r.x + r.iw; x++) if (F.G[y][x] === '.') spots.push([x, y, r]);
  }
  for (let i = 0; i < n * 20 && out.length < n; i++) {
    const [x, y] = spots[(rng() * spots.length) | 0] || [0, 0];
    if (F.G[y] === undefined || F.G[y][x] !== '.') continue;
    out.push({ k: pick(rng, ['vase', 'vase', 'can', 'can', 'lamp', 'chair', 'box']), x: x + 0.5, y: y + 0.5, z, home: { x: x + 0.5, y: y + 0.5, z } });
  }
  return out;
}

/* ------------------------------------------------------------ assemble */
let LAST_STAGE='init';
function tryBuild(seed, labelSeed) {
  const rng = mulberry(seed);
  const gF = mkFloor(0, 'Ground floor', ',');
  const uF = mkFloor(1, 'Upstairs', 'F');
  const bF = mkFloor(2, 'Basement', 'F');

  // yard
  fillRect(gF.G, 0, 0, MW, MH, ',');
  for (let x = 1; x < MW - 1; x++) { gF.G[1][x] = 'F'; gF.G[MH - 2][x] = 'F'; }
  for (let y = 1; y < MH - 1; y++) { gF.G[y][1] = 'F'; gF.G[y][MW - 2] = 'F'; }

  // house shell
  for (const F of [gF, uF]) fillRect(F.G, HOUSE.x, HOUSE.y, HOUSE.w, HOUSE.h, '#');
  // basement shell
  borderRect(bF.G, BASE.x, BASE.y, BASE.w, BASE.h, '#');
  fillRect(bF.G, BASE.x + 1, BASE.y + 1, BASE.w - 2, BASE.h - 2, '.');

  const doors = [];
  const buildFloor = (F, depth) => {
    const root = bsp(HOUSE.x, HOUSE.y, HOUSE.w, HOUSE.h, depth, rng);
    const leaves = leavesOf(root);
    for (const l of leaves) fillRect(F.G, l.x + 1, l.y + 1, l.w - 2, l.h - 2, '.');
    F.rooms = makeRooms(leaves, F.G, F.z, rng);
    const fdoors = [];
    connectLeaves(F.G, leaves, fdoors, rng, 0.22);
    for (const d of fdoors) d.z = F.z;
    F.doors = fdoors;
    for (const d of fdoors) doors.push(d);
    return root;
  };
  const gRoot = buildFloor(gF, 4);
  const uRoot = buildFloor(uF, 3);

  LAST_STAGE='rooms'; if (gF.rooms.length < 4 || uF.rooms.length < 3) return null;

  // ---- stairs up
  LAST_STAGE='stairs'; const up = placeStairsUp(gF.G, gF.rooms, uF.G, uF.rooms, rng, gF.doors.concat(uF.doors));
  if (!up) return null;

  // functional rooms — kitchen downstairs, study upstairs, both mandatory.
  // The study must be a dead end so locking its only door really gates the
  // blue key without cutting off the rest of the house.
  const uDegree = new Map(uF.rooms.map((r) => [r.id, roomDegree(r, uF.doors)]));
  const hasStair = (r) => {
    for (let y = r.y + 1; y <= r.y + r.ih; y++) for (let x = r.x + 1; x <= r.x + r.iw; x++) {
      const c = uF.G[y][x];
      if (c === 'U' || c === 'N') return true;
    }
    return false;
  };
  const deadEnds = uF.rooms.filter((r) => uDegree.get(r.id) === 1 && !hasStair(r) && r.iw >= 4 && r.ih >= 4)
    .sort((a, b) => b.iw * b.ih - a.iw * a.ih);
  if (!deadEnds.length) { LAST_STAGE = 'types'; return null; }
  const study = deadEnds[0];
  study.type = 'study';
  const gTypes = assignTypes(gF.rooms, rng, ['kitchen', 'living', 'bedroom', 'bathroom', 'workshop', 'hall']);
  assignTypes(uF.rooms.filter((r) => r.id !== study.id), rng, ['bedroom', 'bathroom', 'living', 'hall']);
  const kitchen = gTypes.kitchen;
  LAST_STAGE = 'types';
  if (!kitchen) return null;
  const studyFloor = uF;

  // lock the study's single door
  let locked = 0;
  for (const d of studyFloor.doors) {
    let inside = false;
    for (const c of d.cells) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = c[0] + dx, ny = c[1] + dy;
      if (nx >= study.x + 1 && nx <= study.x + study.iw && ny >= study.y + 1 && ny <= study.y + study.ih) inside = true;
    }
    if (inside) {
      for (const c of d.cells) studyFloor.G[c[1]][c[0]] = 'L';
      d.kind = 'lock'; d.closed = 1; locked++;
    }
  }
  LAST_STAGE = 'study-lock';
  if (locked !== 1) return null;

  // ---- cellar
  LAST_STAGE='cellar'; const cellar = placeCellar(gF.G, gF.rooms, bF.G, rng, gF.doors);
  if (!cellar) return null;
  // clear basement furniture space around the stair and the vault prize
  const bx = cellar.b.x | 0, by = cellar.b.y | 0;
  bF.G[by][bx] = 'U';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (bF.G[by + dy] && bF.G[by + dy][bx + dx] !== '#') bF.G[by + dy][bx + dx] = '.';
  let secret = null;
  for (let t = 0; t < 60 && !secret; t++) {
    const sx = irnd(rng, BASE.x + 2, BASE.x + BASE.w - 3), sy = irnd(rng, BASE.y + 2, BASE.y + BASE.h - 3);
    if (bF.G[sy][sx] === '.' && Math.hypot(sx - bx, sy - by) > 4) secret = { x: sx + 0.5, y: sy + 0.5, z: 2 };
  }
  LAST_STAGE='secret'; if (!secret) return null;
  bF.G[secret.y | 0][secret.x | 0] = 'V';

  // ---- basement dressing
  const vRooms = [{ id: '2:0', z: 2, x: BASE.x, y: BASE.y, w: BASE.w, h: BASE.h, iw: BASE.w - 2, ih: BASE.h - 2, cx: BASE.x + BASE.w / 2, cy: BASE.y + BASE.h / 2, type: 'vault', name: 'Vault' }];
  bF.rooms = vRooms;
  bF.furniture = furnish(bF.G, vRooms, [], rng, 2);

  // ---- furniture + windows + doors
  const gFurn = furnish(gF.G, gF.rooms, gF.doors, rng, 0);
  const uFurn = furnish(uF.G, uF.rooms, uF.doors, rng, 1);
  gF.furniture = gFurn;
  uF.furniture = uFurn;

  // ---- front door + porch
  let front = null;
  for (let t = 0; t < 80 && !front; t++) {
    const fx = irnd(rng, HOUSE.x + 3, HOUSE.x + HOUSE.w - 4);
    const fy = HOUSE.y + HOUSE.h - 1;
    if (gF.G[fy][fx] !== 'W' && gF.G[fy][fx] !== '#' ) continue;
    if (gF.G[fy - 1][fx] !== '.') continue;
    let nearDoor = false;
    for (const d of gF.doors) for (const c of d.cells) if (Math.abs(c[0] - fx) + Math.abs(c[1] - fy) < 2) nearDoor = true;
    if (nearDoor) continue;
    if (gF.G[fy][fx] === 'W') {
      const wi = gWins.findIndex((q) => q.x === fx && q.y === fy);
      if (wi >= 0) gWins.splice(wi, 1);
    }
    gF.G[fy][fx] = 'D';
    const fd = { cells: [[fx, fy]], axis: 'h', z: 0, closed: 1, kind: 'door', front: 1 };
    gF.doors.push(fd); doors.push(fd);
    // porch
    for (let y = fy + 1; y < MH - 2; y++) if (gF.G[y][fx] === ',') gF.G[y][fx] = 'P';
    front = { x: fx + 0.5, y: fy + 0.5, z: 0, ix: fx, iy: fy };
    break;
  }
  LAST_STAGE='front'; if (!front) return null;

  // ---- shed
  LAST_STAGE='shed'; const shed = buildYard(gF.G, rng, doors);
  if (!shed) return null;

  // ---- containers
  const containers = [];
  const fridge = placeContainer(gF, gF.rooms, gF.doors, { room: 'kitchen', id: 'fridge', k: 'fridge', w: 1, label: 'fridge', gives: 'red' }, rng, 0);
  const desk = placeContainer(studyFloor, studyFloor.rooms, studyFloor.doors, { room: study.type, id: 'desk', k: 'desk', w: 2, label: 'desk', gives: 'blue' }, rng, study.z);
  LAST_STAGE='containers'; if (!fridge || !desk) return null;
  containers.push(fridge, desk);
  // toolbox in the shed
  let toolbox = null;
  for (const [x, y] of shed.interior) {
    if (gF.G[y][x] !== '.') continue;
    if (adjacentFree({ floors: [gF] }, x, y, 0).length < 2) continue;
    gF.G[y][x] = 'S';
    toolbox = { id: 'toolbox', x: x + 0.5, y: y + 0.5, tx: x, ty: y, z: 0, label: 'toolbox', gives: 'pick', stand: adjacentFree({ floors: [gF] }, x, y, 0)[0] };
    gF.furniture.push({ k: 'toolbox', x, y, w: 1, h: 1, z: 0, box: 1 });
    break;
  }
  LAST_STAGE='toolbox'; if (!toolbox) return null;
  containers.push(toolbox);

  // ---- loose items
  const items = scatterItems(gF, gF.rooms, rng, 8, 0).concat(scatterItems(uF, uF.rooms, rng, 5, 1));

  // ---- windows last, so nothing can end up behind one
  LAST_STAGE = 'windows';
  const gWins = addWindows(gF.G, 0, HOUSE, gF.doors, rng);
  const uWins = addWindows(uF.G, 1, HOUSE, uF.doors, rng);
  if (gWins.length < 3) return null;

  // ---- spawn: just inside the gate
  let spawn = null;
  for (let y = MH - 3; y > MH - 8 && !spawn; y--) {
    for (let x = 2; x < MW - 2; x++) {
      if (gF.G[y][x] === ',' && gF.G[y - 1][x] === ',') { spawn = { x: x + 0.5, y: y + 0.5, z: 0 }; break; }
    }
  }
  LAST_STAGE='spawn'; if (!spawn) return null;

  const stairMap = {};
  const stairs = [];
  const addStair = (a, b) => {
    stairs.push({ a, b });
    stairMap[a.z + ':' + (a.x | 0) + ':' + (a.y | 0)] = { x: b.x | 0, y: b.y | 0, z: b.z };
    stairMap[b.z + ':' + (b.x | 0) + ':' + (b.y | 0)] = { x: a.x | 0, y: a.y | 0, z: a.z };
  };
  addStair({ x: up.a.x, y: up.a.y, z: 0 }, { x: up.b.x, y: up.b.y, z: 1 });
  addStair({ x: cellar.stair.x, y: cellar.stair.y, z: 0 }, { x: cellar.b.x, y: cellar.b.y, z: 2 });

  // rooms/stairs/cellar/front/shed may have appended doors after the copy above;
  // the master list must reference those same objects so kind/closed stay in sync
  for (const d of gF.doors) if (!doors.includes(d)) doors.push(d);
  for (const d of uF.doors) if (!doors.includes(d)) doors.push(d);

  const w = {
    seed, genSeed: seed, attempts: 0,
    floors: [gF, uF, bF],
    rooms: gF.rooms.concat(uF.rooms, vRooms).map((r) => Object.assign(r, { name: roomName(r) })),
    doors, containers, items, windows: gWins.concat(uWins),
    stairs, stairMap, shed, spawn, secret, front,
    study, kitchen, cellar, up,
    meta: {
      rooms: gF.rooms.length + uF.rooms.length + 1,
      doors: doors.length,
      windows: gWins.length + uWins.length,
      seed,
    },
  };
  w.floors[0].items = items.filter((i) => i.z === 0);
  w.floors[1].items = items.filter((i) => i.z === 1);
  return w;

}

function roomName(r) {
  const map = { kitchen: 'kitchen', study: 'study', bedroom: 'bedroom', bathroom: 'bathroom', living: 'living room', workshop: 'workshop', hall: 'hallway', vault: 'vault' };
  const base = map[r.type] || 'room';
  return base;
}

/* --------------------------------------------------------- validation */
function validateWorld(w) {
  const issues = [];
  if (!w || !w.floors || w.floors.length !== 3) return ['missing floors'];

  // 1. every room reachable with everything open
  const all = reach3D(w, w.spawn, { study: true, cellar: true, openDoors: true });
  for (const bad of allRoomsReachable(w, all)) issues.push('unreachable room ' + bad);

  // 2. staged progression
  const base = reach3D(w, w.spawn, { study: false, cellar: false, openDoors: true });
  const withPick = reach3D(w, w.spawn, { study: true, cellar: false, openDoors: true });
  const withKeys = reach3D(w, w.spawn, { study: true, cellar: true, openDoors: true });

  const canTouch = (set, cont) => {
    for (let i = 0; i < (cont.w || 1); i++) {
      const adj = adjacentFree(w, cont.tx + i, cont.ty, cont.z);
      if (adj.some(([x, y]) => set.has(cont.z + ':' + x + ':' + y))) return true;
    }
    return false;
  };
  const byId = {};
  for (const c of w.containers) byId[c.id] = c;

  if (!canTouch(base, byId.toolbox)) issues.push('lockpick (toolbox) not reachable without keys');
  if (!canTouch(base, byId.fridge)) issues.push('red key (fridge) not reachable without keys');
  if (!canTouch(withPick, byId.desk)) issues.push('blue key (desk) not reachable with the lockpick');
  // the study must actually be gated
  if (canTouch(base, byId.desk)) issues.push('study is not locked');
  // basement must be gated
  if (base.has('2:' + (w.secret.x | 0) + ':' + (w.secret.y | 0))) issues.push('basement is not locked');
  if (!withKeys.has('2:' + (w.secret.x | 0) + ':' + (w.secret.y | 0))) issues.push('basement secret unreachable');

  // 3. stairs paired
  for (const s of w.stairs) {
    const A = w.floors[s.a.z].G[s.a.y | 0][s.a.x | 0];
    const B = w.floors[s.b.z].G[s.b.y | 0][s.b.x | 0];
    if (A !== 'U' && A !== 'N') issues.push('stair A tile wrong: ' + A);
    if (B !== 'U' && B !== 'N') issues.push('stair B tile wrong: ' + B);
  }

  // 4. doors and furniture sanity
  const stairCells = new Set();
  for (const e of w.stairs) {
    for (const p of [e.a, e.b]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const G = w.floors[p.z].G;
        const x = (p.x | 0) + dx, y = (p.y | 0) + dy;
        if (G[y] && (G[y][x] === 'U' || G[y][x] === 'N')) stairCells.add(p.z + ':' + x + ':' + y);
      }
    }
  }
  for (const d of w.doors) {
    for (const [x, y] of d.cells) {
      const c = w.floors[d.z].G[y][x];
      if (c !== 'D' && c !== 'L' && c !== 'B') issues.push('door cell ' + c + ' at ' + d.z + ':' + x + ',' + y);
      if (stairCells.has(d.z + ':' + x + ':' + y)) issues.push('door on stairs');
    }
  }
  for (const F of w.floors) {
    for (const f of F.furniture) {
      for (let j = f.y; j < f.y + f.h; j++) for (let i = f.x; i < f.x + f.w; i++) {
        const c = F.G[j][i];
        if (c !== 'S') issues.push('furniture not solid at ' + F.z + ':' + i + ',' + j);
        if (stairCells.has(F.z + ':' + i + ':' + j)) issues.push('furniture on stairs');
      }
    }
  }
  for (const c of w.containers) {
    let bad = false, adj = [];
    for (let i = 0; i < (c.w || 1); i++) {
      if (w.floors[c.z].G[c.ty][c.tx + i] !== 'S') bad = true;
      for (const a of adjacentFree(w, c.tx + i, c.ty, c.z)) if (!adj.some((q) => q[0] === a[0] && q[1] === a[1])) adj.push(a);
    }
    if (bad) issues.push('container missing: ' + c.id);
    if (!adj.length) issues.push('container cannot be reached: ' + c.id);
  }

  // 5. spawn and secret
  if (!worldWalkable(w.floors[w.spawn.z].G, w.spawn.x | 0, w.spawn.y | 0)) issues.push('spawn not walkable');
  const sc = w.floors[2].G[w.secret.y | 0][w.secret.x | 0];
  if (sc !== 'V') issues.push('secret tile wrong');

  // 6. windows must have interior floor behind them
  for (const win of w.windows) {
    if (w.floors[win.z].G[win.iy][win.ix] !== '.') issues.push('window has no interior');
  }

  return issues;
}

function buildWorld(seed, maxAttempts) {
  maxAttempts = maxAttempts || 80;
  for (let a = 0; a < maxAttempts; a++) {
    const s = hashSeed(seed, a);
    const w = tryBuild(s, seed);
    if (!w) continue;
    const issues = validateWorld(w);
    if (issues.length) { LAST_ISSUES = issues; continue; }
    w.attempts = a + 1;
    w.seed = seed;
    w.genSeed = s;
    return w;
  }
  return null;
}
let LAST_ISSUES = [];
function lastStage(){return LAST_STAGE}

/* ------------------------------------------------------------- ascii */
function asciiWorld(w, z) {
  const F = w.floors[z];
  const rows = [];
  for (let y = 0; y < MH; y++) rows.push(F.G[y].join(''));
  return rows.join('\n');
}

const GEN = { buildWorld, validateWorld, tryBuild, reach3D, asciiWorld, hashSeed, roomName, adjacentFree, lastStage, issues:()=>LAST_ISSUES };
