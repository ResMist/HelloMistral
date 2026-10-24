import * as THREE from 'three';
import { clamp, dist2, angleDelta } from './utils.js';

// neighbor.js — the neighbor: procedural character model, finite-state
// machine AI (patrol / investigate / chase / search / trap-setting),
// sight + hearing, A* navigation and adaptive behaviour driven by Memory.




const STATE = {
  ROUTINE: 'routine',
  INVESTIGATE: 'investigate',
  CHASE: 'chase',
  SEARCH: 'search',
  TRAP: 'trap',
};

export class Neighbor {
  constructor(world, memory, game) {
    this.world = world;
    this.memory = memory;
    this.game = game;
    this.pos = new THREE.Vector3(7, 0, 5);
    this.yaw = Math.PI;
    this.state = STATE.ROUTINE;
    this.aware = 0;           // 0..1 suspicion before chase
    this.path = [];
    this.pathI = 0;
    this.waitT = 0;
    this.lookT = 0;
    this.targetRoom = null;
    this.noisePos = null;
    this.lastSeen = null;
    this.lostT = 0;
    this.visionT = 0;
    this.animT = 0;
    this.speedBonus = memory.speedBonus();
    this.visionBonus = memory.visionBonus();
    this.trapQueue = [];      // entry ids to trap
    this.trapWait = false;
    this.stickT = 0;          // stuck-in-corner accumulator
    this.sideT = 0;           // sidestep timer
    this.sideSign = 1;
    this.buildModel();
    this.pickPatrol();
  }

  reset() {
    this.pos.set(7, 0, 5);
    this.yaw = Math.PI;
    this.state = STATE.ROUTINE;
    this.aware = 0;
    this.path = [];
    this.waitT = 0;
    this.lastSeen = null;
    this.noisePos = null;
    this.speedBonus = this.memory.speedBonus();
    this.visionBonus = this.memory.visionBonus();
    this.setEyesChase(false);
    this.pickPatrol();
  }

