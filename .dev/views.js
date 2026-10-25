'use strict';
/* =====================================================================
   views.js — rendering, HUD, menu, cutscene, memory panel
   ===================================================================== */

const PAL = {
  grass: ['#2b4433', '#2f4a37', '#334f3b'],
  yard: '#3a4436', path: '#6e644f', porch: '#6b6151',
  wall: '#23272e', wallTop: '#333a45', wallEdge: '#171a20',
  fence: '#5a4a34',
  floorWood: '#4a3a2a', floorTile: '#4c4f4c', floorStone: '#3e4248', floorCarpet: '#463a44',
  door: '#8a5a2b', doorLocked: '#a98b3f', glass: '#7fb4cf', glassBroken: '#4d6d7a',
  stair: '#8d7b5c', furn: '#3a4048', noise: '#f0d9a0',
  player: '#39d0c6', playerDark: '#1d7a75', neighbour: '#c0392b', neighbourDark: '#7d2018',
  accent: '#f2c14e', good: '#5fd08a', bad: '#e2564a', keyring: '#d8d2c4',
};

let DARK = null;
function darkCanvas() {
  if (!DARK) { DARK = document.createElement('canvas'); DARK.width = CVW; DARK.height = CVH; }
  DARK.width = CVW; DARK.height = CVH;
  return DARK;
}

function render(dt) {
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CVW, CVH);
  if (UI.screen === 'menu') { drawMenu(dt); return; }
  if (UI.screen === 'help') { drawHelp(); return; }
  if (UI.screen === 'cut') { drawCut(dt); return; }
  if (!GAME || !W) return;
  drawWorld();
  drawHUD();
  if (UI.screen === 'pause') drawPause();
  if (UI.screen === 'over') drawOver();
}

/* ------------------------------------------------------------- world draw */
const VH = (x, y, n) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) % n;
};

function drawWorld() {
  const scale = TS * ZOOM;
  const ox = CVW / 2 - CAMX * scale, oy = CVH / 2 - CAMY * scale;
  const x0 = Math.max(0, Math.floor(CAMX - CVW / 2 / scale) - 1), x1 = Math.min(MW - 1, Math.ceil(CAMX + CVW / 2 / scale) + 1);
  const y0 = Math.max(0, Math.floor(CAMY - CVH / 2 / scale) - 1), y1 = Math.min(MH - 1, Math.ceil(CAMY + CVH / 2 / scale) + 1);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  // ---- ground / roof / bedrock depending on the floor you are on
  const zNow = P ? P.z : 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (zNow === 0) {
      ctx.fillStyle = PAL.grass[VH(x, y, 3)];
      ctx.fillRect(x, y, 1.02, 1.02);
      if (VH(x, y, 11) === 0) {
        ctx.fillStyle = 'rgba(120,160,110,0.16)';
        ctx.fillRect(x + 0.2 + VH(x, y, 5) * 0.1, y + 0.3, 0.1, 0.5);
        ctx.fillRect(x + 0.34 + VH(y, x, 5) * 0.1, y + 0.2, 0.08, 0.4);
      }
    } else if (zNow === 1) {
      ctx.fillStyle = shadeColor('#232a33', VH(x, y, 4) * 2 - 3);
      ctx.fillRect(x, y, 1.02, 1.02);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y + 0.86, 1.02, 0.12);
      if (VH(x, y, 9) === 0) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(x + 0.2, y + 0.2, 0.6, 0.5); }
    } else {
      ctx.fillStyle = shadeColor('#14171c', VH(x, y, 3) * 2);
      ctx.fillRect(x, y, 1.02, 1.02);
      if (VH(x, y, 13) === 0) { ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fillRect(x + 0.1, y + 0.4, 0.8, 0.2); }
    }
  }
  // ---- yard / porch / path
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = T(P ? P.z : 0, x, y);
    if (c === ',' || c === 'P') {
      ctx.fillStyle = c === 'P' ? PAL.porch : PAL.yard;
      ctx.fillRect(x, y, 1.02, 1.02);
      ctx.fillStyle = VH(x, y, 2) ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(x + 0.1, y + 0.1, 0.8, 0.8);
    }
  }

  const F = W.floors[P ? P.z : 0];
  if (!F) { ctx.restore(); return; }

  // ---- room floors with a little texture
  for (const r of F.rooms) {
    const tint = roomFloorColor(r.type);
    for (let y = r.y + 1; y < r.y + 1 + r.ih; y++) for (let x = r.x + 1; x < r.x + 1 + r.iw; x++) {
      const v = VH(x, y, 7);
      ctx.fillStyle = shadeColor(tint, (v - 3) * 2.2);
      ctx.fillRect(x, y, 1.02, 1.02);
      if (r.type === 'bathroom' || r.type === 'kitchen') {
        ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 0.035;
        ctx.strokeRect(x + 0.02, y + 0.02, 0.98, 0.98);
      } else if (r.type === 'vault') {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(x, y + 0.88, 1.02, 0.1);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x, y + 0.9 + (VH(x, y, 3) * 0.03), 1.02, 0.07);
        if (VH(y, x, 4) === 0) { ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(x + 0.35, y, 0.04, 1); }
      }
    }
    if (r.type === 'bedroom' || r.type === 'living') {
      // a rug
      const rx = r.x + 2, ry = r.y + 2, rw = Math.max(2, r.iw - 3), rh = Math.max(2, r.ih - 3);
      ctx.fillStyle = r.type === 'bedroom' ? 'rgba(120,60,80,0.22)' : 'rgba(140,100,50,0.18)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.05;
      ctx.strokeRect(rx + 0.12, ry + 0.12, rw - 0.24, rh - 0.24);
    }
  }

  // ---- tiles
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = F.G[y][x];
    switch (c) {
      case '#': drawWall(x, y, F); break;
      case 'F': if (F.z === 0) drawFence(x, y); break;
      case 'S': break;
      case 'W': drawWindow(x, y, 0); break;
      case 'X': drawWindow(x, y, 1); break;
      case 'w': drawWindow(x, y, 2); break;
      case 'D': drawDoor(x, y, F); break;
      case 'L': drawLockedDoor(x, y, 'lock'); break;
      case 'B': drawLockedDoor(x, y, 'cellar'); break;
      case 'U': case 'N': drawStairs(x, y, c); break;
      case 'V': drawSecret(x, y); break;
    }
  }

  drawRoomLabels(F, x0, x1, y0, y1);
  drawFurniture(F, x0, x1, y0, y1);
  drawItems();
  drawContainers(F);
  drawTraps();
  drawCameras();
  drawSplats();
  if (N) drawNeighbour();
  if (P) drawPlayer();
  for (const p of PR) drawProjectile(p);
  drawNightOverlay(scale, ox, oy);
  if (UI.showBelief) drawBeliefOverlay();
  if (UI.showPath && N && N.mode === 'search') drawPathOverlay();
  drawNoiseRings();
  ctx.restore();

  drawVignette();
  if (P && P.hidden) drawHideOverlay();
  if (N && N.mode === 'chase') drawDangerEdge();
}

function shadeColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) + amt, 0, 255) | 0;
  const b = clamp((n & 255) + amt, 0, 255) | 0;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function roomFloorColor(t) {
  switch (t) {
    case 'kitchen': return '#5a5c56';
    case 'bathroom': return '#5c6874';
    case 'bedroom': return '#5b4652';
    case 'study': return '#4f4234';
    case 'living': return '#584433';
    case 'workshop': return '#4c5058';
    case 'hall': return '#564637';
    case 'vault': return '#3f444b';
    default: return PAL.floorWood;
  }
}

function drawWall(x, y, F) {
  const below = F.G[y + 1] && F.G[y + 1][x];
  const open = below !== '#' && below !== undefined;
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(x, y, 1.02, 1.02);
  // subtle brick courses
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fillRect(x + 0.05, y + 0.12, 0.9, 0.06);
  ctx.fillRect(x + 0.05, y + 0.52, 0.9, 0.06);
  if (open) {
    // top face + skirting where the wall meets the room below
    ctx.fillStyle = PAL.wallTop;
    ctx.fillRect(x, y + 0.74, 1.02, 0.26);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y + 0.74, 1.02, 0.06);
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(x, y + 0.98, 1.02, 0.09);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(x, y, 1.02, 0.04);
  ctx.fillRect(x, y, 0.04, 1.02);
}

function drawFence(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 0.06, y + 0.28, 0.96, 0.7);
  ctx.fillStyle = PAL.fence;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 0.06 + i * 0.25, y + 0.05, 0.12, 0.95);
  ctx.fillStyle = '#7a6547';
  ctx.fillRect(x, y + 0.2, 1.02, 0.11);
  ctx.fillRect(x, y + 0.66, 1.02, 0.11);
}

function drawRoomLabels(F, x0, x1, y0, y1) {
  for (const r of F.rooms) {
    if (r.x + r.iw < x0 || r.x > x1 || r.y + r.ih < y0 || r.y > y1) continue;
    const label = (r.type || 'room').toUpperCase();
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#dfe8f2';
    ctx.font = 'bold 0.3px ui-monospace, monospace';
    ctx.fillText(label, r.x + 1.2, r.y + 1.6);
    ctx.restore();
  }
}

function drawFurniture(F, x0, x1, y0, y1) {
  for (const f of F.furniture) {
    if (f.x > x1 || f.x + f.w < x0 || f.y > y1 || f.y + f.h < y0) continue;
    const x = f.x, y = f.y, w = f.w, h = f.h;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + 0.1, y + 0.16, w, h);
    switch (f.k) {
      case 'bed':
        ctx.fillStyle = '#3b4453'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#cfd8e6'; ctx.fillRect(x + 0.08, y + 0.08, w - 0.16, 0.42);
        ctx.fillStyle = '#8d9bb0'; ctx.fillRect(x + 0.08, y + 0.54, w - 0.16, h - 0.62);
        ctx.fillStyle = '#e9eef6'; ctx.fillRect(x + 0.14, y + 0.12, Math.min(0.5, w - 0.28), 0.28);
        break;
      case 'couch':
        ctx.fillStyle = '#4a5568'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#5b6982'; ctx.fillRect(x + 0.08, y + 0.08, w - 0.16, h - 0.2);
        ctx.fillStyle = '#3b4453'; ctx.fillRect(x + 0.08, y + h - 0.22, w - 0.16, 0.14);
        break;
      case 'table':
        ctx.fillStyle = '#6b5334'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#8a6c44'; ctx.fillRect(x + 0.08, y + 0.08, w - 0.16, h - 0.16);
        break;
      case 'tv':
        ctx.fillStyle = '#20242b'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#101318'; ctx.fillRect(x + 0.08, y + 0.1, w - 0.16, h - 0.34);
        ctx.fillStyle = 'rgba(120,180,220,0.35)'; ctx.fillRect(x + 0.12, y + 0.14, w - 0.24, 0.1);
        ctx.fillStyle = '#3a4250'; ctx.fillRect(x + 0.3, y + h - 0.16, Math.max(0.1, w - 0.6), 0.1);
        break;
      case 'fridge':
        ctx.fillStyle = '#b9c3cc'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#d6dee6'; ctx.fillRect(x + 0.06, y + 0.06, w - 0.12, h * 0.55);
        ctx.fillStyle = '#8e9aa5'; ctx.fillRect(x + 0.06, y + h * 0.62, w - 0.12, 0.06);
        break;
      case 'stove':
        ctx.fillStyle = '#2b3038'; ctx.fillRect(x, y, w, h);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = '#4b525c';
          ctx.beginPath(); ctx.arc(x + 0.28 + (i % 2) * 0.45, y + 0.28 + ((i / 2) | 0) * 0.45, 0.15, 0, 7); ctx.fill();
        }
        break;
      case 'sink':
        ctx.fillStyle = '#93a2ae'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#c8d4dd'; ctx.fillRect(x + 0.12, y + 0.14, w - 0.24, h - 0.3);
        ctx.fillStyle = '#5c6874'; ctx.fillRect(x + 0.2, y + 0.26, w - 0.4, h - 0.5);
        break;
      case 'tub':
        ctx.fillStyle = '#a9b7c2'; roundRect(x + 0.03, y + 0.03, w - 0.06, h - 0.06, 0.25); ctx.fill();
        ctx.fillStyle = '#d9e4ec'; roundRect(x + 0.12, y + 0.12, w - 0.24, h - 0.24, 0.2); ctx.fill();
        ctx.fillStyle = 'rgba(120,170,200,0.5)'; roundRect(x + 0.18, y + 0.18, w - 0.36, h - 0.36, 0.16); ctx.fill();
        break;
      case 'toilet': case 'basin':
        ctx.fillStyle = '#c3ced7'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.34, h * 0.36, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#e6eef4'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2 - 0.04, w * 0.24, h * 0.26, 0, 0, 7); ctx.fill();
        break;
      case 'wardrobe':
        ctx.fillStyle = '#4b3a28'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#634d35'; ctx.fillRect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
        ctx.fillStyle = '#8d7350'; ctx.fillRect(x + w / 2 - 0.03, y + 0.1, 0.06, h - 0.2);
        break;
      case 'desk':
        ctx.fillStyle = '#5a4127'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#7a5a37'; ctx.fillRect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
        ctx.fillStyle = '#e8e2d2'; ctx.fillRect(x + 0.12, y + 0.14, w * 0.35, h * 0.28);
        ctx.fillStyle = '#3b3f48'; ctx.fillRect(x + w * 0.6, y + 0.16, w * 0.28, h * 0.22);
        break;
      case 'bookshelf':
        ctx.fillStyle = '#4a3320'; ctx.fillRect(x, y, w, h);
        for (let j = 0; j < 3; j++) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 0.06, y + 0.2 + j * 0.28, w - 0.12, 0.04);
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = ['#b45c4a', '#5b7fb4', '#c3a34a', '#6a9a6a'][VH(x + i, y + j, 4)];
            ctx.fillRect(x + 0.08 + i * ((w - 0.16) / 4), y + 0.06 + j * 0.28, (w - 0.2) / 5, 0.14);
          }
        }
        break;
      case 'bench': case 'rack': case 'counter':
        ctx.fillStyle = '#4a4f57'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#5f6670'; ctx.fillRect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
        ctx.fillStyle = '#2f343c'; ctx.fillRect(x + 0.1, y + 0.1, w - 0.2, 0.08);
        break;
      case 'toolbox':
        ctx.fillStyle = '#b3402f'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#e0b23a'; ctx.fillRect(x + 0.1, y + h / 2 - 0.05, w - 0.2, 0.1);
        break;
      default:
        ctx.fillStyle = PAL.furn; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 0.06, y + 0.06, w - 0.12, 0.18);
    }
  }
}

