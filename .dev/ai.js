'use strict';
/* =====================================================================
   ai.js — the neighbour.

   Perception is honest: a view cone with occlusion, hearing attenuated by
   walls and floors, and no wallhacks. Behaviour is a utility-driven state
   machine (routine / suspicious / search / chase / ambush / fortify) on top
   of a per-floor belief map. Learning lives in the match memory: entries,
   routes, hiding spots, active hours, thefts, suspicion and fortifications.
   ===================================================================== */

const NEED0 = () => ({ hunger: 0.35, thirst: 0.3, boredom: 0.4, energy: 0.15, hygiene: 0.2, suspicion: 0.2 });

/* ------------------------------------------------------------------ tasks
   station -> a place he can stand next to. Durations are seconds. */
const TASKS = [
  { n: 'watch_tv', st: 'tv', a: 22, b: 44, eff: { boredom: -8 }, hours: [17, 24] },
  { n: 'watch_news', st: 'tv', a: 16, b: 26, eff: { boredom: -5 }, hours: [6, 9] },
  { n: 'channel_surf', st: 'tv', a: 9, b: 16, eff: { boredom: -3 }, hours: null },
  { n: 'nap_on_couch', st: 'couch', a: 20, b: 34, eff: { energy: -5 }, hours: [13, 17] },
  { n: 'read_paper', st: 'couch', a: 14, b: 24, eff: { boredom: -4 }, hours: [6, 10] },
  { n: 'do_crossword', st: 'couch', a: 16, b: 28, eff: { boredom: -5 }, hours: null },
  { n: 'cook_dinner', st: 'stove', a: 24, b: 38, eff: { hunger: -8, boredom: -2 }, hours: [17, 20] },
  { n: 'fry_eggs', st: 'stove', a: 14, b: 22, eff: { hunger: -5 }, hours: [6, 10] },
  { n: 'boil_pasta', st: 'stove', a: 16, b: 24, eff: { hunger: -4 }, hours: [12, 14] },
  { n: 'make_tea', st: 'stove', a: 10, b: 16, eff: { thirst: -5 }, hours: null },
  { n: 'wash_dishes', st: 'sink', a: 16, b: 26, eff: { boredom: -2, hygiene: -2 }, hours: null },
  { n: 'drink_water', st: 'sink', a: 6, b: 10, eff: { thirst: -7 }, hours: null },
  { n: 'open_fridge', st: 'fridge', a: 8, b: 14, eff: { hunger: -3 }, hours: null },
  { n: 'midnight_snack', st: 'fridge', a: 10, b: 16, eff: { hunger: -6 }, hours: [22, 27] },
  { n: 'eat_dinner', st: 'ktable', a: 20, b: 30, eff: { hunger: -7 }, hours: [18, 21] },
  { n: 'eat_breakfast', st: 'ktable', a: 14, b: 22, eff: { hunger: -6 }, hours: [6, 9] },
  { n: 'sleep', st: 'bed', a: 60, b: 100, eff: { energy: -9 }, hours: [22, 30] },
  { n: 'make_bed', st: 'bed', a: 12, b: 18, eff: { boredom: -2 }, hours: [7, 11] },
  { n: 'read_in_bed', st: 'bed', a: 18, b: 30, eff: { boredom: -4, energy: -1 }, hours: [21, 24] },
  { n: 'change_clothes', st: 'wardrobe', a: 12, b: 18, eff: { hygiene: -3 }, hours: null },
  { n: 'fold_laundry', st: 'wardrobe', a: 14, b: 22, eff: { boredom: -2 }, hours: null },
  { n: 'pay_bills', st: 'desk', a: 22, b: 34, eff: { boredom: -4 }, hours: [9, 17] },
  { n: 'write_notes', st: 'desk', a: 16, b: 26, eff: { boredom: -4 }, hours: null },
  { n: 'read_book', st: 'books', a: 18, b: 32, eff: { boredom: -6 }, hours: null },
  { n: 'dust_shelf', st: 'books', a: 12, b: 20, eff: { boredom: -2, hygiene: -2 }, hours: null },
  { n: 'take_bath', st: 'tub', a: 28, b: 42, eff: { hygiene: -9 }, hours: [19, 22] },
  { n: 'brush_teeth', st: 'basin', a: 8, b: 14, eff: { hygiene: -4 }, hours: [6, 9] },
  { n: 'use_toilet', st: 'toilet', a: 8, b: 12, eff: { hygiene: -3 }, hours: null },
  { n: 'fix_toaster', st: 'bench', a: 22, b: 34, eff: { boredom: -4 }, hours: [9, 17] },
  { n: 'sharpen_tools', st: 'bench', a: 16, b: 24, eff: { boredom: -3 }, hours: null },
  { n: 'organize_tools', st: 'rack', a: 14, b: 22, eff: { boredom: -2 }, hours: null },
  { n: 'pace_hall', st: 'furn', a: 10, b: 18, eff: { boredom: -2 }, hours: null },
  { n: 'check_basement_lock', st: 'cellar', a: 8, b: 14, eff: { suspicion: -4 }, hours: null },
  { n: 'listen_at_basement', st: 'cellar', a: 10, b: 18, eff: { suspicion: -3 }, hours: [20, 24] },
  { n: 'check_front_door', st: 'front', a: 6, b: 10, eff: { suspicion: -3 }, hours: null },
  { n: 'look_out_window', st: 'tv', a: 10, b: 18, eff: { suspicion: -2 }, hours: [18, 23] },
];

let AI_T = 0;

/* ------------------------------------------------------------------ setup */
function initAI() {
  N = {
    x: W.spawn.x, y: W.spawn.y, z: 0, a: -Math.PI / 2,
    mode: 'routine', st: 'idle', label: '', prio: 0,
    script: [], si: 0, stepT: 0, path: [], pathI: 0,
    al: 0, need: NEED0(), recent: [],
    lastSeen: null, pvel: { x: 0, y: 0 }, pp: P ? { x: P.x, y: P.y } : { x: 0, y: 0 },
    track: null, sounds: [], forensic: null,
    sees: 0, periph: 0, dist: 99,
    chaseT: 0, lostT: 0, repath: 0, stuck: 0, jink: 0,
    searchT: 0, searchN: 0, cleared: [], ambush: 0,
    stun: 0, sleeping: 0, quip: '', quipT: 0, done: 0,
    openT: 0, losT: 0, repathT: 0,
  };
  // he starts deep in the house, never camping the front door
  const gF = W.floors[0];
  let best = null, bd = -1;
  for (const r of gF.rooms) {
    let q = nearestStandable(0, r.cx, r.cy, 0.29);
    if (!q) continue;
    let d = dst(q[0], q[1], W.front.ix, W.front.iy);
    if (r.type === 'living' || r.type === 'kitchen') d += 4;
    if (d > bd) { bd = d; best = q; }
  }
  if (best) { N.x = best[0] + 0.5; N.y = best[1] + 0.5; }
  pickTask();
}

/* ------------------------------------------------------------- perception */
function sightRange() {
  const h = GAME.clock;
  let r = 10.5 + Math.min(3, M.catches * 0.6);
  if (isNight(h)) r *= 0.8;                       // 20% shorter at night
  if (P.crouch) r *= 0.55;
  if (P.sprint) r *= 1.15;                        // sprinting gives you away
  if (P.flash) r *= 1.5;
  if (roomLit(P.z, P.x, P.y)) r *= 1.1;
  if (isNight(h) && !litAt(P.z, P.x, P.y)) r *= 0.85;
  r *= 1 + hourWeight() * 0.15;
  return r;
}
function fovDot() { return 0.55; }

