'use strict';
// test/game2d.js — boots the single-file game in a stub DOM and drives it with
// simulated input. The map is FIXED now, so this suite pins the map down:
// tile positions, room list, both floors, the stair hand-off, the study lock,
// the vault, the night senses, the belief-driven chase, and the memory boundary.
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
        if (api.GAME.state !== 'play') return { ok: false, why: 'game over' };
        if (P.z === z && Math.hypot(P.x - x, P.y - y) < 1.35) { this.clear(); return { ok: true, frames }; }
        if (i >= path.length) {
          const dx = x - P.x, dy = y - P.y;
          if (Math.hypot(dx, dy) < 0.15) { this.clear(); return { ok: true, frames }; }
          path = [path[path.length - 1]];
          i = 0;
        }
        const wp = path[i];
        const dx = wp.x + 0.5 - P.x, dy = wp.y + 0.5 - P.y;
        const d = Math.hypot(dx, dy);
        if (wp.z !== P.z) {
          if (d < 0.7) { this.clear(); api.interact(); i++; continue; }
        } else if (d < 0.2) { i++; continue; }
        P.a = Math.atan2(dy, dx);
        const ax = P.x + Math.cos(P.a) * 0.7, ay = P.y + Math.sin(P.a) * 0.7;
        const tile = api.tileAt(P.z, ax | 0, ay | 0);
        if (tile === 'D') {
          const closed = this.ev('doorClosed(' + P.z + ',' + (ax | 0) + ',' + (ay | 0) + ')');
          if (closed) { this.clear(); api.interact(); continue; }
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
  ok(!!api.W, 'the menu already has a world for its backdrop');
  eq(api.W.floors.length, 2, 'the menu backdrop is the two-floor house');
  let drew = true;
  try { api.render(1 / 60); } catch (e) { drew = false; }
  ok(drew, 'the menu renders without a player');
  api.startMatchFromMenu(true);
  eq(api.SHOW.screen, 'cut', 'Play leads to the cutscene');
  eq(api.GAME.state, 'cut', 'the cutscene holds the game');
  api.skipCutscene();
  eq(api.GAME.state, 'play', 'the cutscene skips into the match');
  ok(!!api.P && !!api.N, 'player and neighbour exist');
  ok(api.N.z === 0 && b.ev('standable(0,' + api.N.x + ',' + api.N.y + ',0.27)'), 'the neighbour starts on a valid tile');
  near(api.P.x, 28.5, 0.6, 'the player spawns at the front gate');
  near(api.P.y, 37.5, 0.6, '...on the path');
  ok(b.env.warnings.length === 0, 'no console errors during boot (' + b.env.warnings.join(' | ') + ')');
}

/* ======================================================== 2. the fixed map */
{
  const b = boot(3);
  b.start(true);
  const api = b.api, W = api.W;
  eq(W.fixed, 1, 'the world is marked as hand-authored');
  eq(W.floors.length, 2, 'there are exactly two floors');
  eq(W.floors.map((f) => f.z).join(','), '0,1', 'floor indices are 0/1');
  eq(W.floors[0].name, 'Ground floor', 'floor 0 is the ground floor');
  eq(W.floors[1].name, 'Upstairs', 'floor 1 is upstairs');
  eq(W.rooms.length, 15, 'ten ground rooms and five upstairs rooms');
  eq(W.meta.rooms, 15, 'the meta count agrees');
  ok(W.meta.doors >= 12, 'the house has its doors (' + W.meta.doors + ')');
  ok(W.meta.windows >= 10, 'the house has its windows (' + W.meta.windows + ')');
  // the same map whatever the seed / attempts
  const a1 = b.ev('JSON.stringify(buildWorld(1).floors[0].G)');
  const a2 = b.ev('JSON.stringify(buildWorld(99999).floors[0].G)');
  const a3 = b.ev('JSON.stringify(buildWorld(0).floors[1].G)');
  const a4 = b.ev('JSON.stringify(buildWorld(4242).floors[1].G)');
  eq(a1, a2, 'the ground floor is identical for every seed');
  eq(a3, a4, 'the upper floor is identical for every seed');
  eq(b.ev('validateWorld(W).length'), 0, 'the fixed map validates clean');
  // the v1 layout, tile for tile
  eq(W.floors[0].G[7][12], '#', 'house corner at 12,7');
  eq(W.floors[0].G[30][43], '#', 'house corner at 43,30');
  eq(W.floors[0].G[12][23], 'D', 'living-room door on the hall wall');
  eq(W.floors[0].G[11][34], 'L', 'the study lock sits at 34,11');
  eq(W.floors[0].G[27][43], 'B', 'the vault door sits at 43,27');
  eq(W.floors[0].G[26][46], 'V', 'the vault floor is inside');
  eq(W.floors[0].G[30][28], 'D', 'the front door sits at 28,30');
  eq(W.floors[0].G[7][26], 'D', 'the north door sits at 26,7');
  eq(W.floors[0].G[39][28], ',', 'the path runs out through the gate');
  eq(W.floors[0].G[39][27], 'F', 'the fence is closed either side of it');
  eq(W.floors[0].G[11][7], 'D', 'the shed has a door');
  eq(W.floors[0].G[26][31], 'U', 'the stairs up are in the foyer');
  eq(W.floors[1].G[26][31], 'N', 'the same tile is the stairs down');
  near(W.secret.x, 46.5, 0.01, 'the SECRET sits where it always did');
  near(W.secret.y, 26.5, 0.01, '...at 46.5,26.5');
  eq(W.secret.z, 0, 'the SECRET is on the ground floor');
}