function drawWindow(x, y, state) {
  ctx.fillStyle = '#20252c';
  ctx.fillRect(x, y, 1.02, 1.02);
  if (state === 1) {
    ctx.fillStyle = '#5b4128';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 0.02, y + 0.1 + i * 0.32, 0.98, 0.18);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 0.02, y + 0.26, 0.98, 0.05);
  } else {
    ctx.fillStyle = state === 2 ? PAL.glassBroken : PAL.glass;
    ctx.fillRect(x + 0.1, y + 0.24, 0.82, 0.54);
    // moon / sky glint
    ctx.fillStyle = 'rgba(200,235,255,0.45)';
    ctx.fillRect(x + 0.14, y + 0.28, 0.28, 0.16);
    ctx.strokeStyle = '#39424d'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.24); ctx.lineTo(x + 0.5, y + 0.78); ctx.stroke();
    if (state === 2) {
      ctx.fillStyle = '#1a2027';
      ctx.beginPath();
      ctx.moveTo(x + 0.24, y + 0.26); ctx.lineTo(x + 0.48, y + 0.5); ctx.lineTo(x + 0.34, y + 0.54);
      ctx.lineTo(x + 0.46, y + 0.76); ctx.lineTo(x + 0.66, y + 0.62); ctx.lineTo(x + 0.7, y + 0.36);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(180,220,240,0.25)';
      ctx.fillRect(x + 0.14, y + 0.66, 0.18, 0.1);
    }
  }
  ctx.strokeStyle = '#171b21'; ctx.lineWidth = 0.06;
  ctx.strokeRect(x, y, 1.02, 1.02);
}

function drawDoor(x, y, F) {
  const d = doorAt(P.z, x, y);
  const closed = d ? d.closed : 1;
  ctx.fillStyle = '#1c2026';
  ctx.fillRect(x, y, 1.02, 1.02);
  const vertical = d && d.axis === 'h';
  if (closed) {
    ctx.fillStyle = PAL.door;
    if (vertical) ctx.fillRect(x + 0.03, y + 0.08, 0.96, 0.84);
    else ctx.fillRect(x + 0.08, y + 0.03, 0.84, 0.96);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    if (vertical) ctx.fillRect(x + 0.03, y + 0.42, 0.96, 0.1);
    else ctx.fillRect(x + 0.42, y + 0.03, 0.1, 0.96);
    ctx.fillStyle = PAL.accent;
    const kx = vertical ? x + 0.78 : x + 0.5, ky = vertical ? y + 0.52 : y + 0.74;
    ctx.beginPath(); ctx.arc(kx, ky, 0.07, 0, 7); ctx.fill();
  } else {
    // swung open against the wall
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (vertical) ctx.fillRect(x + 0.06, y + 0.06, 0.3, 0.9);
    else ctx.fillRect(x + 0.06, y + 0.06, 0.9, 0.3);
    ctx.fillStyle = '#3a2c1f';
    ctx.fillRect(x + 0.08, y + 0.08, 0.22, 0.86);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.05;
  ctx.strokeRect(x, y, 1.02, 1.02);
}
function drawLockedDoor(x, y, kind) {
  ctx.fillStyle = '#1c2026';
  ctx.fillRect(x, y, 1.02, 1.02);
  ctx.fillStyle = kind === 'cellar' ? '#7d3030' : '#a98b3f';
  ctx.fillRect(x + 0.06, y + 0.04, 0.9, 0.92);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 0.06, y + 0.4, 0.9, 0.08);
  ctx.fillStyle = '#20242b';
  roundRect(x + 0.34, y + 0.36, 0.34, 0.3, 0.08); ctx.fill();
  ctx.fillStyle = '#e8cf7a';
  ctx.beginPath(); ctx.arc(x + 0.51, y + 0.5, 0.06, 0, 7); ctx.fill();
  ctx.fillRect(x + 0.48, y + 0.5, 0.06, 0.1);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x + 0.1, y + 0.08, 0.08, 0.84);
}
function drawStairs(x, y, c) {
  ctx.fillStyle = '#262b32';
  ctx.fillRect(x, y, 1.02, 1.02);
  const up = c === 'U';
  for (let i = 0; i < 4; i++) {
    const t = up ? i : 3 - i;
    ctx.fillStyle = shadeColor(PAL.stair, t * 10 - 12);
    ctx.fillRect(x + 0.06, y + 0.08 + i * 0.22, 0.88, 0.17);
  }
  ctx.fillStyle = up ? 'rgba(150,220,255,0.85)' : 'rgba(255,200,120,0.85)';
  ctx.beginPath();
  const cx = x + 0.5;
  if (up) { ctx.moveTo(cx, y + 0.1); ctx.lineTo(cx + 0.16, y + 0.3); ctx.lineTo(cx - 0.16, y + 0.3); }
  else { ctx.moveTo(cx, y + 0.92); ctx.lineTo(cx + 0.16, y + 0.72); ctx.lineTo(cx - 0.16, y + 0.72); }
  ctx.closePath(); ctx.fill();
}
function drawSecret(x, y) {
  const t = performance.now() / 420;
  ctx.fillStyle = '#1b1f24';
  ctx.fillRect(x, y, 1.02, 1.02);
  ctx.save();
  ctx.translate(x + 0.5, y + 0.5);
  ctx.rotate(Math.sin(t) * 0.06);
  ctx.fillStyle = 'rgba(242,193,78,0.14)';
  ctx.beginPath(); ctx.arc(0, 0, 0.52 + Math.sin(t * 2) * 0.04, 0, 7); ctx.fill();
  ctx.fillStyle = '#c9a23f';
  roundRect(-0.28, -0.22, 0.56, 0.44, 0.06); ctx.fill();
  ctx.fillStyle = '#6d571d';
  ctx.fillRect(-0.07, -0.22, 0.14, 0.44);
  ctx.fillStyle = '#ffe9a3';
  ctx.beginPath(); ctx.arc(0, 0.26, 0.07, 0, 7); ctx.fill();
  ctx.restore();
}

