'use strict';
// test/game.js — headless checks for the single-file game (index.html).
// Run: node test/game.js
const path = require('path');
const harness = require('./harness');

const FILE = path.join(__dirname, '..', 'index.html');
let passed = 0, failed = 0;
const fails = [];

function check(name, ok, extra) {
  if (ok) passed++;
  else { failed++; fails.push(name + (extra ? ' — ' + extra : '')); }
}
function eq(name, got, want) {
  check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function near(name, got, want, tol) {
  check(name, Math.abs(got - want) <= (tol == null ? 0.5 : tol), 'got ' + got + ', want ' + want + ' ±' + (tol == null ? .5 : tol));
}
function boot(seed, store) {
  return harness.load({ file: FILE, seed: seed || 1, store: store || {} });
}
function run(g, seconds) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) g.tick(1 / 60);
}

/* ---------------------------------------------------------------- boot */
{
  const b = boot(1);
  check('boots without console warnings', b.warnings.length === 0, b.warnings.join(' | '));
  eq('starts on the menu', b.g.state, 'menu');
  check('menu offers PLAY and NEW GAME', b.g.OVBTNS.length === 2 && /PLAY/.test(b.g.OVBTNS[0].t));
  check('game exposes its debug handle', !!(b.g.P && b.g.N && b.g.FG));
  eq('two floors', b.g.FG.length, 2);
}
{
  const b = boot(3); const g = b.g;
  g.OVBTNS[0].fn();
  let guard = 0;
  while (g.state === 'cut' && guard++ < 10) g.OVBTNS[0].fn();
  for (let i = 0; i < 6; i++) b.pumpFrame(16.7 * (i + 1));
  check('the render loop draws a frame', !!b.els.hud && b.els.hud.innerHTML.length > 0, b.warnings.join(' | '));
  check('the HUD shows the keyring', /KEYRING/.test(b.els.keys.innerHTML));
  check('the objectives put the office before the fridge',
    b.els.hud.innerHTML.indexOf('upstairs office') < b.els.hud.innerHTML.indexOf('kitchen fridge'));
  check('the bag has four slots', (b.els.inv.innerHTML.match(/slot/g) || []).length >= 4);
}
{
  const b = boot(2);
  const g = b.g;
  g.OVBTNS[0].fn();
  eq('PLAY goes to the cutscene', g.state, 'cut');
  let guard = 0;
  while (g.state === 'cut' && guard++ < 10) g.OVBTNS[0].fn();
  eq('cutscene ends in the match', g.state, 'play');
  check('player starts outside the front gate', Math.abs(g.P.x - 28.5) < .01 && Math.abs(g.P.y - 37.5) < .01 && g.P.z === 0);
  check('neighbour starts in the foyer', Math.abs(g.N.x - 28.5) < .01 && Math.abs(g.N.y - 25.5) < .01 && g.N.z === 0);
}

/* ---------------------------------------------------------------- map */
{
  const b = boot(3); const g = b.g; g.start();
  eq('ground stairs', g.T(31, 27, 0), 'U');
  eq('upstairs stairs', g.T(31, 27, 1), 'V');
  eq('upstairs office', g.roomByName('Home Office').z, 1);
  eq('blue key is upstairs', g.CT.find(c => c.id === 'odesk').z, 1);
  eq('ground has a different 46,26', g.roomOf(46, 26, 0), 'Vault');
  eq('upstairs 46,26 is outside', g.roomOf(46, 26, 1), 'Roof');
  check('office is behind a locked door', g.T(34, 10, 1) === 'L');
  check('upstairs path reaches the office', g.findPath(31.5, 26.5, 37.5, 11.5, 1).length > 2);
  eq('ground cannot be walked as upstairs', g.npass(31, 27, 0), true);
  eq('upstairs bedroom wall blocks', g.npass(15, 17, 1), false);
}
{
  const b = boot(4); const g = b.g; g.start();
  // walk south onto the stair tile
  g.P.x = 31.5; g.P.y = 25.6; g.P.z = 0; g.keys.s = 1;
  run(g, .8);
  g.keys.s = 0;
  eq('walking onto the stairs goes up', g.P.z, 1);
  g.P.stairT = 0; g.P.lastCell = '';
  g.useStairs();
  eq('E takes you back down', g.P.z, 0);
  // the AI can change floor through the same stairwell
  g.P.x = 28.5; g.P.y = 37.5; g.P.z = 0; g.P.hide = null;
  g.N.x = 31.5; g.N.y = 26.5; g.N.z = 0; g.N.path = []; g.N.repath = 1;
  g.N.mode = 'idle'; g.N.al = 0; g.N.searchT = 0;
  g.run('search_scan', {}, 0);
  g.N.script = [{ go: [31.5, 27.5, 1] }]; g.N.si = 0; g.N.repath = 0; g.N.pathGoal = null;
  let up = false, swaps = 0, was = g.N.z;
  for (let i = 0; i < 60 * 10; i++) {
    g.tick(1 / 60);
    if (g.N.z !== was) { swaps++; was = g.N.z; }
    if (g.N.z === 1) up = true;
  }
  check('neighbour uses the stairs', up);
  check('and does not ping-pong between floors', swaps <= 6, swaps + ' swaps in 10s');
}
{
  const b = boot(5); const g = b.g; g.start();
  g.P.x = 28.5; g.P.y = 27.5; g.P.z = 0;
  g.N.x = 28.5; g.N.y = 25.5; g.N.z = 1; g.N.a = Math.PI / 2;
  run(g, .5);
  eq('he cannot see through a floor', g.N.sees, 0);
  g.N.z = 0; run(g, .5);
  eq('he sees you on his floor', g.N.sees, 1);
}