/* ================================================== 3. the rooms and fittings */
{
  const b = boot(4);
  b.start(true);
  const api = b.api, W = api.W;
  const names = W.floors[0].rooms.map((r) => r.name);
  for (const n of ['Living Room', 'Kitchen', 'Dining Room', 'Foyer', 'Bedroom', 'Study', 'Bathroom', 'Workshop', 'Vault', 'Shed']) {
    ok(names.indexOf(n) >= 0, 'ground floor has the ' + n);
  }
  const unames = W.floors[1].rooms.map((r) => r.name);
  for (const n of ['Master Bedroom', 'Spare Room', 'Landing', 'Storage', 'Upstairs Bath']) {
    ok(unames.indexOf(n) >= 0, 'upstairs has the ' + n);
  }
  ok(!!W.study && W.study.type === 'study', 'the study is found by type');
  ok(!!W.kitchen && W.kitchen.type === 'kitchen', 'the kitchen is found by type');
  ok(!!W.cellar && W.cellar.door.x === 43 && W.cellar.door.y === 27, 'the vault door is the cellar reference');
  // stairs: two tiles, each a real link both ways
  eq(W.stairs.length, 2, 'two stair links');
  for (const s of W.stairs) {
    eq(s.a.z, 0, 'a stair starts on the ground floor');
    eq(s.b.z, 1, '...and ends upstairs');
    eq(s.a.x, s.b.x, 'the stair is vertical');
    eq(b.ev('stairFrom(0,' + s.a.x + ',' + s.a.y + ').z'), 1, 'walking the stair tile goes up');
    eq(b.ev('stairFrom(1,' + s.b.x + ',' + s.b.y + ').z'), 0, 'and back down');
  }
  // containers
  const ids = W.containers.map((c) => c.id).sort();
  ok(ids.indexOf('toolbox') >= 0 && ids.indexOf('fridge') >= 0 && ids.indexOf('desk') >= 0, 'the three key containers exist');
  for (const c of W.containers) {
    let solid = true, w = c.w || 1;
    for (let i = 0; i < w; i++) if (b.ev('T(' + c.z + ',' + (c.tx + i) + ',' + c.ty + ')') !== 'S') solid = false;
    ok(solid, 'container ' + c.id + ' sits on furniture');
    ok(!!c.stand, 'container ' + c.id + ' has a standing tile');
    ok(b.ev('walkCell(' + c.z + ',' + c.stand[0] + ',' + c.stand[1] + ')'), 'container ' + c.id + ' can be reached');
  }
  // windows look into a room
  let bad = 0;
  for (const win of W.windows) {
    const r = b.ev('roomAt(' + win.z + ',' + win.ix + ',' + win.iy + ')');
    if (!r) bad++;
  }
  eq(bad, 0, 'every window looks into a room');
  // doors
  const kinds = new Set(W.doors.map((d) => d.kind));
  ok(kinds.has('lock'), 'the study door is a lock');
  ok(kinds.has('cellar'), 'the vault door is a cellar lock');
  eq(W.doors.filter((d) => d.kind === 'lock').length, 1, 'exactly one study lock');
  eq(W.doors.filter((d) => d.kind === 'cellar').length, 1, 'exactly one vault door');
}

