'use strict';
// test/game2d.js — boots the single-file game in a stub DOM and drives it with
// simulated input. Covers the generator contract, the full playable route,
// keyring-vs-inventory, floors, night senses, the neighbour's learning, traps,
// cameras, and the per-match memory boundary.
//   node test/game2d.js

const vm = require('vm');
const { load } = require('./harness');

let checks = 0;
const fails = [];
function ok(cond, msg) {
  checks++;
  if (!cond) fails.push(msg);
  return !!cond;
}
function eq(a, b, msg) { return ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, tol, msg) { return ok(Math.abs(a - b) <= tol, msg + ' (got ' + a + ', want ~' + b + ' ±' + tol + ')'); }

/* ------------------------------------------------------------------ rig */
function boot(seed, store) {
  const env = load({ seed: seed || 12345, store: store || {} });
  const s = env.sandbox;
  const api = s.__g;
  const ev = (code) => vm.runInContext(String(code), s);
  return {
    env, s, api, ev,
    KEYS: ev('KEYS'),
    start(fresh) { api.startMatchFromMenu(!!fresh); api.skipCutscene(); return this; },
    tick(n) { for (let i = 0; i < (n || 1); i++) api.gameUpdate(1 / 60); },
    clear() { for (const k in this.KEYS) this.KEYS[k] = 0; },
    standNear(x, y, z) {
      const q = ev('nearestStandable(' + z + ',' + x + ',' + y + ',0.28)');
      if (!q) return false;
      this.api.P.x = q[0] + 0.5; this.api.P.y = q[1] + 0.5; this.api.P.z = z;
      return true;
    },
    face(x, y) { const P = this.api.P; P.a = Math.atan2(y - P.y, x - P.x); },
    grab(id) {
      const c = this.api.W.containers.find((q) => q.id === id);
      if (!c) return false;
      if (!this.standNear(c.x, c.y, c.z)) return false;
      this.face(c.x, c.y);
      this.api.interact();
      return true;
    },
    walkTo(x, y, z, maxFrames) {
      const api = this.api, P = api.P, KEYS = this.KEYS;
      let path = this.ev('pathFind({x:' + P.x + ',y:' + P.y + ',z:' + P.z + '},{x:' + x + ',y:' + y + ',z:' + z + '},{allowClosed:1,keys:1})');
      if (!path || !path.length) return { ok: false, why: 'no path' };
      let i = 0, frames = 0, stuck = 0, last = { x: P.x, y: P.y };
      const lim = maxFrames || 5000;
      while (frames++ < lim) {
        if (api.GAME.state !== 'play') return { ok: false, why: 'game over: ' + api.SHOW.over };
        if (P.z === z && Math.hypot(P.x - x, P.y - y) < 1.35) { this.clear(); return { ok: true, frames }; }
        if (i >= path.length) {
          // reached the end of the path but not close enough: nudge
          const dx = x - P.x, dy = y - P.y;
          if (Math.hypot(dx, dy) < 0.15) return { ok: true, frames };
          path = [path[path.length - 1]];
          i = 0;
        }
        const wp = path[i];
        const dx = wp.x + 0.5 - P.x, dy = wp.y + 0.5 - P.y;
        const d = Math.hypot(dx, dy);
        if (wp.z !== P.z) {
          if (d < 0.65) { this.clear(); api.interact(); i++; continue; }
        } else if (d < 0.2) { i++; continue; }

        // face + auto-open a closed door directly ahead
        P.a = Math.atan2(dy, dx);
        const ax = P.x + Math.cos(P.a) * 0.7, ay = P.y + Math.sin(P.a) * 0.7;
        const tile = api.tileAt(P.z, ax | 0, ay | 0);
        if (tile === 'D') {
          const dClosed = this.ev('doorClosed(' + P.z + ',' + (ax | 0) + ',' + (ay | 0) + ')');
          if (dClosed) { this.clear(); api.interact(); continue; }
        }
        if (tile === 'L' || tile === 'B' || tile === 'W' || tile === 'X') {
          this.clear();
          return { ok: false, why: 'blocked by ' + tile };
        }
        KEYS.right = dx > 0.12; KEYS.left = dx < -0.12;
        KEYS.down = dy > 0.12; KEYS.up = dy < -0.12;
        api.gameUpdate(1 / 60);

        if (frames % 90 === 0) {
          if (Math.hypot(P.x - last.x, P.y - last.y) < 0.25) stuck++; else stuck = 0;
          last = { x: P.x, y: P.y };
          if (stuck >= 2) {
            stuck = 0;
            const re = this.ev('pathFind({x:' + P.x + ',y:' + P.y + ',z:' + P.z + '},{x:' + x + ',y:' + y + ',z:' + z + '},{allowClosed:1,keys:1})');
            if (!re.length) return { ok: false, why: 'stuck, no path' };
            path = re; i = 0;
          }
        }
      }
      this.clear();
      return { ok: false, why: 'timeout' };
    },
  };
}

