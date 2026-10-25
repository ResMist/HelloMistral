'use strict';
/* =====================================================================
   game.js — player, input, interaction, match flow, HUD
   ===================================================================== */

let ITEMS = [];     // loose objects in the world (loot / throwables)
let GAME = null;
let cv = null, ctx = null;
let CVW = 900, CVH = 620;

const KEYS = {};
const KEYMAP = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right', ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };

function newGame(seed) {
  GAME = {
    state: 'play', clock: CLOCK_START, t: 0, msg: '', msgT: 0,
    ticks: 0, alarm: 0, foot: 0, shown: {}, stats: { steps: 0, doors: 0, loot: 0 },
  };
  let w = null;
  if (seed) {
    const m = storedMatch();
    if (m && m.seed === seed) { M = m; w = makeWorld(M.seed); }
  }
  if (!w) {
    M = blankMatch(seed || ((Math.random() * 0xffffffff) >>> 0));
    w = makeWorld(M.seed);
    saveMatch();
  }
  instantiateWorld(w);
  ITEMS = (W.items || []).map((it) => ({ x: it.x, y: it.y, z: it.z, k: it.k, home: { x: it.x, y: it.y, z: it.z }, noticed: 0, taken: 0, thrown: 0 }));

  P = {
    x: W.spawn.x, y: W.spawn.y, z: 0, a: -Math.PI / 2,
    vx: 0, vy: 0, crouch: 0, sprint: 0, stam: 1, slow: 0, stun: 0,
    keys: { pick: 0, red: 0, blue: 0 },
    inv: [], carried: 0, flash: 0, flashCd: 0, hidden: 0, hideT: 0,
    stepT: 0, camo: 0, bobT: 0, lastSafe: { x: W.spawn.x, y: W.spawn.y, z: 0 },
  };
  initAI();
  belSeed();               // a starting prior: he assumes you came in the front
  HUD.tasks = buildTasks();
  HUD.note = 'Get inside without waking him.';
  GAME.msg = ''; UI.msg = ''; UI.msgT = 0; UI.over = null; UI.screen = 'play';
  return true;
}

/* ------------------------------------------------------------ new match flow */
function startMatchFromMenu(fresh) {
  if (fresh) { wipeMatch(); newGame(null); }
  else {
    const m = storedMatch();
    if (m) { M = m; newGame(m.seed); }
    else newGame(null);
  }
  UI.cut = 0;
  UI.screen = 'cut';
  GAME.state = 'cut';
}
function skipCutscene() { if (UI.screen === 'cut') { UI.screen = 'play'; GAME.state = 'play'; } }

/* ------------------------------------------------------------------ player */
const SPD_WALK = 3.05, SPD_SPRINT = 5.25, SPD_CROUCH = 1.45;

