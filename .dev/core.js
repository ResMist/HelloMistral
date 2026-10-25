'use strict';
/* =====================================================================
   core.js — runtime state, match memory, world instance, navigation
   ===================================================================== */

const TS = 16;              // source pixels per tile
const CLOCK_START = 21.0;          // dusk
const HOUR_SECONDS = 42;           // one in-game hour per 42 real seconds
const MATCH_KEY = 'hn.match.v2';

function mulberry32(seed) { return mulberry(seed); }

let W = null;            // current world (rebuilt per attempt from the same seed)
let M = null;            // match memory — the ONLY thing that learns, wiped on New Game
let P = null;            // player
let N = null;            // neighbour
let RNG = mulberry32(1); // runtime randomness

const BEL = [];          // per-floor belief maps (Float32Array)
let TRAPS = [], CAMS = [], SPL = [], PR = [], NZ = [], STAIR = [];
let DOORS = new Map();   // "z:x:y" -> door object

const UI = {
  screen: 'menu',        // menu | cut | play | pause | over
  cut: 0,
  over: null,            // 'caught' | 'win'
  msg: '', msgT: 0,
  hint: '',
  showBelief: 0, showPath: 0,
};

const T = (z, x, y) => {
  const F = W && W.floors[z];
  if (!F) return 'F';
  const row = F.G[y | 0];
  if (!row) return 'F';
  const c = row[x | 0];
  return c === undefined ? 'F' : c;
};
const isNight = (h) => h >= 21 || h < 6;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dst = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/* ------------------------------------------------------------- match memory */
function blankMatch(seed) {
  return {
    seed: seed >>> 0,
    clock: CLOCK_START,
    catches: 0, wins: 0, attempts: 1,
    entries: {},          // "x,y" -> times used as an entry point
    rooms: {},            // room type -> seconds spent by the player
    route: {},            // "z:x,y" -> times the player walked there
    hours: new Array(24).fill(0), // hours in which the player was spotted
    hides: [],            // positions where the player was caught / lost him
    thefts: [],           // container ids he has found emptied
    suspicion: 12,        // 0..100, decays slowly
    traps: [], cams: [], boarded: [], relocks: [], needRelock: [],
    plans: [],            // queued fortifications
    taught: {},           // one-shot lesson flags
    cutscene: 0,
  };
}

function saveMatch() {
  try { localStorage.setItem(MATCH_KEY, JSON.stringify({ seed: M.seed, memory: M })); } catch (e) {}
}
function storedMatch() {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || !o.memory) return null;
    const m = Object.assign(blankMatch(o.seed || 1), o.memory);
    if (!Array.isArray(m.hours) || m.hours.length !== 24) m.hours = new Array(24).fill(0);
    for (const k of ['entries', 'rooms', 'route', 'taught']) if (!m[k] || typeof m[k] !== 'object') m[k] = {};
    for (const k of ['hides', 'thefts', 'traps', 'cams', 'boarded', 'relocks', 'plans', 'needRelock']) if (!Array.isArray(m[k])) m[k] = [];
    return m;
  } catch (e) { return null; }
}
function wipeMatch() { try { localStorage.removeItem(MATCH_KEY); } catch (e) {} }

/* ------------------------------------------------------------- world setup */
function makeWorld(seed) {
  let w = null;
  for (let i = 0; i < 6 && !w; i++) w = buildWorld((seed + i * 7919) >>> 0);
  if (!w) w = buildWorld(1234567);
  return w;
}

function instantiateWorld(w) {
  W = w;
  DOORS = new Map();
  for (const d of W.doors) for (const [x, y] of d.cells) DOORS.set(d.z + ':' + x + ':' + y, d);

  // persistent fortifications live in match memory
  for (const k of M.boarded) { const [z, x, y] = k.split(':').map(Number); if (W.floors[z] && W.floors[z].G[y][x] === 'W') W.floors[z].G[y][x] = 'X'; }
  TRAPS = M.traps.map((k) => { const [z, x, y] = k.split(':').map(Number); return { x: x + 0.5, y: y + 0.5, z, armed: 1 }; });
  CAMS = M.cams.map((k) => { const [z, x, y] = k.split(':').map(Number); return { x: x + 0.5, y: y + 0.5, z, a: 0, sweep: 1.2, seeT: 0, cd: 0 }; });
  SPL = []; PR = []; NZ = [];
  buildStairLinks();
  buildLights();
  buildStations();
  BEL.length = 0;
  for (let z = 0; z < 3; z++) BEL.push(new Float32Array(MW * MH));
  for (const F of W.floors) for (const r of F.rooms) r.light = 0;
}

