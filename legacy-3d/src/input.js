// input.js — keyboard / mouse handling with pointer lock

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.presses = new Set();
    this.mdx = 0;
    this.mdy = 0;
    this.clicks = 0;
    this.locked = false;

    window.addEventListener('keydown', (e) => {
      if (!e.repeat) {
        this.keys.add(e.code);
        this.presses.add(e.code);
      }
      if (e.code === 'Space' || e.code === 'KeyE') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mdx += e.movementX;
        this.mdy += e.movementY;
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.clicks++;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.presses.has(code); }
  takeLook() {
    const r = [this.mdx, this.mdy];
    this.mdx = 0;
    this.mdy = 0;
    return r;
  }
  takeClick() {
    const c = this.clicks;
    this.clicks = 0;
    return c;
  }
  endFrame() { this.presses.clear(); }
}