function lineOfSight(a, b) {
  if (a.z !== b.z) return false;
  const d = dst(a.x, a.y, b.x, b.y);
  const n = Math.ceil(d / 0.28);
  for (let i = 1; i < n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    const c = T(a.z, x | 0, y | 0);
    if (c === '#' || c === 'F' || c === 'S' || c === 'W' || c === 'X') return false;
    if (c === 'D' && doorClosed(a.z, x | 0, y | 0)) return false;
  }
  return true;
}

function perceive(dt) {
  if (!P) return;
  if (!N.pp) N.pp = { x: P.x, y: P.y };
  const d = P.z === N.z ? dst(N.x, N.y, P.x, P.y) : 99;
  N.dist = d;
  const los = lineOfSight(N, P);
  const ang = Math.atan2(P.y - N.y, P.x - N.x);
  const off = Math.abs(Math.atan2(Math.sin(ang - N.a), Math.cos(ang - N.a)));
  const range = sightRange();
  const inCone = off < 0.95 * 1.15;
  N.sees = (d < range && (inCone || d < 2.2) && los) ? 1 : 0;
  N.periph = (!N.sees && d < 5.5 && off < 1.65 && los) ? 1 : 0;
  N.losT = los ? N.losT + dt : 0;

  if (N.sees) {
    const close = d < 4;
    N.locked = 1;
    N.al = Math.min(1, N.al + dt * (close ? 3.4 : 1.7) * (N.sleeping ? 0.35 : 1));
    N.lastSeen = { x: P.x, y: P.y, z: P.z, t: GAME.t };
    if (dt > 0) {
      const k = Math.min(1, dt * 6);
      N.pvel.x = lerp(N.pvel.x, clamp((P.x - N.pp.x) / dt, -7, 7), k);
      N.pvel.y = lerp(N.pvel.y, clamp((P.y - N.pp.y) / dt, -7, 7), k);
    }
    M.hours[GAME.clock | 0] = (M.hours[GAME.clock | 0] || 0) + dt * 0.8;
    M.rooms[roomNameAt(P.z, P.x, P.y)] = (M.rooms[roomNameAt(P.z, P.x, P.y)] || 0) + dt;
    M.suspicion = Math.min(100, M.suspicion + dt * (isNight(GAME.clock) ? 1.6 : 2.4));
    // he watches: sight is sticky, so a player standing in the open is caught
    if (N.al > 0.12 && N.prio < 3) turnTo(Math.atan2(P.y - N.y, P.x - N.x), dt, 7);
  } else {
    N.locked = 0;
    N.al = Math.max(0, N.al - dt * 0.32);
    N.pvel.x *= 0.97; N.pvel.y *= 0.97;
  }
  N.pp = { x: P.x, y: P.y };

  if (N.sleeping && N.sees) {
    // lighter sleeper after a catch
    N.sleeping = 0;
    aiSay('Huh? …I heard that.');
  }
  if (N.mode !== 'chase') {
    if (N.sees && N.al >= 1) {
      if (d > 7.5 && !N.quiet) startQuietApproach();
      else startChase('spotted');
    } else if (N.sees && N.al > 0.45 && N.mode === 'routine') {
      turnTo(Math.atan2(P.y - N.y, P.x - N.x), dt, 6);
      if (!N.script.length) runScript('noticing', {}, 1);
    }
  }
}
function roomNameAt(z, x, y) { const r = roomAt(z, x | 0, y | 0); return r ? r.type : 'yard'; }

/* ------------------------------------------------------------------ hearing */
function hearNoise(x, y, z, radius, tag) {
  if (!N || GAME.state !== 'play' || N.mode === 'chase') return;
  const floorGap = Math.abs(N.z - z);
  const d = floorGap ? 99 : dst(N.x, N.y, x, y);
  if (floorGap > 0) {
    if (radius < 10) return;               // through a floor: only loud things
  }
  const walls = wallCount(N.z, N.x, N.y, x, y);
  const eff = (radius * Math.pow(0.74, walls) * (floorGap ? 0.4 : 1)) * (N.sleeping ? 0.55 : 1);
  if (d > eff) return;

  // suspicion feeds on every sound he can place
  M.suspicion = Math.min(100, M.suspicion + (tag === 'glass' ? 3.2 : tag === 'trap' ? 5 : 1.1));
  M.hours[GAME.clock | 0] = (M.hours[GAME.clock | 0] || 0) + 0.2;

  if (tag !== 'step') {
    N.sounds.push({ x, y, z, t: GAME.t, tag, r: radius });
    if (N.sounds.length > 12) N.sounds.shift();
  } else {
    N.sounds.push({ x, y, z, t: GAME.t, tag, r: radius });
    if (N.sounds.length > 12) N.sounds.shift();
  }

  // ---- belief: sounds always sharpen the map, even mid-search
  belAdd(z, x, y, tag === 'glass' ? 2.4 : 1.1);
  if (N.mode === 'search') {
    N.searchT = Math.min(N.searchT, 8);
    N.lastHeard = { x, y, z, t: GAME.t };
    if (N.prio < 2) {
      const spot = belPeak(z);
      if (spot && N.searchN > 0) { /* he re-aims on the next search step */ N.reaim = { x: spot.x, y: spot.y, z }; }
    }
    return; // never yanks the search script around mid-stride
  }

  if (N.stun > 0) return;

  // ---- rolling footstep tracking: 3+ sounds in 6 s predicts a position
  const recent = N.sounds.filter((s) => GAME.t - s.t < 6 && s.z === z);
  if (recent.length >= 3 && tag === 'step') {
    const first = recent[0], last = recent[recent.length - 1];
    const dt = Math.max(0.2, last.t - first.t);
    const vx = clamp((last.x - first.x) / dt, -6, 6);
    const vy = clamp((last.y - first.y) / dt, -6, 6);
    const lead = clamp(dt * 0.8, 0.5, 2.2);
    const px = last.x + vx * lead, py = last.y + vy * lead;
    N.track = { x: px, y: py, z, vx, vy, t: GAME.t };
    if (N.mode === 'routine' || N.mode === 'suspicious' || N.mode === 'ambush') {
      N.mode = 'suspicious';
      runScript('follow_sound', { x: px, y: py, z }, 2);
      aiSay('Following the sound…');
    }
    return;
  }

  if (N.sleeping) {
    // one catch teaches him to sleep with one eye open
    const wakeAt = Math.max(2.5, 9 - M.catches * 2 - M.suspicion * 0.03);
    if (radius > wakeAt || N.sees) { N.sleeping = 0; runScript('wake_up', {}, 2); }
    return;
  }
  if (N.prio >= 2) return;      // already busy with something more urgent
  if (tag === 'glass') { runScript('check_window', { x: x | 0, y: y | 0, z }, 2); return; }
  if (tag === 'door') { runScript('check_door', { x: x | 0, y: y | 0, z }, 2); return; }
  if (tag === 'trap') { runScript('check_traps', {}, 2); return; }
  if (tag === 'camera') { runScript('check_camera', { x: x | 0, y: y | 0, z }, 2); return; }
  N.mode = 'suspicious';
  runScript('inspect_noise', { x, y, z }, 2);
}