/* -------------------------------------------------------------- keyring */
{
  const b = boot(6); const g = b.g; g.start();
  g.P.x = 4.5; g.P.y = 10.9; g.P.z = 0; g.tick(1 / 60);
  g.doTarget(g.findTarget());
  eq('toolbox gives the lockpick', g.P.keys.pick, 1);
  g.P.x = 33.5; g.P.y = 8.5; g.P.z = 0; g.tick(1 / 60);
  g.doTarget(g.findTarget());
  eq('fridge gives the red key', g.P.keys.red, 1);
  g.P.x = 37.5; g.P.y = 10.4; g.P.z = 1; g.tick(1 / 60);
  g.doTarget(g.findTarget());
  eq('office desk gives the blue key', g.P.keys.blue, 1);
  check('keys never enter the inventory', g.P.inv.every(i => !i || !['red', 'blue', 'pick'].includes(i.k)));
  eq('keyring counts three', g.keyCount(), 3);
}
{
  const b = boot(7); const g = b.g; g.start();
  g.P.x = 33.4; g.P.y = 11.5; g.P.z = 0; g.tick(1 / 60);
  check('study door needs the lockpick', !/Pick the lock/.test((g.findTarget() || {}).l || ''));
  g.P.keys.pick = 1; g.tick(1 / 60);
  check('with the lockpick the door can be picked', /Pick the lock/.test((g.findTarget() || {}).l || ''));
  g.doTarget(g.findTarget());
  eq('picked door becomes a door', g.T(34, 11, 0), 'D');
}
{
  const b = boot(8); const g = b.g; g.start();
  g.P.x = 42.5; g.P.y = 27.5; g.P.z = 0; g.tick(1 / 60);
  check('vault needs both keys', !/Unlock the basement/.test((g.findTarget() || {}).l || ''));
  g.P.keys.red = 1; g.tick(1 / 60);
  check('one key is not enough', !/Unlock the basement/.test((g.findTarget() || {}).l || ''));
  g.P.keys.blue = 1; g.tick(1 / 60);
  check('two keys open the vault', /Unlock the basement/.test((g.findTarget() || {}).l || ''));
}
{
  const b = boot(9); const g = b.g; g.start();
  g.P.keys.pick = 1; g.P.keys.red = 1; g.P.keys.blue = 1;
  g.P.inv[0] = { k: 'pick', x: -9, y: -9 };
  g.keys.q = 1; g.tick(1 / 60); g.keys.q = 0;
  check('keys are not throwable or droppable', !!g.P.keys.pick && !!g.P.keys.red && !!g.P.keys.blue && g.P.inv[0].k === 'pick');
}

