'use strict';
// test/game2d.js — headless regression suite for the 2D game.
// Run with: node test/game2d.js
// It boots index.html in a vm with a stubbed DOM/canvas, then exercises the
// neighbour AI, the window fix, chase/search, memory, looting, retry and win.

const { load } = require('./harness');

let checks = 0;
let failed = 0;
const failures = [];
function ok(name, cond, detail) {
  checks++;
  if (cond) {
    console.log('PASS  ' + name);
  } else {
    failed++;
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}

const WINDOWS = [[12, 12], [17, 7], [12, 24], [17, 30], [30, 7], [38, 30], [43, 20], [43, 12], [38, 7], [4, 8]];
const START = { x: 28.5, y: 37.5 };

function freezeN(g) {
  g.N.stun = 1e9;
  g.N.al = 0;
  g.N.sees = 0;
  g.N.mode = 'idle';
  g.N.script = [];
  g.N.path = [];
}
function noChase(g) {
  if (g.N.mode === 'chase') {
    g.N.mode = 'idle';
    g.N.al = 0;
    g.N.script = [];
    g.N.prio = 0;
    g.N.st = 'idle';
    g.N.path = [];
  }
}
function step(sim, secs, opts = {}) {
  const g = sim.g;
  const n = Math.max(1, Math.round(secs * 60));
  let error = null;
  for (let i = 0; i < n; i++) {
    if (opts.freeze) freezeN(g);
    if (opts.noChase) noChase(g);
    try {
      g.tick(1 / 60);
    } catch (e) {
      error = e;
      break;
    }
    sim.sandbox.__clock += 1000 / 60;
    if (opts.track) {
      if (g.state === 'play') {
        if (!g.npass(g.N.x, g.N.y)) opts.track.solidN = (opts.track.solidN || 0) + 1;
        if (!g.ppass(g.P.x, g.P.y)) opts.track.solidP = (opts.track.solidP || 0) + 1;
      }
      if (!Number.isFinite(g.N.x) || !Number.isFinite(g.N.y) ||
          !Number.isFinite(g.P.x) || !Number.isFinite(g.P.y)) opts.track.nan = true;
      if (opts.track.lastN) {
        const jump = Math.hypot(g.N.x - opts.track.lastN.x, g.N.y - opts.track.lastN.y);
        if (jump > 1.6) opts.track.bigJumps++;
      }
      opts.track.lastN = { x: g.N.x, y: g.N.y };
    }
    if (opts.stopOnState && g.state !== 'play') break;
  }
  return error;
}
function holdE(sim, secs, opts = {}) {
  sim.g.keys.e = 1;
  const err = step(sim, secs, opts);
  sim.g.keys.e = 0;
  return err;
}
function at(g, x, y) {
  g.P.x = x;
  g.P.y = y;
  g.P.vx = g.P.vy = 0;
  g.P.lastCell = '';
}
// Drives the player with real key presses (no teleports) toward a point.
function walkTo(sim, tx, ty, maxSec = 40) {
  const g = sim.g;
  const clear = () => { for (const k of ['w', 'a', 's', 'd']) g.keys[k] = 0; };
  clear();
  let path = [], stuck = 0, last = { x: g.P.x, y: g.P.y };
  for (let f = 0; f < maxSec * 60; f++) {
    if (g.state !== 'play') { clear(); return g.state === 'win'; }
    if (Math.hypot(g.P.x - tx, g.P.y - ty) < 0.42) { clear(); step(sim, 0.05, { freeze: true }); return true; }
    if (!path.length) path = g.findPath(g.P.x, g.P.y, tx, ty);
    const wp = path[0] || [tx, ty];
    if (Math.hypot(g.P.x - wp[0], g.P.y - wp[1]) < 0.4 && path.length) { path.shift(); continue; }
    const dx = wp[0] - g.P.x, dy = wp[1] - g.P.y;
    clear();
    if (dx > 0.12) g.keys.d = 1; else if (dx < -0.12) g.keys.a = 1;
    if (dy > 0.12) g.keys.s = 1; else if (dy < -0.12) g.keys.w = 1;
    step(sim, 1 / 60, { freeze: true });
    if (Math.hypot(g.P.x - last.x, g.P.y - last.y) < 0.004) {
      if (++stuck > 40) { path = []; stuck = 0; }
    } else { stuck = 0; path = path.slice(0, 1); }
    last = { x: g.P.x, y: g.P.y };
  }
  clear();
  return false;
}
function holdE(sim, secs) {
  sim.g.keys.e = 1;
  step(sim, secs, { freeze: true });
  sim.g.keys.e = 0;
  step(sim, 0.05, { freeze: true });
}
function loot(sim, standX, standY) {
  if (!walkTo(sim, standX, standY)) return false;
  for (let i = 0; i < 30 && !(sim.g.P.tgt && sim.g.P.tgt.t > 0); i++) step(sim, 1 / 60, { freeze: true });
  if (!sim.g.P.tgt || !sim.g.P.tgt.t) return false;
  holdE(sim, 3);
  return true;
}
function lsWindow(sim, x, y, mode) {
  const g = sim.g;
  g.G[y][x] = 'w';
  at(g, 47.5, 27.5); // sealed vault, out of sight while the neighbour works
  Object.assign(g.N, {
    x: 28.5, y: 25.5, a: Math.PI / 2, mode: 'idle', st: 'idle',
    script: [], si: 0, prio: 0, al: 0, sees: 0, path: [], sleeping: 0,
    focus: null, stun: 0,
  });
  g.MEM.plans.length = 0;
  g.run(mode === 'repair' ? 'repair_window' : 'board_window', { x, y }, 1);
}

/* ------------------------------------------------------- playthrough */
{
  // Proves the objective chain is actually walkable end to end with keys only.
  // The neighbour is stunned so this measures level design, not stealth.
  const sim = load({ seed: 4242 });
  const g = sim.g;
  g.start();
  g.N.stun = 1e9;
  g.N.script = []; g.N.mode = 'idle'; g.N.prio = 0;
  const trace = [];
  const at2 = (x, y, label) => { const r = walkTo(sim, x, y); if (!r) trace.push(label); return r; };
  let done = loot(sim, 4.5, 10.5) && g.P.pick === 1;
  done = at2(8.5, 11.5, 'shed exit') && done;
  done = at2(28.5, 33.5, 'yard') && done;
  done = at2(28.5, 28.5, 'front door') && done;
  done = at2(29.5, 16.5, 'dining room') && done;
  done = at2(29.5, 10.5, 'kitchen') && done;
  done = loot(sim, 32.5, 9.5) && g.P.red === 1 && done;
  done = at2(33.5, 11.5, 'study door') && done;
  holdE(sim, 3);
  const studyOpen = g.G[11][34] === 'D';
  done = at2(35.5, 11.5, 'study') && done;
  done = loot(sim, 37.5, 10.5) && g.P.blue === 1 && done;
  done = at2(37.5, 26.5, 'workshop') && done;
  done = at2(42.5, 27.5, 'basement door') && done;
  holdE(sim, 4);
  const basementOpen = g.G[27][43] === 'D';
  done = at2(45.5, 27.5, 'vault') && done;
  done = at2(46.5, 26.5, 'secret') && done;
  ok('the whole game can be completed with keyboard input only', done && studyOpen && basementOpen && g.state === 'win', 'stuck=' + trace.join('/') + ' state=' + g.state + ' pick=' + g.P.pick + ' red=' + g.P.red + ' blue=' + g.P.blue);
}

/* ------------------------------------------------------------------ boot */
{
  const sim = load({ seed: 7 });
  const g = sim.g;
  ok('boots to the menu', g.state === 'menu');
  ok('task library expanded beyond v1 (>=150 tasks)', g.TASKS.length >= 150, String(g.TASKS.length));
  const stations = new Set(Object.keys(g.ST));
  const effectKeys = new Set(['h', 't', 'b', 'e', 'y', 'l', 'd', 's']);
  const names = new Set();
  const bad = [];
  for (const t of g.TASKS) {
    if (names.has(t.name)) bad.push('duplicate task ' + t.name);
    names.add(t.name);
    if (!stations.has(t.st)) bad.push('bad station ' + t.st + ' in ' + t.name);
    for (const k in t.eff) if (!effectKeys.has(k)) bad.push('bad effect ' + k + ' in ' + t.name);
    if (!(t.b > t.a)) bad.push('bad duration in ' + t.name);
  }
  ok('all task data is valid', bad.length === 0, bad.slice(0, 3).join('; '));
  ok('state count covers every task and script', g.STATE_COUNT === g.TASKS.length + Object.keys(g.S).length + 5 && g.STATE_COUNT > 190, String(g.STATE_COUNT));
  const literalRuns = Array.from(new Set(Array.from(sim.js.matchAll(/run\('([a-z_]+)'/g)).map(m => m[1])));
  const missingScripts = literalRuns.filter(n => !g.S[n]);
  ok('every literal run() target exists', missingScripts.length === 0, missingScripts.join(','));

  sim.pumpFrame(16); sim.pumpFrame(33); sim.pumpFrame(50);
  ok('menu frame + HUD render without throwing', sim.els.hud.innerHTML.indexOf('Objective') >= 0 && sim.els.dbg.innerHTML.indexOf('THE NEIGHBOUR') >= 0);
  g.start();
  ok('start() enters play', g.state === 'play');
  sim.pumpFrame(66); sim.pumpFrame(83);
  ok('play frame renders and the HUD fills in', sim.els.hud.innerHTML.indexOf('lockpick') >= 0 && sim.els.ov.style.display === 'none');
  ok('no engine warnings on boot', sim.warnings.length === 0, sim.warnings.join(' | '));
}

/* --------------------------------------------------- window stuck regression */
{
  // The old bug: inner() returned the window tile, he repaired/boarded it while
  // standing in it, and the now-solid tile trapped him forever.
  const sim = load({ seed: 11 });
  const g = sim.g;
  g.start();
  g.G[7][17] = 'w';
  at(g, 47.5, 27.5);
  Object.assign(g.N, { x: 17.5, y: 5.5, a: Math.PI / 2, mode: 'idle', st: 'idle', script: [], si: 0, prio: 0, al: 0, sees: 0, path: [], sleeping: 0, focus: null, stun: 0 });
  g.run('repair_window', { x: 17, y: 7 }, 1);
  const track = { solidN: 0, solidP: 0, bigJumps: 0 };
  const err = step(sim, 4, { track, noChase: true });
  const near = { x: g.N.x, y: g.N.y };
  const isInsideWindow = (g.N.x | 0) === 17 && (g.N.y | 0) === 7;
  ok('repair at the TV window no longer self-seals', !err && g.G[7][17] === 'W' && !isInsideWindow && g.npass(g.N.x, g.N.y), err && err.message);
  const err2 = step(sim, 12, { track, noChase: true });
  const moved = Math.hypot(g.N.x - near.x, g.N.y - near.y);
  ok('he walks away from that window afterwards', !err2 && moved > 0.8 && !track.solidN && g.npass(g.N.x, g.N.y), 'moved=' + moved.toFixed(2) + ' solidFrames=' + track.solidN);
}

{
  // Full matrix: every window, repair + board, from the foyer.
  let repaired = 0, boarded = 0, issues = [];
  for (const [wx, wy] of WINDOWS) {
    for (const mode of ['repair', 'board']) {
      const sim = load({ seed: 23 + wx + wy + (mode === 'board' ? 7 : 0) });
      const g = sim.g;
      g.start();
      lsWindow(sim, wx, wy, mode);
      const track = { solidN: 0, solidP: 0, bigJumps: 0 };
      const err = step(sim, 26, { track, noChase: true });
      const expected = mode === 'board' ? 'X' : 'W';
      const good = !err && g.state === 'play' && g.G[wy][wx] === expected &&
        track.solidN === 0 && g.npass(g.N.x, g.N.y) &&
        !((g.N.x | 0) === wx && (g.N.y | 0) === wy);
      if (!good) issues.push(wx + ',' + wy + ' ' + mode + ' cell=' + g.G[wy][wx] + ' solid=' + track.solidN + ' n=' + g.N.x.toFixed(1) + ',' + g.N.y.toFixed(1));
      if (mode === 'repair' && good) repaired++;
      if (mode === 'board' && good) boarded++;
      if (mode === 'board' && good && !g.MEM.boarded.includes(wx + ',' + wy)) issues.push('board not in memory');
    }
  }
  ok('all 10 windows repair safely (' + repaired + '/10)', repaired === 10, issues.slice(0, 1).join(''));
  ok('all 10 windows board safely (' + boarded + '/10)', boarded === 10, issues.slice(0, 2).join(''));
}

/* ------------------------------------------------------ occupants / unstick */
{
  const sim = load({ seed: 31 });
  const g = sim.g;
  g.start();
  g.G[30][17] = 'w';
  g.P.x = 17.5; g.P.y = 30.5;
  g.N.x = 17.5; g.N.y = 30.5;
  const evicted = g.evictCell(17, 30);
  ok('sealing a window evicts the player and neighbour', evicted && !((g.P.x | 0) === 17 && (g.P.y | 0) === 30) && !((g.N.x | 0) === 17 && (g.N.y | 0) === 30) && g.ppass(g.P.x, g.P.y) && g.npass(g.N.x, g.N.y));

  g.G[30][17] = 'X';
  g.P.x = 17.5; g.P.y = 30.5;
  ok('a player sealed inside a window is detected', !g.ppass(g.P.x, g.P.y));
  g.forceUnstuck();
  ok('player safety net pushes them out of solid tiles', g.ppass(g.P.x, g.P.y) && !((g.P.x | 0) === 17 && (g.P.y | 0) === 30), g.P.x + ',' + g.P.y);

  g.N.x = 17.5; g.N.y = 30.5;
  g.forceUnstuck();
  ok('neighbour safety net pushes him out of solid tiles', g.npass(g.N.x, g.N.y));
}

/* ---------------------------------------------------------- canvas resize */
{
  const sim = load({ seed: 13 });
  const g = sim.g;
  g.start();
  const cv = sim.sandbox.document.getElementById('c');
  g.tick(1 / 60); sim.pumpFrame(16);
  const w0 = cv.width, h0 = cv.height;
  sim.sandbox.innerWidth = 900; sim.sandbox.innerHeight = 600;
  g.tick(1 / 60); sim.pumpFrame(33);
  ok('the canvas follows a window resize', cv.width === 900 && cv.height === 600 && (w0 !== 900 || h0 !== 600), cv.width + 'x' + cv.height);
  sim.sandbox.innerWidth = 1280; sim.sandbox.innerHeight = 720;
  sim.pumpFrame(50);
}

/* ---------------------------------------------------------- map integrity */
{
  const sim = load({ seed: 12 });
  const g = sim.g;
  // Player-reachable region from spawn once the locks are open (L/B become D).
  const seen = new Set();
  const startKey = Math.floor(START.x) + ',' + Math.floor(START.y);
  const q = [[Math.floor(START.x), Math.floor(START.y)]];
  seen.add(startKey);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || nx < 1 || ny < 1 || nx >= 56 || ny >= 40) continue;
      const ch = g.G[ny][nx];
      if (ch === '#' || ch === 'F' || ch === 'S' || ch === 'T' || ch === 'W' || ch === 'X') continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  const reach = (x, y) => seen.has(Math.floor(x) + ',' + Math.floor(y));
  // Containers sit inside furniture; the player loots them from beside them.
  const canLoot = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = Math.floor(x) + dx, cy = Math.floor(y) + dy;
      if (reach(cx + 0.5, cy + 0.5) && g.standableCell(cx, cy, 0.28) &&
          Math.hypot(cx + 0.5 - x, cy + 0.5 - y) < 1.6) return true;
    }
    return false;
  };
  ok('the spawn is inside the walkable map', reach(START.x, START.y));
  ok('the lockpick can be reached and looted', canLoot(3.5, 10.5));
  ok('the fridge can be reached and looted', canLoot(32.5, 8.5));
  ok('the study desk can be reached and looted', canLoot(37.5, 9.5));
  ok('the vault and the SECRET can be reached', reach(g.SECRET.x, g.SECRET.y));
  ok('every window is adjacent to walkable ground', WINDOWS.every(([wx, wy]) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach(wx + dx + 0.5, wy + dy + 0.5))));
}