function wallCount(az, ax, ay, bx, by) {
  if (az !== bx && false) return 0;
  const d = dst(ax, ay, bx, by);
  const n = Math.ceil(d / 0.4);
  let w = 0, prev = false;
  for (let i = 1; i < n; i++) {
    const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
    const c = T(az, x | 0, y | 0);
    const blocked = c === '#' || c === 'S' || c === 'W' || c === 'X' || (c === 'D' && doorClosed(az, x | 0, y | 0));
    if (blocked && !prev) w++;
    prev = blocked;
  }
  return w;
}

/* ------------------------------------------------------------------ belief */
function belAdd(z, x, y, m) {
  const i = (y | 0) * MW + (x | 0);
  if (BEL[z] && i >= 0 && i < BEL[z].length) BEL[z][i] += m;
}
function belAt(z, x, y) { return BEL[z] ? BEL[z][(y | 0) * MW + (x | 0)] : 0; }
function belTotal(z) { let s = 0; const B = BEL[z]; for (let i = 0; i < B.length; i++) s += B[i]; return s; }
function belClear() { for (const B of BEL) B.fill(0); }

function belSeed() {
  belClear();
  const ls = N.lastSeen || { x: P.x, y: P.y, z: P.z };
  for (let t = 0; t <= 3.0; t += 0.35) {
    const x = ls.x + N.pvel.x * t, y = ls.y + N.pvel.y * t;
    belAdd(ls.z, x, y, t === 0 ? 1.6 : 0.7);
  }
  const goal = playerGoal();
  if (goal) {
    const path = pathFind({ x: ls.x, y: ls.y, z: ls.z }, goal, { allowClosed: 1 });
    let n = 0;
    for (const p of path) { if (n++ > 14) break; belAdd(p.z, p.x, p.y, 0.45); }
    belAdd(goal.z, goal.x, goal.y, 0.8);
  }
  // remembered hiding places
  for (const h of M.hides) belAdd(h.z, h.x, h.y, 1.2);
  // places he has recently cleared are less likely
  for (const c of N.cleared) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) belAdd(c.z, c.x + dx, c.y + dy, -0.5);
  belNormalize();
}
function belNormalize() {
  for (let z = 0; z < 3; z++) {
    let max = 0.0001;
    const B = BEL[z];
    for (let i = 0; i < B.length; i++) if (B[i] > max) max = B[i];
    for (let i = 0; i < B.length; i++) if (B[i] < 0) B[i] = 0;
    if (max > 1) for (let i = 0; i < B.length; i++) B[i] /= max;
  }
}
function belDiffuse() {
  for (let z = 0; z < 3; z++) {
    const B = BEL[z], out = new Float32Array(B.length);
    for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
      const i = y * MW + x, v = B[i];
      if (v < 0.004) continue;
      const nb = [];
      for (const [dx, dy] of NB4) if (walkCell(z, x + dx, y + dy)) nb.push(i + dy * MW + dx);
      out[i] += v * 0.55;
      for (const j of nb) out[j] += v * 0.45 / nb.length;
    }
    for (let i = 0; i < B.length; i++) B[i] = B[i] * 0.6 + out[i] * 0.9;
  }
  belNormalize();
}
function belPeak(z) {
  const B = BEL[z];
  let bi = -1, bv = 0;
  for (let y = 2; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) {
    const i = y * MW + x;
    if (B[i] <= bv) continue;
    if (!walkCell(z, x, y)) continue;
    bv = B[i]; bi = i;
  }
  if (bi < 0) return null;
  return { x: bi % MW + 0.5, y: (bi / MW | 0) + 0.5, z, v: bv };
}
function belSpots(z, n) {
  const B = BEL[z], arr = [];
  for (let y = 2; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += B[(y + dy) * MW + x + dx];
    if (s <= 0.02 || !walkCell(z, x, y)) continue;
    let pen = 1;
    for (const c of N.cleared) if (c.z === z && dst(x, y, c.x, c.y) < 3) pen = 0.2;
    arr.push({ x: x + 0.5, y: y + 0.5, z, s: s * pen / (1 + dst(N.x, N.y, x, y) * 0.05) });
  }
  arr.sort((a, b) => b.s - a.s);
  const out = [];
  for (const a of arr) {
    if (out.some((o) => dst(o.x, o.y, a.x, a.y) < 3.5)) continue;
    out.push(a);
    if (out.length >= n) break;
  }
  return out;
}

/* --------------------------------------------------------------- movement */
function turnTo(target, dt, rate) {
  const d = Math.atan2(Math.sin(target - N.a), Math.cos(target - N.a));
  N.a += clamp(d, -rate * dt, rate * dt);
}

function followPath(dt, speed) {
  if (!N.path.length) return 1;
  const wp = N.path[0];
  const tx = wp.x + 0.5, ty = wp.y + 0.5;
  if (wp.z !== N.z) {
    // a stair hand-off: he must be standing on the stair tile
    if (dst(N.x, N.y, tx, ty) < 1.1) {
      N.x = tx; N.y = ty; N.z = wp.z;
      N.path.shift();
    } else {
      N.path = pathFind({ x: N.x, y: N.y, z: N.z }, wp, { allowClosed: 1 });
      if (!N.path.length) return 1;
    }
    return 0;
  }
  const dx = tx - N.x, dy = ty - N.y, d = Math.hypot(dx, dy);
  if (d < 0.26) { N.path.shift(); return N.path.length ? 0 : 1; }
  turnTo(Math.atan2(dy, dx), dt, 9);
  // doors: open instead of bumping
  const ax = N.x + Math.cos(N.a) * 0.55, ay = N.y + Math.sin(N.a) * 0.55;
  const ahead = T(N.z, ax | 0, ay | 0);
  if (ahead === 'D' && doorClosed(N.z, ax | 0, ay | 0)) {
    openDoor(N.z, ax | 0, ay | 0, null);
    N.openT = 0.35;
    return 0;
  }
  if (N.openT > 0) { N.openT -= dt; return 0; }

  const step = Math.min(speed * dt, d);
  const ox = N.x, oy = N.y;
  moveCircle(N, (dx / d) * step, (dy / d) * step, 0.29);
  if (dst(ox, oy, N.x, N.y) < step * 0.25) {
    N.stuck += dt;
    if (N.stuck > 0.28) {
      N.stuck = 0; N.jink = (N.jink || 0) + 1; N.repath = 1;
      const sgn = N.jink % 2 ? 1 : -1;
      moveCircle(N, (-dy / d) * step * 2 * sgn, (dx / d) * step * 2 * sgn, 0.29);
      if (N.jink > 4) { N.jink = 0; N.path = []; }
    }
  } else N.stuck = 0;
  return 0;
}

function goTo(x, y, z, opt) {
  const p = pathFind({ x: N.x, y: N.y, z: N.z }, { x, y, z }, Object.assign({ allowClosed: 1 }, opt || {}));
  N.path = p;
  return p.length > 0;
}