/* ---------------------------------------------------------- trap rules */
{
  const b = boot(10); const g = b.g; g.start();
  eq('no trap on a window', g.trapValid(12, 12, 0), 0);
  eq('no trap on the front door', g.trapValid(28, 30, 0), 0);
  eq('no trap on the stairs', g.trapValid(31, 27, 0), 0);
  eq('no trap in a wardrobe', g.trapValid(20, 18, 0), 0);
  eq('no trap in the vault', g.trapValid(44, 26, 0), 0);
  eq('no trap at your spawn', g.trapValid(28, 37, 0), 0);
  eq('a plain corridor is fine', g.trapValid(28, 26, 0), 1);
  check('a trap on another floor is fine too', g.trapValid(28, 26, 1) === 1);
}
{
  const b = boot(11); const g = b.g; g.start();
  g.P.hide = g.HIDES[4]; g.P.x = 37.5; g.P.y = 15.5; g.P.z = 1;
  const spot = g.bestTrapNear(12, 12, 0, 3);
  check('a trap near a used window finds a legal cell', !!spot && g.trapValid(spot.x, spot.y, 0) === 1);
  g.TRAPS.length = 0;
  g.N.x = 30.5; g.N.y = 26.5; g.N.z = 0; g.N.path = []; g.N.repath = 1;
  g.run('set_bear_trap', { x: 12, y: 12, z: 0 }, 1);
  run(g, 45);
  check('a trap was actually placed', g.TRAPS.length >= 1, 'traps ' + g.TRAPS.length);
  check('every placed trap is legal', g.TRAPS.every(t => g.trapValid(t.x, t.y, t.z) === 1));
}
{
  const b = boot(12); const g = b.g; g.start();
  // break the living-room window and climb in through it twice
  g.FG[0][12][12] = 'w';
  g.P.x = 13.5; g.P.y = 12.5; g.P.z = 0; g.tick(1 / 60);
  g.P.x = 12.6; g.tick(1 / 60);
  check('climbing through a window is recorded', (g.MEM.entries['0:12,12'] || 0) === 1);
  check('the window is marked for boarding', g.MEM.plans.some(p => p.t === 'board' && p.x === 12 && p.y === 12));
  for (let i = 0; i < 30; i++) g.tick(1 / 60);
  eq('standing in the window does not inflate the count', g.MEM.entries['0:12,12'], 1);
  g.P.x = 13.5; g.tick(1 / 60);
  g.P.x = 12.6; g.tick(1 / 60);
  eq('the second climb is counted', g.MEM.entries['0:12,12'], 2);
  check('a trap plan appears after two climbs', g.MEM.plans.some(p => p.t === 'trap'));
  check('and the planned trap is on legal floor', g.MEM.plans.filter(p => p.t === 'trap').every(p => g.trapValid(p.x, p.y, p.z || 0) === 1));
}

/* ------------------------------------------------------------- cut-offs */
{
  const b = boot(5); const g = b.g; g.start(); g.N.stun = 1e9;
  g.P.x = 24.5; g.P.y = 19.5; g.P.z = 0;
  g.N.x = 25.5; g.N.y = 17.5; g.N.z = 0;
  const c = g.chaseCutoff();
  check('a cut-off point exists on this floor', !!c && c.z === 0);
  check('the cut-off is a walkable cell', !!c && g.npass(c.x, c.y, c.z));
  check('the cut-off is nearer to him than to you',
    !!c && Math.hypot(g.N.x - c.x, g.N.y - c.y) < Math.hypot(g.P.x - c.x, g.P.y - c.y));
  g.P.z = 1;
  check('he never cuts off through a ceiling', g.chaseCutoff() === null);
}

/* --------------------------------------------------------------- night */
{
  const b = boot(13); const g = b.g; g.start();
  g.hourSet(23);
  eq('23:00 is night', g.nightAmt(), 1);
  g.hourSet(12);
  eq('noon is not night', g.nightAmt(), 0);
}
{
  const b = boot(14); const g = b.g; g.start();
  g.hourSet(22.4);
  g.P.hide = g.HIDES[4]; g.P.x = 37.5; g.P.y = 15.5; g.P.z = 1;
  g.N.x = 16.5; g.N.y = 27.5; g.N.z = 0; g.N.script = []; g.N.path = [];
  g.pickTask();
  eq('at night he goes to bed', g.N.st, 'sleep');
  let slept = false;
  for (let i = 0; i < 60 * 20 && !slept; i++) { g.tick(1 / 60); slept = !!g.N.sleeping; }
  check('he falls asleep in bed', slept);
  const before = g.N.st;
  g.noise(g.N.x + 1, g.N.y, g.N.z, 30, 'step');
  check('a loud noise wakes him', g.N.st !== before || g.N.sleeping === 0);
}
{
  const b = boot(15); const g = b.g; g.start();
  g.hourSet(23);
  g.P.x = 28.5; g.P.y = 29.4; g.P.z = 0;
  g.N.x = 28.5; g.N.y = 22.5; g.N.z = 0; g.N.a = Math.PI / 2; g.N.sleeping = 0;
  g.N.script = [{ wait: 99, label: 'standing' }]; g.N.si = 0; g.N.path = [];
  run(g, .3);
  const nightSees = g.N.sees;
  g.hourSet(12); run(g, .3);
  check('night shortens his sight', g.N.sees === 1 && nightSees === 0, 'night ' + nightSees + ', day ' + g.N.sees);
}