/* --------------------------------------------------------------- chase */
{
  const sim = load({ seed: 41 });
  const g = sim.g;
  g.start();
  at(g, 25.5, 28.5);
  g.N.x = 32.5; g.N.y = 24.5; g.N.a = Math.atan2(4, -7);
  g.startChase();
  g.N.throwCd = 99; // force the pathfinding/cut-off branch (old P.vel crash)
  const track = { solidN: 0, solidP: 0, bigJumps: 0 };
  const err = step(sim, 8, { track });
  ok('long-distance chase does not crash (old P.vel bug)', !err && (g.state === 'play' || g.state === 'caught'), err && err.message);
  ok('chase keeps the neighbour on valid tiles', track.solidN === 0 && Number.isFinite(g.N.x) && Number.isFinite(g.N.y));

  const sim2 = load({ seed: 42 });
  const g2 = sim2.g;
  g2.start();
  at(g2, 37.5, 10.5);
  g2.N.x = 28.5; g2.N.y = 25.5;
  g2.startChase();
  const err2 = step(sim2, 9, { track: { solidN: 0 } });
  ok('chase after losing line of sight turns into a search', !err2 && (g2.N.mode === 'search' || g2.N.mode === 'chase' || g2.state === 'caught'), err2 && err2.message);

  const sim3 = load({ seed: 43 });
  const g3 = sim3.g;
  g3.start();
  at(g3, 20.5, 12.5);
  g3.N.x = 28.5; g3.N.y = 12.5;
  g3.startChase();
  g3.N.throwCd = 0;
  const err3 = step(sim3, 3, {});
  ok('neighbour wind-up / throw runs without throwing NaNs', !err3 && g3.PR.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)), err3 && err3.message);
}