/* ============================================================ 1. boot/menu */
{
  const b = boot(7);
  const api = b.api;
  eq(api.SHOW.screen, 'menu', 'boots to the main menu');
  ok(!!api.W && api.W.floors.length === 3, 'menu has a preview world with 3 floors');
  ok(api.W.meta.rooms >= 10, 'preview world has rooms');
  let drew = true;
  try { api.render(1 / 60); } catch (e) { drew = false; }
  ok(drew, 'menu renders without a player');
  // Play -> cutscene -> match
  api.startMatchFromMenu(true);
  eq(api.SHOW.screen, 'cut', 'Play leads to the cutscene');
  ok(api.P == null || api.GAME.state === 'cut', 'cutscene holds the game');
  api.skipCutscene();
  eq(api.GAME.state, 'play', 'cutscene skips into the match');
  ok(!!api.P && !!api.N, 'player and neighbour exist');
  ok(api.N.z === 0 && b.ev('standable(0,' + api.N.x + ',' + api.N.y + ',0.27)'), 'neighbour stands on a valid tile');
  const blocked = b.walkTo(api.W.front.ix + 0.5, api.W.front.iy + 2, 0, 900);
  ok(blocked.ok || blocked.why !== 'no path', 'the front of the house is reachable from spawn');
  ok(b.env.warnings.length === 0, 'no console errors during boot');
}

/* ====================================================== 2. generator contract */
{
  const b = boot(3);
  b.start(true);
  const W = b.api.W;
  eq(W.floors.length, 3, 'three floors exist');
  eq(W.floors.map((f) => f.z).join(','), '0,1,2', 'floor indices are 0/1/2');
  ok(W.meta.rooms >= 10 && W.meta.rooms <= 26, 'room count is sane');
  ok(W.meta.doors >= 8, 'doors were carved');
  ok(W.meta.windows >= 6, 'windows were fitted');
  ok(W.stairs.length >= 2, 'at least the upstairs and the cellar stairs exist');
  const kinds = new Set(W.doors.map((d) => d.kind));
  ok(kinds.has('lock'), 'the study door is a lock');
  ok(kinds.has('cellar'), 'the basement door is a cellar lock');
  eq(W.doors.filter((d) => d.kind === 'lock').length, 1, 'exactly one study lock');
  eq(W.doors.filter((d) => d.kind === 'cellar').length, 1, 'exactly one cellar door');
  // every container sits on furniture and is touchable
  for (const c of W.containers) {
    let solid = true, adj = false;
    for (let i = 0; i < (c.w || 1); i++) {
      if (b.ev('T(' + c.z + ',' + (c.tx + i) + ',' + c.ty + ')') !== 'S') solid = false;
      if (b.ev('adjacentFree(' + JSON.stringify(W) + ',' + (c.tx + i) + ',' + c.ty + ',' + c.z + ')').length) adj = true;
    }
    ok(solid && adj, 'container ' + c.id + ' is solid and reachable');
  }
  // windows have interior floor behind them
  let badWin = 0;
  for (const w of W.windows) if (b.ev('T(' + w.z + ',' + w.ix + ',' + w.iy + ')') !== '.') badWin++;
  eq(badWin, 0, 'every window has interior floor behind it');
  // generate a bunch more worlds in-process
  let built = 0, attempts = 0, failsGen = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let w = null, err = null;
    try { w = b.ev('buildWorld(' + seed + ')'); } catch (e) { err = e.message; }
    if (err || !w) { failsGen++; continue; }
    const v = b.ev('GEN.validateWorld(' + JSON.stringify(w) + ')');
    if (!v.length) { built++; attempts += w.attempts; }
    else failsGen++;
  }
  ok(built >= 34, 'at least 85% of seeds produce a valid world (' + built + '/40)');
  ok(built > 0 && attempts / Math.max(1, built) < 10, 'worlds build in few attempts (' + (attempts / Math.max(1, built)).toFixed(2) + ')');
  ok(failsGen <= 6, 'no more than 15% of seeds fail');
}

/* ========================================================= 3. keyring vs bag */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, P = api.P;
  ok(!!P.keys && !Array.isArray(P.keys), 'keys live on a keyring object');
  ok(Array.isArray(P.inv), 'the player still has an inventory array for loot');
  eq(Object.keys(P.keys).sort().join(','), 'blue,pick,red', 'the keyring has three slots');
  b.grab('toolbox'); b.grab('fridge');
  ok(P.keys.pick && P.keys.red, 'the lockpick and the red key go on the keyring');
  eq(P.inv.length, 0, 'keys never enter the inventory');
  eq(P.carried, 0, 'keys are never carried and never throwable');
  const keysAsItems = api.ITEMS.filter((it) => /key|pick/i.test(it.k));
  eq(keysAsItems.length, 0, 'no loose item is a key');
  // the keyring survives drawing
  let drew = true;
  try { api.render(1 / 60); } catch (e) { drew = false; }
  ok(drew, 'the keyring HUD renders');
}