function drawItems() {
  for (const it of ITEMS) {
    if (it.taken || it.z !== P.z) continue;
    const x = it.x, y = it.y;
    ctx.save();
    ctx.translate(x, y);
    if (it.k === 'vase') { ctx.fillStyle = '#7fb0c9'; ctx.beginPath(); ctx.ellipse(0, 0, 0.2, 0.26, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#cfe6f2'; ctx.fillRect(-0.07, -0.36, 0.14, 0.12); }
    else if (it.k === 'tomato') { ctx.fillStyle = '#d64541'; ctx.beginPath(); ctx.arc(0, 0, 0.19, 0, 7); ctx.fill(); ctx.fillStyle = '#3f7a3a'; ctx.fillRect(-0.04, -0.26, 0.08, 0.1); }
    else if (it.k === 'box') { ctx.fillStyle = '#a98a5f'; ctx.fillRect(-0.21, -0.18, 0.42, 0.36); ctx.strokeStyle = '#6e573a'; ctx.lineWidth = 0.04; ctx.strokeRect(-0.21, -0.18, 0.42, 0.36); }
    else if (it.k === 'bottle') { ctx.fillStyle = '#5f8f6b'; ctx.fillRect(-0.08, -0.2, 0.16, 0.4); ctx.fillRect(-0.05, -0.3, 0.1, 0.12); }
    else { ctx.fillStyle = '#c9b98a'; ctx.beginPath(); ctx.arc(0, 0, 0.17, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}

function drawContainers(F) {
  for (const c of W.containers) {
    if (c.z !== F.z) continue;
    const w = c.w || 1;
    ctx.fillStyle = c.done ? '#3c3a34' : '#6a5334';
    roundRect(c.tx + 0.04, c.ty + 0.06, w - 0.08, 0.88, 0.12); ctx.fill();
    ctx.fillStyle = c.done ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.16)';
    roundRect(c.tx + 0.1, c.ty + 0.12, w - 0.2, 0.26, 0.08); ctx.fill();
    ctx.fillStyle = c.done ? '#8a8474' : '#e6d3a3';
    ctx.font = '0.34px monospace'; ctx.textAlign = 'center';
    ctx.fillText(c.done ? '✓' : (c.gives === 'red' ? 'R' : c.gives === 'blue' ? 'B' : c.gives === 'pick' ? '⚿' : '?'), c.tx + w / 2, c.ty + 0.62);
    ctx.textAlign = 'left';
  }
}

function drawTraps() {
  for (const t of TRAPS) {
    if (t.z !== P.z) continue;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = t.armed ? '#4a4a52' : '#35353a';
    ctx.beginPath(); ctx.arc(0, 0, 0.26, 0, 7); ctx.fill();
    ctx.strokeStyle = t.armed ? '#b9bcc4' : '#666';
    ctx.lineWidth = 0.06;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.16, Math.sin(a) * 0.16); ctx.lineTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3); ctx.stroke();
    }
    ctx.restore();
  }
}
function drawCameras() {
  for (const c of CAMS) {
    if (c.z !== P.z) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = '#1c2026'; ctx.fillRect(-0.2, -0.14, 0.4, 0.28);
    ctx.fillStyle = '#dfe6ee'; ctx.fillRect(-0.16, -0.1, 0.3, 0.16);
    const seeing = c.seeT > 0.2;
    ctx.fillStyle = seeing ? '#ff5148' : '#63d67a';
    ctx.beginPath(); ctx.arc(0.12, -0.02, 0.06, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.25)';
    ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, CAM_RANGE, c.a - CAM_FOV, c.a + CAM_FOV); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
}
function drawSplats() {
  for (const s of SPL) {
    if (s.z !== P.z) continue;
    ctx.globalAlpha = Math.max(0, 0.6 - s.t / 200);
    ctx.fillStyle = '#a52f2b';
    ctx.beginPath(); ctx.arc(s.x, s.y, 0.3, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawProjectile(p) {
  if (p.dead) return;
  if (p.z < 0.12) return;
  const x = p.x, y = p.y - p.z * 0.18;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.16, 0.09, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.t * 8);
  if (p.k === 'tomato') { ctx.fillStyle = '#d64541'; ctx.beginPath(); ctx.arc(0, 0, 0.18, 0, 7); ctx.fill(); }
  else if (p.k === 'box') { ctx.fillStyle = '#a98a5f'; ctx.fillRect(-0.16, -0.16, 0.32, 0.32); }
  else if (p.k === 'vase') { ctx.fillStyle = '#7fb0c9'; ctx.beginPath(); ctx.ellipse(0, 0, 0.16, 0.22, 0, 0, 7); ctx.fill(); }
  else { ctx.fillStyle = '#c9b98a'; ctx.beginPath(); ctx.arc(0, 0, 0.15, 0, 7); ctx.fill(); }
  ctx.restore();
}

function drawPlayer() {
  const x = P.x, y = P.y;
  const r = P.crouch ? 0.26 : 0.32;
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.65, r * 0.95, r * 0.5, 0, 0, 7); ctx.fill();
  if (P.crouch) {
    ctx.strokeStyle = 'rgba(80,240,220,0.35)';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.arc(x, y, r + 0.26, 0, 7); ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(P.a);
  ctx.fillStyle = P.hidden ? '#6f8f8c' : PAL.player;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = PAL.playerDark;
  ctx.beginPath(); ctx.arc(-0.04, 0, r * 0.72, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8fffc';
  ctx.beginPath(); ctx.arc(r * 0.45, 0, r * 0.28, 0, 7); ctx.fill();
  if (P.carried) { ctx.fillStyle = '#c0a97a'; ctx.fillRect(-0.16, -r - 0.16, 0.3, 0.24); }
  ctx.restore();
  if (P.flash) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    const g = ctx.createRadialGradient(x, y, 0.2, x, y, 7.5);
    g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 7.5, P.a - 0.5, P.a + 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawNeighbour() {
  const x = N.x, y = N.y;
  if (N.z !== P.z) {
    // show an off-floor hint at the stairwell
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PAL.neighbour;
    ctx.font = '0.5px monospace';
    ctx.fillText('▼', x - 0.2, y);
    ctx.restore();
    return;
  }
  // sight cone (only when the player can actually see him)
  const visible = lineOfSight(P, N) || dst(P.x, P.y, N.x, N.y) < 9;
  if (visible) {
    const range = sightRange();
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0.4, x, y, range);
    const hot = N.mode === 'chase';
    g.addColorStop(0, hot ? 'rgba(226,86,74,0.20)' : 'rgba(242,193,78,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, range, N.a - 0.95, N.a + 0.95); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(226,86,74,0.5)' : 'rgba(242,193,78,0.34)';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, range, N.a - 0.95, N.a + 0.95); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  const r = 0.34;
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.7, r, r * 0.5, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(N.a);
  ctx.fillStyle = N.stun > 0 ? '#8a6b62' : (N.mode === 'chase' ? '#e2564a' : PAL.neighbour);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = PAL.neighbourDark;
  ctx.beginPath(); ctx.arc(-0.06, 0, r * 0.76, 0, 7); ctx.fill();
  ctx.fillStyle = '#f7d9a0'; // bald head + glasses
  ctx.beginPath(); ctx.arc(0.06, 0, r * 0.46, 0, 7); ctx.fill();
  ctx.fillStyle = '#20242b';
  ctx.fillRect(r * 0.2, -0.13, 0.09, 0.26);
  ctx.restore();
  // alert bar
  if (!N.sleeping) {
    const w = 0.9, p = N.mode === 'chase' ? 1 : N.al;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - w / 2, y - 0.72, w, 0.11);
    ctx.fillStyle = p > 0.9 ? PAL.bad : p > 0.45 ? PAL.accent : '#8fd0a0';
    ctx.fillRect(x - w / 2 + 0.01, y - 0.71, (w - 0.02) * clamp(p, 0.02, 1), 0.09);
  } else {
    ctx.fillStyle = '#8fb4ff';
    ctx.font = '0.4px monospace';
    ctx.fillText('z z', x - 0.16, y - 0.5);
  }
  if (N.quipT > 0) {
    ctx.font = 'bold 0.34px monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(N.quip).width + 0.4;
    ctx.fillStyle = 'rgba(10,12,16,0.82)';
    roundRect(x - tw / 2, y - 1.5, tw, 0.46, 0.12); ctx.fill();
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(N.quip, x, y - 1.18);
    ctx.textAlign = 'left';
  }
}

function drawNightOverlay(scale, ox, oy) {
  const night = isNight(GAME.clock);
  const dc = darkCanvas();
  const dctx = dc.getContext('2d');
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.globalCompositeOperation = 'source-over';
  dctx.clearRect(0, 0, CVW, CVH);
  dctx.fillStyle = night ? 'rgba(7,10,22,0.88)' : 'rgba(7,10,22,0.14)';
  dctx.fillRect(0, 0, CVW, CVH);
  dctx.globalCompositeOperation = 'destination-out';

  const px = ox + P.x * scale, py = oy + P.y * scale;
  const pr = (night ? 6.6 : 12) * scale;
  let g = dctx.createRadialGradient(px, py, pr * 0.18, px, py, pr);
  g.addColorStop(0, 'rgba(0,0,0,0.98)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.8)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  dctx.fillStyle = g;
  dctx.beginPath(); dctx.arc(px, py, pr, 0, 7); dctx.fill();

  const F = W.floors[P.z];
  if (F && F.lights) for (const L of F.lights) {
    const room = F.rooms.find((r) => r.id === L.room);
    if (!room || !room.light) continue;
    const lx = ox + L.x * scale, ly = oy + L.y * scale, lr = L.r * scale;
    g = dctx.createRadialGradient(lx, ly, lr * 0.15, lx, ly, lr);
    g.addColorStop(0, 'rgba(0,0,0,0.94)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.62)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g;
    dctx.beginPath(); dctx.arc(lx, ly, lr, 0, 7); dctx.fill();
  }
  dctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(dc, 0, 0);

  // warm pools over the lit rooms
  if (night) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const L of (F.lights || [])) {
      const room = F.rooms.find((r) => r.id === L.room);
      if (!room || !room.light) continue;
      const lx = ox + L.x * scale, ly = oy + L.y * scale, lr = L.r * scale * 1.05;
      const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, lr);
      lg.addColorStop(0, 'rgba(255,190,110,0.16)');
      lg.addColorStop(0.6, 'rgba(255,170,90,0.07)');
      lg.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
}

function drawBeliefOverlay() {
  const B = BEL[P.z];
  if (!B) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const scale = TS * ZOOM;
  const ox = CVW / 2 - CAMX * scale, oy = CVH / 2 - CAMY * scale;
  const x0 = Math.max(0, Math.floor(CAMX - CVW / 2 / scale) - 1), x1 = Math.min(MW - 1, Math.ceil(CAMX + CVW / 2 / scale) + 1);
  const y0 = Math.max(0, Math.floor(CAMY - CVH / 2 / scale) - 1), y1 = Math.min(MH - 1, Math.ceil(CAMY + CVH / 2 / scale) + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const v = B[y * MW + x];
    if (v < 0.03) continue;
    const px = ox + x * scale, py = oy + y * scale;
    ctx.fillStyle = 'rgba(226,86,74,' + Math.min(0.62, 0.1 + v * 0.6) + ')';
    ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
  }
  if (N) {
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    const pts = [{ x: N.x, y: N.y, z: N.z }].concat(N.path || []);
    let started = false;
    for (const p of pts) {
      if (p.z !== P.z) { started = false; continue; }
      const px = ox + (p.x + 0.5) * scale, py = oy + (p.y + 0.5) * scale;
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
function drawPathOverlay() {}
function drawNoiseRings() {
  for (const n of NZ) {
    const age = GAME.t - n.t;
    if (age > 1.4 || n.z !== P.z) continue;
    const a = 1 - age / 1.4;
    ctx.strokeStyle = 'rgba(242,193,78,' + (a * 0.4) + ')';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.arc(n.x, n.y, age * 4 + 0.3, 0, 7); ctx.stroke();
  }
}

function drawVignette() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createRadialGradient(CVW / 2, CVH / 2, CVH * 0.32, CVW / 2, CVH / 2, CVH * 0.82);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CVW, CVH);
  ctx.restore();
}
function drawHideOverlay() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, CVW, CVH);
  ctx.fillStyle = '#9fb4b2'; ctx.font = '600 15px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText('HIDING — moving or noise will give you away', CVW / 2, CVH - 26);
  ctx.textAlign = 'left';
  ctx.restore();
}
function drawDangerEdge() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const t = performance.now() / 300;
  ctx.strokeStyle = 'rgba(226,86,74,' + (0.28 + Math.sin(t) * 0.16) + ')';
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, CVW, CVH);
  ctx.restore();
}

/* ------------------------------------------------------------------- HUD */
function drawHUD() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'left';
  const hh = String(Math.floor(GAME.clock)).padStart(2, '0');
  const mm = String(Math.floor((GAME.clock % 1) * 60)).padStart(2, '0');
  const night = isNight(GAME.clock);

  // top bar
  ctx.fillStyle = 'rgba(9,12,18,0.72)';
  roundRect(10, 10, 208, 54, 10); ctx.fill();
  ctx.fillStyle = night ? '#9db7ff' : '#f2d08a';
  ctx.font = '600 20px ui-monospace, monospace';
  ctx.fillText((night ? '☾ ' : '☀ ') + hh + ':' + mm, 22, 36);
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = night ? '#7d90c4' : '#b9a175';
  ctx.fillText(night ? 'NIGHT — he sees you 20% shorter' : 'DAY', 22, 52);

  // stamina
  ctx.fillStyle = 'rgba(9,12,18,0.72)';
  roundRect(CVW - 232, 10, 222, 54, 10); ctx.fill();
  ctx.fillStyle = '#7c8798'; ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('BREATH', CVW - 220, 27);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(CVW - 220, 32, 196, 8);
  ctx.fillStyle = P.sprint ? '#f2c14e' : '#5fd08a'; ctx.fillRect(CVW - 220, 32, 196 * P.stam, 8);
  ctx.fillStyle = P.crouch ? '#7fe6d8' : P.sprint ? '#f2c14e' : '#9aa7b8';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(P.crouch ? 'CROUCHING (quiet)' : P.sprint ? 'SPRINTING (loud!)' : 'WALKING', CVW - 220, 56);

  // keyring — deliberately NOT an inventory
  drawKeyring(14, 76);

  // objectives
  drawTasks();

  // messages
  if (UI.msgT > 0 && UI.msg) {
    const txt = UI.msg;
    ctx.font = '600 15px ui-monospace, monospace';
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(8,10,16,0.8)';
    roundRect(CVW / 2 - tw / 2 - 16, CVH - 96, tw + 32, 38, 10); ctx.fill();
    ctx.fillStyle = '#ffe6b0';
    ctx.textAlign = 'center';
    ctx.fillText(txt, CVW / 2, CVH - 71);
    ctx.textAlign = 'left';
  }

  // interaction prompt
  const pr = promptText();
  if (pr) {
    ctx.font = '600 13px ui-monospace, monospace';
    const tw = ctx.measureText(pr).width;
    ctx.fillStyle = 'rgba(20,26,32,0.85)';
    roundRect(CVW / 2 - tw / 2 - 14, CVH - 138, tw + 28, 32, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(242,193,78,0.5)'; ctx.lineWidth = 1;
    roundRect(CVW / 2 - tw / 2 - 14, CVH - 138, tw + 28, 32, 8); ctx.stroke();
    ctx.fillStyle = '#f4e3bb';
    ctx.textAlign = 'center';
    ctx.fillText(pr, CVW / 2, CVH - 117);
    ctx.textAlign = 'left';
  }

  // carried item
  if (P.carried) {
    ctx.fillStyle = 'rgba(9,12,18,0.72)';
    roundRect(CVW - 178, CVH - 60, 168, 44, 10); ctx.fill();
    ctx.fillStyle = '#d8c9a2'; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('CARRYING', CVW - 166, CVH - 34);
    ctx.fillStyle = '#f2c14e'; ctx.font = '600 13px ui-monospace, monospace';
    ctx.fillText(P.carried.toUpperCase(), CVW - 92, CVH - 34);
  }

  ctx.fillStyle = 'rgba(160,176,196,0.55)';
  ctx.font = '10.5px ui-monospace, monospace';
  ctx.fillText('WASD move  SHIFT run  C crouch  E use  Q/F throw  G grab  H hide  T torch  ESC pause', 16, CVH - 12);
  if (UI.msg && UI.msgT > 0) {}
  ctx.restore();
  if (UI.showBelief) drawMemPanel(true);
}

function drawKeyring(x, y) {
  const keys = [
    { k: 'pick', label: 'LOCKPICK', col: '#cfd6df', glow: '#8fa0b5' },
    { k: 'red', label: 'RED', col: '#e2564a', glow: '#8f2a22' },
    { k: 'blue', label: 'BLUE', col: '#5b8de2', glow: '#26457d' },
  ];
  const w = 236, h = 46;
  ctx.fillStyle = 'rgba(9,12,18,0.72)';
  roundRect(x, y, w, h, 10); ctx.fill();
  ctx.fillStyle = 'rgba(216,210,196,0.65)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('KEYRING', x + 10, y + 14);
  // ring
  ctx.strokeStyle = 'rgba(220,214,200,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(x + 22, y + 28, 10, 0, 7); ctx.stroke();
  keys.forEach((kk, i) => {
    const cx = x + 52 + i * 62, cy = y + 29;
    const have = !!P.keys[kk.k];
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, 7);
    ctx.fillStyle = have ? kk.col : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = have ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = have ? '#10141a' : 'rgba(200,210,220,0.28)';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(kk.k === 'pick' ? '⚿' : kk.k === 'red' ? 'R' : 'B', cx, cy + 3.5);
    ctx.fillStyle = have ? '#e6ecf3' : 'rgba(200,210,220,0.3)';
    ctx.font = '8px ui-monospace, monospace';
    ctx.fillText(kk.label, cx, cy + 20);
    ctx.textAlign = 'left';
  });
}

function drawTasks() {
  if (!HUD.tasks.length) return;
  const x = 14, y = 132, w = 250;
  const rows = HUD.tasks.filter((t) => !t.done).slice(0, 5);
  const h = 26 + rows.length * 19 + 16;
  ctx.fillStyle = 'rgba(9,12,18,0.66)';
  roundRect(x, y, w, h, 10); ctx.fill();
  ctx.fillStyle = 'rgba(242,193,78,0.8)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.fillText('OBJECTIVES', x + 10, y + 16);
  ctx.font = '11.5px ui-monospace, monospace';
  rows.forEach((t, i) => {
    ctx.fillStyle = 'rgba(214,224,236,0.9)';
    ctx.fillText('· ' + t.txt, x + 10, y + 34 + i * 19);
  });
  if (HUD.note) {
    ctx.fillStyle = 'rgba(160,176,196,0.5)';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText(HUD.note, x + 10, y + h - 6);
  }
}

function promptText() {
  if (!P || !GAME || GAME.state !== 'play') return '';
  for (const c of W.containers) {
    const cw = c.w || 1;
    if (c.z === P.z && P.x > c.tx - 0.95 && P.x < c.tx + cw + 0.95 && P.y > c.ty - 0.95 && P.y < c.ty + 1.95) return c.done ? 'E — ' + c.label + ' (empty)' : 'E — search the ' + c.label;
  }
  const it = nearestLooseItem();
  if (it) return 'G — pick up the ' + it.k;
  if (P.z === W.secret.z && dst(P.x, P.y, W.secret.x, W.secret.y) < 1.9) return P.keys.red && P.keys.blue ? 'E — open the stash' : 'E — locked with two keys';
  const fx = Math.floor(P.x + Math.cos(P.a) * 0.75), fy = Math.floor(P.y + Math.sin(P.a) * 0.75);
  const d = doorAt(P.z, fx, fy);
  if (d) {
    if (d.kind === 'cellar') return d.closed ? (P.keys.red ? 'E — unlock the basement (RED KEY)' : 'E — locked (needs the red key)') : 'The basement door is open';
    if (d.kind === 'lock') return d.closed ? (P.keys.pick ? 'E — pick the study lock' : 'E — locked (needs a lockpick)') : 'The study is open';
    return d.closed ? 'E — open the door' : 'E — close the door';
  }
  const t = T(P.z, fx, fy);
  if (t === 'W' || t === 'w') return 'E — climb through the window';
  if (t === 'X') return 'Boardered up — no way through';
  const st = stairFrom(P.z, P.x | 0, P.y | 0);
  if (st) return 'E — take the stairs to ' + (st.z === 0 ? 'the ground floor' : st.z === 1 ? 'upstairs' : 'the basement');
  if (P.hidden) return 'E — come out of hiding';
  return '';
}

/* --------------------------------------------------------------- overlays */
function drawHelp() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#080c13'; ctx.fillRect(0, 0, CVW, CVH);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 26px ui-monospace, monospace';
  ctx.fillText('HOW TO PLAY', 60, 74);
  const rows = [
    ['GOAL', 'Get into the basement and take what is in the stash. The front door is not the way in.'],
    ['MOVEMENT', 'WASD / arrows to move. SHIFT to sprint (loud, he hears it). C to crouch (silent, slower).'],
    ['HANDS', 'E is use: search furniture, open doors, take stairs, climb windows. G grabs a loose object.'],
    ['THROWING', 'Q throws ahead, F or left-click throws at the cursor. A hit stuns him and he hunts the origin.'],
    ['KEYS', 'Keys are never inventory. They snap to your keyring: the lockpick (shed), the red key (fridge),'],
    ['', 'the blue key (study desk). The HUD ring shows exactly which you carry.'],
    ['DARK', 'The house is dark at night. He sees ~20% shorter in the dark, sprinting makes you visible,'],
    ['', 'crouching near-invisible. T toggles your torch (light, but it gives you away).'],
    ['HIM', 'He works a routine, hears your steps, notices what you search, re-locks what you pick,'],
    ['', 'boards up broken windows and sets traps where you walk. After a catch he watches those rooms.'],
    ['MEMORY', 'Everything he learns belongs to THIS house. New Game wipes it; continuing keeps it.'],
    ['PANELS', 'M toggles his belief map. ESC or P pauses and shows what he knows.'],
  ];
  let y = 116;
  for (const [k, v] of rows) {
    ctx.fillStyle = 'rgba(242,193,78,0.85)'; ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillText(k, 60, y);
    ctx.fillStyle = '#cfdae8'; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(v, 176, y);
    y += 30;
  }
  ctx.fillStyle = 'rgba(180,196,212,0.6)'; ctx.font = '12px ui-monospace, monospace';
  ctx.fillText('click or press any key to go back', 60, CVH - 40);
}

