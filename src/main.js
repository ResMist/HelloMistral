import * as THREE from 'three';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';
import { Memory } from './memory.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Neighbor } from './neighbor.js';
import { dist2 } from './utils.js';

// main.js — game bootstrap, state machine and main loop











class Game {
  constructor() {
    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.getElementById('app').appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e16);
    this.scene.fog = new THREE.FogExp2(0x0a0e16, 0.022);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // flashlight attached to the camera
    this.flashOn = true;
    this.flash = new THREE.SpotLight(0xfff0d0, 16, 26, 0.42, 0.4, 1.5);
    this.flash.position.set(0.12, -0.12, 0);
    this.camera.add(this.flash);
    this.flashTarget = new THREE.Object3D();
    this.flashTarget.position.set(0, 0, -1);
    this.camera.add(this.flashTarget);
    this.flash.target = this.flashTarget;

    this.input = new Input(this.canvas);
    this.audio = new AudioSys();
    this.hud = new HUD();
    this.memory = new Memory();
    this.world = new World(this.scene, this.memory);
    this.player = new Player(this.world, this.input, this);
    this.neighbor = new Neighbor(this.world, this.memory, this);

    this.state = 'menu'; // menu | playing | paused | caught | win
    this.attempt = 1;
    this.startTime = 0;
    this.elapsed = 0;