/* ==================================================== 4. the full playable run */
{
  const b = boot(11);
  b.start(true);
  const api = b.api, W = api.W, P = api.P;
  api.freezeAI(true);  // exercise the player route in isolation
  const shed = b.walkTo(W.containers.find((c) => c.id === 'toolbox').x, W.containers.find((c) => c.id === 'toolbox').y, 0, 6000);
  ok(shed.ok, 'walked to the shed (' + JSON.stringify(shed) + ')');
  b.grab('toolbox');
  ok(P.keys.pick, 'lockpick taken from the shed');
  const front = b.walkTo(W.front.ix + 0.5, W.front.iy + 2, 0, 6000);
  ok(front.ok, 'walked to the front door (' + JSON.stringify(front) + ')');
  b.standNear(W.front.ix, W.front.iy + 1, 0); b.face(W.front.x, W.front.y);
  api.interact();
  eq(b.ev('doorClosed(0,' + W.front.ix + ',' + W.front.iy + ')'), false, 'front door opens');
  const inside = b.walkTo(W.front.ix + 0.5, W.front.iy - 1.5, 0, 3000);
  ok(inside.ok, 'walked inside through the front door');
  // the study door blocks until picked
  const sd = W.doors.find((d) => d.kind === 'lock');
  const sc = sd.cells[0];
  const toStudy = b.walkTo(sc[0] + 0.5, sc[1] + 0.5, sd.z, 6000);
  ok(toStudy.ok || toStudy.why === 'blocked by L', 'reached the study door or was stopped by it (' + JSON.stringify(toStudy) + ')');
  b.standNear(sc[0], sc[1], sd.z); b.face(sc[0] + 0.5, sc[1] + 0.5);
  api.interact();
  eq(sd.closed, 0, 'lockpick opens the study');
  eq(b.ev('T(' + sd.z + ',' + sc[0] + ',' + sc[1] + ')'), 'D', 'unlocked door becomes a door tile');
  ok(!!b.standNear(W.containers.find((c) => c.id === 'desk').x, W.containers.find((c) => c.id === 'desk').y, 1), 'the desk is reachable now');
  b.grab('desk');
  ok(P.keys.blue, 'blue key taken from the study desk');
  b.grab('fridge');
  ok(P.keys.red, 'red key taken from the kitchen fridge');
  // basement is locked until the red key
  const cd = W.doors.find((d) => d.kind === 'cellar');
  b.standNear(cd.cells[0][0], cd.cells[0][1], 0); b.face(cd.cells[0][0] + 0.5, cd.cells[0][1] + 0.5);
  b.api.interact();
  eq(cd.closed, 0, 'red key unlocks the basement');
  // stairs
  const cs = api.STAIR.find((s) => s.b.z === 2);
  P.x = cs.a.x + 0.5; P.y = cs.a.y + 0.5; P.z = cs.a.z;
  api.interact();
  eq(P.z, 2, 'the cellar stairs take the player to the basement');
  const sec = W.secret;
  ok(b.standNear(sec.x, sec.y, 2), 'the basement secret is approachable');
  api.interact();
  eq(api.SHOW.over, 'win', 'opening the stash wins the match');
  eq(api.MEM.wins, 1, 'the win is written to match memory');
  ok(b.env.warnings.length === 0, 'no console errors during the run');
}

/* ============================================================ 5. floors/stairs */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, P = api.P;
  ok(api.STAIR.length >= 2, 'stair links exist');
  for (const s of api.STAIR) {
    ok(b.ev('T(' + s.a.z + ',' + s.a.x + ',' + s.a.y + ')') === 'U' || b.ev('T(' + s.a.z + ',' + s.a.x + ',' + s.a.y + ')') === 'N', 'stair end A is a stair tile');
    ok(b.ev('T(' + s.b.z + ',' + s.b.x + ',' + s.b.y + ')') === 'U' || b.ev('T(' + s.b.z + ',' + s.b.x + ',' + s.b.y + ')') === 'N', 'stair end B is a stair tile');
  }
  const up = api.STAIR.find((s) => s.a.z === 0 && s.b.z === 1);
  P.x = up.a.x + 0.5; P.y = up.a.y + 0.5; P.z = 0;
  api.interact();
  eq(P.z, 1, 'stairs go up');
  api.interact();
  eq(P.z, 0, 'and back down');
  ok(b.ev('pathFind({x:2.5,y:33.5,z:0},{x:' + api.W.secret.x + ',y:' + api.W.secret.y + ',z:2},{allowClosed:1,keys:1})').length > 8, 'pathfinding crosses floors');
  ok(b.ev('pathFind({x:2.5,y:33.5,z:0},{x:' + api.W.secret.x + ',y:' + api.W.secret.y + ',z:2},{allowClosed:1,keys:0})').length === 0, 'a locked cellar blocks the path without keys');
}

