'use strict';
/* =====================================================================
   views.js — the plain look: flat tiles, coloured boxes for furniture,
   circles for people. No shading, no rugs, no light pools. Canvas draws
   the world; four plain DOM panels hold the text HUD.
   ===================================================================== */

const $ = (id) => document.getElementById(id);

const COL = {
  grassA: '#86c96e', grassB: '#7fc268', roof: '#332f2a',
  edge: '#1b1e22', wall: '#3b3f46', fence: '#ffffff', path: '#d9d4c2',
  win: '#9fd4ef', winBroken: '#d8f1ff', boarded: '#8a6246',
  door: '#a0632c', locked: '#cc3b32', cellar: '#7a3db0',
  up: '#c9a227', down: '#6f8fbf', stair: '#c9a227',
  player: '#f7f7f7', aim: '#2d6fdc', npc: '#e8803a', chase: '#e8453a',
  clue: '#ffd23f', bg: '#16202b', fencePost: '#d9d4c2',
};
const FC = {
  couch: '#4f7fd1', tv: '#222222', table: '#b07a45', shelf: '#7a5230', sink: '#9aabb4',
  stove: '#888888', counter: '#d8d0c0', fridge: '#f2f2f2', coat: '#6a4a3a', mirror: '#9ccfff',
  bed: '#e9e4f0', wardrobe: '#7a5230', night: '#aa5577', nightstand: '#aa5577',
  dresser: '#7a5230', desk: '#9b6a3a', toilet: '#ffffff', tub: '#ddffff', basin: '#cfe6f2',
  bench: '#a07a3a', rack: '#554433', toolbox: '#cc3333', crate: '#c8964f',
  bookshelf: '#7a5230', cabinet: '#7a5230', tree: '#3f9a4a', mailbox: '#3366cc', trash: '#556677',
  stairs: '#c9a227',
};
const IC = { tomato: '#e63b2e', can: '#cc3333', vase: '#3a86d9', chair: '#b5651d', box: '#c8964f', lamp: '#ffe27a' };

/* ------------------------------------------------------------ the frame */
function render(dt) {
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, CVW, CVH);
  if (UI.screen === 'menu' || UI.screen === 'help' || UI.screen === 'cut' || !GAME || !W || !P) {
    showPanels(false);
    if (UI.screen === 'menu') { drawMenu(dt); return; }
    if (UI.screen === 'help') { drawHelp(); return; }
    if (UI.screen === 'cut') { drawCut(dt); return; }
    return;
  }
  showPanels(true);
  drawWorld();
  drawHUD();
  if (UI.screen === 'pause') drawPause();
  if (UI.screen === 'over') drawOver();
}

function roomAt(z, x, y) {
  const F = W.floors[z];
  for (const r of F.rooms) {
    if (x >= r.x + 1 && x <= r.x + r.iw && y >= r.y + 1 && y <= r.y + r.ih) return r;
  }
  return null;
}