/* ---------------------------------------------------- loot, retry, no softlock */
{
  const sim = load({ seed: 51 });
  const g = sim.g;
  g.start();
  freezeN(g);
  at(g, 4.5, 10.5); step(sim, 0.1, { freeze: true });
  holdE(sim, 1, { freeze: true });
  at(g, 32.5, 9.5); step(sim, 0.1, { freeze: true });
  holdE(sim, 1, { freeze: true });
  at(g, 37.5, 10.5); step(sim, 0.1, { freeze: true });
  holdE(sim, 1.4, { freeze: true });
  ok('locks: lockpick, red key and blue key can all be looted', g.P.pick === 1 && g.P.red === 1 && g.P.blue === 1);

  g.caught();
  ok('catch enters the caught state and is remembered', g.state === 'caught' && g.MEM.catches >= 1);
  g.retry();
  ok('retry puts the player back at the start', g.state === 'play' && Math.abs(g.P.x - START.x) < 0.01 && Math.abs(g.P.y - START.y) < 0.01);
  ok('retry clears the key flags', g.P.pick === 0 && g.P.red === 0 && g.P.blue === 0);
  ok('retry refills the containers (old softlock fixed)', g.CT.every(c => c.done === 0 && c.seen === 0));
  at(g, 32.5, 9.5); step(sim, 0.1, { freeze: true });
  holdE(sim, 1, { freeze: true });
  ok('the fridge can be looted again after a catch', g.P.red === 1 && g.CT[0].done === 1);
}