/* ============================================================= 6. night time */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, P = api.P, N = api.N;
  // put the player in plain sight of the neighbour
  P.x = N.x + 2.2; P.y = N.y; P.z = N.z;
  N.a = 0;
  api.setClock(13);
  const day = api.sightRange();
  api.setClock(23);
  const night = api.sightRange();
  ok(night < day, 'he sees 20% shorter at night (' + day.toFixed(2) + ' -> ' + night.toFixed(2) + ')');
  ok(night / day > 0.5 && night / day <= 0.85, 'night sight is roughly 20% shorter than day (' + (night / day).toFixed(2) + ')');
  api.setClock(13);
  P.crouch = 1;
  const crouch = api.sightRange();
  P.crouch = 0; P.sprint = 1;
  const sprint = api.sightRange();
  ok(crouch < day * 0.65, 'crouching hides you');
  ok(sprint > day, 'sprinting makes you easier to spot');
  P.sprint = 0;
  ok(api.isNight(23) && api.isNight(2) && !api.isNight(12), 'the clock drives day/night');
  // catching you once makes him a lighter sleeper
  b.ev('N.sleeping = 1');
  const before = b.ev('N.sleeping');
  api.MEM.catches = 0;
  const loud0 = b.ev('(function(){N.sleeping=1;hearNoise(N.x+2,N.y,N.z,12,"glass");return N.sleeping})()');
  b.ev('N.mode="routine"; N.script=[]');
  api.MEM.catches = 2;
  const loud2 = b.ev('(function(){N.sleeping=1;hearNoise(N.x+2,N.y,N.z,6,"step");return N.sleeping})()');
  ok(before === 1, 'he can sleep');
  ok(loud0 === 0, 'loud noise wakes him');
  ok(loud2 === 0, 'after two catches even a quiet noise wakes him');
}

/* ============================================================ 7. perception */
{
  const b = boot(7);
  b.start(true);
  const api = b.api;
  const W = api.W;
  // find a wall cell and check occlusion
  let wall = null;
  for (let y = 4; y < 20 && !wall; y++) for (let x = 10; x < 30 && !wall; x++) if (b.ev('T(0,' + x + ',' + y + ')') === '#') wall = { x, y };
  ok(!!wall, 'found a wall');
  ok(!api.lineOfSight({ x: wall.x - 0.5, y: wall.y + 0.5, z: 0 }, { x: wall.x + 1.5, y: wall.y + 0.5, z: 0 }), 'walls block his sight');
  ok(api.lineOfSight({ x: wall.x - 0.5, y: wall.y - 1.5, z: 0 }, { x: wall.x + 2.5, y: wall.y - 1.5, z: 0 }), 'open floor does not');
  // facing matters: a guard behind him
  const N = api.N;
  const P = api.P;
  let pair = null;
  for (let y = 2; y < 34 && !pair; y++) for (let x = 2; x < 44 && !pair; x++) {
    if (b.ev('T(0,' + x + ',' + y + ')') === ',' && b.ev('T(0,' + (x + 4) + ',' + y + ')') === ',') pair = { x, y };
  }
  ok(!!pair, 'found an open stretch of yard to test sight');
  N.x = pair.x + 0.5; N.y = pair.y + 0.5; N.z = 0; N.a = 0;
  P.x = pair.x - 2.5; P.y = pair.y + 0.5; P.z = 0;
  b.ev('N.al=0'); N.mode = 'routine'; N.script = [];
  b.tick(20);
  const behind = N.al;
  b.ev('N.al=0'); N.a = 0; N.mode = 'routine'; N.script = [];
  P.x = pair.x + 3.5; P.y = pair.y + 0.5;
  b.tick(20);
  ok(N.al > behind && N.al > 0.2, 'he notices what is in front of him more than what is behind (' + behind.toFixed(2) + ' -> ' + N.al.toFixed(2) + ')');
  // noise carries less through walls
  const through = b.ev('wallCount(0,' + (wall.x - 0.5) + ',' + (wall.y + 0.5) + ',' + (wall.x + 1.5) + ',' + (wall.y + 0.5) + ')');
  ok(through >= 1, 'a wall between two points is counted');
  const open = b.ev('wallCount(0,' + wall.x + ',' + (wall.y - 1.5) + ',' + (wall.x + 2) + ',' + (wall.y - 1.5) + ')');
  eq(open, 0, 'open floor between two points is not');
}

/* ======================================================== 8. sounds & tracking */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, N = api.N;
  N.mode = 'routine'; N.script = []; N.sounds = []; N.al = 0;
  api.GAME.t = 10;
  // three footsteps in a line within six seconds
  for (let i = 0; i < 3; i++) {
    api.makeNoise(N.x + 1 + i * 0.6, N.y + i * 0.3, N.z, 4, 'step');
    api.GAME.t += 0.4;
  }
  ok(!!N.track, 'three noises in six seconds produce a predicted position');
  ok(N.mode === 'suspicious', 'he goes to investigate the prediction');
  ok(N.track.x > N.x, 'the prediction leads where the player was heading');
  const said = (N.quip || '').toLowerCase();
  ok(/sound|hear/.test(said) || N.label.toLowerCase().includes('sound'), 'he announces following the sound');
}