    this.wireUI();
    this.updateObjectives();
    this.hud.setAttempt(this.attempt, this.memory.catchCount);
    this.hud.setKeys(this.player.keyring);
    this.hud.setTools(this.player.tools);
    this.hud.setSlots(this.player.slots);
    this.hud.showScreen('menu');

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing') {
        this.state = 'paused';
        this.hud.showScreen('pause');
      }
    });

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  wireUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-play').addEventListener('click', () => this.start());
    $('btn-reset').addEventListener('click', () => {
      this.memory.reset();
      $('btn-reset').textContent = 'Memory wiped!';
      setTimeout(() => { $('btn-reset').textContent = 'Make him forget everything'; }, 2500);
    });
    $('btn-resume').addEventListener('click', () => {
      this.state = 'playing';
      this.hud.hideScreens();
      this.canvas.requestPointerLock();
    });
    $('btn-retry').addEventListener('click', () => {
      this.resetRound();
    });
    $('btn-win-menu').addEventListener('click', () => {
      this.fullRestart();
    });
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.canvas.requestPointerLock();
    });
  }

  start() {
    this.audio.ensure();
    this.audio.play('unlock');
    this.state = 'playing';
    this.hud.hideScreens();
    this.canvas.requestPointerLock();
    this.startTime = this.elapsed;
    this.hud.message('Find a way into the basement. Quietly.', 4);
  }

  // ---------- noise routing ----------
  noise(x, y, z, radius, tag) {
    this.neighbor.onNoise(x, y, z, radius, tag);
  }

  // ---------- chase music ----------
  onChaseStart() {
    this.audio.setChase(true);
  }
  onChaseEnd() {
    this.audio.setChase(false);
  }

  // ---------- caught ----------
  onCaught() {
    if (this.state !== 'playing') return;
    this.state = 'caught';
    this.audio.play('caught');
    this.audio.setChase(false);
    document.exitPointerLock();

    const room = this.world.roomAt(this.player.pos.x, this.player.pos.z, this.player.pos.y);
    this.memory.noteCatch(room ? room.id : 'yard');

    const notes = this.applyLearning();

    this.hud.showCaught(
      `He got you in the ${room ? room.name.toLowerCase() : 'yard'}. Attempt ${this.attempt} is over.`,
      notes.length ? notes : ['He remembers. He adapts. Try a different route.']
    );
    setTimeout(() => this.hud.showScreen('caught'), 900);
  }

  applyLearning() {
    const notes = [];
    const world = this.world;
    // board up entry points the player used
    for (const id of this.memory.takePlannedBoards()) {
      const w = world.windows.find((x) => x.id === id);
      if (w && !w.boarded) {
        world.boardUp(w);
        world.memory.data.entries[id].boarded = true;
        world.memory.save();
        notes.push(`He boarded up the ${w.name}.`);
      }
    }
    // bear traps at frequently used entries
    const trapIds = this.memory.takePlannedTraps();
    if (trapIds.length) {
      this.neighbor.queueTraps(trapIds);
      notes.push('He is setting bear traps at your favorite entry points.');
    }
    // security camera after the second catch
    if (this.memory.catchCount >= 2 && world.cameras.length === 0) {
      const hot = this.memory.hotRooms().find((r) => r !== 'yard' && r !== 'base');
      const room = world.rooms.find((r) => r.id === hot) || world.rooms[0];
      world.placeCamera(room);
      notes.push(`He installed a security camera in the ${room.name.toLowerCase()}.`);
    }
    // front door gets locked after the third catch
    if (this.memory.catchCount >= 3) {
      const front = world.doors.find((d) => d.id === 'front');
      if (front && !front.locked) {
        front.locked = true;
        notes.push('He changed the front door lock. A lockpick would help.');
      }
    }
    if (this.memory.catchCount >= 1) {
      notes.push('He is getting faster… and his eyes sharper.');
    }
    return notes;
  }

  resetRound() {
    this.attempt++;
    this.player.spawn();
    this.neighbor.reset();
    this.hud.setAttempt(this.attempt, this.memory.catchCount);
    this.state = 'playing';
    this.hud.hideScreens();
    this.canvas.requestPointerLock();
    this.updateObjectives();
  }

  fullRestart() {
    window.location.reload();
  }

  // ---------- win ----------
  checkWin() {
    const p = this.player.pos;
    if (this.world.basement.open && this.state === 'playing' &&
        p.x > 13.2 && p.y < -1.4 && p.z > -7 && p.z < -3) {
      this.state = 'win';
      this.audio.play('win');
      this.audio.setChase(false);
      document.exitPointerLock();
      const mins = Math.floor(this.elapsed / 60);
      const secs = Math.floor(this.elapsed % 60);
      this.hud.showWin(`You made it into the basement after ${this.attempt} attempt(s), ` +
        `${mins}m ${secs}s, and ${this.memory.catchCount} catch(es). He'll be waiting next time.`);
      this.hud.showScreen('win');
    }
  }

  updateObjectives() {
    const missing = ['red', 'blue', 'green'].filter((k) => !this.player.keyring.has(k));
    const lines = [];
    if (missing.length === 3) {
      lines.push('Find the three basement keys (red, blue, green)');
    } else if (missing.length > 0) {
      lines.push(`Keys found: ${3 - missing.length}/3 — still missing: ${missing.join(', ')}`);
    } else if (!this.world.basement.open) {
      lines.push('Open the steel basement door in the workshop');
    } else {
      lines.push('Descend into the basement');
    }
    lines.push("Don't get caught. He remembers everything.");
    this.hud.setObjectives(lines);
  }

  // ---------- loop ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.state === 'playing') {
      this.elapsed += dt;
      this.player.update(dt);
      this.neighbor.update(dt, this.player);
      this.world.update(dt);
      this.checkWin();

      // camera (+ head bob)
      this.camera.position.set(this.player.pos.x, this.player.pos.y + this.player.height * 0.94
        + Math.sin(this.player.bobT) * 0.035 * this.player.bobAmt, this.player.pos.z);
      this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);

      // FOV kicks wider while chased
      const chaseFov = this.neighbor.state === 'chase' ? 80 : 72;
      this.camera.fov += (chaseFov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();

      // HUD
      const room = this.world.roomAt(this.player.pos.x, this.player.pos.z, this.player.pos.y);
      this.hud.setRoom(room ? room.name : 'The Street');
      this.hud.setAlert(this.neighbor.alertLevel(this.player));
      const near = dist2(this.player.pos.x, this.player.pos.z, this.neighbor.pos.x, this.neighbor.pos.z) < 8;
      this.audio.update(dt, near);

      // mute toggle
      if (this.input.pressed('KeyM')) {
        const m = this.audio.toggleMute();
        this.hud.message(m ? 'Sound muted' : 'Sound on', 1.2);
      }
      // flashlight toggle
      if (this.input.pressed('KeyF')) {
        this.flashOn = !this.flashOn;
        this.flash.intensity = this.flashOn ? 16 : 0;
        this.hud.message(this.flashOn ? 'Flashlight on' : 'Flashlight off', 1);
      }
    } else {
      this.hud.setAlert('');
    }

    this.hud.update(dt);
    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
}

new Game();