/* ----------------------------------------------------------------- scripts */
const SCRIPTS = {
  idle: () => [{ wait: 1.2, label: 'standing there', sweep: 1 }],
  noticing: () => [{ wait: 0.7, label: 'who is that?', faceP: 1 }],
  inspect_noise: (p) => [
    { go: [p.x, p.y, p.z], label: 'checking that noise' },
    { wait: 1.3, label: 'hmm…', sweep: 1 },
    { fn: () => { if (N.mode === 'suspicious' && !N.sees) { belAdd(p.z, p.x, p.y, 1.4); N.searchT = 0; startSearch('investigated'); } } },
  ],
  follow_sound: (p) => [
    { go: [p.x, p.y, p.z], label: 'following the sound…' },
    { wait: 1.4, label: 'I know you are in here', sweep: 1 },
    { fn: () => { if (!N.sees) startSearch('tracked'); } },
  ],
  check_window: (p) => [
    { go: [p.x, p.y, p.z], label: 'a window is broken!' },
    { wait: 1.5, label: 'checking the window', face: [p.x + 0.5, p.y + 0.5] },
    { fn: () => { M.suspicion = Math.min(100, M.suspicion + 4); planBoardWindow(p.x, p.y, p.z); } },
  ],
  check_door: (p) => [
    { go: [p.x, p.y, p.z], label: 'who left this open?' },
    { wait: 1.1, label: 'closing it', face: [p.x + 0.5, p.y + 0.5] },
    { fn: () => { closeDoor(p.z, p.x, p.y, 1); M.suspicion = Math.min(100, M.suspicion + 1.5); } },
  ],
  check_camera: (p) => [{ go: [p.x, p.y, p.z], label: 'checking the camera' }, { wait: 1.2, label: 'hmm…' }],
  check_traps: () => [{ wait: 1, label: 'checking my traps' }],
  wipe_face: () => [{ wait: 1.6, label: 'TOMATO?! ugh!' }],
  hunt_thrower: (p) => [
    { go: [p.x, p.y, p.z], label: 'you threw that from here!' },
    { wait: 1.2, label: 'I can smell you', sweep: 1 },
    { fn: () => { belAdd(p.z, p.x, p.y, 2.5); N.lastSeen = { x: p.x, y: p.y, z: p.z, t: GAME.t }; startSearch('forensic'); } },
  ],
  search_spot: (p) => [
    { go: [p.x, p.y, p.z], label: 'checking the likeliest spot' },
    { wait: 1.5, label: 'sweeping', sweep: 1 },
    { fn: () => { checkTheftsNear(); N.cleared.push({ x: p.x, y: p.y, z: p.z }); if (N.cleared.length > 8) N.cleared.shift(); endSearchStep(); } },
  ],
  search_room: (p) => [
    { go: [p.x, p.y, p.z], label: 'sweeping the room' },
    { wait: 1.2, label: 'in here?', sweep: 1 },
    { go: [p.x + 1.6, p.y, p.z], label: 'sweeping the room' },
    { fn: () => { endSearchStep(); } },
  ],
  ambush_door: (p) => [
    { go: [p.x, p.y, p.z], label: 'waiting by the door' },
    { wait: 4.5, label: 'come through here…', face: [p.fx, p.fy] },
    { fn: () => { endSearchStep(); } },
  ],
  guard_obj: (p) => [
    { go: [p.x, p.y, p.z], label: 'watching ' + (p.what || 'this spot') },
    { wait: 8, label: 'not on my watch', sweep: 1 },
    { fn: () => { N.mode = 'routine'; pickTask(); } },
  ],
  guard_cellar: () => [
    { go: [W.cellar.door.x + 0.5, W.cellar.door.y + 1.5, 0], label: 'guarding the basement' },
    { wait: 9, label: 'I hear you breathing', face: [W.cellar.door.x + 0.5, W.cellar.door.y + 0.5] },
    { fn: () => { N.mode = 'routine'; pickTask(); } },
  ],
  relock_far: (p) => [
    { go: [p.x, p.y, p.z], label: 'someone picked my lock…' },
    { wait: 1.6, label: 'locking this again', face: [p.door.cells[0][0] + 0.5, p.door.cells[0][1] + 0.5] },
    { fn: () => { applyRelock({ door: p.door }); const k = M.needRelock.indexOf(p.door.z + ':' + p.door.cells[0][0] + ':' + p.door.cells[0][1]); if (k >= 0) M.needRelock.splice(k, 1); saveMatch(); } },
  ],
  tidy: (p) => [
    { go: [p.x, p.y, p.z], label: 'that does not belong there' },
    { wait: 1.2, label: 'putting it back' },
    { fn: () => { const it = ITEMS.find((q) => q === p.item); if (it && it.home) { it.x = it.home.x; it.y = it.home.y; it.z = it.home.z; it.noticed = 0; } M.suspicion = Math.min(100, M.suspicion + 2); saveMatch(); aiSay('Back where it belongs.'); } },
  ],
  relock: (p) => [
    { go: [p.x, p.y, p.z], label: 'locking this again' },
    { wait: 1.4, label: 'locked for good', face: [p.x + 0.5, p.y + 0.5] },
    { fn: () => { applyRelock(p); } },
  ],
  place_trap: (p) => [
    { go: [p.x, p.y, p.z], label: 'setting a little surprise' },
    { wait: 2.2, label: 'setting a bear trap…' },
    { fn: () => { addTrap(p.z, p.x, p.y); aiSay('That will slow you down.'); } },
  ],
  board_window: (p) => [
    { go: [p.x, p.y, p.z], label: 'boarding this up' },
    { wait: 2.6, label: 'hammering boards…', face: [p.x + 0.5, p.y + 0.5] },
    { fn: () => { applyBoard(p.z, p.x, p.y); } },
  ],
  install_camera: (p) => [
    { go: [p.x, p.y, p.z], label: 'mounting a camera' },
    { wait: 3, label: 'adjusting the angle…' },
    { fn: () => { addCamera(p.z, p.x, p.y); aiSay('Now I can watch that door.'); } },
  ],
  check_valuables: () => {
    const stops = [];
    for (const c of W.containers) {
      const q = nearestStandable(c.z, c.x, c.y, 0.28);
      if (q) stops.push({ go: [q[0] + 0.5, q[1] + 0.5, c.z], label: 'checking the ' + c.label, c });
    }
    stops.push({ go: [W.cellar.door.x + 0.5, W.cellar.door.y + 1.5, 0], label: 'checking the basement door' });
    stops.push({ fn: () => { checkTheftsNear(true); N.mode = 'routine'; pickTask(); } });
    return stops;
  },
  wake_up: () => [{ wait: 1.1, label: '…what was that?' }, { fn: () => { N.sleeping = 0; } }],
  calm_down: () => [{ wait: 1.6, label: 'must have been the wind…', sweep: 1 }, { fn: () => { N.al = 0; N.mode = 'routine'; pickTask(); } }],
  patrol: (p) => [
    { go: [p.a[0], p.a[1], p.a[2]], label: 'patrolling' },
    { wait: 1.2, label: 'scanning', sweep: 1 },
    { go: [p.b[0], p.b[1], p.b[2]], label: 'patrolling' },
    { wait: 1.2, label: 'scanning', sweep: 1 },
    { fn: () => { N.mode = 'routine'; pickTask(); } },
  ],
};

function runScript(name, params, prio) {
  const build = SCRIPTS[name];
  if (!build) return;
  N.st = name;
  N.script = build(params || {});
  N.si = 0; N.stepT = 0; N.path = []; N.prio = prio || 0;
  N.label = (N.script[0] && N.script[0].label) || '';
}
function endScript() {
  N.script = []; N.si = 0; N.prio = 0;
  if (N.mode === 'search') { searchNext(); return; }
  N.mode = 'routine';
  pickTask();
}