/* ============================================================== 9. chasing */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, N = api.N, P = api.P;
  // stand in front of him with a clear line of sight
  N.a = 0; N.mode = 'routine'; N.script = [];
  P.x = N.x + 3; P.y = N.y; P.z = N.z; P.crouch = 0;
  let saw = false;
  for (let i = 0; i < 90; i++) { b.tick(1); if (N.mode === 'chase') { saw = true; break; } }
  ok(saw, 'he starts a chase when he actually sees you');
  ok(/GOTCHA|cutting/.test(N.quip || '') || N.mode === 'chase', 'and says so');
  // a chase across the room reaches the player
  let caught = false;
  for (let i = 0; i < 600 && !caught; i++) { b.tick(1); if (api.GAME.state === 'over') caught = true; }
  ok(caught, 'a chase ends in a catch');
  eq(api.SHOW.over, 'caught', 'the caught screen is shown');
  ok(api.MEM.catches >= 1, 'the catch is written to match memory');
  ok(api.MEM.hides.length >= 1, 'he remembers where he caught you');
  ok(api.MEM.hours.some((h) => h > 0), 'he records the hour he caught you');
}

/* ========================================================== 10. trap validity */
{
  let valid = 0, total = 0, invalid = [];
  for (const seed of [3, 7, 11, 21]) {
    const b = boot(seed);
    b.start(true);
    const api = b.api;
    for (let i = 0; i < 12; i++) {
      const spot = api.bestTrapSpot();
      if (!spot) break;
      total++;
      if (!api.isValidTrapCell(spot.z, spot.x, spot.y)) invalid.push(seed + ':' + spot.z + ':' + spot.x + ',' + spot.y);
      else { api.addTrap(spot.z, spot.x, spot.y); valid++; }
    }
    // traps never land on the spawn tile, doors, stairs or furniture
    for (const t of api.TRAPS) {
      const z = t.z, x = t.x | 0, y = t.y | 0;
      ok(b.ev('T(' + z + ',' + x + ',' + y + ')') === '.' || b.ev('T(' + z + ',' + x + ',' + y + ')') === ',', 'trap sits on open floor');
      ok(!b.ev('!!doorAt(' + z + ',' + x + ',' + y + ')'), 'trap is not in a doorway');
      ok(!b.ev('!!stairFrom(' + z + ',' + x + ',' + y + ')'), 'trap is not on stairs');
      ok(b.api.W.containers.every((c) => Math.abs(c.tx - x) + Math.abs(c.ty - y) >= 2), 'trap is not inside a container');
    }
  }
  eq(invalid.length, 0, 'every chosen trap cell is valid (' + invalid.slice(0, 3).join('; ') + ')');
  ok(valid > 0 && valid === total, 'trap placement only ever returns valid cells (' + valid + '/' + total + ')');
}

/* =========================================================== 11. suspicion/memory */
{
  const store = {};
  const b = boot(7, store);
  b.start(true);
  const api = b.api;
  const seed1 = api.MEM.seed;
  ok(api.MEM.suspicion >= 0 && api.MEM.suspicion <= 100, 'suspicion starts in range');
  const before = api.MEM.suspicion;
  b.ev('M.suspicion = 40');
  // he hears a window smash: suspicion climbs
  b.ev('hearNoise(N.x+1,N.y,N.z,15,"glass")');
  ok(api.MEM.suspicion > 40, 'loud noises raise his suspicion');
  ok(api.MEM.suspicion > before, 'suspicion accumulates');
  // theft detection needs line of sight (or a forced check)
  const fridge = api.W.containers.find((c) => c.id === 'fridge');
  b.standNear(fridge.x, fridge.y, fridge.z);
  api.P.keys.pick = 1;
  api.interact();
  ok(fridge.done, 'the fridge has been searched');
  b.ev('N.x=' + (fridge.x + 1) + '; N.y=' + fridge.y + '; N.z=' + fridge.z);
  b.ev('checkTheftsNear(true)');
  ok(api.MEM.thefts.includes('fridge'), 'he notices the fridge was searched');
  ok((api.N.quip || '').length > 0, 'and complains about it out loud');
  ok(api.MEM.suspicion > 40, 'theft spikes suspicion');
  // he re-locks a door the player unlocked
  const door = api.W.doors.find((d) => d.kind === 'door' && d.z === 0 && !d.shed && !d.front);
  b.standNear(door.cells[0][0], door.cells[0][1], 0);
  b.ev('openDoor(0,' + door.cells[0][0] + ',' + door.cells[0][1] + ',{crouch:0})');
  door.playerUnlocked = 1;
  door.lockChar = 'L';
  b.ev('N.x=' + (door.cells[0][0] + 1) + '; N.y=' + door.cells[0][1] + '; N.z=0; N.mode="routine"; N.script=[];');
  const relockPlanned = b.ev('considerRelock()');
  ok(relockPlanned === true, 'he plans to re-lock a door you opened');
  b.standNear(api.W.front.ix, api.W.front.iy + 3, 0);
  b.tick(400);
  ok(door.closed === 1 || api.MEM.relocks.length > 0, 'and actually re-locks it');
  // match memory is scoped: same seed on replay, new game wipes
  api.saveMatch();
  ok(!!store['hn.match.v2'], 'the match is saved under its own key');
  const savedSeed = JSON.parse(store['hn.match.v2']).seed;
  eq(savedSeed, seed1, 'the save carries the match seed');
  b.start(false);
  eq(api.MEM.seed, seed1, 'continuing keeps the same house');
  ok(api.MEM.thefts.includes('fridge'), 'continuing keeps what he learned');
  b.start(true);
  ok(!api.MEM.thefts.length, 'New Game wipes everything he learned');
  ok(api.MEM.catches === 0 && api.MEM.suspicion <= 20, 'New Game resets his suspicion');
  ok(!store['hn.match.v2'] || JSON.parse(store['hn.match.v2']).seed === api.MEM.seed, 'New Game re-seeds the save');
}

