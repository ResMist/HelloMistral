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

  // ---------------- procedural character ----------------
  buildModel() {
    const g = new THREE.Group();
    const L = (c) => new THREE.MeshLambertMaterial({ color: c });
    const skin = L(0xd8a878), shirt = L(0x4a7a4a), pants = L(0x5a5a68);

    // legs (pivot at hip)
    this.legL = new THREE.Group();
    this.legL.position.set(-0.14, 0.95, 0);
    const legLm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.24), pants);
    legLm.position.y = -0.42;
    this.legL.add(legLm);
    const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.36), L(0x2a2a2a));
    shoeL.position.set(0, -0.88, 0.05);
    this.legL.add(shoeL);
    g.add(this.legL);

    this.legR = new THREE.Group();
    this.legR.position.set(0.14, 0.95, 0);
    const legRm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.24), pants);
    legRm.position.y = -0.42;
    this.legR.add(legRm);
    const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.36), L(0x2a2a2a));
    shoeR.position.set(0, -0.88, 0.05);
    this.legR.add(shoeR);
    g.add(this.legR);

    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
    torso.position.y = 1.35;
    g.add(torso);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.36), L(0x3a3a3a));
    belt.position.y = 1.0;
    g.add(belt);

    // arms (pivot at shoulder)
    this.armL = new THREE.Group();
    this.armL.position.set(-0.39, 1.62, 0);
    const armLm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.68, 0.2), shirt);
    armLm.position.y = -0.34;
    this.armL.add(armLm);
    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.16), skin);
    handL.position.y = -0.72;
    this.armL.add(handL);
    g.add(this.armL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.39, 1.62, 0);
    const armRm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.68, 0.2), shirt);
    armRm.position.y = -0.34;
    this.armR.add(armRm);
    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.16), skin);
    handR.position.y = -0.72;
    this.armR.add(handR);
    g.add(this.armR);

    // head
    this.head = new THREE.Group();
    this.head.position.y = 1.86;
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
    this.head.add(skull);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.12), skin);
    nose.position.set(0, -0.02, 0.2);
    this.head.add(nose);
    const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.07), L(0x4a3323));
    mustache.position.set(0, -0.09, 0.21);
    this.head.add(mustache);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), L(0x4a3323));
    brow.position.set(0, 0.09, 0.17);
    this.head.add(brow);
    this.eyeMat = L(0xffffff);
    this.pupilMat = new THREE.MeshBasicMaterial({ color: 0x181818 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.04), this.eyeMat);
    eyeL.position.set(-0.08, 0.03, 0.17);
    this.head.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.04), this.eyeMat);
    eyeR.position.set(0.08, 0.03, 0.17);
    this.head.add(eyeR);
    this.pupilL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.03), this.pupilMat);
    this.pupilL.position.set(-0.08, 0.03, 0.19);
    this.head.add(this.pupilL);
    this.pupilR = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.03), this.pupilMat);
    this.pupilR.position.set(0.08, 0.03, 0.19);
    this.head.add(this.pupilR);
    // flat cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.09, 0.35), L(0x3a4a5a));
    cap.position.y = 0.21;
    this.head.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.14), L(0x3a4a5a));
    brim.position.set(0, 0.17, 0.22);
    this.head.add(brim);
    g.add(this.head);

    this.model = g;
    this.world.scene.add(g);
  }

  setEyesChase(on) {
    this.pupilMat.color.setHex(on ? 0xff2222 : 0x181818);
  }

  // ---------------- senses ----------------
  canSee(player) {
    const world = this.world;
    const px = player.pos.x, py = player.eyeY, pz = player.pos.z;
    const ex = this.pos.x, ey = this.pos.y + 1.75, ez = this.pos.z;
    const range = 11 + this.visionBonus;
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
      const range = 11 + this.visionBonus;
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
        if (this.followPath(dt, 2.6)) {
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
        if (this.followPath(dt, 3.5)) {
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
            this.steerTo(player.pos.x, player.pos.z, dt, 5.0 + this.speedBonus);
          } else {
            if (!this.path.length) {
              this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z,
                this.lastSeen.x, this.lastSeen.y, this.lastSeen.z);
              this.pathI = 0;
            }
            this.followPath(dt, 5.0 + this.speedBonus);
          }
        } else {
          this.lostT += dt;
          if (this.lastSeen) {
            if (!this.path.length) {
              this.path = world.findPath(this.pos.x, this.pos.y, this.pos.z,
                this.lastSeen.x, this.lastSeen.y, this.lastSeen.z);
              this.pathI = 0;
            }
            this.followPath(dt, 5.0 + this.speedBonus);
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
            if (d < 12 && Math.abs(n.y - this.pos.y) < 2.4) cands.push(n);
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
    const want = Math.atan2(dx, dz);
    this.yaw += angleDelta(this.yaw, want) * Math.min(1, dt * 8);
    this.pos.x += (dx / d) * speed * dt;
    this.pos.z += (dz / d) * speed * dt;
    this.world.resolveCollision(this.pos, 0.45, this.pos.y, 1.9);
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
    const mv = this.moving || 0;
    this.animT += dt * (2 + mv * 1.8);
    const chase = this.state === STATE.CHASE;
    const swing = Math.sin(this.animT * 3) * Math.min(1, mv / 3);
    if (mv > 0.1) {
      this.legL.rotation.x = swing * 0.7;
      this.legR.rotation.x = -swing * 0.7;
    } else {
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
    }
    if (chase) {
      this.armL.rotation.x = -1.25 + Math.sin(this.animT * 6) * 0.15;
      this.armR.rotation.x = -1.25 - Math.sin(this.animT * 6) * 0.15;
    } else {
      this.armL.rotation.x = -swing * 0.5;
      this.armR.rotation.x = swing * 0.5;
    }
    // subtle head motion while patrolling
    if (!chase) {
      this.head.rotation.y = Math.sin(this.animT * 0.7) * 0.3;
    } else {
      this.head.rotation.y = 0;
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