function buildStairLinks() {
  STAIR = [];
  const push = (a, b) => {
    if (!a || !b) return;
    const A = { x: a.x | 0, y: a.y | 0, z: a.z }, B = { x: b.x | 0, y: b.y | 0, z: b.z };
    if (STAIR.some((s) => s.a.z === A.z && s.a.x === A.x && s.a.y === A.y)) return;
    STAIR.push({ a: A, b: B });
  };
  for (const s of (W.stairs || [])) push(s.a, s.b);
  // safety: any adjacent U/N pair the generator forgot to register
  for (let z = 0; z < 2; z++) for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (T(z, x, y) === 'U' && T(z + 1, x, y) === 'N') push({ x, y, z }, { x, y, z: z + 1 });
  }
}
function stairFrom(z, x, y) {
  for (const s of STAIR) if (s.a.z === z && s.a.x === (x | 0) && s.a.y === (y | 0)) return s.b;
  for (const s of STAIR) if (s.b.z === z && s.b.x === (x | 0) && s.b.y === (y | 0)) return s.a;
  return null;
}

/* ---------------------------------------------------------------- lighting */
function buildLights() {
  for (const F of W.floors) {
    F.lights = [];
    for (const r of F.rooms) {
      const cx = r.x + r.iw / 2, cy = r.y + r.ih / 2;
      F.lights.push({ x: cx, y: cy, r: Math.max(3.2, Math.min(8, Math.hypot(r.iw, r.ih) * 0.52)), room: r.id, on: 1 });
    }
  }
}
function roomAt(z, x, y) {
  const F = W.floors[z];
  if (!F) return null;
  for (const r of F.rooms) if (x >= r.x + 1 && x <= r.x + r.iw && y >= r.y + 1 && y <= r.y + r.ih) return r;
  return null;
}
function roomLit(z, x, y) {
  const r = roomAt(z, x | 0, y | 0);
  return !!(r && r.light);
}
function litAt(z, x, y) {
  if (roomLit(z, x, y)) return 1;
  if (P && P.z === z && P.flash && dst(P.x, P.y, x, y) < 7.5) return 1;
  return 0;
}

/* ------------------------------------------------------------------ doors */
function doorAt(z, x, y) { return DOORS.get(z + ':' + (x | 0) + ':' + (y | 0)); }
function doorClosed(z, x, y) { const d = doorAt(z, x, y); return d ? !!d.closed : false; }

function solidAt(z, x, y, opt) {
  const c = T(z, x, y);
  if (c === '#' || c === 'F' || c === 'S' || c === 'W' || c === 'X') return true;
  if (c === 'L' || c === 'B') return true;
  if (c === 'D') {
    if (opt && opt.openDoors) return false;
    return doorClosed(z, x, y);
  }
  return false;
}
const freeCell = (z, x, y) => !solidAt(z, x, y) && T(z, x, y) !== 'F';
const walkCell = (z, x, y) => !solidAt(z, x, y, { openDoors: 1 });

function openDoor(z, x, y, byPlayer) {
  const d = doorAt(z, x, y);
  if (!d || !d.closed) return false;
  d.closed = 0;
  if (byPlayer) {
    const k = z + ':' + (x | 0) + ':' + (y | 0);
    M.entries[k] = (M.entries[k] || 0) + 1;
    makeNoise(x + 0.5, y + 0.5, z, byPlayer.crouch ? 2.4 : 4.5, 'door');
  }
  return true;
}
function closeDoor(z, x, y, silent) {
  const d = doorAt(z, x, y);
  if (!d || d.closed) return false;
  d.closed = 1;
  if (!silent) makeNoise(x + 0.5, y + 0.5, z, 3, 'door');
  return true;
}

/* ------------------------------------------------------------ pathfinding */
const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NB8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