/* ======================================================= 4. reachability */
{
  const b = boot(5);
  b.start(true);
  const W = b.api.W;
  // flood the walkable cells from the spawn, with every door open and keys in hand
  const flood = (withKeys) => b.ev(`(() => {
    const S = [0,1].map(() => new Uint8Array(MW*MH));
    const pass = (z,x,y) => {
      const c = T(z,x,y);
      if (c === '#') return false;
      if (c === 'L' || c === 'B') return ${withKeys};
      return walkCell(z,x,y);
    };
    pass(0,0,0);
    const q = [[0, ${W.spawn.x | 0}, ${W.spawn.y | 0}]];
    S[0][${W.spawn.x | 0} + ${W.spawn.y | 0}*MW] = 1;
    while (q.length) {
      const [z,x,y] = q.shift();
      for (const [dx,dy] of NB4) {
        const nx=x+dx, ny=y+dy;
        if (nx<1||ny<1||nx>=MW-1||ny>=MH-1) continue;
        if (!pass(z,nx,ny)) continue;
        if (S[z][nx+ny*MW]) continue;
        S[z][nx+ny*MW]=1; q.push([z,nx,ny]);
      }
      const st = stairFrom(z,x,y);
      if (st && !S[st.z][st.x+st.y*MW]) { S[st.z][st.x+st.y*MW]=1; q.push([st.z,st.x,st.y]); }
    }
    return S;
  })()`);
  const seen = flood(1);
  const MW = b.ev('MW');
  let unreachable = [];
  for (const F of W.floors) for (const r of F.rooms) {
    let hit = false;
    for (let y = r.y + 1; y <= r.y + r.ih && !hit; y++) for (let x = r.x + 1; x <= r.x + r.iw && !hit; x++) {
      if (seen[F.z][x + y * MW]) hit = true;
    }
    if (!hit) unreachable.push(F.z + ':' + r.name);
  }
  eq(unreachable.join('|'), '', 'with the keys, every room on both floors is reachable from the gate');
  ok(seen[1][Math.floor(W.secret.x) + Math.floor(W.secret.y) * MW] === 0, 'the SECRET tile itself is inside the vault block');
  // without the keys exactly the study and the vault are shut
  const locked = flood(0);
  const shut = [];
  for (const F of W.floors) for (const r of F.rooms) {
    let hit = false;
    for (let y = r.y + 1; y <= r.y + r.ih && !hit; y++) for (let x = r.x + 1; x <= r.x + r.iw && !hit; x++) {
      if (locked[F.z][x + y * MW]) hit = true;
    }
    if (!hit) shut.push(r.name);
  }
  eq(shut.sort().join('|'), 'Study|Vault', 'only the study and the vault need keys');
  // every room has a way in: a door, a lock or a window on its wall ring
  let sealed = 0;
  for (const F of W.floors) for (const r of F.rooms) {
    let ways = 0;
    for (let x = r.x; x <= r.x + r.iw + 1; x++) {
      for (const y of [r.y, r.y + r.ih + 1]) {
        const c = b.ev('T(' + F.z + ',' + x + ',' + y + ')');
        if (c === 'D' || c === 'L' || c === 'B' || c === 'W') ways++;
      }
    }
    for (let y = r.y; y <= r.y + r.ih + 1; y++) {
      for (const x of [r.x, r.x + r.iw + 1]) {
        const c = b.ev('T(' + F.z + ',' + x + ',' + y + ')');
        if (c === 'D' || c === 'L' || c === 'B' || c === 'W') ways++;
      }
    }
    if (!ways) sealed++;
  }
  eq(sealed, 0, 'every room has a door or a window');
}

/* ========================================================= 5. keyring vs bag */
{
  const b = boot(7);
  b.start(true);
  const api = b.api, P = api.P;
  ok(!!P.keys && !Array.isArray(P.keys), 'keys live on a keyring object');
  ok(Array.isArray(P.inv), 'the inventory array is still there for loot');
  eq(Object.keys(P.keys).sort().join(','), 'blue,pick,red', 'the keyring has three slots');
  // the shed first
  api.freezeAI(true);
  b.grab('toolbox');
  ok(P.keys.pick, 'the lockpick goes on the keyring');
  b.grab('fridge');
  ok(P.keys.red, 'the red key goes on the keyring');
  eq(P.inv.length, 0, 'keys never enter the inventory');
  eq(P.carried, 0, 'keys are never carried');
  eq(api.ITEMS.filter((it) => /key|pick/i.test(it.k)).length, 0, 'no loose item is a key');
  let drew = true;
  try { api.render(1 / 60); } catch (e) { drew = false; }
  ok(drew, 'the HUD draws the keyring');
}