function drawMenu(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // backdrop: a blurred-ish top-down glimpse of the house
  const g = ctx.createLinearGradient(0, 0, 0, CVH);
  g.addColorStop(0, '#0b1018'); g.addColorStop(1, '#131a24');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CVW, CVH);
  if (W) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.translate(CVW / 2 - HOUSE.x * 9, CVH / 2 - HOUSE.y * 9);
    for (let y = HOUSE.y; y < HOUSE.y + HOUSE.h; y++) for (let x = HOUSE.x; x < HOUSE.x + HOUSE.w; x++) {
      const c = W.floors[0].G[y][x];
      ctx.fillStyle = c === '#' ? '#3a4553' : c === 'D' ? '#8a5a2b' : '#7b8fa3';
      ctx.fillRect(x * 9, y * 9, 8.4, 8.4);
    }
    ctx.restore();
  }
  const t = performance.now() / 1000;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, CVW, CVH);
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 52px ui-monospace, monospace';
  ctx.fillText('HELLO NEIGHBOUR', CVW / 2, 150 + Math.sin(t) * 2);
  ctx.fillStyle = '#9fb4c9';
  ctx.font = '600 15px ui-monospace, monospace';
  ctx.fillText('2D · procedural house · a neighbour who learns', CVW / 2, 182);

  const has = !!storedMatch();
  const items = menuItems(has);
  items.forEach((it, i) => {
    const y = 250 + i * 56;
    const sel = i === MENU.sel;
    ctx.fillStyle = sel ? 'rgba(242,193,78,0.16)' : 'rgba(255,255,255,0.04)';
    roundRect(CVW / 2 - 190, y - 30, 380, 46, 12); ctx.fill();
    if (sel) { ctx.strokeStyle = 'rgba(242,193,78,0.65)'; ctx.lineWidth = 1.4; roundRect(CVW / 2 - 190, y - 30, 380, 46, 12); ctx.stroke(); }
    ctx.fillStyle = it.disabled ? 'rgba(160,176,196,0.35)' : sel ? '#ffe6b0' : '#cfdae8';
    ctx.font = '600 17px ui-monospace, monospace';
    ctx.fillText(it.label, CVW / 2, y);
    if (it.sub) {
      ctx.fillStyle = 'rgba(160,176,196,0.5)';
      ctx.font = '10.5px ui-monospace, monospace';
      ctx.fillText(it.sub, CVW / 2, y + 15);
    }
    MENU.rects[i] = { x: CVW / 2 - 190, y: y - 30, w: 380, h: 46 };
  });
  ctx.fillStyle = 'rgba(160,176,196,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText('↑↓ select   ENTER play   ·   WASD move  E use  C crouch  SHIFT sprint', CVW / 2, CVH - 40);
  ctx.fillStyle = 'rgba(160,176,196,0.35)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('He remembers how you play. New Game erases everything he has learned.', CVW / 2, CVH - 20);
  ctx.textAlign = 'left';
}

