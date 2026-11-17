'use strict';
/* Headless harness for the single-file game.
   Stubs just enough DOM / canvas / WebGL / WebAudio to execute index.html's script in Node,
   then hands back the game's own window.__g debug surface. Deliberately strict: a missing
   2D-context method or WebGL call is reported instead of silently swallowed, and real event
   listeners are captured so tests can dispatch actual keydown / mousedown events. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadGame(file) {
  const src = fs.readFileSync(file || path.join(ROOT, 'index.html'), 'utf8');
  const open = src.indexOf('<script');
  const i = src.indexOf('>', open) + 1;
  const j = src.lastIndexOf('</script>');
  if (open < 0 || i < 1 || j < 0) throw new Error('could not find the game script tag');
  const js = src.slice(i, j);

  const problems = [];
  const listeners = {};

  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }

  function ctx2d() {
    const grad = { addColorStop() {} };
    /* RECORDING: when global.__REC is an array, every canvas call (and every style
       assignment) is appended to it. Two builds that draw the same scene produce the
       same transcript, and identical args mean identical pixels. */
    const rec = (name, args) => {
      if (!global.__REC) return;
      const parts = [];
      for (const a of args) {
        if (typeof a === 'number') parts.push(Number.isFinite(a) ? a.toFixed(6) : String(a));
        else if (typeof a === 'string' || typeof a === 'boolean' || a == null) parts.push(String(a));
        else if (a === grad) parts.push('grad');
        else parts.push('[' + (a && a.constructor ? a.constructor.name : typeof a) + ']');
      }
      global.__REC.push(name + '(' + parts.join(',') + ')');
    };
    const target = {
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
      globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '#000', filter: 'none',
      imageSmoothingEnabled: true,
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
      resetTransform() {}, transform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
      rect() {}, roundRect() {}, quadraticCurveTo() {}, bezierCurveTo() {}, fill() {}, stroke() {},
      clip() {}, fillText() {}, strokeText() {},
      measureText: t => ({ width: String(t).length * 5.5, actualBoundingBoxAscent: 8 }),
      drawImage() {}, putImageData() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
      setLineDash() {}, getLineDash: () => [], isPointInPath: () => false,
    };
    return new Proxy(target, {
      get(t, k) {
        const v = t[k];
        if (typeof v === 'function') {
          return function (...args) {
            rec(String(k), args);
            return v.apply(t, args);
          };
        }
        if (k in t) return v;
        problems.push('2D ctx missing member: ' + String(k));
        return undefined;
      },
      set(t, k, v) {
        if (typeof k === 'string') rec('=' + k, [v]);
        t[k] = v;
        return true;
      },
    });
  }

  function fakeGL() {
    const C = {
      VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962, FLOAT: 5126, TRIANGLES: 4, DEPTH_TEST: 2929, BLEND: 3042,
      SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, CULL_FACE: 2884, BACK: 1029,
      STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048, COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256,
      LEQUAL: 515,
    };
    const stats = { draws: 0, verts: 0 };
    const api = {
      getShaderParameter: () => true, getShaderInfoLog: () => '',
      getProgramParameter: () => true, getProgramInfoLog: () => '',
      createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
      getAttribLocation: (p, n) => ({ aP: 0, aN: 1, aC: 2, aK: 3, aA: 4 })[n] === undefined ? -1 : ({ aP: 0, aN: 1, aC: 2, aK: 3, aA: 4 })[n],
      getUniformLocation: () => ({}),
      bufferData(t, d) { if (!d) problems.push('bufferData with no data'); },
      drawArrays(m, f, n) { stats.draws++; stats.verts += n; },
      uniform1f() {}, uniform3f() {},
      uniformMatrix4fv(m, l, v) { if (!v) problems.push('uniformMatrix4fv with null matrix'); },
      shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, useProgram() {},
      bindBuffer() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, viewport() {},
      clearColor() {}, clear() {}, enable() {}, disable() {}, depthMask() {}, cullFace() {}, blendFunc() {},
    };
    const proxy = new Proxy(Object.assign(C, api), {
      get(t, k) {
        if (k in t) return t[k];
        problems.push('GL missing member: ' + String(k));
        return undefined;
      },
    });
    proxy.__stats = stats;
    return proxy;
  }

  function mkCanvas(id) {
    const cv = {
      id, width: 300, height: 150, style: {},
      addEventListener: on,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 760 }),
      requestPointerLock() {
        if (DOCSTATE.refuse) return Promise.reject(new Error('blocked'));
        DOCSTATE.pointerLockElement = cv;
        return Promise.resolve();
      },
      getContext(t) {
        if (t === '2d') return ctx2d();
        if (String(t).indexOf('webgl') >= 0) return fakeGL();
        return null;
      },
    };
    return cv;
  }

  const DOCSTATE = { pointerLockElement: null, refuse: false };
  const els = {};
  const ids = ['c', 'gl', 'ov3', 'hud', 'dbg', 'inv', 'msg', 'viewchip', 'ov', 'ovt', 'row',
    'pcgSeed', 'pcgSeedHelp', 'memline', 'go', 'pcg', 'forget', 'viewbtn'];
  for (const id of ids) {
    if (id === 'c' || id === 'gl' || id === 'ov3') { els[id] = mkCanvas(id); continue; }
    els[id] = {
      id, style: {}, textContent: '', innerHTML: '', value: '', children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      querySelector: () => ({ textContent: '' }), querySelectorAll: () => [],
      appendChild() {}, removeChild() {}, insertAdjacentHTML(pos, html) { this.innerHTML = html + this.innerHTML; },
      focus() {}, addEventListener: on, removeEventListener() {},
      onclick: null, onkeydown: null, dataset: {},
    };
  }

  global.document = {
    get pointerLockElement() { return DOCSTATE.pointerLockElement; },
    getElementById: id => els[id] || null,
    createElement: t => mkCanvas(t),
    addEventListener: on,
    querySelector: () => null,
    body: { appendChild() {}, style: {} },
    documentElement: { style: {} },
  };
  global.window = global;
  global.innerWidth = 1280;
  global.innerHeight = 760;
  global.devicePixelRatio = 2;
  global.addEventListener = on;

  let rafSeq = 0;
  const rafFns = [];
  global.requestAnimationFrame = fn => { rafFns.push(fn); return ++rafSeq; };
  global.cancelAnimationFrame = () => {};
  global.performance = { now: () => Date.now() };

  const TIMERS = [];
  global.setTimeout = () => 0;
  global.clearTimeout = () => {};
  global.setInterval = (f, ms) => { TIMERS.push({ f, ms, acc: 0 }); return TIMERS.length; };
  global.clearInterval = () => {};

  global.confirm = () => false;
  global.alert = () => {};
  global.Image = class {};
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.location = { href: 'http://localhost:8000/', search: '' };
  try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-harness', maxTouchPoints: 0 }, configurable: true }); }
  catch (e) { /* Node 22 exposes a read-only navigator; the game only sniffs it, so leave it */ }

  /* WebAudio: strict enough that misuse (NaN into an AudioParam, a bad buffer length) throws
     exactly like a browser, because the click handler calls audioInit() before doing anything. */
  class FakeParam {
    constructor(v) { this.value = v; }
    setValueAtTime(v) { this._chk(v); return this; }
    linearRampToValueAtTime(v) { this._chk(v); return this; }
    exponentialRampToValueAtTime(v) { this._chk(v); return this; }
    setTargetAtTime(v) { this._chk(v); return this; }
    cancelScheduledValues() { return this; }
    _chk(v) {
      if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError('AudioParam value must be a number, got ' + v);
    }
  }
  class FakeNode {
    constructor(ctx, kind) { this.context = ctx; this.kind = kind; }
    connect(n) { if (n == null) throw new TypeError('connect() needs a node'); return n; }
    disconnect() {}
    start(t) { if (t !== undefined && typeof t !== 'number') throw new TypeError('start() time must be a number'); }
    stop() {}
  }
  class FakeAudioContext {
    constructor() { this.state = 'running'; this._t = 0; this.sampleRate = 48000; this.destination = new FakeNode(this, 'destination'); }
    get currentTime() { return this._t; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(1); return n; }
    createOscillator() { const n = new FakeNode(this, 'osc'); n.frequency = new FakeParam(440); n.detune = new FakeParam(0); n.type = 'sine'; return n; }
    createBiquadFilter() { const n = new FakeNode(this, 'filter'); n.frequency = new FakeParam(350); n.Q = new FakeParam(1); n.type = 'lowpass'; return n; }
    createBufferSource() { const n = new FakeNode(this, 'bufferSource'); n.buffer = null; n.loop = false; n.playbackRate = new FakeParam(1); return n; }
    createBuffer(ch, len, sr) {
      len = Math.floor(len);
      if (!(len > 0)) throw new TypeError('createBuffer length must be > 0, got ' + len);
      const data = new Float32Array(len);
      return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => data };
    }
    createDynamicsCompressor() { const n = new FakeNode(this, 'comp'); n.threshold = new FakeParam(-24); n.ratio = new FakeParam(12); return n; }
    createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam(0); return n; }
    createConvolver() { const n = new FakeNode(this, 'conv'); n.buffer = null; return n; }
  }
  global.AudioContext = FakeAudioContext;
  global.webkitAudioContext = FakeAudioContext;

  new Function(js)();
  const g = global.__g;
  if (!g) throw new Error('game did not export window.__g');

  let clock = 0;
  const api = {
    g, els, DOCSTATE, problems, listeners,
    /* drive the game exactly the way a browser does: only through queued rAF callbacks */
    pump(n, stepMs) {
      stepMs = stepMs || 16.7;
      let frames = 0;
      for (let k = 0; k < n; k++) {
        clock += stepMs;
        if (g.AU) {
          g.AU._t += stepMs / 1000;
          for (const t of TIMERS) {
            t.acc += stepMs;
            while (t.acc >= t.ms) { t.acc -= t.ms; t.f(); }
          }
        }
        const fns = rafFns.slice();
        rafFns.length = 0;
        if (!fns.length) throw new Error('render loop stopped requesting frames at frame ' + frames);
        for (const fn of fns) fn(clock);
        frames++;
      }
      return frames;
    },
    dispatch(type, ev) {
      const e = Object.assign({
        type, preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0,
        deltaY: 0, target: null, movementX: 0, movementY: 0,
      }, ev || {});
      for (const fn of (listeners[type] || [])) fn(e);
    },
    key(k) { api.dispatch('keydown', { key: k }); },
    keyUp(k) { api.dispatch('keyup', { key: k }); },
  };
  return api;
}

module.exports = { loadGame, ROOT };