/* ------------------------------------------------------ learning/memory */
{
  const store = {};
  const b = boot(16, store); const g = b.g; g.start();
  g.P.x = g.N.x; g.P.y = g.N.y + .6; g.P.z = 0;
  run(g, 1.5);
  eq('catch ends the round', g.state, 'caught');
  eq('catch is remembered', g.MEM.catches, 1);
  check('catch is written to storage', JSON.parse(store['hm2d.v1'] || '{}').catches === 1);
  check('lessons are shown', g.OVBTNS.length >= 1 && /TRY AGAIN/.test(g.OVBTNS[0].t));
}
{
  const store = {};
  const b = boot(17, store); const g = b.g; g.start();
  g.MEM.catches = 2;
  g.MEM.rooms = { Foyer: 12 };
  g.learn();
  check('two catches buy a camera', g.MEM.plans.some(p => p.t === 'cam'));
  g.MEM.catches = 3;
  g.learn();
  check('three catches buy a new lock', g.MEM.plans.some(p => p.t === 'lock'));
}
{
  const b = boot(18); const g = b.g; g.start();
  g.P.x = 4.5; g.P.y = 10.9; g.P.z = 0; g.tick(1 / 60);
  g.doTarget(g.findTarget());
  g.MEM.catches = 1;
  g.retry();
  eq('retry keeps his memory', g.MEM.catches, 1);
  check('retry restores the toolbox', g.CT.find(c => c.id === 'toolbox').done === 0);
  check('retry empties your keyring', g.keyCount() === 0);
  eq('retry clears the secret', g.SECRET.got, 0);
  eq('retry keeps the world playable', g.state, 'play');
}
{
  const b = boot(19); const g = b.g; g.start();
  g.TRAPS.length = 0;
  g.MEM.traps = ['0:28,26'];
  g.retry();
  check('his traps come back with him', g.TRAPS.some(t => t.x === 28 && t.y === 26 && t.z === 0));
  g.TRAPS.push({ x: 30, y: 24, z: 0, armed: 1 });
  g.retry();
  check('world state does not leak into a new round', !g.TRAPS.some(t => t.x === 30 && t.y === 24));
}
{
  const store = {};
  const b = boot(20, store); const g = b.g; g.start();
  g.MEM.catches = 4; g.MEM.wins = 2; g.MEM.rooms = { Foyer: 30 }; g.saveMemory();
  g.newGame();
  eq('new game wipes the catches', g.MEM.catches, 0);
  eq('new game wipes the rooms', Object.keys(g.MEM.rooms).length, 0);
  eq('new game wipes the save', JSON.parse(store['hm2d.v1'] || '{}').catches, 0);
  eq('new game starts with the story', g.state, 'cut');
}
{
  const b = boot(21); const g = b.g; g.start();
  g.P.x = 21.5; g.P.y = 19.5; g.P.z = 0; g.tick(1 / 60);
  const t = g.findTarget();
  check('wardrobes can be hidden in', t && t.k === 'hide');
  g.doTarget(t);
  check('hiding sets the hide state', !!g.P.hide && g.P.hide.id === 'w0');
  g.N.x = 20.4; g.N.y = 19.4; g.N.z = 0; g.N.a = 3.1;
  run(g, .4);
  eq('hidden players are not spotted', g.N.sees, 0);
  g.N.mode = 'search';
  run(g, 1.2);
  eq('a searching neighbour finds the hiding place', g.state, 'caught');
  check('and remembers it', (g.MEM.hides.w0 || 0) > 0);
}
{
  const b = boot(22); const g = b.g; g.start();
  g.MEM.hides = { w0: 3 };
  g.P.x = 21.4; g.P.y = 19.4; g.P.z = 0;
  g.N.x = 30.5; g.N.y = 24.5; g.N.z = 0; g.N.mode = 'search';
  g.seedBelief(); g.stamp(0, 20.5, 18.5, 3); g.N.lastSeen = { x: 20.5, y: 18.5, z: 0 };
  g.N.searchT = 0; g.N.searchN = 1; g.N.script = []; g.N.path = [];
  g.searchNext();
  eq('a remembered hideout is checked first', g.N.st, 'search_closet');
}