function drawWorld() {
  const scale = TS * ZOOM;
  const ox = CVW / 2 - CAMX * scale, oy = CVH / 2 - CAMY * scale;
  const x0 = Math.max(0, Math.floor(CAMX - CVW / 2 / scale) - 1), x1 = Math.min(MW - 1, Math.ceil(CAMX + CVW / 2 / scale) + 1);
  const y0 = Math.max(0, Math.floor(CAMY - CVH / 2 / scale) - 1), y1 = Math.min(MH - 1, Math.ceil(CAMY + CVH / 2 / scale) + 1);
  const F = W.floors[P.z];
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.lineWidth = 0.06;
  ctx.lineJoin = 'round';

  // ---- flat ground / room floors
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ch = F.G[y][x];
    const wallish = ch === '#' || ch === 'D' || ch === 'W' || ch === 'w' || ch === 'X' || ch === 'L' || ch === 'B' || ch === 'U' || ch === 'N';
    let col;
    const r = roomAt(P.z, x, y);
    if (wallish) col = COL.wall;
    else if (r) col = r.col;
    else if (P.z === 0) col = (x + y) % 2 ? COL.grassA : COL.grassB;
    else col = COL.roof;
    if (ch === 'P') col = COL.path;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1.02, 1.02);
    if (r && !wallish) { ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.strokeRect(x, y, 1, 1); ctx.strokeStyle = COL.edge; }
  }

  // ---- walls, doors, windows, fences, stairs
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ch = F.G[y][x];
    let col = null, inset = 0;
    if (ch === '#') col = COL.wall;
    else if (ch === 'F') col = COL.fence;
    else if (ch === 'S') continue; // furniture, drawn below
    else if (ch === 'W') col = COL.win;
    else if (ch === 'w') col = COL.winBroken;
    else if (ch === 'X') col = COL.boarded;
    else if (ch === 'L') col = COL.locked;
    else if (ch === 'B') col = COL.cellar;
    else if (ch === 'D') { col = COL.door; inset = 0.15; }
    else if (ch === 'U') col = COL.up;
    else if (ch === 'N') col = COL.down;
    if (!col) continue;
    if (ch === 'F') {
      if (P.z > 0) continue;   // upstairs, outside the rooms is just roof
      // a picket fence: one plain white post per tile (the old look)
      ctx.fillStyle = COL.fence;
      ctx.fillRect(x + 0.34, y + 0.28, 0.32, 0.44);
      continue;
    }
    if (ch === 'D') {
      const dd = doorAt(P.z, x, y);
      if (dd && !dd.closed) ctx.globalAlpha = 0.3;
    }
    ctx.strokeStyle = COL.edge;
    ctx.fillStyle = col;
    ctx.fillRect(x + inset, y + inset, 1 - 2 * inset, 1 - 2 * inset);
    if (ch !== '#') ctx.strokeRect(x + inset, y + inset, 1 - 2 * inset, 1 - 2 * inset);
    ctx.globalAlpha = 1;
    if (ch === 'w') {
      ctx.strokeStyle = '#778899';
      ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.9); ctx.lineTo(x + 0.5, y + 0.3); ctx.lineTo(x + 0.9, y + 0.9); ctx.stroke();
      ctx.strokeStyle = COL.edge;
    }
    if (ch === 'U' || ch === 'N') {
      ctx.fillStyle = COL.edge;
      ctx.beginPath();
      if (ch === 'U') { ctx.moveTo(x + 0.25, y + 0.72); ctx.lineTo(x + 0.5, y + 0.28); ctx.lineTo(x + 0.75, y + 0.72); }
      else { ctx.moveTo(x + 0.25, y + 0.28); ctx.lineTo(x + 0.5, y + 0.72); ctx.lineTo(x + 0.75, y + 0.28); }
      ctx.closePath(); ctx.fill();
    }
  }

  // ---- furniture: a flat coloured box with an outline
  for (const f of F.furniture) {
    ctx.fillStyle = FC[f.k] || '#999999';
    ctx.fillRect(f.x + 0.06, f.y + 0.06, f.w - 0.12, f.h - 0.12);
    ctx.strokeRect(f.x + 0.06, f.y + 0.06, f.w - 0.12, f.h - 0.12);
  }
  if (P.z === 0) for (const d of W.decor) {
    const [dz, x, y, dw, dh, k] = d;
    if (dz !== 0) continue;
    ctx.fillStyle = FC[k] || '#999999';
    if (k === 'tree') { ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 1.05, 0, 7); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(x + 0.1, y + 0.1, dw - 0.2, dh - 0.2); ctx.strokeRect(x + 0.1, y + 0.1, dw - 0.2, dh - 0.2); }
  }

  // ---- splats, traps, cameras, loose items
  for (const s of SPL) {
    if (s.z !== P.z) continue;
    ctx.fillStyle = s.k === 'splat' ? 'rgba(230,59,46,0.7)' : 'rgba(126,200,255,0.7)';
    ctx.beginPath(); ctx.arc(s.x, s.y, 0.35, 0, 7); ctx.fill();
  }
  for (const t of TRAPS) {
    if (t.z !== P.z) continue;
    ctx.strokeStyle = t.armed ? '#cc3b32' : '#888888';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.arc(t.x + 0.5, t.y + 0.5, 0.3, 0, 7);
    ctx.moveTo(t.x + 0.3, t.y + 0.3); ctx.lineTo(t.x + 0.7, t.y + 0.7);
    ctx.moveTo(t.x + 0.7, t.y + 0.3); ctx.lineTo(t.x + 0.3, t.y + 0.7);
    ctx.stroke();
    ctx.lineWidth = 0.06;
  }
  for (const c of CAMS) {
    if (c.z !== P.z) continue;
    ctx.fillStyle = '#222222';
    ctx.fillRect(c.x + 0.3, c.y + 0.3, 0.4, 0.4);
    ctx.beginPath();
    ctx.moveTo(c.x + 0.5, c.y + 0.5);
    for (let i = 0; i <= 14; i++) {
      const a = c.a - (CAM_FOV || 0.6) + 2 * (CAM_FOV || 0.6) * i / 14;
      let ex = c.x + 0.5, ey = c.y + 0.5;
      for (let r = 0.3; r < (CAM_RANGE || 9); r += 0.25) {
        const px = c.x + 0.5 + Math.cos(a) * r, py = c.y + 0.5 + Math.sin(a) * r;
        if (opaque(P.z, px, py)) break;
        ex = px; ey = py;
      }
      ctx.lineTo(ex, ey);
    }
    ctx.closePath();
    ctx.fillStyle = c.seeT > 0.2 ? 'rgba(232,69,58,0.25)' : 'rgba(232,69,58,0.08)';
    ctx.fill();
    ctx.strokeStyle = COL.edge;
    ctx.stroke();
  }
  for (const k of W.containers) {
    if (k.z !== P.z || k.done) continue;
    ctx.fillStyle = COL.clue;
    for (let i = 0; i < (k.w || 1); i++) {
      ctx.fillRect(k.tx + i + 0.36, k.ty + 0.36, 0.28, 0.28);
      ctx.strokeRect(k.tx + i + 0.36, k.ty + 0.36, 0.28, 0.28);
    }
  }
  if (W.secret.z === P.z) {
    ctx.fillStyle = COL.clue;
    ctx.beginPath(); ctx.arc(W.secret.x, W.secret.y, 0.3 + Math.sin(GAME.t * 4) * 0.05, 0, 7); ctx.fill(); ctx.stroke();
  }
  for (const it of ITEMS) {
    if (it.z !== P.z || it.taken || it.fly) continue;
    ctx.fillStyle = IC[it.k] || '#999999';
    ctx.beginPath();
    if (it.k === 'chair' || it.k === 'box') ctx.rect(it.x - 0.2, it.y - 0.2, 0.4, 0.4);
    else ctx.arc(it.x, it.y, 0.2, 0, 7);
    ctx.fill(); ctx.stroke();
  }
  for (const p of PR) {
    if (p.dead || Math.abs(p.z) > 0.05) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.27)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 0.14, 0, 7); ctx.fill();
    ctx.fillStyle = IC[p.k] || '#999999';
    ctx.beginPath(); ctx.arc(p.x, p.y - p.z * 0.25, 0.17, 0, 7); ctx.fill(); ctx.stroke();
  }

  // ---- his belief about where you are (debug overlay, M)
  if (UI.showBelief) {
    const B = BEL[P.z];
    if (B) {
      let peak = 0.000001;
      for (let i = 0; i < B.length; i++) if (B[i] > peak) peak = B[i];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const v = B[y * MW + x];
        if (v <= peak * 0.004) continue;
        ctx.fillStyle = 'rgba(255,0,60,' + Math.min(0.6, Math.sqrt(v / peak) * 0.6) + ')';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // ---- noise rings
  for (const n of NZ) {
    if (n.z !== P.z) continue;
    const a = n.t / 0.9;
    if (a < 0 || a > 1) continue;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * (1 - a)) + ')';
    ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r * a, 0, 7); ctx.stroke();
    ctx.lineWidth = 0.06;
  }

  // ---- his view cone, cut by walls (only what he really sees)
  if (N && N.z === P.z) {
    const cone = viewCone(N.x, N.y, N.a, sightRange(), N.z);
    if (cone.length) {
      ctx.beginPath();
      ctx.moveTo(N.x, N.y);
      for (const q of cone) ctx.lineTo(q[0], q[1]);
      ctx.closePath();
      ctx.fillStyle = N.mode === 'chase' ? 'rgba(232,69,58,.2)'
        : N.al > 0.15 ? 'rgba(224,194,58,.24)'
          : N.sleeping ? 'rgba(120,120,255,.12)' : 'rgba(255,240,150,.16)';
      ctx.fill();
    }
    if (UI.showPath && N.path && N.path.length) {
      ctx.strokeStyle = '#2d6fdc'; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(N.x, N.y);
      for (const q of N.path) ctx.lineTo(q.x + 0.5, q.y + 0.5);
      ctx.stroke();
      ctx.lineWidth = 0.06;
    }
  }

  // ---- the neighbour
  if (N) {
    if (N.z === P.z) {
      ctx.strokeStyle = COL.edge; ctx.lineWidth = 0.1;
      ctx.fillStyle = N.mode === 'chase' ? COL.chase : COL.npc;
      ctx.beginPath(); ctx.arc(N.x, N.y, 0.46, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a1a10';
      ctx.beginPath(); ctx.arc(N.x + Math.cos(N.a) * 0.28, N.y + Math.sin(N.a) * 0.28, 0.13, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 0.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 0.08; ctx.strokeStyle = '#000000';
      const lb = String(N.label || N.st || 'idle').replace(/_/g, ' ');
      ctx.strokeText(lb, N.x, N.y - 0.8);
      ctx.fillText(lb, N.x, N.y - 0.8);
      if (N.sleeping) { ctx.font = 'bold 1px sans-serif'; ctx.fillText('Zzz', N.x + 0.5, N.y - 1.4); }
      if (N.al > 0.15 || N.mode === 'chase') {
        ctx.font = 'bold 1.2px sans-serif';
        ctx.fillStyle = N.mode === 'chase' ? '#ff3333' : '#ffcc00';
        ctx.fillText(N.mode === 'chase' ? '!' : '?', N.x, N.y - 1.5);
      }
      ctx.lineWidth = 0.06; ctx.strokeStyle = COL.edge; ctx.textAlign = 'left';
    } else {
      // he is on the other floor: show him at the stairs
      const st = stairSpot(N.z);
      if (st) {
        ctx.fillStyle = 'rgba(232,69,58,.5)';
        ctx.beginPath(); ctx.arc(st.x + 0.5, st.y + 0.5, 0.3, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 0.55px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(N.z > P.z ? 'ABOVE' : 'BELOW', st.x + 0.5, st.y - 0.2);
        ctx.textAlign = 'left';
      }
    }
  }

  // ---- the player
  if (P.aim === undefined) P.aim = P.a;
  if (P.carried) {
    ctx.setLineDash([0.15, 0.2]);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath();
    ctx.moveTo(P.x, P.y);
    ctx.lineTo(P.x + Math.cos(P.a) * 9, P.y + Math.sin(P.a) * 9);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const pr = P.crouch ? 0.27 : 0.36;
  ctx.strokeStyle = COL.edge; ctx.lineWidth = 0.1;
  ctx.fillStyle = COL.player;
  ctx.beginPath(); ctx.arc(P.x, P.y, pr, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = COL.aim;
  ctx.beginPath(); ctx.arc(P.x + Math.cos(P.a) * pr * 0.55, P.y + Math.sin(P.a) * pr * 0.55, pr * 0.38, 0, 7); ctx.fill();
  if (P.carried) {
    ctx.fillStyle = IC[P.carried] || '#999999';
    ctx.beginPath(); ctx.arc(P.x - Math.cos(P.a) * 0.3, P.y - Math.sin(P.a) * 0.3, 0.14, 0, 7); ctx.fill();
  }
  if (P.hold > 0 && P.tgt) {
    ctx.strokeStyle = COL.clue; ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(P.x, P.y, 0.6, -Math.PI / 2, -Math.PI / 2 + Math.min(1, P.hold / P.tgt.t) * 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 0.06;
  }
  ctx.restore();

  // ---- night: one flat blue wash, no pools
  const night = nightAmount();
  if (night > 0.02) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(9,18,52,' + (night * 0.4) + ')';
    ctx.fillRect(0, 0, CVW, CVH);
    if (P.flash) {
      const g = ctx.createRadialGradient(CVW / 2, CVH / 2, 10, CVW / 2, CVH / 2, 240);
      g.addColorStop(0, 'rgba(255,244,200,0.18)');
      g.addColorStop(1, 'rgba(255,244,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CVW, CVH);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // ---- a soft vignette, then the danger edge
  const vg = ctx.createRadialGradient(CVW / 2, CVH / 2, Math.min(CVW, CVH) * 0.42, CVW / 2, CVH / 2, Math.max(CVW, CVH) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(6,12,20,.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CVW, CVH);
  if (N && N.mode === 'chase' && N.z === P.z) {
    ctx.strokeStyle = 'rgba(232,69,58,' + (0.22 + Math.sin(performance.now() / 300) * 0.12) + ')';
    ctx.lineWidth = 7;
    ctx.strokeRect(0, 0, CVW, CVH);
  }
}

function nightAmount() {
  if (!GAME) return 0;
  const h = ((GAME.clock % 24) + 24) % 24;
  if (h >= 21 || h < 5) return 1;
  if (h >= 18) return (h - 18) / 3;
  if (h < 7) return 1 - (h - 5) / 2;
  return 0;
}

/* a sight cone that stops at walls — his real field of view */
function viewCone(x, y, a, range, z) {
  const out = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const ang = a - 0.95 + (2 * 0.95 * i) / N;
    let px = x, py = y;
    for (let r = 0.35; r < range; r += 0.22) {
      const nx = x + Math.cos(ang) * r, ny = y + Math.sin(ang) * r;
      if (opaque(z == null ? P.z : z, nx, ny)) break;
      px = nx; py = ny;
    }
    out.push([px, py]);
  }
  return out;
}

function stairSpot(z) {
  if (!W || !W.stairs) return null;
  for (const s of W.stairs) {
    if (s.a.z === z) return s.a;
    if (s.b.z === z) return s.b;
  }
  return null;
}

function opaque(z, x, y) {
  const c = T(z, x | 0, y | 0);
  if (c === '#' || c === 'S' || c === 'W' || c === 'X' || c === 'T') return true;
  if (c === 'D' || c === 'L' || c === 'B') return doorClosed(z, x | 0, y | 0);
  return false;
}

/* -------------------------------------------------------------- the HUD */
let panelsOn = null;
function showPanels(on) {
  if (panelsOn === on) return;
  panelsOn = on;
  for (const id of ['hud', 'dbg', 'inv']) {
    const el = $(id);
    if (el) el.style.display = on ? 'block' : 'none';
  }
  if (!on) { const m = $('msg'); if (m) m.style.display = 'none'; }
}

let hudCache = '';
function drawHUD() {
  const hud = $('hud'), dbg = $('dbg'), inv = $('inv'), msg = $('msg');
  if (!hud) return;
  const hh = Math.floor(GAME.clock), mm = Math.floor((GAME.clock % 1) * 60);
  const tick = (b) => (b ? '✔' : '·');
  const objs = [
    tick(P.keys.pick) + ' lockpick (shed)',
    tick(P.keys.red) + ' red key (kitchen fridge)',
    tick(P.keys.blue) + ' blue key (study desk)',
    tick(!!W.cellarOpen || (W.cellarDoor && !W.cellarDoor.closed)) + ' vault (workshop, red key)',
    tick(M.wins > 0) + ' take the SECRET',
  ];
  const pr = promptText();
  const L = '<b>Objective</b>\n' + objs.join('\n') +
    (P.z === 1 ? '\n<span class="dim">upstairs</span>' : '') +
    (pr ? '\n<b style="color:#ffd23f">' + pr + '</b>' : '');
  if (L !== hudCache) { hudCache = L; hud.innerHTML = L; }

  const slots = [
    '<span class="slot' + (P.keys.pick ? ' sel' : '') + '">🗝 pick</span>',
    '<span class="slot' + (P.keys.red ? ' sel' : '') + '">red</span>',
    '<span class="slot' + (P.keys.blue ? ' sel' : '') + '">blue</span>',
    '<span class="slot">' + (P.carried || '—') + '</span>',
  ];
  const IH = slots.join('');
  if (inv._last !== IH) { inv._last = IH; inv.innerHTML = IH; }

  const bar = (v, col) => '<span class="bar" style="width:' + Math.round(clamp(v, 0, 1) * 60) + 'px;background:' + col + '"></span>';
  const D = '<b>THE NEIGHBOUR</b> ' + pad(hh) + ':' + pad(mm) +
    '\nstate: <b>' + (N.mode || '?') + '</b> ' + String(N.st || '').replace(/_/g, ' ') +
    '\ndoing: ' + (N.label || '—') +
    '\nawareness ' + bar(N.mode === 'chase' ? 1 : N.al, '#f33') +
    '\nsuspicion ' + bar((M.suspicion || 0) / 100, '#f80') +
    '\nbelief ' + Math.round((BEL[P.z] ? belTotal(P.z) : 0) * 100) + '% · floor ' + (P.z + 1) + '/2' +
    '\ncatches ' + M.catches + ' · wins ' + M.wins +
    '\ntraps ' + TRAPS.length + ' · cameras ' + CAMS.length +
    '\n' + (UI.showBelief ? 'M belief on' : 'M belief off');
  if (dbg._last !== D) { dbg._last = D; dbg.innerHTML = D; }

  if (UI.msgT > 0 && UI.msg) {
    msg.style.display = 'block';
    if (msg._last !== UI.msg) { msg._last = UI.msg; msg.innerHTML = UI.msg; }
  } else if (msg.style.display !== 'none') msg.style.display = 'none';
}
const pad = (n) => (n < 10 ? '0' + n : '' + n);

function promptText() {
  if (!P || !W || !GAME || GAME.state !== 'play') return '';
  for (const c of W.containers) {
    const cw = c.w || 1;
    if (c.z === P.z && P.x > c.tx - 1 && P.x < c.tx + cw + 1 && P.y > c.ty - 1 && P.y < c.ty + 2) {
      return 'E — ' + (c.done ? c.label + ' (empty)' : 'search the ' + c.label);
    }
  }
  const it = nearestLooseItem();
  if (it) return 'G — pick up the ' + it.k;
  if (W.secret.z === P.z && dst(P.x, P.y, W.secret.x, W.secret.y) < 1.9) return 'E — the SECRET';
  const fx = Math.floor(P.x + Math.cos(P.a) * 0.75), fy = Math.floor(P.y + Math.sin(P.a) * 0.75);
  const d = doorAt(P.z, fx, fy);
  if (d) {
    if (d.kind === 'cellar') return d.closed ? (P.keys.red ? 'E — unlock the vault' : 'E — locked (red key)') : 'E — vault open';
    if (d.kind === 'lock') return d.closed ? (P.keys.pick ? 'E — pick the study lock' : 'E — locked (lockpick)') : 'E — study open';
    return d.closed ? 'E — open the door' : 'E — close the door';
  }
  const t = T(P.z, fx, fy);
  if (t === 'W') return 'E — climb through the window';
  if (t === 'w') return 'E — climb through the broken window';
  if (t === 'X') return 'boarded up';
  if (stairsHere()) return 'E — ' + (P.z === 0 ? 'go upstairs' : 'go downstairs');
  if (P.hidden) return 'E — come out';
  return '';
}

function stairsHere() {
  if (!W) return false;
  return !!(stairFrom(P.z, P.x | 0, P.y | 0));
}

/* ------------------------------------------------------------- the menu */
function drawMenu(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, CVH);
  g.addColorStop(0, '#0b1018');
  g.addColorStop(1, '#131a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CVW, CVH);
  if (W) { // a small plain map of the house as a backdrop
    ctx.save();
    ctx.globalAlpha = 0.18;
    const S = 11;
    ctx.translate(CVW / 2 - (HOUSE.x + HOUSE.w / 2) * S, CVH / 2 - (HOUSE.y + HOUSE.h / 2) * S);
    for (let y = HOUSE.y; y < HOUSE.y + HOUSE.h; y++) for (let x = HOUSE.x; x < HOUSE.x + HOUSE.w; x++) {
      const c = W.floors[0].G[y] && W.floors[0].G[y][x];
      ctx.fillStyle = c === '#' ? '#3a4553' : c === 'D' ? '#8a5a2b' : '#7b8fa3';
      ctx.fillRect(x * S, y * S, S - 0.6, S - 0.6);
    }
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, CVW, CVH);
  const t = performance.now() / 1000;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 52px ui-monospace, monospace';
  ctx.fillText('HELLO NEIGHBOUR', CVW / 2, 150 + Math.sin(t) * 2);
  ctx.fillStyle = '#9fb4c9';
  ctx.font = '600 15px ui-monospace, monospace';
  ctx.fillText('2D · one house · two floors · a neighbour who learns', CVW / 2, 182);

  const has = !!storedMatch();
  const items = menuItems(has);
  items.forEach((it, i) => {
    const y = 246 + i * 66;
    const sel = i === MENU.sel;
    ctx.fillStyle = sel ? 'rgba(242,193,78,0.16)' : 'rgba(255,255,255,0.04)';
    roundRect(CVW / 2 - 200, y - 28, 400, 56, 12); ctx.fill();
    if (sel) { ctx.strokeStyle = 'rgba(242,193,78,0.65)'; ctx.lineWidth = 1.4; roundRect(CVW / 2 - 200, y - 28, 400, 56, 12); ctx.stroke(); }
    ctx.fillStyle = it.disabled ? 'rgba(160,176,196,0.35)' : sel ? '#ffe6b0' : '#cfdae8';
    ctx.font = '600 17px ui-monospace, monospace';
    ctx.fillText(it.label, CVW / 2, y - 1);
    if (it.sub) {
      ctx.fillStyle = 'rgba(160,176,196,0.5)';
      ctx.font = '10.5px ui-monospace, monospace';
      ctx.fillText(it.sub, CVW / 2, y + 17);
    }
    MENU.rects[i] = { x: CVW / 2 - 200, y: y - 28, w: 400, h: 56 };
  });
  ctx.fillStyle = 'rgba(160,176,196,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText('↑↓ select   ENTER play   ·   WASD move   E use   C crouch   SHIFT sprint', CVW / 2, CVH - 40);
  ctx.fillStyle = 'rgba(160,176,196,0.35)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('He remembers how you play this match. New Game erases everything he has learned.', CVW / 2, CVH - 20);
  ctx.textAlign = 'left';
}

const MENU = { sel: 0, rects: [] };
function menuItems(has) {
  return [
    { id: 'play', label: has ? 'CONTINUE' : 'PLAY', sub: has ? 'same house, he remembers you' : 'the house, from tonight' },
    { id: 'new', label: 'NEW GAME', sub: 'wipe everything he has learned' },
    { id: 'help', label: 'HOW TO PLAY', sub: 'controls, keys, and the vault' },
  ];
}
function menuKey(code) {
  const items = menuItems(!!storedMatch());
  if (code === 'ArrowUp' || code === 'KeyW') MENU.sel = (MENU.sel + items.length - 1) % items.length;
  else if (code === 'ArrowDown' || code === 'KeyS') MENU.sel = (MENU.sel + 1) % items.length;
  else if (code === 'Enter' || code === 'Space') menuAct(items[MENU.sel].id);
  return true;
}
function menuClick(x, y) {
  const items = menuItems(!!storedMatch());
  for (let i = 0; i < MENU.rects.length; i++) {
    const r = MENU.rects[i];
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { MENU.sel = i; menuAct(items[i].id); return true; }
  }
  return false;
}
function menuAct(id) {
  if (id === 'play') startMatchFromMenu(false);
  else if (id === 'new') startMatchFromMenu(true);
  else if (id === 'help') { UI.screen = 'help'; }
}

/* --------------------------------------------------------------- screens */
function drawHelp() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b1018';
  ctx.fillRect(0, 0, CVW, CVH);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 26px ui-monospace, monospace';
  ctx.fillText('HOW TO PLAY', 60, 70);
  ctx.fillStyle = '#cfdae8';
  ctx.font = '13px ui-monospace, monospace';
  const rows = [
    'WASD / arrows   move          C  crouch        SHIFT  sprint (loud)',
    'E  use / open / search / stairs        G  pick up / drop',
    'F  throw what you carry at the cursor   H  hide        T  torch',
    'ESC  pause           M  show his belief map        P  pause',
    '',
    'Three keys, no pockets: the lockpick is in the yard shed, the red key',
    'is in the kitchen fridge, the blue key is on the study desk. They live',
    'on your keyring — never in your hands. The vault is in the workshop;',
    'the SECRET is inside it.',
    '',
    'The stairs are in the foyer. Upstairs he sleeps, and the landing lets',
    'you cross the house without the rooms he watches.',
    '',
    'He hears you: running, doors, dropped things, breaking glass. He',
    'investigates, sets traps on the way you keep coming in, and re-locks',
    'what you pick. This match he learns; a New Game forgets it all.',
  ];
  rows.forEach((r, i) => ctx.fillText(r, 60, 110 + i * 22));
  ctx.fillStyle = 'rgba(160,176,196,0.55)';
  ctx.fillText('click or any key to go back', 60, CVH - 40);
}

function drawCut(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, CVH);
  g.addColorStop(0, '#080c13');
  g.addColorStop(1, '#182230');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CVW, CVH);
  const beats = CUTSCENE;
  const dur = 13 / beats.length;
  const i = Math.min(beats.length - 1, Math.floor(UI.cut / dur));
  const local = (UI.cut % dur) / dur;
  const a = Math.min(1, local * 3) * Math.min(1, (1 - local) * 3);
  const b = beats[i];
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 30px ui-monospace, monospace';
  wrapText(b.title, CVW / 2, 240, 700, 40);
  ctx.fillStyle = '#cfdae8';
  ctx.font = '14px ui-monospace, monospace';
  wrapText(b.body, CVW / 2, 310, 640, 26);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText('click or SPACE to skip', CVW / 2, CVH - 40);
  ctx.textAlign = 'left';
}
const CUTSCENE = [
  { title: 'THE HOUSE ON THE HILL', body: 'One house, two floors, one neighbour. Get in, get the keys, get out with what is locked in his vault.' },
  { title: 'THREE KEYS, NO POCKETS', body: 'The lockpick is in the shed. The red key is in the fridge, the blue key on the study desk. They go on your keyring — never in your hands.' },
  { title: 'THE UPSTAIRS', body: 'Stairs in the foyer. He sleeps up there, and the landing lets you cross the house without walking through the rooms he watches.' },
  { title: 'HE IS LEARNING', body: 'He hears your steps, notices what you take, and re-locks what you pick. Caught or not, this match he keeps what he learns. New Game forgets it.' },
];

function wrapText(text, x, y, max, lh) {
  const words = String(text).split(' ');
  let line = '', yy = y;
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > max) { ctx.fillText(line, x, yy); line = wd; yy += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawPause() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(5,8,12,.75)';
  ctx.fillRect(0, 0, CVW, CVH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 26px ui-monospace, monospace';
  ctx.fillText('PAUSED', CVW / 2, 110);
  ctx.fillStyle = '#cfdae8';
  ctx.font = '13px ui-monospace, monospace';
  const rows = [
    'what he knows about this match',
    '',
    'suspicion       ' + Math.round(M.suspicion || 0) + '/100',
    'catches / wins  ' + M.catches + ' / ' + M.wins,
    'traps · cameras ' + TRAPS.length + ' · ' + CAMS.length,
    'doors noticed   ' + Object.keys(M.entries || {}).length,
    'things taken    ' + (M.thefts || []).length,
    'hiding spots    ' + (M.hides || []).length,
    '',
    'ESC resume  ·  R restart this match  ·  M belief overlay',
  ];
  rows.forEach((r, i) => ctx.fillText(r, CVW / 2, 170 + i * 24));
  ctx.textAlign = 'left';
}

function drawOver() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(5,8,12,.82)';
  ctx.fillRect(0, 0, CVW, CVH);
  const win = UI.over === 'win';
  ctx.textAlign = 'center';
  ctx.fillStyle = win ? '#5fd08a' : '#e2564a';
  ctx.font = '700 40px ui-monospace, monospace';
  ctx.fillText(win ? 'YOU GOT OUT WITH IT' : 'CAUGHT', CVW / 2, 220);
  ctx.fillStyle = '#cfdae8';
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(win
    ? 'The SECRET is yours. He will remember how you did it.'
    : 'He walked you back out. He will remember which way you came.', CVW / 2, 268);
  ctx.fillStyle = 'rgba(160,176,196,0.6)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText('ENTER or click — back into the house', CVW / 2, 330);
  ctx.textAlign = 'left';
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