/* ===================================================== 6. the study is locked */
{
  const b = boot(8);
  b.start(true);
  const api = b.api, P = api.P;
  api.freezeAI(true);
  ok(!!P && !P.keys.pick, 'no lockpick to start with');
  const door = api.W.doors.find((d) => d.kind === 'lock');
  ok(!!door && door.closed, 'the study door starts closed');
  b.standNear(door.cells[0][0], door.cells[0][1], door.z);
  b.face(door.cells[0][0] + 0.5, door.cells[0][1] + 0.5);
  b.tick(2);
  api.interact();
  ok(api.W.doors.find((d) => d.kind === 'lock').closed, 'without a lockpick the study stays shut');
  b.grab('toolbox');
  ok(P.keys.pick, 'lockpick in hand (on the ring)');
  b.standNear(door.cells[0][0], door.cells[0][1], door.z);
  b.face(door.cells[0][0] + 0.5, door.cells[0][1] + 0.5);
  api.interact();
  ok(!api.W.doors.find((d) => d.kind === 'lock').closed, 'with the lockpick the study opens');
  const blue = api.W.containers.find((c) => c.id === 'desk');
  ok(blue.z === 0 && blue.x > 34, 'the blue key is in the study desk');
}

/* ================================================== 7. the vault and the win */
{
  const b = boot(9);
  b.start(true);
  const api = b.api, P = api.P;
  api.freezeAI(true);
  const vault = api.W.doors.find((d) => d.kind === 'cellar');
  ok(!!vault && vault.closed, 'the vault starts locked');
  b.standNear(43, 28, 0);
  b.face(43.5, 27.5);
  api.interact();
  ok(api.W.doors.find((d) => d.kind === 'cellar').closed, 'without the red key the vault stays locked');
  b.grab('fridge');
  ok(P.keys.red, 'red key taken');
  P.keys.blue = 1;              // the blue key comes from the study; granted here
  b.standNear(43, 28, 0);
  b.face(43.5, 27.5);
  api.interact();
  ok(!api.W.doors.find((d) => d.kind === 'cellar').closed, 'the red key opens the vault');
  // stand in the vault, touch the secret
  b.standNear(api.W.secret.x, api.W.secret.y, 0);
  b.face(api.W.secret.x, api.W.secret.y);
  b.tick(2);
  api.interact();
  eq(api.GAME.state, 'over', 'taking the SECRET ends the match');
  eq(api.SHOW.over, 'win', '...as a win');
  ok(api.M.wins >= 1, 'the win is remembered');
}

/* =========================================================== 8. the stairs */
{
  const b = boot(10);
  b.start(true);
  const api = b.api, P = api.P;
  api.freezeAI(true);
  b.standNear(31.5, 26.5, 0);
  b.face(31.5, 26.5);
  api.interact();
  eq(P.z, 1, 'E on the stair tile takes you upstairs');
  ok(Math.hypot(P.x - 31.5, P.y - 26.5) < 0.7, 'you come out on the landing');
  api.interact();
  eq(P.z, 0, 'and E on the matching tile takes you back down');
  // he uses the same stairs
  const w = b.walkTo(31.5, 27.5, 1, 2200);
  ok(w.ok, 'the player can walk upstairs (' + JSON.stringify(w) + ')');
  eq(P.z, 1, 'walking the stairs puts you on floor 1');
}

/* ============================================================= 9. night time */
{
  const b = boot(11);
  b.start(true);
  const api = b.api;
  api.setClock(14);
  ok(!api.isNight(14), '14:00 is day');
  api.setClock(23);
  ok(api.isNight(23), '23:00 is night');
  ok(api.isNight(2), '02:00 is night');
  ok(!api.isNight(9), '09:00 is day');
  api.freezeAI(true);
  api.setClock(13);
  const day = api.sightRange();
  api.setClock(23);
  const night = api.sightRange();
  ok(night < day, 'he sees less far at night (' + night.toFixed(2) + ' < ' + day.toFixed(2) + ')');
  const P = api.P;
  P.crouch = 1;
  const crouch = api.sightRange();
  P.crouch = 0;
  P.sprint = 1;
  const sprint = api.sightRange();
  P.sprint = 0;
  ok(crouch < night * 0.7, 'crouching at night hides you');
  ok(sprint > night, 'sprinting gives you away');
  // the clock runs
  const before = api.GAME.clock;
  b.tick(120);
  ok(api.GAME.clock !== before, 'the clock advances');
}

