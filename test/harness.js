'use strict';
// test/harness.js — a tiny dependency-free DOM/canvas stub that boots the
// single-file game from index.html inside a Node vm. Used by test/game2d.js.
// It intentionally does not try to render pixels: every Canvas2D call is a
// no-op, which lets the update/AI logic run at full speed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('index.html: no inline game script found');
  return m[1];
}

function seededMath(seed) {
  const m = Object.create(Math);
  let s = (seed >>> 0) || 1;
  m.random = function () {
    // Numerical Recipes LCG — deterministic across Node versions.
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return m;
}

function makeCtx() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createConicGradient') {
        return function () { return gradient; };
      }
      if (p === 'measureText') return function () { return { width: 0 }; };
      if (p === 'getImageData') return function (x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) }; };
      return function () {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function makeEl(id) {
  const el = {
    id,
    style: {},
    innerHTML: '',
    textContent: '',
    className: '',
    onclick: null,
    width: 1280,
    height: 720,
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeEl(id + '-child'); },
    getContext() { return makeCtx(); },
    requestPointerLock() {},
  };
  return el;
}

function load(opts = {}) {
  const file = opts.file || path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const js = extractScript(html);
  const els = opts.els || {};
  const store = opts.store || {};
  const listeners = {};
  const warnings = [];
  const timers = [];
  let timerId = 1;

  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.Math = seededMath(opts.seed == null ? 12345 : opts.seed);
  sandbox.console = {
    log: function () {},
    warn: function () { warnings.push(Array.prototype.join.call(arguments, ' ')); },
    error: function () { warnings.push(Array.prototype.join.call(arguments, ' ')); },
  };
  sandbox.innerWidth = 1280;
  sandbox.innerHeight = 720;
  sandbox.devicePixelRatio = 1;
  sandbox.performance = { now: function () { return 0; } };
  sandbox.requestAnimationFrame = function (cb) { sandbox.__rafCb = cb; return 1; };
  sandbox.setTimeout = function (fn, ms) {
    timers.push({ id: timerId, fn: fn, at: sandbox.__clock + (ms || 0) });
    return timerId++;
  };
  sandbox.clearTimeout = function (id) {
    const i = timers.findIndex(function (t) { return t.id === id; });
    if (i >= 0) timers.splice(i, 1);
  };
  sandbox.__clock = 0;
  sandbox.addEventListener = function (name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  };
  sandbox.removeEventListener = function () {};
  sandbox.localStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { Object.keys(store).forEach(function (k) { delete store[k]; }); },
  };
  sandbox.location = { reload: function () {} };
  sandbox.document = {
    getElementById: function (id) {
      if (!els[id]) els[id] = makeEl(id);
      return els[id];
    },
    createElement: function (tag) { return makeEl('created-' + tag); },
    addEventListener: function (name, fn) {
      (listeners['doc:' + name] = listeners['doc:' + name] || []).push(fn);
    },
    body: makeEl('body'),
  };

  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: path.basename(file) });

  return {
    g: sandbox.__g,
    sandbox,
    els,
    store,
    warnings,
    listeners,
    html,
    js,
    pumpFrame: function (ms) {
      if (!sandbox.__rafCb) return false;
      if (ms) sandbox.__clock += ms;
      sandbox.__rafCb(sandbox.__clock);
      return true;
    },
    runTimers: function () {
      const due = timers.filter(function (t) { return t.at <= sandbox.__clock; });
      for (const t of due) t.fn();
      for (const t of due) {
        const i = timers.indexOf(t);
        if (i >= 0) timers.splice(i, 1);
      }
    },
  };
}

module.exports = { load, extractScript, makeEl, makeCtx };