function floorPath(z, sx, sy, tx, ty, opt) {
  opt = opt || {};
  const F = W.floors[z];
  if (!F) return [];
  sx |= 0; sy |= 0; tx |= 0; ty |= 0;
  if (sx === tx && sy === ty) return [[tx, ty]];
  const pass = (x, y) => {
    if (x < 0 || y < 0 || x >= MW || y >= MH) return false;
    const c = F.G[y][x];
    if (c === '#' || c === 'F' || c === 'S' || c === 'W' || c === 'X') return false;
    if (c === 'L' || c === 'B') return !!opt.keys;
    if (c === 'D') return opt.allowClosed ? true : !doorClosed(z, x, y);
    return true;
  };
  if (!pass(tx, ty)) {
    // snap to the nearest reachable neighbour of the target
    let best = null, bd = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (pass(x, y) && dst(x, y, tx, ty) < bd) { bd = dst(x, y, tx, ty); best = [x, y]; }
    }
    if (!best) return [];
    tx = best[0]; ty = best[1];
  }
  const idx = (x, y) => y * MW + x;
  const open = [idx(sx, sy)];
  const g = new Map([[idx(sx, sy), 0]]);
  const from = new Map();
  const f = new Map([[idx(sx, sy), dst(sx, sy, tx, ty)]]);
  const closed = new Set();
  let guard = 0;
  while (open.length && guard++ < 9000) {
    let bi = 0, bf = Infinity;
    for (let i = 0; i < open.length; i++) { const v = f.get(open[i]); if (v < bf) { bf = v; bi = i; } }
    const cur = open.splice(bi, 1)[0];
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % MW, cy = (cur / MW) | 0;
    if (cx === tx && cy === ty) {
      const out = [];
      let c = cur;
      while (c !== undefined) { out.unshift([c % MW, (c / MW) | 0]); c = from.get(c); }
      return out;
    }
    for (const [dx, dy, cost] of NB8) {
      const nx = cx + dx, ny = cy + dy;
      if (!pass(nx, ny)) continue;
      if (dx && dy && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      if (closed.has(ni)) continue;
      const ng = g.get(cur) + cost;
      if (ng < (g.get(ni) === undefined ? Infinity : g.get(ni))) {
        g.set(ni, ng);
        f.set(ni, ng + dst(nx, ny, tx, ty));
        from.set(ni, cur);
        open.push(ni);
      }
    }
  }
  return [];
}

/* Path across floors. Returns waypoints [{x,y,z}] including stair hand-offs. */
function pathFind(a, b, opt) {
  opt = opt || {};
  if (a.z === b.z) {
    const p = floorPath(a.z, a.x, a.y, b.x, b.y, opt);
    return p.map(([x, y]) => ({ x, y, z: a.z }));
  }
  const links = [];
  const direct = STAIR.filter((s) => (s.a.z === a.z && s.b.z === b.z) || (s.b.z === a.z && s.a.z === b.z));
  for (const s of direct) {
    const from = s.a.z === a.z ? s.a : s.b;
    const to = s.a.z === a.z ? s.b : s.a;
    const p1 = floorPath(a.z, a.x, a.y, from.x, from.y, opt);
    if (!p1.length) continue;
    const p2 = floorPath(b.z, to.x, to.y, b.x, b.y, opt);
    if (!p2.length) continue;
    links.push({ from, to, p1, p2, cost: p1.length + p2.length });
  }
  if (!links.length && a.z !== 0 && b.z !== 0) {
    // upstairs -> cellar: go down to the ground floor first
    const mid = { x: a.x, y: a.y, z: 0 };
    const p1 = pathFind(a, mid, opt);
    if (p1.length) {
      const start = p1[p1.length - 1];
      const p2 = pathFind({ x: start.x, y: start.y, z: 0 }, b, opt);
      if (p2.length) return p1.concat(p2.slice(1));
    }
    return [];
  }
  if (!links.length) return [];
  links.sort((x, y) => x.cost - y.cost);
  const best = links[0];
  return best.p1.map(([x, y]) => ({ x, y, z: a.z }))
    .concat(best.p2.map(([x, y]) => ({ x, y, z: b.z })));
}

function standable(z, x, y, r) {
  r = r == null ? 0.3 : r;
  const fx = Math.floor(x), fy = Math.floor(y);
  if (!freeCell(z, fx, fy)) return false;
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) if (!freeCell(z, Math.floor(x + dx), Math.floor(y + dy))) return false;
  return true;
}
function nearestStandable(z, x, y, r) {
  for (let rad = 0; rad <= 5; rad++) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (rad && Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const nx = Math.floor(x) + dx, ny = Math.floor(y) + dy;
      if (standable(z, nx + 0.5, ny + 0.5, r)) return [nx, ny];
    }
  }
  return null;
}

/* --------------------------------------------------------------- movement */
function moveCircle(e, dx, dy, r) {
  const ok = (x, y) => freeCell(e.z, Math.floor(x), Math.floor(y));
  const nx = e.x + dx;
  if (ok(nx + Math.sign(dx) * r, e.y) && ok(nx, e.y + r) && ok(nx, e.y - r) && ok(nx + Math.sign(dx) * r, e.y + r) && ok(nx + Math.sign(dx) * r, e.y - r)) e.x = nx;
  const ny = e.y + dy;
  if (ok(e.x, ny + Math.sign(dy) * r) && ok(e.x + r, ny) && ok(e.x - r, ny) && ok(e.x + r, ny + Math.sign(dy) * r) && ok(e.x - r, ny + Math.sign(dy) * r)) e.y = ny;
}

