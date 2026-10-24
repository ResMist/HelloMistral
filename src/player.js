import * as THREE from 'three';
import { clamp, dist2 } from './utils.js';

// player.js — first-person controller, inventory, interaction, throwing




export class Player {
  constructor(world, input, game) {
    this.world = world;
    this.input = input;
    this.game = game;
    this.pos = new THREE.Vector3(0, 0, 13.5);
    this.yaw = 0; // facing the house (down -Z)
    this.pitch = 0;
    this.vy = 0;
    this.height = 1.7;
    this.crouching = false;
    this.sprinting = false;
    this.trapT = 0;      // stuck in bear trap
    this.stepAcc = 0;
    this.slots = [null, null, null, null];
    this.tools = new Set();
    this.keyring = new Set();
    this.hold = null;
    this.projectiles = [];
    this.bobT = 0;     // head-bob phase
    this.bobAmt = 0;    // head-bob intensity
  }

  get eyeY() { return this.pos.y + this.height * 0.94; }

  cameraDir() {
    // Three.js cameras look down -Z; forward is (-sin(yaw), -cos(yaw))
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  spawn() {
    this.pos.set(0, 0, 13.5);
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.trapT = 0;
    this.hold = null;
  }

  update(dt) {
    const input = this.input;
    const world = this.world;

    // ---- look ----
    const [mdx, mdy] = input.takeLook();
    this.yaw -= mdx * 0.0022;
    this.pitch = clamp(this.pitch - mdy * 0.0022, -1.35, 1.35);

    // ---- crouch / sprint ----
    // NOTE: Ctrl is intentionally NOT a crouch key — Ctrl+W closes the browser tab
    // and page JS can never intercept that shortcut. C only.
    this.crouching = input.down('KeyC');
    this.sprinting = input.down('ShiftLeft') && !this.crouching;
    const targetH = this.crouching ? 1.05 : 1.7;
    this.height += clamp(targetH - this.height, -dt * 4, dt * 4);

    // ---- move ----
    this.bobAmt += (0 - this.bobAmt) * Math.min(1, dt * 5);
    let speed = 0;
    if (this.trapT <= 0) {
      speed = this.crouching ? 1.9 : this.sprinting ? 6.1 : 3.6;
      let mx = 0, mz = 0;
      if (input.down('KeyW')) mz += 1;
      if (input.down('KeyS')) mz -= 1;
      if (input.down('KeyA')) mx += 1;
      if (input.down('KeyD')) mx -= 1;
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len; mz /= len;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const dx = (-mz * sin - mx * cos) * speed * dt;
        const dz = (-mz * cos + mx * sin) * speed * dt;
        this.pos.x += dx;
        this.pos.z += dz;
        // footstep noise
        this.stepAcc += Math.hypot(dx, dz);
        this.bobT += dt * (this.sprinting ? 11 : 7.5);
        this.bobAmt += (1 - this.bobAmt) * Math.min(1, dt * 8);
        const stride = this.sprinting ? 1.5 : 1.1;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          const radius = this.crouching ? 1.2 : this.sprinting ? 9 : 4.5;
          this.game.noise(this.pos.x, this.pos.y, this.pos.z, radius, 'step');
          this.game.audio.play(this.sprinting ? 'stepRun' : 'step');
        }
      }
    } else {
      this.trapT -= dt;
    }