const MENU = { sel: 0, rects: [] };
function menuItems(has) {
  return [
    { id: 'play', label: has ? 'CONTINUE' : 'PLAY', sub: has ? 'same house, he remembers you' : 'a fresh house, a fresh neighbour' },
    { id: 'new', label: 'NEW GAME', sub: 'wipe everything he has learned' },
    { id: 'help', label: 'HOW TO PLAY', sub: 'controls, keys, and the basement' },
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

function drawCut(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, CVH);
  g.addColorStop(0, '#080c13'); g.addColorStop(1, '#182230');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CVW, CVH);
  const beats = CUTSCENE;
  const dur = 13 / beats.length;
  const i = Math.min(beats.length - 1, Math.floor(UI.cut / dur));
  const local = (UI.cut % dur) / dur;
  const fade = Math.min(1, local * 3) * Math.min(1, (1 - local) * 3.5);
  const b = beats[i];

  ctx.save();
  ctx.globalAlpha = fade;
  // art
  const cx = CVW / 2, cy = 230;
  if (b.art === 'house') {
    ctx.fillStyle = '#1c2530';
    ctx.fillRect(cx - 150, cy - 80, 300, 150);
    ctx.fillStyle = '#0f1720';
    ctx.beginPath(); ctx.moveTo(cx - 175, cy - 80); ctx.lineTo(cx, cy - 165); ctx.lineTo(cx + 175, cy - 80); ctx.closePath(); ctx.fill();
    for (let wx = 0; wx < 3; wx++) for (let wy = 0; wy < 2; wy++) {
      const on = (wx + wy) % 2 === 0;
      ctx.fillStyle = on ? 'rgba(242,193,78,0.85)' : 'rgba(30,44,58,0.9)';
      ctx.fillRect(cx - 120 + wx * 90, cy - 55 + wy * 60, 46, 36);
    }
    ctx.fillStyle = '#f2c14e'; ctx.font = '13px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('No. 13 — and a neighbour who never sleeps.', cx, cy + 100);
  } else if (b.art === 'key') {
    ctx.fillStyle = '#cfd6df';
    ctx.beginPath(); ctx.arc(cx, cy - 20, 34, 0, 7); ctx.fill();
    ctx.fillStyle = '#0f1720'; ctx.beginPath(); ctx.arc(cx, cy - 20, 16, 0, 7); ctx.fill();
    ctx.fillStyle = '#cfd6df'; ctx.fillRect(cx - 8, cy + 8, 16, 90);
    ctx.fillRect(cx - 8, cy + 70, 46, 14);
    ctx.fillRect(cx - 8, cy + 92, 32, 12);
  } else if (b.art === 'eye') {
    ctx.strokeStyle = '#e2564a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(cx, cy, 110, 54, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = '#e2564a'; ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 7); ctx.fill();
    ctx.fillStyle = '#0f1720'; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(226,86,74,0.45)'; ctx.lineWidth = 2;
    for (let k = 0; k < 8; k++) { const a = k / 8 * 7; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 120, cy + Math.sin(a) * 62); ctx.lineTo(cx + Math.cos(a) * 150, cy + Math.sin(a) * 84); ctx.stroke(); }
  } else if (b.art === 'stairs') {
    ctx.fillStyle = '#2b3440';
    for (let s = 0; s < 7; s++) ctx.fillRect(cx - 90 + s * 22, cy + 80 - s * 24, 200 - s * 20, 24);
    ctx.fillStyle = '#f2c14e'; ctx.fillRect(cx - 6, cy - 40, 16, 40);
    ctx.beginPath(); ctx.moveTo(cx + 2, cy - 70); ctx.lineTo(cx + 20, cy - 34); ctx.lineTo(cx - 16, cy - 34); ctx.closePath(); ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#eef3f8';
  ctx.font = '600 22px ui-monospace, monospace';
  wrapText(b.title, CVW / 2, 430, 700, 30);
  ctx.fillStyle = 'rgba(200,214,228,0.72)';
  ctx.font = '14px ui-monospace, monospace';
  wrapText(b.body, CVW / 2, 480, 700, 22);
  ctx.restore();

  // progress dots
  ctx.textAlign = 'center';
  for (let d = 0; d < beats.length; d++) {
    ctx.fillStyle = d === i ? '#f2c14e' : 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.arc(CVW / 2 - (beats.length - 1) * 9 + d * 18, CVH - 62, 4, 0, 7); ctx.fill();
  }
  ctx.fillStyle = 'rgba(180,196,212,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText('CLICK or SPACE to skip', CVW / 2, CVH - 34);
  ctx.textAlign = 'left';
}