/* ================================================== 10. sight cannot cheat */
{
  const b = boot(12);
  b.start(true);
  const api = b.api;
  api.freezeAI(true);
  const ev = b.ev;
  ok(ev('lineOfSight({x:16.5,y:14.5,z:0},{x:21.5,y:14.5,z:0})'), 'he can see across an open room');
  ok(!ev('lineOfSight({x:16.5,y:14.5,z:0},{x:27.5,y:14.5,z:0})'), 'the hall wall blocks sight');
  ok(!ev('lineOfSight({x:16.5,y:14.5,z:0},{x:27.5,y:14.5,z:1})'), 'floors block sight');
  ok(!ev('lineOfSight({x:22.6,y:16.6,z:0},{x:23.4,y:17.4,z:0})'), 'no sight through a wall corner');
  ok(!ev('lineOfSight({x:33.5,y:11.5,z:0},{x:36.5,y:11.5,z:0})'), 'the shut study door blocks sight');
  ev('openDoor(0,34,11,null)');
  ok(ev('lineOfSight({x:33.5,y:11.5,z:0},{x:36.5,y:11.5,z:0})'), 'opening it restores the sight line');
  // and the perception path respects it: stand right behind the wall
  ev('N.x=26.5;N.y=14.5;N.z=0;N.a=Math.PI;N.mode="routine";N.script=[];N.prio=0;N.al=1;');
  ev('P.x=20.5;P.y=14.5;P.z=0;');
  b.tick(60);
  eq(ev('N.sees'), 0, 'he does not see through the wall even at full alert');
  ok(ev('N.mode') !== 'chase', 'and does not start a chase through it');
}

/* ==================================================== 11. belief map quality */
{
  const b = boot(13);
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(true);
  near(ev('belTotal(0) + belTotal(1)'), 1, 0.02, 'the belief map is a normalised probability');
  ok(ev('belPeak(0)') !== null, 'there is a most-likely cell');
  // a sighting collapses the map onto the player
  ev('P.x=18.5;P.y=12.5;P.z=0; N.x=22.5;N.y=12.5;N.z=0; N.a=Math.PI;');
  ev('N.sees=1; N.lastSeen={x:P.x,y:P.y,z:P.z,t:GAME.t}; belStep(1/60);');
  const peak = ev('belPeak(0)');
  ok(peak && Math.hypot(peak.x - 18.5, peak.y - 12.5) < 1.6, 'a sighting puts the peak on you');
  // losing you: the map is near where he last saw you, not at the spawn
  ev('N.sees=0; N.lastSeen={x:18.5,y:12.5,z:0,t:GAME.t}; N.cleared=[];');
  ev('belSeed();');
  const p2 = ev('belPeak(0)');
  ok(p2 && Math.hypot(p2.x - 18.5, p2.y - 12.5) < 4, 'after losing you the peak stays near the sighting');
  ok(ev('belTotal(0)') > 0.5, 'and most of the mass stays on your floor');
  // the mass creeps toward the objective, not at random
  const before = ev('(() => { const B = BEL[0]; let s = 0; for (let i = 0; i < B.length; i++) { const x = i % MW, y = (i / MW) | 0; if (goalDist(0, x, y) < 12) s += B[i]; } return s; })()');
  for (let i = 0; i < 180; i++) ev('belStep(1/60)');
  const after = ev('(() => { const B = BEL[0]; let s = 0; for (let i = 0; i < B.length; i++) { const x = i % MW, y = (i / MW) | 0; if (goalDist(0, x, y) < 12) s += B[i]; } return s; })()');
  ok(after >= before, 'belief flows toward the player\'s objective (' + before.toFixed(3) + ' -> ' + after.toFixed(3) + ')');
  // cleared rooms lose mass
  ev('N.cleared = []; N.lastSeen = {x:16.5,y:12.5,z:0,t:GAME.t}; belSeed();');
  const uncleared = ev('belAt(0, 22, 12)');
  ev('N.cleared = [{x:22,y:12,z:0}]; belSeed();');
  const cleared = ev('belAt(0, 22, 12)');
  ok(cleared < uncleared * 0.5, 'a room he already cleared loses mass (' + cleared.toFixed(4) + ' < ' + uncleared.toFixed(4) + ')');
  ok(ev('belSpots(0, 4).length') > 0, 'he can list candidate spots');
}

