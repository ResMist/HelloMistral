// hud.js — DOM-based HUD, prompts, inventory and menu screens

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.msgEl = $('msg');
    this.promptEl = $('prompt');
    this.holdWrap = $('holdwrap');
    this.holdBar = $('holdbar');
    this.invEl = $('inv');
    this.toolsEl = $('tools');
    this.keysEl = $('keys');
    this.objEl = $('obj');
    this.alertEl = $('alert');
    this.roomEl = $('room');
    this.attemptEl = $('attempt');
    this.vignette = $('vignette');
    this.screens = {
      menu: $('screen-menu'),
      pause: $('screen-pause'),
      caught: $('screen-caught'),
      win: $('screen-win'),
    };
    this.caughtSub = $('caught-sub');
    this.caughtNotes = $('caught-notes');
    this.winSub = $('win-sub');
    this._msgT = 0;
    this._msgQueue = [];
    this._lastAlert = '';
  }

  showScreen(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('hidden', k !== name);
  }
  hideScreens() {
    for (const k in this.screens) this.screens[k].classList.add('hidden');
  }

  message(text, dur = 2.6) {
    this._msgQueue.push({ text, dur });
  }

  update(dt) {
    this._msgT -= dt;
    if (this._msgT <= 0 && this._msgQueue.length) {
      const m = this._msgQueue.shift();
      this.msgEl.textContent = m.text;
      this.msgEl.style.opacity = '1';
      this._msgT = m.dur;
    }
    if (this._msgT <= 0.4 && this._msgT > 0) {
      this.msgEl.style.opacity = String(Math.max(0, this._msgT / 0.4));
    }
  }

  setPrompt(text) {
    this.promptEl.textContent = text || '';
    this.promptEl.classList.toggle('hidden', !text);
  }

  setHold(frac) {
    if (frac == null) {
      this.holdWrap.classList.add('hidden');
    } else {
      this.holdWrap.classList.remove('hidden');
      this.holdBar.style.width = `${Math.min(1, frac) * 100}%`;
    }
  }

  setSlots(slots) {
    for (let i = 0; i < 4; i++) {
      const el = this.invEl.children[i];
      if (!el) continue;
      const it = slots[i];
      el.textContent = it ? (it.kind === 'can' ? 'CAN' : 'BOX') : '';
      el.classList.toggle('filled', !!it);
    }
  }

  setTools(tools) {
    let html = '';
    if (tools.has('crowbar')) html += '<span class="chip">CROWBAR</span>';
    if (tools.has('lockpick')) html += '<span class="chip">LOCKPICK</span>';
    this.toolsEl.innerHTML = html;
  }

  setKeys(keys) {
    let html = '';
    for (const k of ['red', 'blue', 'green']) {
      if (keys.has(k)) html += `<span class="chip key key-${k}">${k.toUpperCase()} KEY</span>`;
    }
    this.keysEl.innerHTML = html;
  }

  setObjectives(lines) {
    this.objEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  setAttempt(n, total) {
    this.attemptEl.textContent = `Attempt ${n} — he has caught you ${total} time${total === 1 ? '' : 's'}`;
  }

  setRoom(name) {
    this.roomEl.textContent = name || '';
  }

  // level: '', 'suspect', 'chase'
  setAlert(level) {
    if (level === this._lastAlert) return;
    this._lastAlert = level;
    this.alertEl.textContent = level === 'chase' ? '!! HE SEES YOU !!' : level === 'suspect' ? '! ...he heard something' : '';
    this.alertEl.className = 'hud' + (level ? ' ' + level : '');
    this.vignette.className = 'hud' + (level === 'chase' ? ' chase' : '');
  }

  showCaught(sub, notes) {
    this.caughtSub.textContent = sub;
    this.caughtNotes.innerHTML = notes.map((n) => `<div>— ${n}</div>`).join('');
  }

  showWin(sub) {
    this.winSub.textContent = sub;
  }
}