const CUTSCENE = [
  { art: 'house', title: 'THE HOUSE ON THE HILL', body: 'Every night the same: one house, one neighbour, and a secret under the floor. You have been hired to find it.' },
  { art: 'key', title: 'THREE KEYS, NO POCKETS', body: 'The lockpick is in the shed. Keys are never inventory — they live on your keyring: red, blue, and the pick.' },
  { art: 'stairs', title: 'THE BASEMENT', body: 'Whatever he keeps down there is worth more than his temper. He guards it. He learns what you touch.' },
  { art: 'eye', title: 'HE IS LEARNING', body: 'He hears your steps, notices what you take, boards up what you break, and re-locks what you open. New Game wipes it all.' },
];

function wrapText(text, x, y, max, lh) {
  const words = text.split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > max) { ctx.fillText(line, x, yy); line = w; yy += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawPause() {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(5,8,12,0.8)'; ctx.fillRect(0, 0, CVW, CVH);
  drawMemPanel(false);
  ctx.fillStyle = '#f2c14e'; ctx.font = '700 22px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText('PAUSED', CVW / 2, 60);
  ctx.fillStyle = 'rgba(190,204,220,0.7)'; ctx.font = '12px ui-monospace, monospace';
  ctx.fillText('ESC / P resume   ·   M belief overlay   ·   R restart match', CVW / 2, CVH - 26);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawMemPanel(debug) {
  const x = debug ? CVW - 300 : 40, y = debug ? 92 : 96;
  const w = 260, h = 372;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(8,11,17,0.86)';
  roundRect(x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(242,193,78,0.35)'; ctx.lineWidth = 1;
  roundRect(x, y, w, h, 12); ctx.stroke();
  ctx.fillStyle = '#f2c14e'; ctx.font = '600 11px ui-monospace, monospace';
  ctx.fillText('HIS HEAD — THIS MATCH', x + 12, y + 20);
  const rows = [
    ['suspicion', Math.round(M.suspicion) + '/100'],
    ['catches', String(M.catches)],
    ['wins', String(M.wins)],
    ['state', N ? N.mode + (N.mode !== 'chase' ? ' · ' + N.label : '') : '—'],
    ['hearing', N ? (N.sounds.filter((s) => GAME.t - s.t < 6).length + ' sounds / 6s') : '—'],
    ['doors you opened', String(Object.keys(M.entries).length)],
    ['things he noticed', String(M.thefts.length)],
    ['traps down', String(TRAPS.length) + ' · cameras ' + CAMS.length],
    ['hiding spots known', String(M.hides.length)],
  ];
  ctx.font = '11px ui-monospace, monospace';
  rows.forEach((r, i) => {
    ctx.fillStyle = 'rgba(150,166,184,0.75)';
    ctx.fillText(r[0], x + 12, y + 44 + i * 18);
    ctx.fillStyle = '#dfe8f2';
    ctx.textAlign = 'right';
    ctx.fillText(String(r[1]).slice(0, 26), x + w - 12, y + 44 + i * 18);
    ctx.textAlign = 'left';
  });
  const by = y + 210;
  ctx.fillStyle = 'rgba(150,166,184,0.75)';
  ctx.fillText('hours he spotted you', x + 12, by);
  const maxH = Math.max(1, ...M.hours);
  for (let i = 0; i < 24; i++) {
    const bh = (M.hours[i] / maxH) * 34;
    ctx.fillStyle = isNight(i) ? 'rgba(120,150,235,0.65)' : 'rgba(242,193,78,0.65)';
    ctx.fillRect(x + 12 + i * 9.6, by + 44 - bh, 5.6, Math.max(1, bh));
  }
  ctx.fillStyle = 'rgba(150,166,184,0.5)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('00', x + 12, by + 56);
  ctx.fillText('23', x + w - 26, by + 56);
  if (M.thefts.length) {
    ctx.fillStyle = 'rgba(226,86,74,0.85)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('noticed missing: ' + M.thefts.slice(-3).join(', '), x + 12, by + 74);
  }
  ctx.restore();
}

function drawOver() {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const win = UI.over === 'win';
  ctx.fillStyle = win ? 'rgba(6,20,16,0.86)' : 'rgba(22,6,8,0.86)';
  ctx.fillRect(0, 0, CVW, CVH);
  ctx.textAlign = 'center';
  ctx.fillStyle = win ? '#6fe0a0' : '#e2564a';
  ctx.font = '700 38px ui-monospace, monospace';
  ctx.fillText(win ? 'YOU GOT IT' : 'CAUGHT', CVW / 2, CVH / 2 - 70);
  ctx.fillStyle = '#dfe8f2';
  ctx.font = '15px ui-monospace, monospace';
  const lines = win
    ? ['You walked out with his secret.', 'He will not forget how you did it.', 'Same house next time — harder.']
    : ['He found you in ' + (N && N.label ? N.label.replace(/!$/, '') : 'the dark') + '.', 'He remembers this room and this hour.', 'Try a different route.'];
  lines.forEach((l, i) => ctx.fillText(l, CVW / 2, CVH / 2 - 20 + i * 26));
  ctx.fillStyle = 'rgba(190,204,220,0.65)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText('R / ENTER — replay this house     ESC — menu', CVW / 2, CVH / 2 + 92);
  ctx.textAlign = 'left';
  ctx.restore();
}

/* --------------------------------------------------------------- utilities */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