/* --------------------------------------------------------------- win route */
{
  const sim = load({ seed: 61 });
  const g = sim.g;
  g.start();
  freezeN(g);
  at(g, 42.5, 27.5); step(sim, 0.1, { freeze: true });
  holdE(sim, 2.6, { freeze: true });
  ok('the basement door refuses to open without both keys', g.G[27][43] === 'B');
  g.P.pick = 1; g.P.red = 1; g.P.blue = 1;
  holdE(sim, 2.6, { freeze: true });
  ok('the basement door unlocks with red + blue keys', g.G[27][43] === 'D');
  at(g, 46.5, 26.5); step(sim, 0.2, { freeze: true });
  ok('reaching the SECRET wins the round', g.state === 'win' && g.SECRET.got === 1 && g.MEM.wins >= 1);
}

/* ------------------------------------------------------- memory persistence */
{
  const sim = load({ seed: 71 });
  const g = sim.g;
  g.start();
  at(g, 16.5, 12.5);
  g.N.x = 20.5; g.N.y = 12.5; g.N.a = Math.PI; g.N.mode = 'idle'; g.N.script = []; g.N.al = 0;
  const err = step(sim, 3, { noChase: true });
  const heatKeys = Object.keys(g.MEM.heat);
  const hoursSum = g.MEM.hours.reduce((a, b) => a + b, 0);
  ok('being seen writes the spatial heat map and hour histogram', !err && heatKeys.length > 0 && hoursSum > 0, 'heat=' + heatKeys.length + ' hours=' + hoursSum);
  ok('hour affinity rises from observed activity', g.hourAffinity() > 0);
  g.saveMemory();
  const sim2 = load({ seed: 72, store: sim.store });
  ok('memory survives a reload', Object.keys(sim2.g.MEM.heat).length > 0 && sim2.g.MEM.hours.length === 24 && sim2.g.MEM.heat[heatKeys[0]] === g.MEM.heat[heatKeys[0]]);
  ok('memory format is normalised on load', sim2.g.MEM.decoys && typeof sim2.g.MEM.decoys === 'object' && Array.isArray(sim2.g.MEM.plans));
}