function playerUpdate(dt) {
  if (!P || GAME.state !== 'play') return;
  if (P.stun > 0) { P.stun -= dt; return; }
  P.flashCd = Math.max(0, P.flashCd - dt);
  P.slow = Math.max(0, P.slow - dt);

  let dx = 0, dy = 0;
  if (KEYS.up) dy -= 1;
  if (KEYS.down) dy += 1;
  if (KEYS.left) dx -= 1;
  if (KEYS.right) dx += 1;
  if (P.hidden) { dx = 0; dy = 0; }
  const moving = dx || dy;
  if (moving) { const l = Math.hypot(dx, dy); dx /= l; dy /= l; }

  // stamina
  if (P.sprint && moving) P.stam = Math.max(0, P.stam - dt * 0.155);
  else P.stam = Math.min(1, P.stam + dt * (P.crouch ? 0.34 : 0.2));
  if (P.stam <= 0.02) P.sprint = 0;

  const base = P.crouch ? SPD_CROUCH : P.sprint ? SPD_SPRINT : SPD_WALK;
  const spd = base * (P.slow > 0 ? 0.45 : 1) * (P.carrying ? 1 : 1);
  if (moving) {
    const sp = spd * dt;
    moveCircle(P, dx * sp, dy * sp, 0.3);
    P.bobT += sp;
    P.vx = dx * spd; P.vy = dy * spd;
    // footsteps: sprinting is loud and frequent, crouching is silent
    P.stepT += sp;
    const gap = P.sprint ? 0.75 : P.crouch ? 2.4 : 1.15;
    if (P.stepT > gap) {
      P.stepT = 0;
      const loud = P.sprint ? 7.4 : P.crouch ? 1.0 : 3.6;
      const floor = P.z;
      makeNoise(P.x, P.y, P.z, loud, 'step', { sprint: P.sprint, crouch: P.crouch });
      GAME.stats.steps++;
      if (P.sprint) addHeatNow();
    }
    P.a = Math.atan2(dy, dx);
  } else { P.vx = 0; P.vy = 0; }

  if (freeCell(P.z, P.x | 0, P.y | 0)) P.lastSafe = { x: P.x, y: P.y, z: P.z };
  if (P.crouch && roomLit(P.z, P.x, P.y) && dst(P.x, P.y, N.x, N.y) > 4) P.camo = Math.min(1, P.camo + dt * 0.5);
  else P.camo = Math.max(0, P.camo - dt * 1.4);

  // traps
  const tr = trapAt(P.z, P.x, P.y);
  if (tr && tr.armed && !P.hidden) {
    tr.armed = 0;
    P.stun = 1.1; P.slow = 2.6;
    makeNoise(P.x, P.y, P.z, 9, 'trap');
    say('SNAP! A bear trap — you are hurt and loud.');
    const i = M.traps.indexOf(P.z + ':' + (tr.x | 0) + ':' + (tr.y | 0));
    if (i >= 0) M.traps.splice(i, 1);
    saveMatch();
  }
  // fire exit: the front door is not an exit, but walking far outside is a soft fail (handled in aiUpdate)
  if (dst(P.x, P.y, W.spawn.x, W.spawn.y) < 1.2 && P.z === 0 && GAME.t > 6) P.left = 1;
}
function addHeatNow() {
  const key = P.z + ':' + (P.x | 0) + ',' + (P.y | 0);
  M.route[key] = (M.route[key] || 0) + 1;
}

/* ------------------------------------------------------------- interaction */
function interact() {
  if (GAME.state !== 'play') return;
  if (P.hidden) { P.hidden = 0; P.hideT = 0; return; }
  const fx = Math.floor(P.x + Math.cos(P.a) * 0.75), fy = Math.floor(P.y + Math.sin(P.a) * 0.75);
  const tx = fx, ty = fy;
  const z = P.z;

  // containers
  for (const c of W.containers) {
    if (c.z !== z) continue;
    const w = c.w || 1;
    const near = P.x > c.tx - 0.95 && P.x < c.tx + w + 0.95 && P.y > c.ty - 0.95 && P.y < c.ty + 1.95;
    if (!near) continue;
    openContainer(c);
    return;
  }
  // loose items
  for (const it of ITEMS) {
    if (it.z !== z || it.taken) continue;
    if (dst(P.x, P.y, it.x, it.y) < 1.05) {
      it.taken = 1;
      if (it.k === 'keyring') { P.keys.pick = 1; say('Shed keyring: LOCKPICK acquired.'); }
      else { if (P.inv.length < 3) { P.inv.push(it.k); say('Picked up the ' + it.k + '.'); } else { say('Your hands are full.'); it.taken = 0; } }
      makeNoise(P.x, P.y, z, 1.6, 'loot');
      return;
    }
  }
  // secret stash
  if (dst(P.x, P.y, W.secret.x, W.secret.y) < 1.9 && P.z === W.secret.z) {
    if (!P.keys.red || !P.keys.blue) { say('Two locks. You need the red key and the blue key.'); return; }
    winMatch();
    return;
  }
  // stairs
  const st = stairFrom(z, P.x | 0, P.y | 0);
  if (st) { climbTo(st); return; }
  // doors in front of you
  const d = doorAt(z, fx, fy);
  if (d) { useDoor(d, fx, fy); return; }
  // windows
  if (T(z, fx, fy) === 'W' || T(z, fx, fy) === 'w') { climbWindow(fx, fy); return; }
  // search the cell you face
  if (T(z, tx, ty) === 'S') { say('Furniture. Nothing hidden here.'); return; }
  say('Nothing to do here.');
}

