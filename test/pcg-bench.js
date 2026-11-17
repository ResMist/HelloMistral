'use strict';
/* PCG benchmark: generates many seeds and reports the metrics that decide whether a
   generated estate is worth playing. Run with: node test/pcg-bench.js [count] */
const { loadGame } = require('./harness');

const N = parseInt(process.argv[2] || '120', 10);

function measure(g) {
  const P = g.PCG;
  let windows = 0, doors = 0, locked = 0, vault = 0, trees = 0, sheds = 0;
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      const c = g.G[y][x];
      if (c === 'W') windows++;
      else if (c === 'D') doors++;
      else if (c === 'L') locked++;
      else if (c === 'B') vault++;
      else if (c === 'S') sheds++;
    }
  }
  for (const f of g.FU) if (f[0] === 'tree') trees++;
  const areas = P.rooms.map(r => r.w * r.h);
  const roles = {};
  for (const r of P.rooms) roles[r.role] = (roles[r.role] || 0) + 1;
  const t = P.topology || {};
  return {
    rooms: P.rooms.length,
    furn: P.furnishings,
    doors: P.doorsBuilt,
    loops: t.loopCount || 0,
    yard: P.yardFeatures,
    windows, doorsTiles: doors, locked, vault, trees, solidProps: sheds,
    minRoom: areas.length ? Math.min(...areas) : 0,
    maxRoom: areas.length ? Math.max(...areas) : 0,
    spawnDist: Math.hypot(P.spawn[0] - P.npcSpawn[0], P.spawn[1] - P.npcSpawn[1]),
    roleOrdinary: roles.ordinary || 0,
    usedCapacity: P.rooms.filter(r => r.w >= 4 && r.h >= 4).length,
    walls: (() => { let n = 0; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.G[y][x] === '#') n++; return n; })(),
    vaultDoor: (() => { let n = 0; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) if (g.G[y][x] === 'B') n++; return n; })(),
    studyExits: (() => { const r = P.rooms.find(r => r.role === 'study'); return r ? r.exits : -1; })(),
    wing: P.estate && P.estate.house && P.estate.house.wing ? 1 : 0,
    garage: P.estate && P.estate.garage ? 1 : 0,
    /* the objective chain the player actually walks: door -> fridge -> study -> vault */
    chainDist: (() => {
      const path = (a, b) => g.findPath(a[0], a[1], b[0], b[1]).length;
      const gn = P.goals;
      if (!gn || gn.length < 4) return 0;
      return path(P.spawn, gn[0]) + path(gn[0], gn[1]) + path(gn[1], gn[3]);
    })(),
  };
}

function run() {
  const h = loadGame();
  const g = h.g;
  g.start();
  const rows = [];
  let failed = 0;
  const t0 = Date.now();

  for (let seed = 1; seed <= N; seed++) {
    try {
      g.makePCGMap(seed);
      rows.push(Object.assign({ seed }, measure(g)));
    } catch (e) {
      failed++;
      rows.push({ seed, fail: e.message.slice(0, 70) });
    }
  }
  const ok = rows.filter(r => !r.fail);
  const avg = k => ok.length ? ok.reduce((a, r) => a + r[k], 0) / ok.length : 0;
  const min = k => Math.min(...ok.map(r => r[k]));
  const max = k => Math.max(...ok.map(r => r[k]));
  const distinct = k => new Set(ok.map(r => r[k])).size;

  console.log(`seeds ${N} · failed ${failed} · ${((Date.now() - t0) / N).toFixed(1)} ms/estate`);
  console.log('metric        avg      min    max   distinct');
  for (const k of ['rooms', 'furn', 'walls', 'doors', 'loops', 'windows', 'doorsTiles', 'locked', 'vaultDoor',
    'studyExits', 'trees', 'yard', 'minRoom', 'maxRoom', 'spawnDist', 'chainDist', 'wing', 'garage']) {
    console.log('  ' + k.padEnd(12) + avg(k).toFixed(2).padStart(7) +
      String(min(k)).padStart(7) + String(max(k)).padStart(7) + String(distinct(k)).padStart(10));
  }
  const sig = r => `${r.rooms}/${r.furn}/${r.windows}/${r.locked}/${r.wing}`;
  console.log('  distinct layout signatures:', new Set(ok.map(sig)).size, 'of', ok.length);
  console.log('  roomless/empty estates:', ok.filter(r => r.rooms < 4).length);
  console.log('  barely-furnished (<8 pieces):', ok.filter(r => r.furn < 8).length);
  if (failed) console.log('  failures:', rows.filter(r => r.fail).slice(0, 5).map(r => r.seed + ': ' + r.fail).join(' | '));
  return rows;
}

if (require.main === module) run();
module.exports = { run };