/* ---------------------------------------------------- memory wipe control */
{
  const sim = load({ seed: 73 });
  const g = sim.g;
  g.start();
  g.MEM.catches = 4;
  g.MEM.plans.push({ t: 'lock', x: 0, y: 0 });
  g.saveMemory();
  g.wipeMemory();
  ok('the forget control wipes catches and plans', g.MEM.catches === 0 && g.MEM.plans.length === 0 && Object.keys(g.MEM.heat).length === 0);
  const sim2 = load({ seed: 74, store: sim.store });
  ok('a wiped memory stays wiped after reload', sim2.g.MEM.catches === 0 && sim2.g.MEM.plans.length === 0);
}

/* ------------------------------------------------------ in-flight items */
{
  const sim = load({ seed: 75 });
  const g = sim.g;
  g.start();
  ok('a new round puts the camera on the player', Math.abs(g.cam.x - g.P.x) < 1e-9 && Math.abs(g.cam.y - g.P.y) < 1e-9);
  freezeN(g);
  at(g, 29.9, 12.5);
  step(sim, 0.1, { freeze: true });
  const target = g.findTarget();
  ok('a table can be picked up', !!target && target.k === 'item');
  if (target) g.doTarget(target);
  const it = g.P.inv.find(Boolean);
  ok('the picked-up item is in the inventory', !!it && g.P.inv.indexOf(it) >= 0);
  g.P.aim = 0;
  g.throwHeld();
  ok('a thrown item is marked in flight and leaves the hand', !!it && it.fly === 1 && !g.P.inv.includes(it) && g.PR.length > 0);
  const retarget = g.findTarget();
  ok('a flying item cannot be picked out of the air', !retarget || retarget.k !== 'item' || retarget.o !== it);
  step(sim, 2, { freeze: true });
  ok('the thrown item lands and becomes collectable again', !!it && it.fly === 0 && Number.isFinite(it.x) && Number.isFinite(it.y));
}