    // ---- collide & gravity ----
    world.resolveCollision(this.pos, 0.38, this.pos.y, this.height);
    this.vy -= 18 * dt;
    this.pos.y += this.vy * dt;
    const ground = world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= ground) {
      if (this.vy < -7) this.game.audio.play('thud');
      this.pos.y = ground;
      this.vy = 0;
    }
    if (input.pressed('Space') && this.trapT <= 0 && this.pos.y <= ground + 0.02) {
      this.vy = 6.6;
    }

    // ---- bear traps ----
    for (const trap of world.traps) {
      if (!trap.armed) continue;
      if (dist2(this.pos.x, this.pos.z, trap.x, trap.z) < 0.5 && Math.abs(this.pos.y - trap.y) < 0.6) {
        world.snapTrap(trap);
        this.trapT = 2.6;
        this.game.audio.play('snap');
        this.game.noise(this.pos.x, this.pos.y, this.pos.z, 20, 'trap');
        this.game.hud.message('You stepped in a bear trap! He\'s coming…', 3);
      }
    }

    // ---- projectiles ----
    for (const p of this.projectiles) {
      p.age += dt;
      p.vel.y -= 18 * dt;
      const nx = p.mesh.position.x + p.vel.x * dt;
      const ny = p.mesh.position.y + p.vel.y * dt;
      const nz = p.mesh.position.z + p.vel.z * dt;
      const g = world.groundHeightAt(nx, nz, ny);
      if (ny <= g + 0.1 || world.pointBlocked(nx, ny, nz)) {
        p.mesh.position.y = Math.max(g + 0.07, ny);
        if (!p.settled) {
          p.settled = true;
          this.game.audio.play(p.kind === 'can' ? 'clink' : 'thud');
          this.game.noise(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 15, 'impact');
        }
        p.vel.set(0, 0, 0);
      } else {
        p.mesh.position.set(nx, ny, nz);
      }
      if (p.age > 9) p.mesh.visible = false;
    }
    this.projectiles = this.projectiles.filter((p) => p.age < 60);

    // ---- interact ----
    this.updateInteraction(dt);

    // ---- throw / drop ----
    if (input.takeClick() > 0 && this.trapT <= 0) {
      this.throwHeld();
    }
    if (input.pressed('KeyQ')) this.dropHeld();
  }

  // find best interactable in view
  findTarget() {
    const world = this.world;
    const cam = new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z);
    const dir = this.cameraDir();
    let best = null;
    let bestScore = 0.62;
    const consider = (x, y, z, make) => {
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 2.8) return;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      const score = dot - d * 0.06;
      if (dot > 0.55 && score > bestScore) { bestScore = score; best = make(d); }
    };
    for (const it of world.items) {
      if (it.taken || !it.revealed) continue;
      consider(it.mesh.position.x, it.mesh.position.y, it.mesh.position.z, () => ({
        kind: 'item', obj: it, label: `Pick up ${it.label}`, hold: 0,
      }));
    }
    for (const c of world.containers) {
      if (c.opened) continue;
      consider(c.x, c.y + 0.2, c.z, () => ({
        kind: 'container', obj: c, label: `Open ${c.name.toLowerCase()}…`, hold: 0.5,
      }));
    }
    for (const d of world.doors) {
      const cy = d.y + 1.1;
      consider(d.center.x, cy, d.center.z, () => {
        if (this.world.doorClosed(d) && d.locked) {
          if (this.tools.has('lockpick')) {
            return { kind: 'door', obj: d, label: 'Pick the lock (hold E)…', hold: 2.5 };
          }
          return { kind: 'door', obj: d, label: 'It\'s locked. A lockpick would help.', hold: 0 };
        }
        const open = this.world.doorClosed(d) ? 'Open' : 'Close';
        return { kind: 'door', obj: d, label: `${open} ${d.name.toLowerCase()}`, hold: 0 };
      });
    }
    for (const w of world.windows) {
      const wy = w.floor1 ? 4.65 : 1.55;
      consider(w.cx, wy, w.cz, () => {
        if (w.boarded) {
          if (this.tools.has('crowbar')) {
            return { kind: 'window', obj: w, label: 'Pry the boards off (hold E)…', hold: 2.0 };
          }
          return { kind: 'window', obj: w, label: 'It\'s boarded up. You need a crowbar.', hold: 0 };
        }
        return { kind: 'window', obj: w, label: 'Climb through the window', hold: 0 };
      });
      if (w.ladder && !w.boarded) {
        // climbing the outside ladder into the room
        const lx = w.cx + w.nx * 0.9, lz = w.cz + w.nz * 0.9;
        const dx = lx - cam.x, dz = lz - cam.z;
        const d = Math.hypot(dx, dz, cam.y * 0.2);
        if (Math.hypot(dx, dz) < 2.4 && this.pos.y < 1.5) {
          const score = 0.8 - Math.hypot(dx, dz) * 0.1;
          if (score > bestScore) {
            bestScore = score;
            best = { kind: 'ladder', obj: w, label: 'Climb the ladder', hold: 0 };
          }
        }
      }
    }
    // steel basement door
    const B = world.basement;
    if (!B.open) {
      consider(9.85, 1.3, -5, () => {
        const missing = ['red', 'blue', 'green'].filter((k) => !this.keyring.has(k));
        if (missing.length === 0) {
          return { kind: 'steel', label: 'Unlock the basement door', hold: 0 };
        }
        return {
          kind: 'steel',
          label: `Basement door — ${missing.length} lock${missing.length > 1 ? 's' : ''} left (${missing.join(', ')})`,
          hold: 0,
        };
      });
    }
    // doorbell (front porch)
    if (this.pos.y < 1.2) {
      consider(0.65, 1.4, 8.2, () => ({ kind: 'bell', label: 'Ring the doorbell', hold: 0 }));
    }
    for (const trap of world.traps) {
      if (!trap.armed) continue;
      consider(trap.x, trap.y + 0.15, trap.z, () => ({
        kind: 'trap', obj: trap, label: 'Disarm the bear trap (hold E)…', hold: 1.6,
      }));
    }
    return best;
  }

  updateInteraction(dt) {
    const input = this.input;
    const hud = this.game.hud;
    const target = this.findTarget();
    hud.setPrompt(target ? target.label : null);

    if (!target) {
      this.hold = null;
      hud.setHold(null);
      return;
    }
    if (target.hold > 0) {
      if (input.down('KeyE')) {
        if (!this.hold || this.hold.target !== target) {
          this.hold = { target, t: 0, dur: target.hold, tick: 0 };
        }
        this.hold.t += dt;
        this.hold.tick += dt;
        if (this.hold.tick > 0.5) {
          this.hold.tick = 0;
          const s = target.kind === 'window' ? 'pry' : target.kind === 'trap' ? 'pick' : 'pick';
          this.game.audio.play(s);
          if (target.kind !== 'trap') {
            this.game.noise(this.pos.x, this.pos.y, this.pos.z, 5, 'fiddle');
          }
        }
        hud.setHold(this.hold.t / this.hold.dur);
        if (this.hold.t >= this.hold.dur) {
          this.completeHold(target);
          this.hold = null;
          hud.setHold(null);
        }
      } else {
        this.hold = null;
        hud.setHold(null);
      }
    } else if (input.pressed('KeyE')) {
      this.instantAction(target);
    }
  }

  completeHold(target) {
    switch (target.kind) {
      case 'door':
        target.obj.locked = false;
        this.world.setDoor(target.obj, true);
        this.game.audio.play('unlock');
        this.game.audio.play('door');
        this.game.noise(this.pos.x, this.pos.y, this.pos.z, 8, 'lockpick');
        this.game.hud.message('The lock clicks open.');
        break;
      case 'window': {
        const w = target.obj;
        this.world.unboard(w);
        this.game.audio.play('pry');
        this.game.noise(this.pos.x, this.pos.y, this.pos.z, 16, 'pry');
        this.game.hud.message('The boards come loose — that was loud.');
        break;
      }
      case 'trap':
        this.world.removeTrap(target.obj);
        this.game.audio.play('pickup');
        this.game.hud.message('Trap disarmed.');
        break;
    }
  }

  instantAction(target) {
    const world = this.world;
    const game = this.game;
    switch (target.kind) {
      case 'item': {
        const it = target.obj;
        it.taken = true;
        it.mesh.visible = false;
        game.audio.play('pickup');
        if (it.kind.startsWith('key_')) {
          const k = it.kind.slice(4);
          this.keyring.add(k);
          game.hud.message(`You found the ${k.toUpperCase()} key!`);
          game.updateObjectives();
        } else if (it.kind === 'crowbar' || it.kind === 'lockpick') {
          this.tools.add(it.kind);
          game.hud.message(`Picked up the ${it.kind}.`);
        } else {
          const slot = this.slots.findIndex((s) => s === null);
          if (slot < 0) {
            it.taken = false;
            it.mesh.visible = true;
            game.hud.message('Your hands are full.');
            return;
          }
          this.slots[slot] = { kind: it.kind };
          game.hud.message(`Picked up a ${it.label}. LMB to throw.`);
        }
        game.hud.setKeys(this.keyring);
        game.hud.setTools(this.tools);
        game.hud.setSlots(this.slots);
        game.updateObjectives();
        break;
      }
      case 'container': {
        world.revealContainer(target.obj);
        game.audio.play('door');
        game.noise(this.pos.x, this.pos.y, this.pos.z, 5, 'container');
        game.hud.message(`You rummage through the ${target.obj.name.toLowerCase()}…`);
        break;
      }
      case 'door': {
        const d = target.obj;
        const open = world.doorClosed(d);
        world.setDoor(d, open);
        game.audio.play('door');
        game.noise(this.pos.x, this.pos.y, this.pos.z, 6, 'door');
        break;
      }
      case 'window': {
        const w = target.obj;
        if (w.floor1) {
          // upstairs windows are only reachable from inside — climb out and drop
          this.pos.set(w.outX, 0.2, w.outZ);
          this.vy = 0;
          game.hud.message('You climb out and drop down outside.');
        } else {
          const insideNow = (w.nz === 1 && this.pos.z < w.cz) || (w.nz === -1 && this.pos.z > w.cz) ||
            (w.nx === 1 && this.pos.x < w.cx) || (w.nx === -1 && this.pos.x > w.cx);
          if (insideNow) {
            this.pos.set(w.outX, 0.05, w.outZ);
            game.hud.message('You slip out through the window.');
          } else {
            this.pos.set(w.inX, 0.05, w.inZ);
            game.hud.message('You slip inside through the window.');
          }
          this.vy = 0;
        }
        game.audio.play('climb');
        game.noise(this.pos.x, this.pos.y, this.pos.z, 8, 'climb');
        world.memory.noteEntryUse(w.id);
        break;
      }
      case 'ladder': {
        const w = target.obj;
        this.pos.set(w.inX, 3.25, w.inZ);
        this.vy = 0;
        game.audio.play('climb');
        game.noise(this.pos.x, this.pos.y, this.pos.z, 9, 'climb');
        world.memory.noteEntryUse(w.id);
        game.hud.message('You climb through the upstairs window.');
        break;
      }
      case 'bell':
        game.audio.play('bell');
        game.noise(0, 0, 9, 24, 'doorbell');
        game.hud.message('You ring the doorbell. Bold.');
        break;
      case 'steel': {
        world.openBasement();
        game.audio.play('unlock');
        game.audio.play('door');
        game.noise(this.pos.x, this.pos.y, this.pos.z, 22, 'basement');
        game.hud.message('The steel door swings open. Something hums below…', 4);
        game.updateObjectives();
        break;
      }
    }
  }

  throwHeld() {
    const slot = this.slots.findIndex((s) => s !== null);
    if (slot < 0) return;
    const kind = this.slots[slot].kind;
    this.slots[slot] = null;
    this.game.hud.setSlots(this.slots);
    const mesh = this.world.makeItemMesh(kind);
    const dir = this.cameraDir();
    mesh.position.set(this.pos.x + dir.x * 0.4, this.eyeY - 0.2, this.pos.z + dir.z * 0.4);
    this.world.group.add(mesh);
    this.projectiles.push({
      kind, mesh, age: 0, settled: false,
      vel: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 2.4, 0)),
    });
    this.game.audio.play('throwWhoosh');
  }

  dropHeld() {
    const slot = this.slots.findIndex((s) => s !== null);
    if (slot < 0) return;
    const kind = this.slots[slot].kind;
    this.slots[slot] = null;
    this.game.hud.setSlots(this.slots);
    const mesh = this.world.makeItemMesh(kind);
    const dir = this.cameraDir();
    mesh.position.set(this.pos.x + dir.x * 0.5, this.pos.y + 0.5, this.pos.z + dir.z * 0.5);
    this.world.group.add(mesh);
    this.projectiles.push({
      kind, mesh, age: 0, settled: false,
      vel: dir.clone().multiplyScalar(2).add(new THREE.Vector3(0, 1, 0)),
    });
  }
}