/* ----------------------------------------------------------------- noise */
function makeNoise(x, y, z, radius, tag, extra) {
  NZ.push({ x, y, z, r: radius, t: 0, tag });
  if (NZ.length > 60) NZ.shift();
  if (N) hearNoise(x, y, z, radius, tag, extra);
}

/* ------------------------------------------------------------ projectiles */
function spawnProjectile(kind, x, y, z, vx, vy, vz, owner, extra) {
  PR.push(Object.assign({ k: kind, x, y, z, vx, vy, vz, own: owner, t: 0, ox: x, oy: y, oz: z }, extra || {}));
}
function updateProjectiles(dt) {
  for (const p of PR) {
    if (p.dead) { p.t += dt; continue; }
    p.t += dt;
    p.vz -= 13 * dt;
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    p.z += p.vz * dt;
    const cell = T(p.z | 0, nx, ny);
    if (cell === 'W') {
      const fz = p.z | 0;
      W.floors[fz].G[ny | 0][nx | 0] = 'w';
      W.floors[fz].windows = (W.floors[fz].windows || []);
      M.entries[fz + ':' + (nx | 0) + ':' + (ny | 0)] = (M.entries[fz + ':' + (nx | 0) + ':' + (ny | 0)] || 0);
      makeNoise(nx, ny, fz, 17, 'glass');
      say('CRASH! Glass shatters.');
      p.dead = 1; continue;
    }
    if (solidAt(p.z | 0, nx, ny) || cell === '#') { p.dead = 1; continue; }
    p.x = nx; p.y = ny;
    if (p.z <= 0) {
      p.z = 0;
      p.dead = 1;
      if (p.k === 'tomato' || p.k === 'vase' || p.k === 'bottle') { SPL.push({ x: p.x, y: p.y, z: p.z | 0, k: 'splat', t: 0 }); makeNoise(p.x, p.y, p.z | 0, 7, 'impact'); }
      else { makeNoise(p.x, p.y, p.z | 0, 6, 'impact'); }
    }
    // hits
    if (p.own === 'p' && N && N.z === (p.z | 0) && dst(p.x, p.y, N.x, N.y) < 0.55 && p.z < 1.9 && !p.dead) {
      p.dead = 1;
      N.stun = 1.6;
      N.al = 1;
      M.suspicion = Math.min(100, M.suspicion + 6);
      N.lastSeen = { x: P.x, y: P.y, z: P.z, t: GAME.t };
      say('Direct hit! He is furious.');
      aiSay('Someone threw that… from over there!');
      makeNoise(p.x, p.y, p.z | 0, 6, 'hit');
      aiHitByThrow(p.ox, p.oy, p.oz);
    }
    if (p.own === 'n' && P && P.z === (p.z | 0) && dst(p.x, p.y, P.x, P.y) < 0.55 && p.z < 1.8 && !p.dead) {
      p.dead = 1;
      P.stun = 1.2;
      P.slow = 2.2;
      say('He hit you with a ' + p.k + '!');
    }
  }
  for (let i = PR.length - 1; i >= 0; i--) if (PR[i].dead && PR[i].t > 0.6) PR.splice(i, 1);
  for (let i = SPL.length - 1; i >= 0; i--) { SPL[i].t += dt; if (SPL[i].t > 120) SPL.splice(i, 1); }
}

/* ------------------------------------------------------------------ traps */
function trapAt(z, x, y) { return TRAPS.find((t) => t.z === z && (t.x | 0) === (x | 0) && (t.y | 0) === (y | 0)); }
function addTrap(z, x, y, fromMemory) {
  const key = z + ':' + (x | 0) + ':' + (y | 0);
  if (TRAPS.some((t) => t.z === z && (t.x | 0) === (x | 0) && (t.y | 0) === (y | 0))) return null;
  const t = { x: (x | 0) + 0.5, y: (y | 0) + 0.5, z, armed: 1 };
  TRAPS.push(t);
  if (!fromMemory && !M.traps.includes(key)) { M.traps.push(key); saveMatch(); }
  return t;
}
function isValidTrapCell(z, x, y) {
  const c = T(z, x, y);
  if (c !== '.' && c !== ',' && c !== 'P' && c !== 'V') return false;
  if (doorAt(z, x, y)) return false;                 // never on a doorway
  if (stairFrom(z, x, y)) return false;              // never on stairs
  if (trapAt(z, x, y)) return false;
  if (!standable(z, x + 0.5, y + 0.5, 0.28)) return false;
  for (const c2 of W.containers) if (c2.z === z && Math.abs(c2.tx - x) + Math.abs(c2.ty - y) < 2) return false;
  if (z === 0 && dst(x + 0.5, y + 0.5, W.spawn.x, W.spawn.y) < 3) return false;
  if (P && P.z === z && dst(x + 0.5, y + 0.5, P.x, P.y) < 2.6) return false;
  return true;
}