/* ---------------------------------------------------------- chase/belief */
{
  const b = boot(23); const g = b.g; g.start();
  g.P.x = 28.5; g.P.y = 27.5; g.P.z = 0;
  g.N.x = 28.5; g.N.y = 23.5; g.N.z = 0; g.N.a = Math.PI / 2;
  run(g, .5);
  eq('line of sight in an open room', g.N.sees, 1);
  // the wall between the foyer and the bedroom
  g.P.x = 21.5; g.P.y = 25.5; g.N.x = 27.5; g.N.y = 25.5;
  run(g, .5);
  eq('no sight through the wall', g.N.sees, 0);
}
{
  const b = boot(24); const g = b.g; g.start();
  g.P.x = 28.5; g.P.y = 26.5; g.P.z = 0;
  g.N.x = 28.5; g.N.y = 23.5; g.N.z = 0; g.N.a = Math.PI / 2;
  run(g, .4); g.startChase();
  check('chase starts from sight', g.N.mode === 'chase');
  // he sees you, then you vanish into the bedroom behind a solid wall
  g.P.x = 15.5; g.P.y = 19.5;
  g.N.vt = 0; g.tick(1 / 60); g.N.vt = 0; g.tick(1 / 60);
  eq('wall breaks his sight', g.N.sees, 0);
  const tgt = g.chaseTarget();
  check('chase target is not your hidden position', !(Math.abs(tgt.x - g.P.x) < .3 && Math.abs(tgt.y - g.P.y) < .3), JSON.stringify(tgt));
  check('belief is populated while chasing', g.N.mass > 0);
  run(g, 3);
  check('he keeps hunting the belief', g.N.mode === 'chase' || g.N.mode === 'search');
}
{
  const b = boot(25); const g = b.g; g.start();
  g.P.x = 28.5; g.P.y = 26.5; g.P.z = 0;
  g.N.x = 28.5; g.N.y = 23.0; g.N.z = 0; g.N.a = Math.PI / 2;
  run(g, .4); g.startChase();
  let flips = 0, last = 0, still = 0, worst = 0;
  let px = g.N.x, py = g.N.y;
  for (let i = 0; i < 240; i++) {
    // the player flees along the foyer, never in reach
    g.P.x += .004; g.P.y = 26.5;
    g.tick(1 / 60);
    const d = Math.atan2(Math.sin(g.N.a - last), Math.cos(g.N.a - last));
    if (Math.abs(d) > 1.2) flips++;
    last = g.N.a;
    if (Math.hypot(g.N.x - px, g.N.y - py) < .004) still++; else still = 0;
    worst = Math.max(worst, still);
    px = g.N.x; py = g.N.y;
    if (g.state !== 'play') break;
  }
  check('chase heading does not flip about', flips <= 12, 'flips ' + flips);
  check('chase does not stall on the spot', worst < 45, 'worst ' + worst + ' frames still');
}
{
  const b = boot(26); const g = b.g; g.start();
  g.P.x = 15.5; g.P.y = 12.5; g.P.z = 1;
  g.N.x = 28.5; g.N.y = 25.5; g.N.z = 0;
  g.N.mode = 'chase'; g.N.chaseT = 1; g.N.lastSeen = { x: 31.5, y: 27.5, z: 1 };
  g.seedBelief();
  let up = false;
  for (let i = 0; i < 60 * 25 && !up; i++) { g.tick(1 / 60); up = g.N.z === 1; }
  check('a chase crosses the stairwell', up);
}
{
  const b = boot(27); const g = b.g; g.start();
  g.P.x = 20.5; g.P.y = 19.5; g.P.z = 0; g.tick(1 / 60);
  g.doTarget(g.findTarget());
  g.N.x = 20.4; g.N.y = 19.4; g.N.z = 0; g.N.mode = 'idle'; g.N.script = []; g.N.st = 'grumble';
  run(g, 2);
  eq('hidden players are not caught by touch alone', g.state, 'play');
}

