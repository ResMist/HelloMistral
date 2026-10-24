// memory.js — the neighbor's persistent long-term memory.
// He remembers which entry points you use, which rooms you get caught in,
// and adapts: boarding windows, placing bear traps, installing cameras,
// locking the front door, and getting faster and sharper with every catch.

const STORE_KEY = 'hellomistral.memory.v1';

export class Memory {
  constructor() {
    this.load();
  }

  blank() {
    return {
      catches: 0,
      entries: {},        // windowId -> { count, boarded }
      heat: {},           // roomId -> times seen
      plannedBoards: [],
      plannedTraps: [],
      catchesByRoom: {},
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.data = raw ? Object.assign(this.blank(), JSON.parse(raw)) : this.blank();
    } catch (e) {
      this.data = this.blank();
    }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  }

  reset() {
    this.data = this.blank();
    this.save();
  }

  // Player used an entry point (window climb / front door)
  noteEntryUse(id) {
    const e = this.data.entries[id] || (this.data.entries[id] = { count: 0, boarded: false });
    e.count++;
    if (!e.boarded && !this.data.plannedBoards.includes(id)) this.data.plannedBoards.push(id);
    if (e.count >= 2 && !this.data.plannedTraps.includes(id)) this.data.plannedTraps.push(id);
    this.save();
  }

  // Player was spotted in a room (drives patrol weighting)
  noteSighting(roomId) {
    if (!roomId) return;
    this.data.heat[roomId] = (this.data.heat[roomId] || 0) + 1;
    this.save();
  }

  noteCatch(roomId) {
    this.data.catches++;
    if (roomId) {
      this.data.heat[roomId] = (this.data.heat[roomId] || 0) + 4;
      this.data.catchesByRoom[roomId] = (this.data.catchesByRoom[roomId] || 0) + 1;
    }
    this.save();
  }

  speedBonus() { return Math.min(1.4, this.data.catches * 0.35); }
  visionBonus() { return Math.min(4, this.data.catches * 0.8); }
  get catchCount() { return this.data.catches; }

  hotRooms() {
    return Object.keys(this.data.heat)
      .sort((a, b) => this.data.heat[b] - this.data.heat[a]);
  }

  takePlannedBoards() {
    const out = this.data.plannedBoards.slice();
    this.data.plannedBoards.length = 0;
    for (const id of out) {
      if (this.data.entries[id]) this.data.entries[id].boarded = true;
    }
    this.save();
    return out;
  }

  takePlannedTraps() {
    const out = this.data.plannedTraps.slice();
    this.data.plannedTraps.length = 0;
    this.save();
    return out;
  }

  shouldBoardOnBuild(id) {
    const e = this.data.entries[id];
    return !!(e && e.boarded);
  }
}