  // ---------------- procedural character (jointed rig) ----------------
  // A hand-built skeleton: every limb is a chain of pivots (shoulder->elbow,
  // hip->knee) so animations bend at real joints instead of swinging boxes.
  buildModel() {
    const g = new THREE.Group();
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });
    const skin = L(0xd8a878), shirt = L(0x4a7a4a), pants = L(0x5a5a68);
    const j = (this.j = {});

    // ---- hips (rig root) ----
    const hips = new THREE.Group();
    hips.position.y = 1.04;
    g.add(hips);
    j.root = hips;
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.3, 0.34), pants);
    pelvis.position.y = -0.02;
    hips.add(pelvis);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.37), L(0x3a3a3a));
    belt.position.y = -0.15;
    hips.add(belt);

    // ---- torso (spine) ----
    const torso = new THREE.Group();
    hips.add(torso);
    j.torso = torso;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.36), shirt);
    chest.position.y = 0.42;
    torso.add(chest);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.24, 0.41), shirt);
    belly.position.y = 0.05;
    torso.add(belly);
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), L(0xd9d9d9));
      btn.rotation.x = Math.PI / 2;
      btn.position.set(0, 0.6 - i * 0.19, 0.2);
      torso.add(btn);
    }
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.1), L(0x3d663d));
    collar.position.set(0, 0.76, 0.15);
    torso.add(collar);

    // ---- neck & head ----
    const neck = new THREE.Group();
    neck.position.y = 0.82;
    torso.add(neck);
    j.neck = neck;
    this.head = new THREE.Group();
    this.head.position.y = 0.14;
    neck.add(this.head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
    this.head.add(skull);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.12), skin);
    nose.position.set(0, -0.02, 0.2);
    this.head.add(nose);
    const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.07), L(0x4a3323));
    mustache.position.set(0, -0.09, 0.21);
    this.head.add(mustache);
    const browGeo = new THREE.BoxGeometry(0.12, 0.05, 0.05);
    this.browL = new THREE.Mesh(browGeo, L(0x4a3323));
    this.browL.position.set(-0.07, 0.09, 0.17);
    this.browL.rotation.z = 0.12;
    this.head.add(this.browL);
    this.browR = new THREE.Mesh(browGeo, L(0x4a3323));
    this.browR.position.set(0.07, 0.09, 0.17);
    this.browR.rotation.z = -0.12;
    this.head.add(this.browR);
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), L(0x5a2f2f));
    this.mouth.position.set(0, -0.155, 0.21);
    this.head.add(this.mouth);
    this.eyeMat = L(0xffffff);
    this.pupilMat = new THREE.MeshBasicMaterial({ color: 0x181818 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.04), this.eyeMat);
      eye.position.set(s * 0.08, 0.03, 0.17);
      this.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.03), this.pupilMat);
      pupil.position.set(s * 0.08, 0.03, 0.19);
      if (s === -1) this.pupilL = pupil; else this.pupilR = pupil;
      this.head.add(pupil);
    }
    // flat cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.09, 0.35), L(0x3a4a5a));
    cap.position.y = 0.21;
    this.head.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.14), L(0x3a4a5a));
    brim.position.set(0, 0.17, 0.22);
    this.head.add(brim);

    // ---- arms: shoulder -> elbow -> hand ----
    const mkArm = (s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.39, 0.62, 0);
      torso.add(shoulder);
      const delt = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), shirt);
      shoulder.add(delt);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.34, 0.18), shirt);
      upper.position.y = -0.19;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.38;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.15), shirt);
      fore.position.y = -0.15;
      elbow.add(fore);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.15), skin);
      hand.position.y = -0.36;
      elbow.add(hand);
      return { shoulder, elbow };
    };
    j.armL = mkArm(-1);
    j.armR = mkArm(1);
    // wristwatch on the left forearm
    const watch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), L(0x222222));
    watch.position.y = -0.26;
    j.armL.elbow.add(watch);

    // ---- legs: hip -> knee -> foot ----
    const mkLeg = (s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.15, -0.1, 0);
      hips.add(hip);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.24), pants);
      thigh.position.y = -0.2;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.38, 0.2), pants);
      shin.position.y = -0.19;
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.36), L(0x2a2a2a));
      foot.position.set(0, -0.42, 0.07);
      knee.add(foot);
      return { hip, knee };
    };
    j.legL = mkLeg(-1);
    j.legR = mkLeg(1);

    // blob contact shadow
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.3),
      new THREE.MeshBasicMaterial({
        map: this.world.shadowTexture(), transparent: true, opacity: 0.55, depthWrite: false,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    g.add(blob);

    this.model = g;
    this.world.scene.add(g);
  }

  setEyesChase(on) {
    this.pupilMat.color.setHex(on ? 0xff2222 : 0x181818);
    if (this.browL) {
      this.browL.rotation.z = on ? 0.42 : 0.12;
      this.browR.rotation.z = on ? -0.42 : -0.12;
    }
    if (this.mouth) {
      this.mouth.scale.y = on ? 3.5 : 1;
    }
  }

  // ---------------- senses ----------------
  canSee(player) {
    const world = this.world;
    const px = player.pos.x, py = player.eyeY, pz = player.pos.z;
    const ex = this.pos.x, ey = this.pos.y + 1.75, ez = this.pos.z;
    const range = 12 + this.visionBonus;
    const dx = px - ex, dy = py - ey, dz = pz - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range) return false;
    // facing? forward vector from yaw
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dot = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
    if (dot < 0.55 && d > 1.6) return false; // ~113° cone, but aware at very close range
    if (world.segmentBlocked(ex, ey, ez, px, py, pz)) return false;
    return true;
  }

  onNoise(x, y, z, radius, tag) {
    if (this.state === STATE.CHASE) return;
    const sameFloor = Math.abs(this.pos.y - y) < 1.8;
    const eff = sameFloor ? radius : radius * 0.4;
    const d = Math.hypot(this.pos.x - x, this.pos.z - z);
    if (d < eff) {
      this.noisePos = { x, y, z };
      this.state = STATE.INVESTIGATE;
      this.path = [];
      this.waitT = 0;
      if (d < eff * 0.4) this.aware = Math.min(1, this.aware + 0.3);
      this.game.audio.play('alert');
    }
  }

  // ---------------- decisions ----------------
  pickPatrol() {
    const world = this.world;
    const hot = this.memory.hotRooms();
    // candidate patrol destinations: all nav nodes' rooms, weighted by heat
    const rooms = world.rooms.filter((r) => r.id !== 'yard' && r.id !== 'base');
    let pick;
    if (hot.length && Math.random() < 0.45) {
      pick = rooms.find((r) => r.id === hot[Math.floor(Math.random() * Math.min(3, hot.length))]);
    }
    if (!pick && Math.random() < 0.3) pick = rooms.find((r) => r.id === 'work');
    if (!pick) pick = rooms[Math.floor(Math.random() * rooms.length)];
    this.targetRoom = pick;
    const node = this.nodeInRoom(pick.id);
    if (node >= 0) {
      this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z,
        world.nodes[node].x, world.nodes[node].y, world.nodes[node].z);
      this.pathI = 0;
    }
  }

  nodeInRoom(roomId) {
    const idxs = [];
    this.world.nodes.forEach((n, i) => { if (n.roomId === roomId) idxs.push(i); });
    if (!idxs.length) return -1;
    return idxs[Math.floor(Math.random() * idxs.length)];
  }

  enterChase() {
    this.state = STATE.CHASE;
    this.aware = 1;
    this.lostT = 0;
    this.setEyesChase(true);
    this.game.onChaseStart();
  }

  // ---------------- per-frame ----------------
  update(dt, player) {
    const world = this.world;
    const game = this.game;

    // ---- vision ----
    this.visionT -= dt;
    let sees = false;
    if (this.visionT <= 0) {
      this.visionT = 0.12;
      this.lastVision = this.canSee(player);
    }
    sees = this.lastVision;
    if (sees) {
      const d = dist2(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
      const range = 12 + this.visionBonus;
      let rate = 2.2 * (1.15 - d / range);
      if (player.sprinting) rate *= 1.7;
      if (player.crouching) rate *= 0.55;
      if (d < 3.5) rate = 7;
      this.aware = Math.min(1, this.aware + rate * dt);
      this.lastSeen = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
      const room = world.roomAt(player.pos.x, player.pos.z, player.pos.y);
      if (room && this.aware > 0.4) this.memory.noteSighting(room.id);
      if (this.aware >= 1 && this.state !== STATE.CHASE) this.enterChase();
      // face what you see
      if (this.state !== STATE.CHASE && this.aware > 0.35) {
        const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        this.yaw += angleDelta(this.yaw, want) * Math.min(1, dt * 4);
      }
    } else {
      this.aware = Math.max(0, this.aware - dt * 0.25);
    }
    // proximity sense: he feels someone right next to him
    if (!sees && dist2(this.pos.x, this.pos.z, player.pos.x, player.pos.z) < 1.2 &&
        Math.abs(this.pos.y - player.pos.y) < 1.4) {
      this.aware = Math.min(1, this.aware + dt * 3);
    }
    // lingering suspicion: go check where he last saw you
    if (this.state === STATE.ROUTINE && this.aware > 0.5 && this.lastSeen) {
      this.noisePos = { x: this.lastSeen.x, y: this.lastSeen.y, z: this.lastSeen.z };
      this.state = STATE.INVESTIGATE;
      this.path = [];
      this.lookT = 0;
    }

    // ---- security cameras ----
    for (const cam of world.cameras) {
      const head = player.pos.y + 1.3;
      const dx = player.pos.x - cam.g.position.x, dz = player.pos.z - cam.g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 8.5 && Math.abs(player.pos.y - cam.g.position.y) < 3 &&
          !world.segmentBlocked(cam.g.position.x, cam.g.position.y - 0.4, cam.g.position.z,
            player.pos.x, head, player.pos.z)) {
        cam.seeT += dt;
        if (cam.seeT > 1.4) {
          cam.seeT = -4; // cooldown
          game.audio.play('camera');
          this.onNoise(player.pos.x, player.pos.y, player.pos.z, 7, 'camera');
        }
      } else if (cam.seeT > 0) {
        cam.seeT = Math.max(0, cam.seeT - dt);
      }
    }

    // ---- state machine ----
    switch (this.state) {
      case STATE.ROUTINE: {
        this.setEyesChase(false);
        if (this.trapQueue.length && !this.trapWait) {
          const id = this.trapQueue.shift();
          const w = world.windows.find((x) => x.id === id);
          if (w) {
            const tx = w.cx + w.nx * 1.9, tz = w.cz + w.nz * 1.9;
            this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z, tx, 0, tz);
            this.pathI = 0;
            this.state = STATE.TRAP;
            this.trapTarget = { x: w.cx + w.nx * 1.4, z: w.cz + w.nz * 1.4, winId: id };
            break;
          }
        }
        if (this.followPath(dt, 2.9)) {
          this.waitT -= dt;
          if (this.waitT <= 0) {
            this.waitT = 1.5 + Math.random() * 2.5;
            this.pickPatrol();
          }
        }
        break;
      }
      case STATE.INVESTIGATE: {
        const n = this.noisePos;
        if (!n) { this.state = STATE.ROUTINE; this.pickPatrol(); break; }
        if (!this.path.length) {
          this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z, n.x, n.y, n.z);
          this.pathI = 0;
          if (!this.path.length) this.path = [{ x: n.x, y: n.y, z: n.z }];
        }
        if (this.followPath(dt, 3.9)) {
          this.lookT += dt;
          this.yaw += Math.sin(this.lookT * 2.4) * dt * 2.2;
          if (this.lookT > 4) {
            this.lookT = 0;
            this.noisePos = null;
            this.state = STATE.ROUTINE;
            this.pickPatrol();
          }
        }
        break;
      }
      case STATE.CHASE: {
        if (sees) {
          this.lostT = 0;
          this.lastSeen = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
          const direct = !world.segmentBlocked(this.pos.x, this.pos.y + 1.4, this.pos.z,
            player.pos.x, player.eyeY, player.pos.z);
          if (direct && Math.abs(this.pos.y - player.pos.y) < 1.2) {
            this.path = [];
            this.steerTo(player.pos.x, player.pos.z, dt, 5.7 + this.speedBonus);
          } else {
            if (!this.path.length) {
              this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z,
                this.lastSeen.x, this.lastSeen.y, this.lastSeen.z);
              this.pathI = 0;
            }
            this.followPath(dt, 5.7 + this.speedBonus);
          }
        } else {
          this.lostT += dt;
          if (this.lastSeen) {
            if (!this.path.length) {
              this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z,
                this.lastSeen.x, this.lastSeen.y, this.lastSeen.z);
              this.pathI = 0;
            }
            this.followPath(dt, 5.7 + this.speedBonus);
          }
          if (this.lostT > 4.5) {
            this.state = STATE.SEARCH;
            this.searchT = 0;
            this.setEyesChase(false);
            game.onChaseEnd();
          }
        }
        const dc = dist2(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
        if (dc < 1.15 && Math.abs(this.pos.y - player.pos.y) < 1.6) {
          game.onCaught();
          return;
        }
        break;
      }
      case STATE.SEARCH: {
        this.searchT += dt;
        if (!this.searchNode || this.followPath(dt, 3.4)) {
          // hop to a random nearby room node
          const cands = [];
          const base = this.lastSeen || this.pos;
          world.nodes.forEach((n) => {
            const d = Math.hypot(n.x - base.x, n.z - base.z);
            if (d < 12 && Math.abs(n.y - this.pos.y) < 3.4) cands.push(n);
          });
          if (cands.length) {
            const n = cands[Math.floor(Math.random() * cands.length)];
            this.searchNode = n;
            this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z, n.x, n.y, n.z);
            this.pathI = 0;
          }
        }
        if (this.searchT > 14) {
          this.state = STATE.ROUTINE;
          this.aware = 0;
          this.pickPatrol();
        }
        break;
      }
      case STATE.TRAP: {
        const t = this.trapTarget;
        if (this.followPath(dt, 2.8)) {
          if (t) {
            const ty = world.groundHeightAt(t.x, t.z, this.pos.y);
            world.placeTrap(t.x, ty, t.z);
            this.game.hud.message('Somewhere in the house, metal clinks…', 2.5);
            this.game.audio.play('snap');
          }
          this.trapTarget = null;
          this.state = STATE.ROUTINE;
          this.pickPatrol();
        }
        break;
      }
    }

    // ---- ground follow & animation ----
    this.pos.y = this.world.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    this.animate(dt);
  }

  steerTo(x, z, dt, speed) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    let ux = dx / d, uz = dz / d;
    // sidestep while wedged against geometry
    if (this.sideT > 0) {
      this.sideT -= dt;
      const px = -uz * this.sideSign, pz = ux * this.sideSign;
      ux = px; uz = pz;
    }
    const want = Math.atan2(ux, uz);
    this.yaw += angleDelta(this.yaw, want) * Math.min(1, dt * 8);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += ux * speed * dt;
    this.pos.z += uz * speed * dt;
    this.world.resolveCollision(this.pos, 0.45, this.pos.y, 1.9);
    // did we actually move? if not, we're stuck
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    if (moved < speed * dt * 0.35) {
      this.stickT += dt;
      if (this.stickT > 0.35 && this.sideT <= 0) {
        this.sideT = 0.45;
        this.sideSign = Math.random() < 0.5 ? 1 : -1;
        this.stickT = 0;
      }
    } else {
      this.stickT = Math.max(0, this.stickT - dt * 2);
    }
    this.moving = speed;
    // open doors in the way
    for (const door of this.world.doors) {
      if (this.world.doorClosed(door)) {
        const dd = dist2(this.pos.x, this.pos.z, door.center.x, door.center.z);
        if (dd < 1.3 && Math.abs(this.pos.y - door.y) < 1.5) {
          this.world.setDoor(door, true);
        }
      }
    }
  }

  // returns true when path finished; false while walking
  followPath(dt, speed) {
    if (this.pathI >= this.path.length || !this.path.length) {
      this.moving = 0;
      return true;
    }
    const n = this.path[this.pathI];
    const d = dist2(this.pos.x, this.pos.z, n.x, n.z);
    if (d < 0.55) {
      this.pathI++;
      if (this.pathI >= this.path.length) {
        this.moving = 0;
        return true;
      }
      return false;
    }
    this.steerTo(n.x, n.z, dt, speed);
    return false;
  }

  animate(dt) {
    const j = this.j;
    if (!j) return;
    const mv = this.moving || 0;
    const chase = this.state === STATE.CHASE;
    this.animT += dt * (2 + mv * 1.9);
    const t = this.animT;
    const stride = Math.min(1.4, mv / 3);
    const swL = Math.sin(t * 3);
    const swR = Math.sin(t * 3 + Math.PI);
    const ease = (target, cur, k = 10) => cur + (target - cur) * Math.min(1, dt * k);

    // ---- legs: hip swing + knee flexion ----
    if (stride < 0.05) {
      // idle weight shift
      j.legL.hip.rotation.x = ease(Math.sin(t * 0.8) * 0.03, j.legL.hip.rotation.x);
      j.legR.hip.rotation.x = ease(-Math.sin(t * 0.8) * 0.03, j.legR.hip.rotation.x);
      j.legL.knee.rotation.x = ease(0.04, j.legL.knee.rotation.x);
      j.legR.knee.rotation.x = ease(0.04, j.legR.knee.rotation.x);
    } else {
      j.legL.hip.rotation.x = ease(-swL * 0.6 * stride, j.legL.hip.rotation.x);
      j.legR.hip.rotation.x = ease(-swR * 0.6 * stride, j.legR.hip.rotation.x);
      // knees bend while the leg swings forward
      j.legL.knee.rotation.x = ease((swL > 0 ? swL : 0) * 0.85 * stride + 0.04, j.legL.knee.rotation.x);
      j.legR.knee.rotation.x = ease((swR > 0 ? swR : 0) * 0.85 * stride + 0.04, j.legR.knee.rotation.x);
    }

    // ---- arms ----
    if (chase) {
      // reaching grab pose, pumping with the gait
      const pump = Math.sin(t * 6) * 0.12;
      j.armL.shoulder.rotation.x = ease(-1.35 + pump, j.armL.shoulder.rotation.x);
      j.armR.shoulder.rotation.x = ease(-1.35 - pump, j.armR.shoulder.rotation.x);
      j.armL.elbow.rotation.x = ease(-0.25, j.armL.elbow.rotation.x);
      j.armR.elbow.rotation.x = ease(-0.25, j.armR.elbow.rotation.x);
    } else {
      // counter-swinging arms; relaxed hang when idle
      const breathe = Math.sin(t * 0.9) * 0.04;
      j.armL.shoulder.rotation.x = ease(-swR * 0.45 * stride - breathe, j.armL.shoulder.rotation.x);
      j.armR.shoulder.rotation.x = ease(-swL * 0.45 * stride + breathe, j.armR.shoulder.rotation.x);
      j.armL.elbow.rotation.x = ease(-0.15 - 0.2 * stride, j.armL.elbow.rotation.x);
      j.armR.elbow.rotation.x = ease(-0.15 - 0.2 * stride, j.armR.elbow.rotation.x);
    }

    // ---- body: bob, lean, breathing ----
    j.root.position.y = 1.04 + Math.abs(Math.sin(t * 3)) * 0.045 * stride;
    j.torso.rotation.x = ease(chase ? 0.2 : 0.03 + Math.sin(t * 1.1) * 0.02, j.torso.rotation.x);
    j.torso.rotation.z = Math.sin(t * 3) * 0.04 * stride;

    // ---- head ----
    if (!chase) {
      j.neck.rotation.y = Math.sin(t * 0.7) * 0.35;
      j.neck.rotation.x = ease(0.02, j.neck.rotation.x);
    } else {
      j.neck.rotation.y = ease(0, j.neck.rotation.y, 6);
      j.neck.rotation.x = ease(-0.12, j.neck.rotation.x);
    }
    this.moving = 0;
  }

  // for HUD
  alertLevel(player) {
    if (this.state === STATE.CHASE) return 'chase';
    if (this.state === STATE.INVESTIGATE || this.aware > 0.25) return 'suspect';
    return '';
  }

  queueTraps(ids) {
    this.trapQueue.push(...ids);
  }
}