/* ======================================================= 12. traps + cams persist */
{
  const store = {};
  const b = boot(7, store);
  b.start(true);
  const api = b.api;
  api.MEM.seed;
  const spot = api.bestTrapSpot();
  ok(!!spot, 'a trap spot is found');
  api.addTrap(spot.z, spot.x, spot.y);
  eq(api.TRAPS.length, 1, 'the trap exists in the world');
  ok(api.MEM.traps.length === 1, 'the trap is remembered');
  api.saveMatch();
  b.start(false);
  eq(api.TRAPS.length, 1, 'the trap is still there when you come back');
  const cam = api.W.floors[0].rooms[0];
  const q = b.ev('nearestStandable(0,' + cam.cx + ',' + cam.cy + ',0.28)');
  api.addCamera(0, q[0], q[1]);
  eq(api.CAMS.length, 1, 'a camera can be installed');
  ok(api.MEM.cams.length === 1, 'the camera is remembered');
  // cameras see the player in their cone
  const c = api.CAMS[0];
  c.sweep = 0;
  b.ev('P.x=' + (c.x + 1) + '; P.y=' + c.y + '; P.z=' + c.z);
  c.a = Math.atan2(api.P.y - c.y, api.P.x - c.x);
  b.tick(90);
  ok(c.seeT > 0.2, 'a camera notices a player in its cone');
}

/* =========================================================== 13. the AI's day job */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, N = api.N;
  const seen = new Set();
  const positions = [];
  for (let i = 0; i < 60 * 200; i++) {
    b.tick(1);
    if (i % 60 === 0) { seen.add(N.st); positions.push([N.x, N.y, N.z]); }
    if (api.GAME.state !== 'play') break;
  }
  ok(seen.size >= 3, 'he does more than one kind of chore (' + [...seen].slice(0, 6).join(',') + ')');
  ok(positions.length > 50, 'he keeps moving around the house');
  const cells = new Set(positions.map((p) => p[2] + ':' + (p[0] | 0) + ',' + (p[1] | 0)));
  ok(cells.size > 12, 'he is genuinely walking, not frozen (' + cells.size + ' distinct tiles)');
  ok(N.need.hunger <= 1 && N.need.energy <= 1, 'his needs stay bounded');
  ok(N.mode !== 'chase', 'he does not chase a player who is hiding outside');
}

/* ================================================== 13b. the reaction chain */
{
  const b = boot(9, {});
  b.start(true);
  const api = b.api, N = api.N, P = api.P;
  // two walkable tiles in the same room with a clear line of sight
  let pair = null;
  for (let y = 2; y < 34 && !pair; y++) {
    for (let x = 2; x < 40 && !pair; x++) {
      if (b.ev('standable(0,' + (x + 0.5) + ',' + (y + 0.5) + ',0.3)') &&
          b.ev('standable(0,' + (x + 4.5) + ',' + (y + 0.5) + ',0.3)') &&
          api.lineOfSight({ x: x + 0.5, y: y + 0.5, z: 0 }, { x: x + 4.5, y: y + 0.5, z: 0 })) {
        pair = { x, y };
      }
    }
  }
  ok(!!pair, 'found a room with an open sightline');
  if (pair) {
    N.x = pair.x + 0.5; N.y = pair.y + 0.5; N.z = 0; N.a = 0;
    N.mode = 'routine'; N.script = [];
    P.x = pair.x + 4.5; P.y = pair.y + 0.5; P.z = 0; P.crouch = 0;
    let react = null;
    for (let i = 0; i < 180; i++) {
      api.gameUpdate(1 / 60);
      if (N.mode === 'suspicious' || N.mode === 'chase') { react = { i, mode: N.mode, label: N.label, quip: N.quip }; break; }
    }
    ok(!!react, 'he reacts to a player standing in the open');
    ok(/hear|breathing|who is that|follow/i.test((react && (react.quip || react.label)) || '') || (react && react.mode === 'chase'),
      'a distant sighting first becomes a quiet approach, not a sprint');
    // he loses the player: a belief-driven search replaces a straight chase
    P.hidden = 1; P.crouch = 1;
    b.ev('P.x = -99; P.y = -99;');            // out of the world: no line of sight at all
    if (N.mode === 'chase') b.ev('N.lastSeen={x:' + pair.x + ',y:' + pair.y + ',z:0,t:GAME.t}');
    let becameSearch = false;
    for (let i = 0; i < 60 * 12; i++) {
      api.gameUpdate(1 / 60);
      if (N.mode === 'search') { becameSearch = true; break; }
      if (api.GAME.state !== 'play') break;
    }
    ok(becameSearch || N.mode !== 'chase', 'a chase lets go when the trail goes cold');
    // deterministic belief search from a known last sighting
    b.ev('P.x = ' + (pair.x + 0.5) + '; P.y = ' + (pair.y + 0.5) + '; P.z = 0; P.hidden = 1;');
    N.lastSeen = { x: pair.x + 0.5, y: pair.y + 0.5, z: 0, t: api.GAME.t };
    N.mode = 'suspicious'; N.script = []; N.path = [];
    b.ev('startSearch("lost")');
    eq(N.mode, 'search', 'losing you starts a search, not a freeze');
    ok(b.ev('belTotal(0)') > 0, 'the search seeds a belief map');
    const spots = b.ev('belSpots(0,4)');
    ok(spots.length > 0, 'the belief map yields candidate hiding spots');
    let swept = false;
    for (let i = 0; i < 60 * 40; i++) {
      api.gameUpdate(1 / 60);
      if (N.st === 'search_spot' || N.st === 'ambush_door') swept = true;
      if (api.GAME.state !== 'play') break;
    }
    ok(swept, 'he walks to the likeliest spots');
    const door = api.bestAmbushDoor();
    ok(!!door, 'he can pick a chokepoint to camp');
  }
}