function scriptUpdate(dt) {
  if (!N.script.length) { endScript(); return; }
  const sc = N.script, idx = N.si;
  const s = sc[idx];
  if (!s) { endScript(); return; }
  // A step may install a whole new script (endScript/pickTask/runScript). Only
  // advance the cursor if we are still looking at the same step afterwards.
  const advance = () => {
    if (N.script === sc && N.si === idx) N.si = idx + 1;
    N.stepT = 0; N.goT = 0;
  };
  if (s.go) {
    if (N.repath || !N.path.length) {
      N.repath = 0;
      if (!goTo(s.go[0], s.go[1], s.go[2])) { advance(); return; }
    }
    N.label = s.label || N.label;
    if (followPath(dt, N.speed || 2.4)) { advance(); return; }
    N.goT = (N.goT || 0) + dt;
    if (N.goT > 22) { N.path = []; advance(); }
  } else if (s.wait != null) {
    N.stepT += dt;
    N.label = s.label || '';
    if (s.face) turnTo(Math.atan2(s.face[1] - N.y, s.face[0] - N.x), dt, 5);
    else if (s.faceP) turnTo(Math.atan2(P.y - N.y, P.x - N.x), dt, 5);
    else if (s.sweep && !N.locked) N.a += Math.sin(GAME.t * 2.6) * dt * 1.8;
    if (s.eff) for (const k in s.eff) N.need[k] = clamp((N.need[k] || 0) + s.eff[k] / s.wait, 0, 1);
    if (N.stepT >= s.wait) advance();
  } else if (s.fn) { s.fn(); advance(); }
}

/* ------------------------------------------------------------- search mode */
function startSearch(reason) {
  if (N.mode === 'chase' && reason !== 'lost') return;
  N.mode = 'search';
  N.mode = 'search'; N.searchT = 0; N.searchN = 0; N.cleared = []; N.prio = 0;
  N.searchReason = reason || 'lost';
  belSeed();
  aiSay('I know you are still in here.');
  searchNext();
}
function endSearchStep() {
  N.searchN++;
  if (N.mode === 'search') searchNext();
}
function searchNext() {
  if (N.mode !== 'search') return;
  if (N.searchT > 34) { N.mode = 'routine'; runScript('calm_down', {}, 1); return; }
  const total = belTotal(N.z) + belTotal(0) * 0.3 + belTotal(1) * 0.3;
  if (total < 0.05) { N.mode = 'routine'; runScript('calm_down', {}, 1); return; }

  // every third step: chokepoint ambush instead of sweeping
  if (N.searchN > 0 && N.searchN % 3 === 0) {
    const door = bestAmbushDoor();
    if (door) {
      runScript('ambush_door', { x: door.x, y: door.y, z: door.z, fx: door.fx, fy: door.fy }, 2);
      N.ambush = (N.ambush || 0) + 1;
      return;
    }
  }
  const spots = belSpots(N.z, 6).concat(belSpots(0, 3), belSpots(1, 3)).sort((a, b) => b.s - a.s);
  for (const s of spots) {
    if (goTo(s.x, s.y, s.z)) { runScript('search_spot', { x: s.x, y: s.y, z: s.z }, 2); return; }
  }
  N.mode = 'routine'; runScript('calm_down', {}, 1);
}