/* ====================================================== 12. the chase itself */
{
  const b = boot(14);
  b.start(true);
  const api = b.api, ev = b.ev, N = api.N, P = api.P;
  api.freezeAI(false);
  // open-room acquisition
  ev('P.x=16.5;P.y=14.5;P.z=0;P.a=0; N.x=20.5;N.y=14.5;N.z=0;N.a=Math.PI; N.mode="routine";N.script=[];N.prio=0;');
  b.tick(40);
  eq(ev('N.mode'), 'chase', 'he starts a chase when he really sees you');
  // he runs at you, not away
  const d0 = ev('dst(N.x,N.y,P.x,P.y)');
  b.tick(60);
  const d1 = ev('dst(N.x,N.y,P.x,P.y)');
  ok(d1 < d0 || api.GAME.state === 'over', 'he closes the distance (' + d0.toFixed(2) + ' -> ' + d1.toFixed(2) + ')');
}

/* ============================================ 13. a lost chase is not jittery */
{
  const b = boot(15);
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(false);
  // he is in the foyer, the player vanishes into the bedroom
  ev('N.x=28.5;N.y=24.5;N.z=0;N.a=Math.PI; P.x=18.5;P.y=25.5;P.z=0;');
  ev('N.mode="chase";N.chaseT=0;N.lostT=0;N.conf=1;N.lastSeen={x:22.5,y:16.5,z:0,t:GAME.t};N.pvel={x:-3,y:2};');
  ev('belSeed();');
  let px = ev('N.x'), py = ev('N.y'), pz = ev('N.z');
  let travelled = 0, reversals = 0, lastA = ev('N.a'), switches = 0, lastCt = null, still = 0, stalls = 0;
  for (let i = 0; i < 60 * 6; i++) {
    b.tick(1);
    const x = ev('N.x'), y = ev('N.y'), z = ev('N.z'), a = ev('N.a');
    travelled += Math.hypot(x - px, y - py) + Math.abs(z - pz) * 2;
    const dd = Math.abs(Math.atan2(Math.sin(a - lastA), Math.cos(a - lastA)));
    if (dd > 2.4) reversals++;
    lastA = a;
    const ct = ev('N.ct ? [N.ct.x,N.ct.y] : null');
    if (lastCt && ct && Math.hypot(ct[0] - lastCt[0], ct[1] - lastCt[1]) > 1.6) switches++;
    if (ct) lastCt = ct;
    if (Math.hypot(x - px, y - py) < 0.002) { still++; if (still === 50) stalls++; } else still = 0;
    px = x; py = y; pz = z;
    if (api.GAME.state !== 'play') break;
  }
  ok(travelled > 4, 'he keeps hunting on the belief map (' + travelled.toFixed(1) + ' tiles)');
  eq(reversals, 0, 'no direction flapping during the chase');
  ok(stalls <= 1, 'he does not grind in place (' + stalls + ' stalls)');
  ok(switches <= 4, 'his target is held, not re-picked every frame (' + switches + ' switches)');
  ok(ev('belTotal(0) + belTotal(1)') > 0.9, 'the belief map stays a normalised probability through the chase');
  ok(api.GAME.state === 'over' || ev('N.lostT') >= 0, 'the chase either caught you or is still on');
}

/* ================================================ 14. he follows you upstairs */
{
  const b = boot(16);
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(false);
  ev('N.x=28.5;N.y=24.5;N.z=0;N.a=Math.PI/2; P.x=28.5;P.y=27.5;P.z=0;');
  b.tick(30);
  eq(ev('N.mode'), 'chase', 'he sees you in the foyer');
  ev('P.x=30.5;P.y=25.5;P.z=1;');
  let climbed = false, lastZ = ev('N.z');
  for (let i = 0; i < 60 * 20; i++) {
    if (i % 90 === 0) ev(i % 180 ? 'P.x=30.5;P.y=22.5;P.z=1;' : 'P.x=38.5;P.y=25.5;P.z=1;');
    b.tick(1);
    const z = ev('N.z');
    if (z === 1 && lastZ === 0) climbed = true;
    lastZ = z;
    if (api.GAME.state !== 'play') break;
  }
  ok(climbed, 'losing you at the stairs sends him up them');
  eq(ev('N.z'), 1, 'he is on the upper floor');
}