{
  const b = boot(28); const g = b.g; g.start();
  // he sees you upstairs, loses you, and must not stampede back downstairs
  g.P.x = 18.5; g.P.y = 12.5; g.P.z = 1;
  g.N.x = 24.5; g.N.y = 16.5; g.N.z = 1; g.N.a = Math.PI; g.N.script = []; g.N.path = [];
  run(g, .5);
  g.startChase();
  check('upstairs chase starts', g.N.mode === 'chase' && g.N.sees === 1);
  g.P.x = 15.5; g.P.y = 9.5;   // behind the bed/wardrobe, still upstairs
  run(g, 2);
  eq('a fresh sighting keeps him on your floor', g.N.z, 1);
  const tgt = g.chaseTarget();
  eq('and his target is your floor', tgt.z, 1);
}
{
  const b = boot(29); const g = b.g; g.start();
  // you are in the bedroom, he is one tile away on the other side of the wall
  g.P.x = 22.4; g.P.y = 19.5; g.P.z = 0;
  g.N.x = 24.6; g.N.y = 19.5; g.N.z = 0; g.N.a = Math.PI;
  g.N.mode = 'chase'; g.N.chaseT = 2; g.N.lastSeen = { x: 22.4, y: 19.5, z: 0 };
  g.seedBelief();
  g.N.vt = 0; run(g, 2);
  eq('no catch through a wall', g.state, 'play');
  check('no sight through a wall mid-chase', g.N.sees === 0);
}
/* ------------------------------------------------------------ integrity */
{
  const b = boot(30); const g = b.g; g.start();
  const route = [
    [28.5, 37.5, 0], [28.5, 31.5, 0], [28.5, 27.5, 0], [31.5, 27.5, 0],
    [31.5, 27.5, 1], [28.5, 17.5, 1], [28.5, 12.5, 1], [37.5, 11.5, 1], [37.5, 10.4, 1],
    [31.5, 27.5, 1], [31.5, 27.5, 0], [28.5, 26.5, 0], [26.5, 26.5, 0], [14.5, 27.5, 0],
    [8.5, 11.5, 0], [4.5, 10.9, 0], [10.5, 11.5, 0], [28.5, 30.5, 0], [33.5, 8.5, 0],
    [38.5, 25.5, 0], [42.5, 27.5, 0], [46.5, 26.5, 0]
  ];
  let broken = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], c = route[i];
    if (a[2] !== c[2]) continue;
    if (!g.findPath(a[0], a[1], c[0], c[1], c[2]).length && Math.hypot(a[0] - c[0], a[1] - c[1]) > .35) {
      broken.push(a.join(',') + ' → ' + c.join(','));
    }
  }
  check('the whole route is walkable', broken.length === 0, broken.join(' | '));
  eq('the player cannot pass a locked door', g.ppass(34, 10, 1), false);
  eq('the neighbour can', g.npass(34, 10, 1), true);
  eq('ground study door is locked too', g.ppass(34, 11, 0), false);
  check('the secret only exists behind the vault door', g.roomOf(g.SECRET.x, g.SECRET.y, 0) === 'Vault');
}
{
  // memory survives a reload; the round itself starts clean
  const store = {};
  let b = boot(31, store); let g = b.g; g.start();
  g.MEM.catches = 2;
  g.MEM.traps = ['0:28,26'];
  g.MEM.boarded = ['0:17,30'];
  g.MEM.cams = ['0:26,26'];
  g.MEM.hides = { w0: 2 };
  g.saveMemory();
  const b2 = boot(32, store); const g2 = b2.g; g2.start();
  eq('reload keeps the catches', g2.MEM.catches, 2);
  check('reload keeps the traps', g2.TRAPS.some(t => t.x === 28 && t.y === 26));
  eq('reload boards the window he boarded', g2.T(17, 30, 0), 'X');
  check('reload keeps the camera', g2.CAMS.length === 1);
  check('reload keeps the hiding place', g2.MEM.hides.w0 === 2);
  check('a new page starts a clean round', g2.CT.every(c => !c.done) && g2.SECRET.got === 0 && g2.keyCount() === 0);
}
/* --------------------------------------------------------------- report */
if (failed) {
  console.log('GAME FAIL — ' + passed + '/' + (passed + failed));
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('GAME OK — ' + passed + '/' + passed);
}