function openContainer(c) {
  if (c.done) { say('The ' + c.label + ' is empty.'); return; }
  c.done = 1;
  makeNoise(P.x, P.y, P.z, 4.6, 'loot');
  GAME.stats.loot++;
  if (c.gives === 'red') { P.keys.red = 1; say('RED KEY found in the ' + c.label + '!'); aiSoundKey(c); }
  else if (c.gives === 'blue') { P.keys.blue = 1; say('BLUE KEY found in the ' + c.label + '!'); aiSoundKey(c); }
  else if (c.gives === 'pick') { P.keys.pick = 1; say('LOCKPICK found in the ' + c.label + '!'); aiSoundKey(c); }
  else { if (P.inv.length < 3) P.inv.push('trinket'); say('The ' + c.label + ' holds a trinket.'); }
  M.suspicion = Math.min(100, M.suspicion + 1.4);
  saveMatch();
}
function aiSoundKey(c) { aiSay('Did I just hear my ' + c.label + '?'); }

function useDoor(d, x, y) {
  if (d.kind === 'cellar') {
    if (!d.closed) { say('The vault. Whatever he keeps in there is the point of all this.'); return; }
    if (!P.keys.red) { say('Locked. A red keyhole.'); makeNoise(P.x, P.y, P.z, 3, 'door'); return; }
    d.closed = 0; d.playerUnlocked = 1; d.lockChar = 'B';
    for (const [dx2, dy2] of d.cells) W.floors[d.z].G[dy2][dx2] = 'D';
    (M.needRelock = M.needRelock || []).push(d.z + ':' + d.cells[0][0] + ':' + d.cells[0][1]);
    saveMatch();
    say('The RED KEY turns: the vault door is open.');
    makeNoise(P.x, P.y, P.z, 6, 'door');
    aiSay('The vault?! No — not the vault!');
    M.suspicion = Math.min(100, M.suspicion + 12);
    return;
  }
  if (d.kind === 'lock') {
    if (!d.closed) { say('The study door. The desk is inside.'); return; }
    if (!P.keys.pick) { say('Locked tight. A lockpick would do it.'); makeNoise(P.x, P.y, P.z, 3.5, 'door'); return; }
    d.closed = 0; d.playerUnlocked = 1; d.lockChar = 'L';
    for (const [dx2, dy2] of d.cells) W.floors[d.z].G[dy2][dx2] = 'D';
    W.studyOpen = 1;
    (M.needRelock = M.needRelock || []).push(d.z + ':' + d.cells[0][0] + ':' + d.cells[0][1]);
    saveMatch();
    say('Picked the lock. The study is open.');
    makeNoise(P.x, P.y, P.z, 3.2, 'lockpick');
    aiSay('Who is picking my lock?');
    M.suspicion = Math.min(100, M.suspicion + 9);
    return;
  }
  if (d.closed) openDoor(P.z, x, y, { crouch: P.crouch }), (GAME.stats.doors++, say('Door opened.'));
  else { closeDoor(P.z, x, y); say('Door closed.'); }
  if (d.closed && d.playerUnlocked) d.playerUnlocked = 0;
}

function climbWindow(wx, wy) {
  // find a free cell straight behind the window relative to the player
  const dx = wx - (P.x | 0), dy = wy - (P.y | 0);
  const bx = wx + Math.sign(dx), by = wy + Math.sign(dy);
  if (!freeCell(P.z, bx, by)) { say('Can not climb through from here.'); return; }
  P.x = bx + 0.5; P.y = by + 0.5;
  makeNoise(P.x, P.y, P.z, 5.2, 'window');
  M.entries[P.z + ':' + wx + ':' + wy] = (M.entries[P.z + ':' + wx + ':' + wy] || 0) + 1;
  say('You climbed through the window.');
  saveMatch();
}

function climbTo(s) {
  P.z = s.z; P.x = s.x + 0.5; P.y = s.y + 0.5;
  makeNoise(P.x, P.y, P.z, 4.4, 'stairs');
  const r = roomAt(P.z, P.x, P.y);
  say('You are ' + (P.z === 0 ? 'downstairs' : 'upstairs') + '.');
  GAME.shown['z' + P.z] = 1;
}