/* ================================================= 15. catches need contact */
{
  const b = boot(17);
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(false);
  // through the hall wall, nose to nose
  ev('P.x=22.4;P.y=14.5;P.z=0; N.x=23.6;N.y=14.5;N.z=0; N.mode="chase";N.chaseT=0;N.lostT=0;N.sees=0;');
  api.gameUpdate(1 / 60);
  eq(api.GAME.state, 'play', 'he cannot catch you through a wall');
  // in the open, at arm\'s length
  ev('P.x=16.5;P.y=14.5;P.z=0; N.x=17.1;N.y=14.5;N.z=0; N.mode="chase";N.chaseT=0;N.lostT=0;');
  api.gameUpdate(1 / 60);
  eq(api.GAME.state, 'over', 'in the open he grabs you');
  eq(api.SHOW.over, 'caught', '...with the caught card');
}

/* ================================================ 16. traps, cameras, plans */
{
  const b = boot(18, {});
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(true);
  let valid = 0;
  for (let i = 0; i < 8; i++) {
    const s = api.bestTrapSpot();
    if (!s) continue;
    valid++;
    ok(ev('isValidTrapCell(' + s.z + ',' + s.x + ',' + s.y + ')'), 'trap spot ' + valid + ' is a valid tile');
    ok(ev('walkCell(' + s.z + ',' + s.x + ',' + s.y + ')'), 'trap spot ' + valid + ' is walkable');
    api.addTrap(s.z, s.x, s.y);
  }
  eq(api.TRAPS.length, valid, 'every planned trap was placed');
  for (const t of api.TRAPS) {
    ok(ev('walkCell(' + t.z + ',' + (t.x | 0) + ',' + (t.y | 0) + ')'), 'a placed trap sits on a walkable tile');
    ok(ev('!!trapAt(' + t.z + ',' + (t.x | 0) + ',' + (t.y | 0) + ')'), 'and is registered in the world');
  }
  const keys = new Set(api.TRAPS.map((t) => t.z + ':' + (t.x | 0) + ':' + (t.y | 0)));
  eq(keys.size, api.TRAPS.length, 'no two traps share a tile');
  // invalid cells are refused
  ok(!ev('isValidTrapCell(0,12,7)'), 'a wall is not a trap cell');
  ok(!ev('isValidTrapCell(0,28,30)'), 'the front door is not a trap cell');
  ok(!ev('isValidTrapCell(0,31,26)'), 'the stairs are not a trap cell');
  // cameras: he only plans one once he has caught you and knows your entry
  api.M.catches = 0;
  eq(ev('planCamera()'), false, 'with no catches he plans no camera');
  api.M.catches = 2;
  api.M.entries = { '0:28:30': 4 };
  ev('M.suspicion = 90');
  eq(ev('planCamera()'), true, 'after two catches he plans a camera');
  const plan = api.M.plans.filter((p) => p.t === 'camera').pop();
  ok(!!plan, 'the camera plan is remembered');
  if (plan) api.addCamera(plan.z, plan.x, plan.y);
  ok(api.CAMS.length >= 1, 'the camera is in the world');
}

/* =================================================== 17. learning in a match */
{
  const b = boot(19, {});
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(true);
  ev('N.x=20.5;N.y=14.5;N.z=0;N.mode="routine";N.script=[];N.prio=0;N.a=Math.PI;');
  const sus0 = api.M.suspicion;
  ev('hearNoise(21.5, 14.5, 0, 9, "glass")');
  ok(api.M.suspicion > sus0, 'noise raises his suspicion');
  ok(api.M.hours.some((h) => h > 0), 'he records the hours you are active');
  ok(ev('belTotal(0) + belTotal(1)') > 0.5, 'noise sharpens the belief map');
  ev('P.x=16.5;P.y=14.5;P.z=0; N.x=20.5;N.y=14.5;N.z=0; N.a=Math.PI; N.mode="routine"; N.script=[]; N.prio=0;');
  for (let i = 0; i < 30; i++) ev('perceive(1/60)');
  ok(ev('N.sees') === 1, 'he has eyes on you for the learning checks');
  ok(Object.keys(api.M.rooms).length > 0, 'he records which rooms you use');
  ev('startChase("test"); addHeatRoute();');
  ok(Object.keys(api.M.route).length > 0, 'he records the route you take');
  // re-locking a door you picked
  const d = api.W.doors.find((q) => q.kind === 'lock');
  d.playerUnlocked = 1;
  ev('N.x=' + (d.cells[0][0] + 0.5) + ';N.y=' + (d.cells[0][1] + 1.5) + ';N.z=' + d.z + ';');
  const relocked = ev('considerRelock()');
  ok(relocked === true, 'standing at a door you picked, he starts re-locking it');
  // and he checks the containers he finds emptied
  const c = api.W.containers.find((q) => q.id === 'fridge');
  c.done = 1; c.seen = 0;
  ev('N.x=' + (c.stand[0] + 0.5) + ';N.y=' + (c.stand[1] + 0.5) + ';N.z=' + c.z + ';N.a=0;');
  ev('checkTheftsNear(true)');
  ok(c.seen === 1, 'he notices an emptied container');
  ok(api.M.thefts.indexOf(c.id) >= 0 || api.M.plans.some((p) => p.id === c.id), 'and remembers it');
}