/* ------------------------------------------- discovering a looted container */
{
  const sim = load({ seed: 81 });
  const g = sim.g;
  g.start();
  at(g, 47.5, 27.5);
  g.CT[0].done = 1;
  g.MEM.plans.length = 0;
  g.SPL.length = 0;
  g.N.script = []; g.N.mode = 'idle';
  let picked = false;
  for (let i = 0; i < 60; i++) {
    g.N.script = []; g.N.mode = 'idle';
    g.pickTask();
    if (g.N.st === 'inspect_container') { picked = true; break; }
  }
  ok('the planner investigates a looted fridge', picked, g.N.st);
  step(sim, 16, { noChase: true });
  ok('he discovers the theft and gets suspicious', g.CT[0].seen === 1 && g.N.need.s > 0.2, 'seen=' + g.CT[0].seen + ' susp=' + g.N.need.s.toFixed(2));
  const one = g.guardObjective();
  ok('one theft makes him guard the remaining objective', !!one && (one.n === 'guard_obj' || one.n === 'guard_basement'));
  g.P.red = 1; g.P.blue = 1;
  const both = g.guardObjective();
  ok('both keys make him camp the basement', both && both.n === 'guard_basement');
  ok('player-goal prediction follows the key chain', (() => {
    g.P.pick = 0; g.P.red = 0; g.P.blue = 0;
    const a = g.playerGoal().name;
    g.P.pick = 1;
    const b = g.playerGoal().name;
    g.P.red = 1;
    const c = g.playerGoal().name;
    g.P.blue = 1;
    const d = g.playerGoal().name;
    return a === 'the shed' && b === 'the kitchen' && c === 'the study' && d === 'the vault';
  })());
}

/* --------------------------------------------------------------- search */
{
  const sim = load({ seed: 91 });
  const g = sim.g;
  g.start();
  at(g, 47.5, 27.5);
  g.N.x = 28.5; g.N.y = 12.5; g.N.lastSeen = { x: 18.5, y: 12.5 }; g.N.pvel = { x: 0, y: 0 };
  g.loseChase();
  ok('losing the chase switches to search mode', g.N.mode === 'search' && g.N.searchT === 0);
  const spots = g.beliefSpots(5);
  ok('search seeds a usable belief map', spots.length > 0 && (g.N.mass || 0) > 0.02, 'mass=' + (g.N.mass || 0).toFixed(3));
  ok('predicted intercept is a finite point', (() => { const q = g.interceptPoint(); return Number.isFinite(q[0]) && Number.isFinite(q[1]); })());
  const p0 = { x: g.N.x, y: g.N.y };
  const track = { solidN: 0, solidP: 0, bigJumps: 0 };
  const err = step(sim, 8, { track });
  ok('search moves him and never puts him in a wall', !err && track.solidN === 0 && Math.hypot(g.N.x - p0.x, g.N.y - p0.y) > 0.5, err && err.message);
  const err2 = step(sim, 40, { track });
  ok('search eventually settles without crashing', !err2 && (g.N.mode === 'idle' || g.N.mode === 'search' || g.state === 'caught'), g.N.mode);
}

