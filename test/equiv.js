'use strict';
/* Equivalence test: is build B the same game as build A?
 *
 *   node test/equiv.js <fileA> <fileB> [seeds]
 *
 * Each file is loaded in its own process (fresh globals), driven through the same
 * scripted session, and fingerprinted. A fingerprint covers:
 *   - every 2D canvas call and style assignment (identical args == identical pixels)
 *   - the map, furniture, items, doors and PCG metadata for many seeds
 *   - the 3D vertex buffers for those seeds
 *   - HUD / inventory / message text after each step
 *   - the thrown projectile and the neighbour's state over time
 * The two fingerprints must match exactly, or this exits non-zero and prints the first
 * difference.
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');

const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function transcript(file, seeds) {
  /* the game is allowed to be nondeterministic (Math.random in the AI, Date.now in
     timers); the comparison must not be, so both runs get the same clock and the same
     random stream — then any difference is a real difference in the code */
  let n = 0;
  let a = 0xC0FFEE ^ 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const base = 1700000000000;
  Date.now = () => base + (n += 1);

  const { loadGame } = require('./harness');
  const H = loadGame(file);
  const g = H.g;
  const out = { build: g.BUILD, steps: {}, seeds: [] };

  const withRec = (label, fn) => {
    global.__REC = [];
    try { fn(); } finally {
      out.steps[label] = h(global.__REC.join('\n')) + ':' + global.__REC.length;
      global.__REC = null;
    }
  };

  const hud = () => ['hud', 'dbg', 'inv', 'msg', 'viewchip', 'ovt']
    .map(id => (H.els[id] ? (H.els[id].textContent || '') + '|' + (H.els[id].innerHTML || '') : ''))
    .join('~');

  g.start();
  withRec('boot-frames', () => H.pump(120));
  out.steps.bootHud = h(hud());

  /* walk, sprint, crouch, look — the 2D renderer must draw the same thing */
  withRec('walk', () => {
    H.dispatch('keydown', { key: 'w' }); H.pump(40);
    H.dispatch('keydown', { key: 'Shift' }); H.pump(30);
    H.dispatch('keyup', { key: 'Shift' }); H.dispatch('keydown', { key: 'c' }); H.pump(30);
    H.dispatch('keyup', { key: 'c' }); H.dispatch('keyup', { key: 'w' });
    H.dispatch('mousemove', { movementX: 40, movementY: 5 }); H.pump(20);
  });
  out.steps.walkHud = h(hud() + JSON.stringify([g.P.x, g.P.y, g.P.aim]));

  /* pick something up, then throw it with the mouse */
  const item = g.ITEMS[0];
  g.P.x = item.x; g.P.y = item.y;
  withRec('pickup', () => {
    for (let i = 0; i < 40 && !g.P.inv[g.P.sel]; i++) { H.dispatch('keydown', { key: 'e' }); H.pump(2); }
    H.dispatch('keyup', { key: 'e' });
  });
  out.steps.pickupHud = h(hud() + JSON.stringify(g.P.inv));
  withRec('throw', () => {
    H.dispatch('mousedown', { button: 0 });
    H.pump(20);
  });
  out.steps.throwHud = h(hud() + JSON.stringify(g.PR.map(p => [p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3)])));

  /* 3D: the vertex buffers for this estate */
  withRec('3d', () => { H.key('v'); H.pump(30); });
  const mesh = arr => h(Buffer.from(arr.buffer, arr.byteOffset, Math.min(arr.byteLength, 4000000)).toString('base64'));
  out.steps.mesh3d = [g.SM.n, g.SM.a.length, mesh(g.SM.a)].join(':');
  const glStats = (() => {
    try { return JSON.stringify(g.gl.gl.__stats); } catch (e) { return 'n/a'; }
  })();
  out.steps.glStats = h(glStats);
  out.steps.hud3d = h(hud());
  withRec('3d-frames', () => H.pump(40));
  /* the dynamic layer: figures, decals, dust, thrown objects, X-ray overlays */
  out.steps.mesh3dDynamic = [g.DM.n, g.TM.n, mesh(g.DM.a), mesh(g.TM.a)].join(':');
  out.steps.glStatsFrames = h(glStats);
  H.key('v'); H.pump(10);
  out.steps.after3d = h(hud() + JSON.stringify([g.P.x, g.P.y, g.N.x, g.N.y, g.N.st]));

  /* every seed: map, furniture, items, goals, meshes */
  for (let seed = 1; seed <= seeds; seed++) {
    let row;
    try {
      g.makePCGMap(seed);
      g.resetPlayer(); g.resetN(); g.pickTask();
      const G = g.G.map(r => r.join('')).join('/');
      const p = g.PCG;
      const pcg = JSON.stringify({
        rooms: p.rooms, goals: p.goals, spawn: p.spawn, npc: p.npcSpawn,
        estate: p.estate, layouts: p.layouts, furnishings: p.furnishings,
        doors: p.doorsBuilt, cuts: p.partitions, yard: p.yardFeatures,
        seed: p.seed, active: p.active,
      });
      g.buildStaticWorld();
      const m = [g.SM.n, mesh(g.SM.a), h(JSON.stringify(g.FU)), h(JSON.stringify(g.ITEMS.map(i => [i.k, i.x, i.y])))].join(':');
      const npc0 = [g.N.x, g.N.y];
      H.pump(60);
      row = [seed, h(G), h(pcg), m, g.N.x !== npc0[0] || g.N.y !== npc0[1]].join('|');
    } catch (e) {
      row = seed + '|THREW|' + e.message.slice(0, 80);
    }
    out.seeds.push(row);
  }

  g.restoreBaseMap();
  out.restored = h(g.G.map(r => r.join('')).join('/') + JSON.stringify(g.FU) + JSON.stringify(g.PCG.rooms));
  out.problems = H.problems.slice(0, 5);
  return out;
}