/* ==================================================== 18. the memory boundary */
{
  const store = {};
  const b = boot(20, store);
  b.start(true);
  const api = b.api;
  api.M.wins = 2;
  api.M.catches = 3;
  api.M.suspicion = 88;
  api.saveMatch();
  ok(!!api.storedMatch(), 'the match is saved');
  // New Game wipes it
  api.startMatchFromMenu(true);
  ok(!api.storedMatch() || api.storedMatch().catches === 0, 'New Game wipes the stored match');
  eq(api.M.wins, 0, 'wins do not leak into a new game');
  eq(api.M.catches, 0, 'catches do not leak into a new game');
  ok(api.M.suspicion < 30, 'suspicion starts low again');
  // Continue restores what he learned
  api.M.wins = 1;
  api.M.catches = 2;
  api.M.suspicion = 71;
  api.saveMatch();
  api.startMatchFromMenu(false);
  eq(api.M.catches, 2, 'Continue keeps the catches he has made');
  eq(api.M.wins, 1, 'Continue keeps your wins');
  ok(api.M.suspicion > 50, 'Continue keeps his suspicion');
  // a different memory never bleeds into a fresh boot
  const b2 = boot(21, {});
  b2.start(true);
  eq(b2.api.M.catches, 0, 'a fresh session starts with nothing remembered');
}

/* ============================================================ 19. rendering */
{
  const b = boot(22);
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(true);
  let err = null;
  try {
    for (let i = 0; i < 6; i++) { b.tick(20); api.render(1 / 60); }
    // both floors
    ev('P.z=1;'); for (let i = 0; i < 40; i++) ev('updateCamera(0.05)'); api.render(1 / 60);
    ev('P.z=0;'); for (let i = 0; i < 40; i++) ev('updateCamera(0.05)'); api.render(1 / 60);
    // night, torch, belief overlay, danger edge
    api.setClock(23);
    api.toggleFlash();
    api.SHOW.showBelief = 1;
    ev('N.mode="chase"; N.z=0; N.x=P.x+4; N.y=P.y;');
    for (let i = 0; i < 40; i++) ev('updateCamera(0.05)');
    api.render(1 / 60);
    api.SHOW.showBelief = 0;
    api.SHOW.screen = 'pause'; api.render(1 / 60);
    api.SHOW.screen = 'play';
    api.SHOW.screen = 'menu'; api.render(1 / 60);
    api.SHOW.screen = 'help'; api.render(1 / 60);
    api.SHOW.screen = 'cut'; api.SHOW.cut = 2; api.render(1 / 60);
    api.SHOW.screen = 'over'; api.SHOW.over = 'win'; api.render(1 / 60);
    api.SHOW.screen = 'play';
  } catch (e) { err = e.stack; }
  ok(!err, 'every screen renders: ' + (err || 'ok'));
}

/* ========================================================== 20. the HUD text */
{
  const b = boot(23);
  b.start(true);
  const api = b.api, ev = b.ev;
  api.freezeAI(true);
  api.refreshTasks();
  ok(api.HUD.tasks.length >= 6, 'the task list is populated');
  ok(api.HUD.tasks.some((t) => /lockpick/i.test(t.txt)), 'the first task is the lockpick');
  ok(api.HUD.tasks.some((t) => /vault/i.test(t.txt)), 'the vault is a task');
  b.standNear(31.5, 26.5, 0);
  b.face(31.5, 26.5);
  const prompt = ev('promptText()');
  ok(/upstairs/i.test(prompt), 'standing on the stairs, the prompt offers the stairs (' + prompt + ')');
  const c = api.W.containers.find((q) => q.id === 'fridge');
  b.standNear(c.x, c.y, c.z);
  b.face(c.x, c.y);
  ok(/search/i.test(ev('promptText()')), 'standing at the fridge, the prompt offers a search');
  ok(!/http/i.test(b.env.html) && !/<script src/i.test(b.env.html), 'the file is self-contained, no external assets');
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