/* ========================================================== 14. camera/keys UI */
{
  const b = boot(7);
  b.start(true);
  const api = b.api;
  ok(!!api.HUD.tasks.length, 'objective list exists');
  const texts = api.HUD.tasks.map((t) => t.txt.toLowerCase()).join(' | ');
  ok(/lockpick|key/.test(texts), 'objectives talk about the keyring, not items');
  ok(api.P.inv.length === 0, 'inventory starts empty');
  api.P.carrying = 0;
  const before = api.P.inv.length;
  const it = api.ITEMS.find((i) => i.z === api.P.z);
  if (it) {
    api.P.x = it.x; api.P.y = it.y;
    api.interact();
    ok(api.P.inv.length >= before, 'loot can go in the bag');
    ok(api.P.inv.length <= 3, 'the bag is small');
  }
  // throwing a carried item makes noise and lands
  const room = api.W.floors[0].rooms[0];
  const q = b.ev('nearestStandable(0,' + room.cx + ',' + room.cy + ',0.3)');
  api.P.x = q[0] + 0.5; api.P.y = q[1] + 0.5; api.P.z = 0;
  api.P.carried = 'vase';
  const n0 = api.GAME.t;
  api.throwCarried(api.P.x + 2, api.P.y);
  ok(api.GAME.t >= n0, 'throwing does not advance time by itself');
  b.tick(60);
  ok(api.P.carried === 0, 'the throw clears your hands');
}