/* --------------------------------------------------------------- carrying */
function pickUpDrop() {
  const it = nearestLooseItem();
  if (it) {
    if (P.carried) { say('Already carrying the ' + P.carried + '.'); return; }
    P.carried = it.k; it.taken = 1;
    say('You are carrying the ' + it.k + '. Click or press Q to throw it.');
    makeNoise(P.x, P.y, P.z, 2.4, 'loot');
    return;
  }
  if (P.carried) {
    const k = P.carried; P.carried = 0;
    const q = nearestStandable(P.z, P.x + Math.cos(P.a), P.y + Math.sin(P.a), 0.2);
    if (q) ITEMS.push({ x: q[0] + 0.5, y: q[1] + 0.5, z: P.z, k, taken: 0, home: null, noticed: 1 });
    say('You set the ' + k + ' down.');
  } else say('Nothing to carry.');
}
function nearestLooseItem() {
  let best = null, bd = 1.3;
  for (const it of ITEMS) {
    if (it.taken || it.z !== P.z) continue;
    const d = dst(P.x, P.y, it.x, it.y);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

function throwCarried(ax, ay) {
  if (GAME.state !== 'play') return;
  if (!P.carried) { say('Nothing to throw. Throw a vase, a tomato, a box…'); return; }
  const kind = P.carried; P.carried = 0;
  const d = Math.max(0.4, dst(P.x, P.y, ax, ay));
  const speed = Math.min(11, 5 + d * 0.7);
  const t = d / speed;
  const vx = (ax - P.x) / t, vy = (ay - P.y) / t;
  spawnProjectile(kind, P.x, P.y, P.z, vx, vy, 2.6 + d * 0.16, 'p');
  makeNoise(P.x, P.y, P.z, 2.2, 'throw');
  say('You threw the ' + kind + '.');
}

function toggleFlash() {
  if (P.flashCd > 0) { say('The torch is recharging.'); return; }
  P.flash = !P.flash;
  P.flashCd = 0.35;
  say(P.flash ? 'Torch on — he can see you from further away.' : 'Torch off.');
  if (P.flash) makeNoise(P.x, P.y, P.z, 2.5, 'click');
}

/* ------------------------------------------------------------ flashlight */
function flashCone() { return P.flash && GAME.state === 'play'; }

/* ---------------------------------------------------------------- hiding */
function tryHide() {
  // must be standing next to furniture in a dark corner
  if (!roomAt(P.z, P.x, P.y)) { say('Nothing to hide behind out here.'); return; }
  const dark = !litAt(P.z, P.x, P.y);
  if (!dark && N.dist < 6) { say('Too bright to hide here.'); return; }
  P.hidden = 1; P.hideT = 0;
  say('Hiding. Hold still — moving gives you away.');
  M.hides.push({ x: P.x, y: P.y, z: P.z });
  if (M.hides.length > 12) M.hides.shift();
  saveMatch();
}

/* ---------------------------------------------------------------- win */
function winMatch() {
  GAME.state = 'over';
  UI.over = 'win';
  M.wins++;
  M.suspicion = Math.max(0, M.suspicion - 25);
  saveMatch();
  UI.screen = 'over';
}

/* --------------------------------------------------------------- objectives */
const HUD = { tasks: [], note: '' };
function buildTasks() {
  const t = [];
  t.push({ k: 'shed', txt: 'Get the lockpick from the shed', done: P.keys.pick });
  t.push({ k: 'inside', txt: 'Get inside the house', done: P.z > 0 || insideHouse() });
  t.push({ k: 'study', txt: 'Pick the study door lock', done: W.studyUnlocked || P.keys.blue });
  t.push({ k: 'blue', txt: 'Find the blue key (study desk)', done: P.keys.blue });
  t.push({ k: 'red', txt: 'Find the red key (kitchen fridge)', done: P.keys.red });
  t.push({ k: 'cellar', txt: 'Unlock the vault (red key)', done: !!W.cellarOpen });
  t.push({ k: 'secret', txt: 'Take the SECRET from the vault', done: M.wins > 0 });
  return t;
}
function insideHouse() {
  return P.x > HOUSE.x && P.x < HOUSE.x + HOUSE.w && P.y > HOUSE.y && P.y < HOUSE.y + HOUSE.h;
}
function refreshTasks() {
  if (!HUD.tasks.length || !P) return;
  for (const t of HUD.tasks) {
    if (t.k === 'inside') t.done = P.z > 0 || insideHouse();
    if (t.k === 'study') t.done = !!W.studyOpen;
    if (t.k === 'cellar') t.done = !!W.cellarOpen || (W.cellarDoor && !W.cellarDoor.closed);
    if (t.k === 'secret') t.done = M.wins > 0;
  }
}

/* ---------------------------------------------------------------- input */
function bindInput() {
  addEventListener('keydown', (e) => {
    if (UI.screen === 'help') { UI.screen = 'menu'; if (e.preventDefault) e.preventDefault(); return; }
    if (UI.screen === 'menu' && MENU) { menuKey(e.code); if (e.preventDefault) e.preventDefault(); return; }
    if (e.code === 'Escape') {
      if (UI.screen === 'play') { UI.screen = 'pause'; GAME.state = 'pause'; }
      else if (UI.screen === 'pause') { UI.screen = 'play'; GAME.state = 'play'; }
      if (e.preventDefault) e.preventDefault();
      return;
    }
    if (UI.screen === 'cut' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) { skipCutscene(); return; }
    if (UI.screen === 'over' && (e.code === 'Enter' || e.code === 'KeyR')) { UI.screen = 'play'; startMatchFromMenu(false); return; }
    if (UI.screen === 'pause' && (e.code === 'KeyR')) { UI.screen = 'play'; startMatchFromMenu(false); return; }
    if (UI.screen !== 'play') return;
    const m = KEYMAP[e.code];
    if (m) { KEYS[m] = 1; e.preventDefault(); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { P.sprint = 1; return; }
    if (e.code === 'KeyC') { P.crouch = !P.crouch; P.sprint = 0; return; }
    if (e.code === 'KeyE') { interact(); return; }
    if (e.code === 'KeyQ') { throwCarried(P.x + Math.cos(P.a) * 3, P.y + Math.sin(P.a) * 3); return; }
    if (e.code === 'KeyF') { throwCarried(mouseWorld.x, mouseWorld.y); return; }
    if (e.code === 'KeyG') { pickUpDrop(); return; }
    if (e.code === 'KeyH') { tryHide(); return; }
    if (e.code === 'KeyT') { toggleFlash(); return; }
    if (e.code === 'KeyM') { UI.showBelief = !UI.showBelief; return; }
    if (e.code === 'KeyP') { UI.screen = 'pause'; GAME.state = 'pause'; return; }
  });
  addEventListener('keyup', (e) => {
    const m = KEYMAP[e.code];
    if (m) { KEYS[m] = 0; return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') P.sprint = 0;
  });
  addEventListener('blur', () => { for (const k in KEYS) KEYS[k] = 0; if (P) P.sprint = 0; });
}

function canvasPos(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * (CVW / r.width), y: (ev.clientY - r.top) * (CVH / r.height) };
}
const mouseScreen = { x: CVW / 2, y: CVH / 2 };
let mouseWorld = { x: 0, y: 0 };

function bindMouse() {
  cv.addEventListener('mousemove', (e) => { const p = canvasPos(e); mouseScreen.x = p.x; mouseScreen.y = p.y; });
  cv.addEventListener('mousedown', (e) => {
    if (UI.screen === 'help') { UI.screen = 'menu'; return; }
    if (UI.screen === 'menu') {
      const p0 = canvasPos(e);
      if (!menuClick(p0.x, p0.y)) { /* ignore stray clicks */ }
      return;
    }
    if (UI.screen === 'cut') { skipCutscene(); return; }
    if (UI.screen === 'over') { UI.screen = 'play'; startMatchFromMenu(false); return; }
    if (UI.screen === 'pause') { UI.screen = 'play'; GAME.state = 'play'; return; }
    if (UI.screen !== 'play') return;
    const p = canvasPos(e);
    const w = screenToWorld(p.x, p.y);
    if (e.button === 0) throwCarried(w.x, w.y);
    if (e.button === 2) toggleFlash();
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { ZOOM = clamp(ZOOM * (e.deltaY > 0 ? 0.92 : 1.08), 1.3, 3.2); e.preventDefault(); }, { passive: false });
}

let ZOOM = 2.0;
let CAMX = 0, CAMY = 0;
function screenToWorld(sx, sy) {
  const scale = TS * ZOOM;
  return { x: (sx - CVW / 2) / scale + CAMX, y: (sy - CVH / 2) / scale + CAMY };
}

/* --------------------------------------------------------------- game step */
function gameUpdate(dt) {
  if (!GAME) return;
  if (GAME.state !== 'play') return;
  GAME.ticks++;
  playerUpdate(dt);
  if (GAME.state !== 'play') return;
  aiUpdate(dt);
  updateProjectiles(dt);
  for (const c of W.containers) if (c.done && !c.seen && c.t === undefined) c.t = 0;
  refreshTasks();
  if (GAME.msgT > 0) GAME.msgT -= dt;
  if (UI.msgT > 0) UI.msgT -= dt;
  for (const k in GAME.shown) {}
  // clock
  GAME.clock += dt / HOUR_SECONDS;
  if (GAME.clock >= 24) GAME.clock -= 24;
  // save lightly
  GAME.saveT = (GAME.saveT || 0) + dt;
  if (GAME.saveT > 6) {
    GAME.saveT = 0;
    M.clock = GAME.clock;
    for (const F of W.floors) for (const r of F.rooms) {}
    saveMatch();
  }
}

/* ---------------------------------------------------------------- ticker */
let LAST_TS = 0, ACC = 0;
const STEP = 1 / 60;
function frame(ts) {
  if (!LAST_TS) LAST_TS = ts;
  let dt = (ts - LAST_TS) / 1000;
  LAST_TS = ts;
  if (dt > 0.25) dt = 0.25;
  ACC += dt;
  let guard = 0;
  while (ACC >= STEP && guard++ < 8) { gameUpdate(STEP); ACC -= STEP; }
  if (UI.screen === 'cut') { UI.cut += dt; if (UI.cut > 13) skipCutscene(); }
  updateCamera(dt);
  render(dt);
  requestAnimationFrame(frame);
}

function updateCamera(dt) {
  if (!P) return;
  const k = 1 - Math.pow(0.0015, dt);
  CAMX = lerp(CAMX, P.x, k);
  CAMY = lerp(CAMY, P.y, k);
  const scale = TS * ZOOM;
  const halfW = CVW / 2 / scale, halfH = CVH / 2 / scale;
  CAMX = clamp(CAMX, halfW, MW - halfW);
  CAMY = clamp(CAMY, halfH, MH - halfH);
  mouseWorld = screenToWorld(mouseScreen.x, mouseScreen.y);
}

/* ---------------------------------------------------------------- boot */
function boot() {
  cv = document.getElementById('game');
  ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  bindInput();
  bindMouse();
  // menu preview world (no match memory yet)
  M = blankMatch(1234);
  W = makeWorld(M.seed);
  instantiateWorld(W);
  P = null; N = null;
  UI.screen = 'menu';
  requestAnimationFrame(frame);
}

const GAMEAPI = {
  get P() { return P; }, get N() { return N; }, get M() { return M; }, get W() { return W; }, get GAME() { return GAME; },
  tileAt: (z, x, y) => T(z, x, y),
  newGame, startMatchFromMenu, skipCutscene, interact, gameUpdate, render,
  get MEM() { return M; }, get ITEMS() { return ITEMS; }, get CAMS() { return CAMS; }, get TRAPS() { return TRAPS; },
  throwCarried, pickUpDrop, toggleFlash, tryHide, winMatch, saveMatch, wipeMatch, storedMatch,
  bestTrapSpot, planFortify, planCamera, isValidTrapCell, addTrap, makeNoise,
  belSeed, belSpots, belPeak, belAdd, belStep, belCentroid, belTotal, belClear,
  cutoffTarget, playerGoal, pickupAt: nearestLooseItem,
  get SHOW() { return UI; }, get STAIR() { return STAIR; }, get DOORS() { return DOORS; },
  setClock(h) { if (GAME) GAME.clock = h; }, hourSet(h) { if (GAME) GAME.clock = h; },
  aiUpdate, startChase, startSearch, pickTask, refreshTasks,
  freezeAI(on) { if (GAME) GAME.freezeAI = !!on; },
  sightRange, lineOfSight, isNight, roomLit, litAt, hasKey: (k) => !!(P && P.keys[k]),
  bestAmbushDoor, belSpots: (z, n) => belSpots(z, n),
  addCamera, tick(idt) { gameUpdate(idt || 1 / 60); },
  get LAST() { return { seed: W && W.seed, kinds: [...new Set((W.doors || []).map((d) => d.kind))] }; },
  get HUD() { return HUD; }, get MOUSE() { return mouseWorld; },
};