function bestAmbushDoor() {
  const peak = belPeak(N.z) || belPeak(0) || belPeak(1);
  if (!peak) return null;
  let best = null, bd = 1e9;
  for (const d of W.doors) {
    if (d.kind === 'lock' || d.kind === 'cellar') continue;
    for (const [x, y] of d.cells) {
      const dist = dst(x, y, peak.x, peak.y);
      if (dist < bd && dist < 26) {
        const q = nearestStandable(d.z, x, y, 0.28);
        if (q) { bd = dist; best = { x: q[0] + 0.5, y: q[1] + 0.5, z: d.z, fx: x + 0.5, fy: y + 0.5 }; }
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------- chase mode */
function startChase(reason) {
  if (N.mode === 'chase') return;
  N.mode = 'chase'; N.chaseT = 0; N.lostT = 0; N.quiet = 0;
  N.script = []; N.prio = 4; N.path = []; N.sleeping = 0;
  M.catches = M.catches; // no change here; catches only on a real catch
  M.suspicion = Math.min(100, M.suspicion + 6);
  aiSay('GOTCHA!');
  say('He spotted you — RUN!');
  addHeatRoute();
}
function startQuietApproach() {
  N.mode = 'suspicious'; N.quiet = 1;
  runScript('follow_sound', { x: P.x, y: P.y, z: P.z }, 2);
  aiSay('I can hear you breathing…');
}
function addHeatRoute() { if (P) M.route[P.z + ':' + (P.x | 0) + ',' + (P.y | 0)] = (M.route[P.z + ':' + (P.x | 0) + ',' + (P.y | 0)] || 0) + 3; }

function updateChase(dt) {
  N.chaseT += dt;
  const d = N.dist;
  const clear = lineOfSight(N, P);
  if (N.sees) {
    N.lostT = 0;
    N.lastSeen = { x: P.x, y: P.y, z: P.z, t: GAME.t };
    addHeatRoute();
    if (d < 2.6 && clear) {
      N.speed = 3.55 + Math.min(0.45, M.catches * 0.09);
      turnTo(Math.atan2(P.y - N.y, P.x - N.x), dt, 12);
      moveCircle(N, Math.cos(N.a) * N.speed * 1.12 * dt, Math.sin(N.a) * N.speed * 1.12 * dt, 0.29);
      N.label = 'LUNGE!';
    } else if (d < 7 && clear) {
      N.speed = 3.6 + Math.min(0.45, M.catches * 0.09);
      turnTo(Math.atan2(P.y - N.y, P.x - N.x), dt, 10);
      moveCircle(N, Math.cos(N.a) * N.speed * dt, Math.sin(N.a) * N.speed * dt, 0.29);
      N.label = 'get back here!';
      N.path = [];
    } else {
      N.speed = 3.65 + Math.min(0.45, M.catches * 0.09);
      N.label = 'cutting you off!';
      N.repathT -= dt;
      if (N.repathT <= 0 || !N.path.length) {
        N.repathT = 0.35;
        const tgt = cutoffTarget(d);
        if (!goTo(tgt.x, tgt.y, tgt.z)) goTo(P.x, P.y, P.z);
      }
      followPath(dt, N.speed);
    }
    if (N.throwCd === undefined) N.throwCd = 2;
    N.throwCd -= dt;
    if (d > 3.2 && d < 9.5 && clear && N.throwCd <= 0) { nThrow(); N.throwCd = 3.2 - Math.min(1.2, M.catches * 0.2); }
  } else {
    N.lostT += dt;
    N.label = 'where did you go?';
    N.speed = 3.3;
    if (!N.path.length || N.repathT <= 0) {
      N.repathT = 0.5;
      const ls = N.lastSeen || { x: N.x, y: N.y, z: N.z };
      const t = Math.min(N.lostT + 0.5, 3);
      const g = playerGoal() || { x: ls.x, y: ls.y, z: ls.z };
      let p = pathFind(N, { x: ls.x + N.pvel.x * t, y: ls.y + N.pvel.y * t, z: ls.z }, { allowClosed: 1 });
      if (p.length) N.path = p;
      else if (g) goTo(g.x, g.y, g.z);
    }
    followPath(dt, N.speed);
    if (N.lostT > 5.5) { N.mode = 'suspicious'; startSearch('lost'); return; }
  }
  if (N.sees && d > 9) N.label = 'cutting you off!';
  if (d < 0.95 && N.z === P.z) catchPlayer();
}

function cutoffTarget(fallbackDist) {
  const room = roomAt(P.z, P.x, P.y);
  const goal = playerGoal();
  if (room && goal) {
    const exits = [];
    for (const d of W.doors) {
      if (d.kind === 'lock' || d.kind === 'cellar') continue;
      for (const [x, y] of d.cells) {
        const q = nearestStandable(d.z, x, y, 0.28);
        if (!q) continue;
        // does this doorway lie on the way to the player's goal?
        const score = dst(q[0], q[1], goal.x, goal.y) - dst(P.x, P.y, goal.x, goal.y) * 0.8;
        const nd = dst(N.x, N.y, q[0], q[1]);
        const pd = dst(P.x, P.y, q[0], q[1]);
        if (nd < 30) exits.push({ x: q[0] + 0.5, y: q[1] + 0.5, z: d.z, score, nd, pd });
      }
    }
    exits.sort((a, b) => a.score - b.score);
    for (const e of exits) {
      // can he beat the player there?
      const aiT = e.nd / 3.8, pT = e.pd / 3.5;
      if (aiT < pT * 0.92) return e;
    }
  }
  // otherwise: intercept the player's path to their objective
  if (goal) {
    const p = pathFind(P, goal, { allowClosed: 1 });
    if (p.length > 2) {
      const q = p[Math.min(3, p.length - 1)];
      return { x: q.x, y: q.y, z: q.z };
    }
  }
  return { x: P.x, y: P.y, z: P.z };
}

function nThrow() {
  const speed = 9.5;
  const d = Math.max(1, N.dist);
  const t = d / speed;
  const px = P.x + P.vx * t * 0.6, py = P.y + P.vy * t * 0.6;
  const dx = px - N.x, dy = py - N.y, l = Math.hypot(dx, dy) || 1;
  spawnProjectile(Math.random() < 0.5 ? 'tomato' : 'box', N.x + dx / l * 0.5, N.y + dy / l * 0.5, N.z, dx / t, dy / t, 3.6, 'n');
  aiSay('Take that!');
}

function catchPlayer() {
  if (GAME.state !== 'play') return;
  GAME.state = 'over';
  UI.over = 'caught';
  M.catches++;
  M.suspicion = Math.min(100, M.suspicion + 15);
  M.rooms[roomNameAt(P.z, P.x, P.y)] = (M.rooms[roomNameAt(P.z, P.x, P.y)] || 0) + 2;
  M.hours[GAME.clock | 0] = (M.hours[GAME.clock | 0] || 0) + 2;
  M.hides.push({ x: P.x, y: P.y, z: P.z });
  if (M.hides.length > 12) M.hides.shift();
  saveMatch();
  UI.screen = 'over';
}

/* --------------------------------------------------------------- player goal */
function playerGoal() {
  if (!P) return null;
  const byId = {};
  for (const c of W.containers) byId[c.id] = c;
  if (!P.keys.pick && byId.toolbox) return { x: byId.toolbox.x, y: byId.toolbox.y, z: byId.toolbox.z };
  if (!P.keys.red && byId.fridge) return { x: byId.fridge.x, y: byId.fridge.y, z: byId.fridge.z };
  if (!P.keys.blue && byId.desk) return { x: byId.desk.x, y: byId.desk.y, z: byId.desk.z };
  return { x: W.secret.x, y: W.secret.y, z: W.secret.z };
}

/* ----------------------------------------------------------------- thefts */
function visibleSpot(z, x, y) {
  // furniture is solid, so sight-check to the floor tile in front of it
  if (freeCell(z, x | 0, y | 0)) return { x: x | 0, y: y | 0, z };
  for (let rad = 1; rad <= 3; rad++) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      if (freeCell(z, (x | 0) + dx, (y | 0) + dy)) return { x: (x | 0) + dx, y: (y | 0) + dy, z };
    }
  }
  return { x: x | 0, y: y | 0, z };
}
function checkTheftsNear(force) {
  if (!N) return;
  // emptied containers
  for (const c of W.containers) {
    if (!c.done || c.seen) continue;
    const sameFloor = c.z === N.z;
    const spot = visibleSpot(c.z, c.tx + (c.w || 1) / 2, c.ty);
    const near = sameFloor ? dst(N.x, N.y, c.x, c.y) < 12 && lineOfSight(N, spot) : force;
    if (!near) continue;
    c.seen = 1;
    M.thefts.push(c.id);
    M.suspicion = Math.min(100, M.suspicion + 14);
    aiSay('Someone has been in my ' + c.label + '!');
    say('He noticed the ' + c.label + ' had been searched.');
    M.plans.push({ t: 'guard', id: c.id, x: c.x, y: c.y, z: c.z });
    saveMatch();
  }
  // moved or missing loose objects
  for (const it of ITEMS) {
    if (it.noticed || !it.home) continue;
    if (it.x === it.home.x && it.y === it.home.y && it.z === it.home.z) continue;
    const near = it.z === N.z && dst(N.x, N.y, it.home.x, it.home.y) < 9 && lineOfSight(N, visibleSpot(it.z, it.home.x, it.home.y));
    if (!near) continue;
    it.noticed = 1;
    M.suspicion = Math.min(100, M.suspicion + 9);
    M.plans.push({ t: 'tidy', k: it.k });
    aiSay('My ' + it.k + ' is gone!');
    say('He noticed his ' + it.k + ' was missing.');
  }
}

/* ------------------------------------------------------------ re-locking */
function considerRelock() {
  for (const d of W.doors) {
    if (!d.playerUnlocked) continue;
    if (d.z !== N.z) continue;
    for (const [x, y] of d.cells) {
      if (dst(N.x, N.y, x + 0.5, y + 0.5) > 1.6) continue;
      const q = nearestStandable(d.z, x, y, 0.28);
      if (!q) continue;
      runScript('relock', { x: q[0], y: q[1], z: d.z, door: d }, 2);
      return true;
    }
  }
  return false;
}
function applyRelock(p) {
  const d = p.door;
  d.closed = 1;
  d.playerUnlocked = 0;
  for (const [x, y] of d.cells) W.floors[d.z].G[y][x] = d.lockChar || 'L';
  M.suspicion = Math.min(100, M.suspicion + 4);
  M.relocks.push(d.z + ':' + d.cells[0][0] + ':' + d.cells[0][1]);
  saveMatch();
  aiSay('Locked. Try that again.');
  say('He re-locked the door.');
}

/* ------------------------------------------------------------ fortification */
function planBoardWindow(x, y, z) {
  const key = z + ':' + x + ':' + y;
  if (M.plans.some((p) => p.t === 'board' && p.x === x && p.y === y && p.z === z)) return;
  M.plans.push({ t: 'board', x, y, z });
  saveMatch();
}
function applyBoard(z, x, y) {
  const c = T(z, x, y);
  if (c !== 'W' && c !== 'w') return;
  W.floors[z].G[y][x] = 'X';
  const key = z + ':' + x + ':' + y;
  if (!M.boarded.includes(key)) M.boarded.push(key);
  saveMatch();
  aiSay('Try climbing through that now.');
  say('He boarded up a window.');
}

function routeHeat(z, x, y) { return M.route[z + ':' + (x | 0) + ',' + (y | 0)] || 0; }

function bestTrapSpot() {
  const cands = [];
  const seen = new Set();
  const push = (z, x, y, bonus) => {
    const k = z + ':' + x + ',' + y;
    if (seen.has(k)) return;
    seen.add(k);
    if (!isValidTrapCell(z, x, y)) return;
    let score = bonus;
    score += routeHeat(z, x, y) * 1.4;
    score += M.suspicion * 0.02;
    // chokepoints: next to a doorway
    let doors = 0;
    for (const [dx, dy] of NB4) if (doorAt(z, x + dx, y + dy)) doors++;
    score += doors * 5;
    // close to the player's usual objectives
    const g = playerGoal();
    if (g && g.z === z) score += Math.max(0, 8 - dst(x, y, g.x, g.y)) * 0.35;
    cands.push({ x, y, z, score });
  };
  // doorway approaches
  for (const d of W.doors) {
    for (const [x, y] of d.cells) for (const [dx, dy] of NB4) push(d.z, x + dx, y + dy, 3);
  }
  // where the player actually walks
  const route = Object.keys(M.route).map((k) => {
    const [z, xy] = k.split(':');
    const [x, y] = xy.split(',').map(Number);
    return { z: +z, x, y, v: M.route[k] };
  }).sort((a, b) => b.v - a.v).slice(0, 12);
  for (const r of route) push(r.z, r.x, r.y, r.v * 0.8);
  // belief peaks
  for (let z = 0; z < 3; z++) { const p = belPeak(z); if (p) push(z, p.x | 0, p.y | 0, 2); }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] || null;
}

function planFortify() {
  // board a window the player has climbed through
  const entries = Object.keys(M.entries).map((k) => ({ k, n: M.entries[k] }))
    .filter((e) => !e.k.includes('D') && !M.boarded.includes(e.k)).sort((a, b) => b.n - a.n);
  for (const e of entries) {
    const [z, x, y] = e.k.split(':').map(Number);
    if (T(z, x, y) === 'w' || T(z, x, y) === 'W') { planBoardWindow(x, y, z); return 'board'; }
  }
  const trap = bestTrapSpot();
  if (trap) { runScript('place_trap', { x: trap.x, y: trap.y, z: trap.z }, 3); return 'trap'; }
  return null;
}

function planCamera() {
  if (!M.catches) return false;
  const top = Object.entries(M.entries).sort((a, b) => b[1] - a[1])[0];
  if (!top) return false;
  const [z, x, y] = top[0].split(':').map(Number);
  // a spot near the entry, facing it
  let best = null, bd = 1e9;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!standable(z, nx + 0.5, ny + 0.5, 0.28)) continue;
    if (dst(nx, ny, x, y) < 1.5) continue;
    const q = nearestStandable(z, nx, ny, 0.28);
    if (!q) continue;
    const d = dst(q[0], q[1], x, y);
    if (d < bd) { bd = d; best = { z, x: q[0], y: q[1] }; }
  }
  if (!best) return false;
  runScript('install_camera', { x: best.x, y: best.y, z: best.z }, 3);
  M.plans.push({ t: 'camera', x: best.x, y: best.y, z: best.z });
  saveMatch();
  return true;
}