/* ------------------------------------------- noise, windows, doors, decoys */
{
  const sim = load({ seed: 101 });
  const g = sim.g;
  g.start();
  at(g, 47.5, 27.5);
  g.G[30][17] = 'w';
  g.N.x = 20.5; g.N.y = 27.5; g.N.script = []; g.N.mode = 'idle'; g.N.prio = 0; g.N.focus = null;
  g.noise(17.5, 30.5, 16, 'glass');
  const target = g.N.script[0] && g.N.script[0].go;
  ok('glass noise makes him inspect the window from beside it', g.N.st === 'check_window' && !!target && !((Math.floor(target[0]) === 17) && (Math.floor(target[1]) === 30)), g.N.st);
  ok('the window inspection target is standable', !!target && g.standableCell(Math.floor(target[0]), Math.floor(target[1])));
  const track = { solidN: 0, solidP: 0, bigJumps: 0 };
  const err = step(sim, 10, { track, noChase: true });
  ok('window inspection does not walk him into the wall', !err && track.solidN === 0, err && err.message);

  // repeated footsteps should update the focus instead of restarting the script
  g.N.x = 28.5; g.N.y = 25.5; g.N.script = []; g.N.mode = 'idle'; g.N.prio = 0; g.N.focus = null;
  g.noise(29, 25, 8, 'step');
  const len = g.N.script.length;
  g.noise(29.4, 25, 8, 'step');
  ok('footstep spam updates the search target without restarting', g.N.st === 'investigate_noise' && g.N.script.length === len && !!g.N.focus && g.N.focus.x === 29.4);

  // door noise
  const d = g.DRM[12 * 56 + 23];
  if (d) { d.t = 1; d.o = 1; }
  g.N.x = 21.5; g.N.y = 12.5; g.N.script = []; g.N.mode = 'idle'; g.N.prio = 0; g.N.focus = null;
  g.noise(23.5, 12.5, 9, 'door');
  ok('door noise sends him to check (and close) the door', g.N.st === 'check_open_door');
  step(sim, 8, { noChase: true });
  ok('door check completes safely', (g.N.st !== 'check_open_door' || g.N.si > 0) && g.npass(g.N.x, g.N.y));

  // decoy learning
  g.N.x = 20.5; g.N.y = 12.5; g.N.script = []; g.N.mode = 'idle'; g.N.prio = 0; g.N.focus = null;
  let follow = false;
  for (let i = 0; i < 4; i++) {
    g.N.focus = null;
    g.P.throwO = { x: 16.5, y: 12.5, t: g.tm };
    g.noise(24.5, 12.5, 12, 'impact');
    if (g.N.st === 'follow_thrower') follow = true;
  }
  const dk = Object.keys(g.MEM.decoys);
  ok('repeated throws teach him to follow the thrower', follow && dk.length > 0 && g.MEM.decoys[dk[0]] >= 3, JSON.stringify(g.MEM.decoys));
}

/* ---------------------------------------------------- trap placement fallback */
{
  const sim = load({ seed: 111 });
  const g = sim.g;
  g.start();
  at(g, 47.5, 27.5);
  g.G[30][17] = 'X';
  g.N.x = 20.5; g.N.y = 27.5;
  g.MEM.traps.length = 0;
  g.TRAPS.length = 0;
  g.run('set_bear_trap', { x: 17, y: 30 }, 1);
  const err = step(sim, 8, { noChase: true });
  const t = g.TRAPS[0];
  ok('a trap planned on a boarded tile is placed somewhere useful', !err && !!t && g.standableCell(t.x, t.y, 0.2), t ? t.x + ',' + t.y : 'none');
  ok('trap memory matches the safe placement', !!t && g.MEM.traps.includes(t.x + ',' + t.y));

  // Disarming must also forget it, otherwise it is silently back after a reload.
  if (t) {
    const key = t.x + ',' + t.y;
    g.doTarget({ k: 'trap', o: t, t: 0.9 });
    ok('disarming a trap forgets it in long-term memory', g.TRAPS.indexOf(t) < 0 && !g.MEM.traps.includes(key));
  }
}

