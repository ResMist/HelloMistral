'use strict';
/* Assemble the single-file game from .dev/*.js. Run: node .dev/build.js */
const fs = require('fs');
const path = require('path');

const DEV = __dirname;
const ROOT = path.join(DEV, '..');
const PARTS = ['mapfixed.js', 'core.js', 'ai.js', 'game.js', 'views.js'];

const shell = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hello Neighbour 2D — one house, two floors</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #070a0f; color: #dfe8f2;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; }
  #wrap { position: fixed; inset: 0; display: grid; place-items: center; }
  canvas { display: block; width: min(100vw, calc(100vh * 900 / 620)); height: auto;
    aspect-ratio: 900 / 620; background: #070a0f; border-radius: 10px;
    box-shadow: 0 24px 90px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.05);
    image-rendering: pixelated; cursor: crosshair; touch-action: none; }
  #hint { position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%);
    font-size: 11px; color: rgba(160,176,196,.45); pointer-events: none; }
  .p { position: fixed; padding: 9px 12px; font-size: 11.5px; line-height: 1.55;
    background: rgba(8,11,16,.82); border: 1px solid rgba(255,255,255,.09);
    border-radius: 9px; pointer-events: none; white-space: pre; }
  #hud { left: 10px; top: 10px; max-width: 300px; }
  #dbg { right: 10px; top: 10px; width: 268px; color: #cfdae8; }
  #inv { left: 50%; bottom: 34px; transform: translateX(-50%); display: flex; gap: 8px; }
  #msg { left: 50%; bottom: 78px; transform: translateX(-50%); border-color: rgba(242,193,78,.35);
    color: #ffe6b0; text-align: center; max-width: 560px; }
  .slot { display: inline-block; padding: 2px 8px; border-radius: 6px;
    background: rgba(255,255,255,.06); color: rgba(200,212,226,.4); }
  .slot.sel { background: rgba(242,193,78,.2); color: #ffe6b0; }
  .bar { display: inline-block; height: 7px; border-radius: 3px; vertical-align: middle; }
  .dim { color: rgba(200,212,226,.45); }
</style>
</head>
<body>
<div id="wrap"><canvas id="game" width="900" height="620"></canvas></div>
<div id="hud" class="p"></div>
<div id="dbg" class="p"></div>
<div id="inv" class="p"></div>
<div id="msg" class="p" style="display:none"></div>
<div id="hint">single file · no assets · one house, two floors · he learns</div>
<script>
/*__GAME__*/
</script>
</body>
</html>
`;

let js = '';
for (const p of PARTS) js += `\n/* ===== ${p} ===== */\n` + fs.readFileSync(path.join(DEV, p), 'utf8');
js += `\n/* ===== boot ===== */\nwindow.__g = GAMEAPI;\nboot();\n`;

const html = shell.replace('/*__GAME__*/', js);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('index.html written:', (html.length / 1024).toFixed(1) + ' KB');