/* --------------------------------------------------------------- schedule */
function hourWeight() {
  let total = 0, here = 0;
  for (let h = 0; h < 24; h++) { total += M.hours[h] || 0; if (h === (GAME.clock | 0)) here += M.hours[h] || 0; }
  return total > 0 ? clamp(here / total * 4, 0, 1) : 0;
}

/* ------------------------------------------------------------ routine tasks */
function pickTask() {
  if (GAME.state !== 'play' || !N) return;
  if (N.mode === 'chase' || N.mode === 'search') return;

  // urgent: relock a door he just saw opened, or one you picked
  if (considerRelock()) return;
  if (M.needRelock && M.needRelock.length) {
    const key = M.needRelock[0];
    const pp = String(key).split(':').map(Number);
    const d = doorAt(pp[0], pp[1], pp[2]);
    if (!d || !d.playerUnlocked) { M.needRelock.shift(); saveMatch(); }
    else {
      const q = nearestStandable(pp[0], pp[1], pp[2], 0.28);
      if (q) { runScript('relock_far', { x: q[0] + 0.5, y: q[1] + 0.5, z: pp[0], door: d }, 3); return; }
      M.needRelock.shift();
    }
  }

  // fortify when suspicion is high
  const wantFort = M.suspicion > 55 || M.catches > 0;
  if (M.plans.length) {
    const plan = M.plans.shift();
    if (plan.t === 'board') { runScript('board_window', plan, 3); return; }
    if (plan.t === 'guard') { runScript('guard_obj', { x: plan.x, y: plan.y, z: plan.z, what: 'the ' + plan.id }, 2); return; }
    if (plan.t === 'camera') { runScript('install_camera', plan, 3); return; }
    if (plan.t === 'tidy') {
      const it = ITEMS.find((q) => q.k === plan.k && q.taken && q.home);
      if (it) { runScript('tidy', { x: it.x, y: it.y, z: it.z, item: it }, 2); return; }
    }
  }
  if (wantFort && Math.random() < 0.5) {
    if (planFortify()) return;
    if (M.catches >= 2 && CAMS.length < 3 && Math.random() < 0.4 && planCamera()) return;
  }
  const hw = hourWeight();
  if (hw > 0.45 && M.suspicion > 22 && Math.random() < 0.55) {
    const ad = bestAmbushDoor();
    if (ad) { runScript('patrol', { a: [ad.x, ad.y, ad.z], b: [W.stations.front.x, W.stations.front.y, 0] }, 1); return; }
  }
  if (hw > 0.6 && M.suspicion > 35 && Math.random() < 0.3) { runScript('guard_cellar', {}, 2); return; }

  if (M.suspicion > 62 && Math.random() < 0.45) {
    const goal = playerGoal();
    if (goal && P.keys.red && P.keys.blue) { runScript('guard_cellar', {}, 2); return; }
    if (goal) { const q = nearestStandable(goal.z, goal.x, goal.y, 0.28); if (q) { runScript('guard_obj', { x: q[0] + 0.5, y: q[1] + 0.5, z: goal.z, what: 'the ' + (goal.z === 2 ? 'basement' : 'valuables') }, 2); return; } }
  }
  if (M.suspicion > 40 && Math.random() < 0.3) { runScript('check_valuables', {}, 1); return; }

  // routine tasks
  const hr = GAME.clock;
  let best = null, bestScore = -1e9;
  for (const t of TASKS) {
    const st = W.stations[t.st];
    if (!st) continue;
    let sc = 0;
    for (const k in t.eff) {
      const deficit = k === 'suspicion' ? M.suspicion / 100 : (N.need[k] || 0);
      const v = t.eff[k];
      sc += v < 0 ? deficit * (-v) * 0.16 : -v * 0.2;
    }
    if (t.hours) {
      const [a, b] = t.hours;
      const inWin = (hr >= a && hr < b) || (hr + 24 >= a && hr + 24 < b);
      sc += inWin ? 1.2 : -0.7;
    }
    const d = dst(N.x, N.y, st.x, st.y) + (N.z !== st.z ? 14 : 0);
    sc -= d * 0.03;
    if (N.recent.includes(t.n)) sc -= 1.1;
    // he roams: a chore in the room he is already in is less interesting
    const rm = roomAt(st.z, st.x, st.y);
    if (rm && N.lastRoom && rm.id === N.lastRoom) sc -= 1.0;
    if (N.lastRoom && rm && rm.id !== N.lastRoom) sc += 0.45;
    if (N.z !== st.z) sc += 0.9;               // he uses the whole house
    sc += Math.random() * 0.6;
    if (t.n === 'sleep' && !(hr >= 22 || hr < 6)) sc -= 3.5;
    if (t.n === 'sleep' && M.suspicion > 55) sc -= 1.2;
    if (sc > bestScore) { bestScore = sc; best = { t, st }; }
  }
  N.choreN = (N.choreN || 0) + 1;
  if (N.choreN % 4 === 0) {
    const a = bestAmbushDoor();
    const front = W.stations.front;
    if (a) {
      const alt = N.z === 0 ? { x: a.x, y: a.y, z: a.z } : { x: front.x, y: front.y, z: 0 };
      runScript('patrol', { a: [alt.x, alt.y, alt.z], b: [front.x, front.y, front.z] }, 1);
      N.lastRoom = null;
      return;
    }
  }
  if (!best) { runScript('idle', {}, 0); return; }
  const { t, st } = best;
  N.recent.push(t.n); if (N.recent.length > 6) N.recent.shift();
  const steps = [{ go: [st.x, st.y, st.z], label: t.n.replace(/_/g, ' ') }];
  if (t.n === 'sleep') steps.push({ fn: () => { N.sleeping = 1; } });
  steps.push({ wait: (t.a + Math.random() * (t.b - t.a)), label: t.n.replace(/_/g, ' ') + '…', eff: t.eff, sweep: t.n === 'sleep' ? 0 : 1 });
  if (t.n === 'sleep') steps.push({ fn: () => { N.sleeping = 0; } });
  steps.push({ fn: () => { N.done++; endScript(); } });
  N.st = t.n; N.script = steps; N.si = 0; N.path = []; N.prio = 0; N.goT = 0;
  N.speed = t.n === 'sleep' ? 2 : 2.35;
  const hr0 = roomAt(st.z, st.x, st.y);
  if (hr0) N.lastRoom = hr0.id;
  N.mode = N.mode === 'chase' ? 'chase' : 'routine';
}