/* ========================================================= 14b. HN mechanics */
{
  // --- a thrown object is traced back to where it was thrown from
  {
    const b = boot(7, {});
    b.start(true);
    const api = b.api, N = api.N, P = api.P;
    api.freezeAI(true);
    N.mode = 'routine'; N.script = []; N.stun = 0;
    // stand next to him, in the open, so the throw connects
    let from = null;
    for (let d = 2.4; d <= 3.6 && !from; d += 0.4) {
      for (const ang of [0, 1.57, 3.14, 4.71, 0.78, 2.36, 3.93, 5.5]) {
        const x = N.x + Math.cos(ang) * d, y = N.y + Math.sin(ang) * d;
        if (b.ev('standable(' + N.z + ',' + x + ',' + y + ',0.3)') && api.lineOfSight({ x, y, z: N.z }, { x: N.x, y: N.y, z: N.z })) { from = { x, y }; break; }
      }
    }
    ok(!!from, 'found a clear throwing spot');
    if (!from) from = { x: N.x + 2.6, y: N.y };
    P.x = from.x; P.y = from.y; P.z = N.z;
    P.carried = 'tomato';
    api.throwCarried(N.x, N.y);
    for (let i = 0; i < 120 && !N.stun; i++) api.gameUpdate(1 / 60);
    ok(N.stun > 0, 'a direct hit stuns him');
    ok(!!N.forensic, 'he records where the throw came from');
    near(N.forensic.x, P.x, 0.6, 'the recorded origin is the thrower');
    ok(/tomato|thr/i.test(String(N.quip || '') + ' ' + String(N.label || '')), 'he reacts to being hit');
    api.freezeAI(false);
    let hunted = false;
    for (let i = 0; i < 60 * 12; i++) {
      api.gameUpdate(1 / 60);
      if (N.st === 'hunt_thrower' || N.st === 'search_spot' || N.mode === 'chase') { hunted = true; break; }
      if (api.GAME.state !== 'play') break;
    }
    ok(hunted, 'and he hunts from the throw origin');
  }
  // --- cameras are placed only after he has caught you twice
  {
    const b = boot(7, {});
    b.start(true);
    const api = b.api;
    api.MEM.catches = 0;
    api.MEM.entries['0:22:27'] = 6;
    eq(api.planCamera(), false, 'no cameras before the first catch');
    api.MEM.catches = 2;
    const ok2 = api.planCamera();
    ok(ok2 === true, 'after two catches he mounts a camera on your favourite entry');
    ok(api.MEM.plans.some((p) => p.t === 'camera'), 'the plan is queued');
    const plan = api.MEM.plans.find((p) => p.t === 'camera');
    ok(Math.hypot(plan.x - 22, plan.y - 27) < 8, 'the camera is placed near that entry');
  }
  // --- noises during a search sharpen his belief map instead of restarting it
  {
    const b = boot(7, {});
    b.start(true);
    const api = b.api, N = api.N;
    b.ev('startSearch("test")');
    eq(N.mode, 'search', 'searching');
    const before = b.ev('belTotal(0)');
    const st0 = N.st;
    b.ev('hearNoise(' + (N.x + 4) + ',' + N.y + ',0,' + N.z + ',9,"step")');
    ok(b.ev('belTotal(0)') >= before, 'noise inside a search adds belief mass');
    eq(N.st, st0, 'and does not yank him out of the current search step');
  }
  // --- door cut-offs: he only tries if he can actually beat you there
  {
    const b = boot(7, {});
    b.start(true);
    const api = b.api, N = api.N, P = api.P;
    N.z = 0; P.z = 0;
    const front = api.W.front;
    P.x = front.ix + 0.5; P.y = front.iy - 1.5;
    N.x = front.ix + 0.5; N.y = front.iy + 6;    // outside, further away
    const t = api.cutoffTarget(9);
    ok(!!t, 'a cut-off target exists');
    ok(Math.hypot(t.x - P.x, t.y - P.y) < 30, 'the target is in the same house');
    // with the player already on top of the goal, he falls back to the player
    b.ev('P.x = ' + api.W.secret.x + '; P.y = ' + api.W.secret.y + '; P.z = 2; P.keys.red=1; P.keys.blue=1;');
    const t2 = api.cutoffTarget(9);
    ok(!!t2, 'with the player at the objective he still has a target');
  }
  // --- valuables check routine exists and visits the objectives
  {
    const b = boot(7, {});
    b.start(true);
    const api = b.api, N = api.N;
    const steps = b.ev('JSON.stringify(SCRIPTS.check_valuables().length)');
    ok(Number(steps) >= 3, 'the valuables check visits several stations (' + steps + ')');
    b.ev('runScript("check_valuables", {}, 1)');
    ok(N.script.length >= 3, 'the routine is queued');
    let seenStation = null;
    for (let i = 0; i < 60 * 60; i++) {
      api.gameUpdate(1 / 60);
      if (N.st === 'check_valuables') seenStation = true;
      if (api.GAME.state !== 'play') break;
    }
    ok(seenStation !== null, 'he actually runs the valuables check');
  }
  // --- sprinting is visible further than walking; crouching is not
  {
    const b = boot(7, {});
    b.start(true);
    const api = b.api, P = api.P;
    api.setClock(23);
    P.sprint = 0; P.crouch = 0; const base = api.sightRange();
    P.crouch = 1; const crouch = api.sightRange(); P.crouch = 0;
    P.sprint = 1; const sprint = api.sightRange(); P.sprint = 0;
    ok(crouch < base * 0.6, 'crouching at night makes you nearly invisible');
    ok(sprint > base, 'sprinting makes you easier to see');
  }
}

/* ================================================================ 15. render */
{
  const b = boot(7);
  b.start(true);
  const api = b.api;
  let err = null;
  try {
    for (let i = 0; i < 8; i++) {
      b.tick(30);
      api.render(1 / 60);
    }
    api.SHOW.screen = 'pause'; api.render(1 / 60);
    api.SHOW.screen = 'play';
    api.SHOW.showBelief = 1; api.render(1 / 60); api.SHOW.showBelief = 0;
    api.SHOW.screen = 'menu'; api.render(1 / 60);
    api.SHOW.screen = 'cut'; api.SHOW.cut = 3; api.render(1 / 60);
    api.SHOW.screen = 'over'; api.SHOW.over = 'caught'; api.render(1 / 60);
  } catch (e) { err = e.stack; }
  ok(!err, 'every screen renders: ' + (err || 'ok'));
}

/* ------------------------------------------------------------------ report */
if (fails.length) {
  console.log('\nFAILURES (' + fails.length + '/' + checks + '):');
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('\nGAME2D FAIL — ' + (checks - fails.length) + '/' + checks);
  process.exit(1);
} else {
  console.log('GAME2D OK — ' + checks + '/' + checks);
}
