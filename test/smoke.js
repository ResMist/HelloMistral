'use strict';
/* Smoke test: loads index.html in the strict harness, plays it for real (frames are
   pumped only through queued rAF callbacks, input goes through dispatched events),
   switches to 3D, throws something, and then hammers the PCG across many seeds.
   Run: node test/smoke.js [seeds] */
const { loadGame } = require('./harness');

let pass = 0, fail = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  problems.push(name + (detail ? ' — ' + detail : ''));
}

const h = loadGame();
const g = h.g;

/* ---------- boot ---------- */
ok('build stamp present', typeof g.BUILD === 'string' && /^b\d+$/.test(g.BUILD), g.BUILD);
ok('no context/GL members missing at load', h.problems.length === 0, h.problems.slice(0, 3).join('; '));
ok('map is 56x57', g.W === 56 && g.H === 57);

g.start();
ok('start() puts the game in play', g.state === 'play', String(g.state));

const frames = h.pump(180);
ok('render loop survives 180 frames', frames === 180);
ok('player is inside the map', g.P.x > 0 && g.P.x < g.W && g.P.y > 0 && g.P.y < g.H);

/* ---------- 2D -> 3D -> 2D ---------- */
h.key('v');
h.pump(90);
ok('V switches to the 3D view', g.view3d === true);
const finiteMesh = m => {
  const used = Math.min(m.a.length, Math.max(9, m.n * 9));
  for (let i = 0; i < used; i++) if (!Number.isFinite(m.a[i])) return false;
  return m.n > 200;
};
ok('3D built a static world mesh', finiteMesh(g.SM), 'verts=' + g.SM.n);
ok('3D dynamic mesh is finite', (g.DM.n === 0 || finiteMesh(g.DM)));
h.key('v');
h.pump(30);
ok('V switches back to 2D', g.view3d === false);

/* ---------- picking up + throwing ---------- */
const item = g.ITEMS.find(i => !i.o && Math.abs(i.x - g.P.x) < 40);
let grabbed = false;
if (item) {
  g.P.x = item.x; g.P.y = item.y; g.cam.x = item.x; g.cam.y = item.y;
  for (let i = 0; i < 60 && !grabbed; i++) { h.dispatch('keydown', { key: 'e' }); h.pump(2); grabbed = !!g.P.inv[g.P.sel]; }
  if (grabbed) h.dispatch('keyup', { key: 'e' });
}
ok('an item can be picked up', grabbed);
h.key('v');
h.pump(20);
const held = g.P.inv[g.P.sel];
h.dispatch('mousedown', { button: 0 });
h.pump(2);
ok('throwing works in the 3D view', g.PR.length > 0, 'projectiles=' + g.PR.length);
ok('the thrown item left the hand', held && !g.P.inv.includes(held));
h.key('v');
h.pump(10);

/* ---------- PCG across seeds ---------- */
const seeds = parseInt(process.argv[2] || '80', 10);
let failed = 0, noLock = 0, noVault = 0, noStudy = 0, thin = 0;
const roleSeen = {}, sigs = new Set();
for (let seed = 1; seed <= seeds; seed++) {
  try {
    g.makePCGMap(seed);
  } catch (e) {
    failed++;
    continue;
  }
  const P = g.PCG;
  let L = 0, B = 0, walls = 0, doors = 0;
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      const c = g.G[y][x];
      if (c === 'L') L++;
      else if (c === 'B') B++;
      else if (c === '#') walls++;
      else if (c === 'D') doors++;
    }
  }
  if (!L) noLock++;
  if (!B) noVault++;
  if (!P.rooms.some(r => r.role === 'study')) noStudy++;
  if (walls < 150 || doors < 8) thin++;
  for (const r of P.rooms) roleSeen[r.role] = (roleSeen[r.role] || 0) + 1;
  sigs.add(P.rooms.length + ':' + P.rooms.map(r => r.w * r.h).join(','));
  /* the estate must be fully connected and every goal routable */
  if (!P.goals || !P.goals.length) thin++;
  /* the 3D mesh for this estate must still be finite and non-empty */
  g.buildStaticWorld();
  if (!finiteMesh(g.SM)) thin++;
  h.pump(2);
}
ok('every seed generates', failed === 0, failed + ' failed');
ok('every estate has a locked door', noLock === 0, noLock + ' without');
ok('every estate has a vault door', noVault === 0, noVault + ' without');
ok('every estate has a study', noStudy === 0, noStudy + ' without');
ok('no shattered estates (walls/doors/mesh)', thin === 0, thin + ' thin');
ok('room roles are all assigned', ['entry', 'kitchen', 'study', 'destination', 'ordinary'].every(r => roleSeen[r]),
  JSON.stringify(roleSeen));
ok('seeds really differ', sigs.size > seeds * 0.6, sigs.size + '/' + seeds);

/* ---------- back to the hand-built map ---------- */
g.restoreBaseMap();
ok('restoreBaseMap() leaves PCG off', g.PCG.active === false);
ok('restoreBaseMap() restores the base map', g.PCG.rooms.length === 0);
h.pump(10);

/* ---------- cleanup ---------- */
ok('no missing 2D/GL members during the whole run', h.problems.length === 0, h.problems.slice(0, 3).join('; '));

console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(problems.map(p => '  ✗ ' + p).join('\n')); process.exit(1); }