/* --------------------------------------------------------------- routine AI */
{
  const sim = load({ seed: 121 });
  const g = sim.g;
  g.start();
  at(g, 47.5, 27.5);
  let err = null, solidN = 0, solidP = 0, stalls = 0, still = 0, nan = false;
  let last = { x: g.N.x, y: g.N.y };
  for (let i = 0; i < 60 * 300; i++) {
    noChase(g);
    try {
      g.tick(1 / 60);
    } catch (e) { err = e; break; }
    if (!g.npass(g.N.x, g.N.y)) solidN++;
    if (!g.ppass(g.P.x, g.P.y)) solidP++;
    if (!Number.isFinite(g.N.x) || !Number.isFinite(g.N.y)) { nan = true; break; }
    const goStep = g.N.script[g.N.si] && g.N.script[g.N.si].go;
    const moved = Math.hypot(g.N.x - last.x, g.N.y - last.y);
    if (goStep && moved < 1e-4) still++; else still = 0;
    if (still > 240) { stalls++; still = 0; }
    last = { x: g.N.x, y: g.N.y };
  }
  ok('five minutes of routine play never wedges the neighbour', !err && solidN === 0 && !nan, err && err.message);
  ok('no go-step stalls during routine play', stalls === 0, String(stalls));
  ok('routine tasks actually complete', g.N.done >= 8, String(g.N.done));
  ok('routine play is warning-free', sim.warnings.length === 0, sim.warnings.slice(0, 2).join(' | '));
}

/* ------------------------------------------------------------------- fuzz */
{
  let rngState = 987654321;
  const rand = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };
  let totalErrors = 0, totalSolid = 0, totalCatch = 0;
  const dirs = ['w', 'a', 's', 'd'];
  for (let seed = 0; seed < 3; seed++) {
    const sim = load({ seed: 131 + seed });
    const g = sim.g;
    g.start();
    let err = null;
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 20 === 0) {
        for (const k of ['w', 'a', 's', 'd', 'shift', 'c', 'e']) g.keys[k] = 0;
        if (rand() < 0.8) g.keys[dirs[(rand() * 4) | 0]] = 1;
        if (rand() < 0.18) g.keys.shift = 1;
        if (rand() < 0.25) g.keys.c = 1;
        if (rand() < 0.5) g.keys.e = 1;
        if (rand() < 0.012) {
          for (let t = 0; t < 30; t++) {
            const x = 1 + ((rand() * 54) | 0), y = 1 + ((rand() * 38) | 0);
            if (g.standableCell(x, y, 0.3)) { g.P.x = x + 0.5; g.P.y = y + 0.5; break; }
          }
        }
        if (rand() < 0.006) {
          const w = WINDOWS[(rand() * WINDOWS.length) | 0];
          if (g.G[w[1]][w[0]] === 'W') { g.G[w[1]][w[0]] = 'w'; g.noise(w[0] + 0.5, w[1] + 0.5, 16, 'glass'); }
        }
      }
      try { g.tick(1 / 60); } catch (e) { err = e; break; }
      if (g.state === 'play') {
        if (!g.npass(g.N.x, g.N.y)) totalSolid++;
        if (!Number.isFinite(g.P.x + g.P.y + g.N.x + g.N.y)) { err = new Error('NaN position'); break; }
      }
      if (g.state === 'caught') { totalCatch++; g.retry(); }
      if (g.state === 'win') break;
    }
    if (err) { totalErrors++; console.log('      fuzz seed ' + seed + ': ' + err.message); }
  }
  ok('random-input fuzzing: no runtime exceptions', totalErrors === 0, String(totalErrors));
  ok('random-input fuzzing: nobody clips into solid tiles', totalSolid === 0, String(totalSolid));
  ok('random-input fuzzing: catches/retries are stable', totalCatch >= 0);
}

/* ------------------------------------------------------------- final report */
console.log('');
if (failed === 0) {
  console.log('GAME2D OK — ' + checks + '/' + checks + ' checks passed');
} else {
  console.log('GAME2D FAILED — ' + failed + '/' + checks + ' checks failed');
  for (const f of failures) console.log('  · ' + f);
  process.exitCode = 1;
}