/* --------------------------------------------------------------- cameras */
function addCamera(z, x, y) {
  const key = z + ':' + (x | 0) + ':' + (y | 0);
  if (CAMS.some((c) => c.z === z && (c.x | 0) === (x | 0) && (c.y | 0) === (y | 0))) return null;
  const c = { x: (x | 0) + 0.5, y: (y | 0) + 0.5, z, a: 0, sweep: 1.1, seeT: 0, cd: 0 };
  CAMS.push(c);
  if (!M.cams.includes(key)) { M.cams.push(key); saveMatch(); }
  return c;
}

/* --------------------------------------------------------------- stations */
const STATION_RULES = [
  ['tv', (r) => r.type === 'living', 'tv'],
  ['couch', (r) => r.type === 'living', 'couch'],
  ['fridge', (r) => r.type === 'kitchen', 'fridge'],
  ['stove', (r) => r.type === 'kitchen', 'stove'],
  ['sink', (r) => r.type === 'kitchen', 'sink'],
  ['ktable', (r) => r.type === 'kitchen', 'table'],
  ['bed', (r) => r.type === 'bedroom', 'bed'],
  ['wardrobe', (r) => r.type === 'bedroom', 'wardrobe'],
  ['desk', (r) => r.type === 'study', 'desk'],
  ['books', (r) => r.type === 'study', 'bookshelf'],
  ['tub', (r) => r.type === 'bathroom', 'tub'],
  ['toilet', (r) => r.type === 'bathroom', 'toilet'],
  ['basin', (r) => r.type === 'bathroom', 'basin'],
  ['bench', (r) => r.type === 'workshop', 'bench'],
  ['rack', (r) => r.type === 'workshop', 'rack'],
  ['furn', (r) => r.type === 'hall', null],
  ['cellar', (r) => r.type === 'vault', null],
];

function buildStations() {
  W.stations = {};
  const add = (name, z, x, y) => {
    if (W.stations[name]) return;
    const q = nearestStandable(z, x, y, 0.28);
    if (q) W.stations[name] = { x: q[0] + 0.5, y: q[1] + 0.5, z };
  };
  for (const F of W.floors) {
    for (const r of F.rooms) {
      for (const [name, rule, kind] of STATION_RULES) {
        if (!rule(r)) continue;
        let f = null;
        if (kind) f = F.furniture.find((q) => q.k === kind && q.room === r.id);
        if (!f && r.type === 'hall') f = F.furniture.find((q) => q.room === r.id);
        if (f) add(name, F.z, f.x + f.w / 2, f.y + f.h / 2);
        else if (r.type === 'vault' && name === 'cellar') add('cellar', F.z, W.cellar.door.x, W.cellar.door.y);
      }
    }
  }
  // objective stations always exist
  for (const c of W.containers) add(c.id, c.z, c.x, c.y);
  const picks = ['tv', 'couch', 'fridge', 'stove', 'sink', 'ktable', 'bed', 'wardrobe', 'desk', 'books', 'tub', 'toilet', 'basin', 'bench', 'rack', 'furn', 'cellar'];
  for (const p of picks) if (!W.stations[p]) {
    const F = W.floors[0];
    for (const r of F.rooms) { const q = nearestStandable(F.z, r.cx, r.cy, 0.28); if (q) { W.stations[p] = { x: q[0] + 0.5, y: q[1] + 0.5, z: F.z }; break; } }
  }
  // stairs + cellar + entries
  const up = STAIR[0];
  if (up) W.stations.stairs = { x: up.a.x + 0.5, y: up.a.y + 0.5, z: up.a.z };
  W.stations.front = { x: W.front.ix + 0.5, y: W.front.iy + 1.5, z: 0 };
}

/* ---------------------------------------------------------------- helpers */
function say(text, secs) { UI.msg = text; UI.msgT = secs || 2.6; }
function aiSay(text, secs) { if (N) { N.quip = text; N.quipT = secs || 2.8; } }
function matchHash() {
  let h = 2166136261 >>> 0;
  for (const F of W.floors) for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    h ^= F.G[y][x].charCodeAt(0); h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