if (require.main === module) {
  const [a, b] = process.argv.slice(2);
  const seeds = parseInt(process.argv[4] || '60', 10);
  if (!a || !b) { console.error('usage: node test/equiv.js <fileA> <fileB> [seeds]'); process.exit(2); }
  const self = path.resolve(__filename);
  const runOne = f => execFileSync(process.execPath,
    ['-e', `process.argv[2]=${JSON.stringify(f)};process.argv[3]=${seeds};` +
      `const m=require(${JSON.stringify(self)});console.log(JSON.stringify(m.transcript(${JSON.stringify(f)},${seeds})))`],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

  const A = JSON.parse(runOne(a));
  const B = JSON.parse(runOne(b));
  let bad = 0;
  const diff = (label, x, y) => {
    if (JSON.stringify(x) === JSON.stringify(y)) { console.log(`  ok   ${label}`); return; }
    bad++;
    console.log(`  DIFF ${label}\n        A=${JSON.stringify(x).slice(0, 300)}\n        B=${JSON.stringify(y).slice(0, 300)}`);
  };
  console.log(`A = ${a}  (BUILD ${A.build})`);
  console.log(`B = ${b}  (BUILD ${B.build})`);
  diff('build stamp', A.build, B.build);
  for (const k of Object.keys(A.steps)) diff('step ' + k, A.steps[k], B.steps[k]);
  const n = Math.min(A.seeds.length, B.seeds.length);
  diff('seed count', A.seeds.length, B.seeds.length);
  let seedBad = 0;
  for (let i = 0; i < n; i++) if (A.seeds[i] !== B.seeds[i]) { seedBad++; if (seedBad <= 3) console.log(`  DIFF seed ${i + 1}\n        A=${A.seeds[i]}\n        B=${B.seeds[i]}`); }
  if (seedBad) { bad += seedBad; console.log(`  DIFF ${seedBad}/${n} seeds differ`); } else console.log(`  ok   ${n} seeds identical (map, furniture, goals, meshes)`);
  diff('restoreBaseMap', A.restored, B.restored);
  diff('harness problems', A.problems, B.problems);
  console.log(bad ? `\n${bad} DIFFERENCE(S)` : '\nIDENTICAL');
  process.exit(bad ? 1 : 0);
}

module.exports = { transcript };