/* ---------------------------------------------------- hit by a thrown object */
function aiHitByThrow(ox, oy, oz) {
  if (!N) return;
  N.stun = 1.6;
  N.al = 1;
  N.forensic = { x: ox, y: oy, z: oz, t: GAME.t };
  if (N.mode === 'chase') { N.lastSeen = { x: P.x, y: P.y, z: P.z, t: GAME.t }; return; }
  N.mode = 'suspicious'; N.prio = 0; N.path = []; N.stepT = 0;
  N.script = SCRIPTS.wipe_face().concat(SCRIPTS.hunt_thrower({ x: ox, y: oy, z: oz }));
  N.si = 0; N.st = 'hunt_thrower'; N.label = 'TOMATO?!';
}

/* ------------------------------------------------------------------ update */
function aiUpdate(dt) {
  if (!N || GAME.state !== 'play') return;
  if (GAME.freezeAI) { N.dist = P ? dst(N.x, N.y, P.x, P.y) : 99; return; }
  GAME.t += dt;

  // needs drift
  N.need.hunger = clamp(N.need.hunger + dt * 0.004, 0, 1);
  N.need.thirst = clamp(N.need.thirst + dt * 0.005, 0, 1);
  N.need.boredom = clamp(N.need.boredom + dt * 0.006, 0, 1);
  N.need.energy = clamp(N.need.energy + dt * (N.sleeping ? -0.02 : 0.003), 0, 1);
  N.need.hygiene = clamp(N.need.hygiene + dt * 0.002, 0, 1);
  M.suspicion = clamp(M.suspicion - dt * 0.05, 0, 100);

  if (N.quipT > 0) N.quipT -= dt;
  if (GAME.msgT > 0) GAME.msgT -= dt;

  if (N.stun > 0) { N.stun -= dt; return; }

  perceive(dt);

  if (N.mode === 'chase') {
    updateChase(dt);
  } else {
    if (N.sees && N.al >= 1) {
      if (N.dist > 7.5 && !N.quiet) startQuietApproach();
      else startChase('seen');
    }
    if (N.mode === 'suspicious' && N.quiet && N.dist < 3.2 && N.sees) startChase('confirmed');
    if (N.mode === 'search') {
      N.searchT += dt;
      if (N.lastHeard && GAME.t - N.lastHeard.t < 1.2 && N.sees) { N.lastSeen = { x: P.x, y: P.y, z: P.z, t: GAME.t }; }
    }
    scriptUpdate(dt);
  }

  // periodic: belief diffusion + theft noticing + camera checks
  N.bt = (N.bt || 0) + dt;
  if (N.bt > 0.5) { N.bt = 0; if (N.mode === 'search') belDiffuse(); checkTheftsNear(); }
  updateCameras(dt);

  // un-stick safety net
  N.unT = (N.unT || 0) + dt;
  if (N.unT > 0.3) {
    N.unT = 0;
    if (!standable(N.z, N.x, N.y, 0.27)) {
      const q = nearestStandable(N.z, N.x, N.y, 0.29);
      if (q) { N.x = q[0] + 0.5; N.y = q[1] + 0.5; N.path = []; }
    }
  }
  // lights follow him at night
  if (isNight(GAME.clock)) {
    const r = roomAt(N.z, N.x, N.y);
    for (const F of W.floors) for (const room of F.rooms) {
      const isHere = r && room.id === r.id && F.z === N.z;
      room.light = isHere || (room.light && Math.random() > 0.002);
    }
  } else {
    for (const F of W.floors) for (const room of F.rooms) room.light = 1;
  }
}

/* ----------------------------------------------------------------- cameras */
const CAM_RANGE = 7, CAM_FOV = 0.7;
function updateCameras(dt) {
  for (const c of CAMS) {
    c.a += dt * (c.sweep == null ? 1 : c.sweep);
    c.cd -= dt;
    if (c.z !== P.z) continue;
    const d = dst(c.x, c.y, P.x, P.y);
    if (d > CAM_RANGE) continue;
    const ang = Math.atan2(P.y - c.y, P.x - c.x);
    const off = Math.abs(Math.atan2(Math.sin(ang - c.a), Math.cos(ang - c.a)));
    if (off > CAM_FOV) continue;
    if (!lineOfSight({ x: c.x, y: c.y, z: c.z }, { x: P.x, y: P.y, z: P.z })) continue;
    c.seeT += dt;
    if (c.seeT > 1.0 && c.cd <= 0) { c.cd = 5; makeNoise(c.x, c.y, c.z, 11, 'camera'); say('A camera spotted you!'); }
  }
}

const AI = {
  initAI, aiUpdate, hearNoise, startChase, startSearch, startQuietApproach,
  belAdd, belSeed, belSpots, belPeak, belDiffuse, belClear, belTotal,
  pickTask, runScript, updateChase, cutoffTarget, playerGoal,
  bestTrapSpot, planFortify, planCamera, isValidTrapCell, addTrap,
  checkTheftsNear, considerRelock, applyRelock, applyBoard, planBoardWindow, visibleSpot,
  sightRange, lineOfSight, roomNameAt, hourWeight, bestAmbushDoor, routeHeat,
  aiHitByThrow, visibleSpot,
  SCRIPTS, TASKS, NEED0,
};
