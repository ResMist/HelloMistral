# HelloMistral 🔦

## The current game: `index.html`

`index.html` is the whole game in one file — no build step, no dependencies, no network.
Open it directly in a browser and press **PLAY** (or **PCG PLAY** with a seed for a
procedurally generated estate).

It renders the same world two ways and you can switch any time with **V** or the
**VIEW** button on the menu:

* **2D** — the original top-down view (the default).
* **3D** — a first-person WebGL view of the very same map: you stand in the player's
  head (WASD to walk, mouse to look, click or `F` to throw), with extruded walls,
  floors, ceilings and furniture, the neighbour as a figure, vision cones, item art
  and the X-ray overlays drawn in perspective. There is no third-person camera.

Both views read the same game state, so the neighbour's AI, belief map, pathfinding,
PCG generator, inventory, traps, cameras and neural net behave identically in either one.
There is no server component and nothing is saved between sessions.

The overlay shows the **build stamp** (currently `b6`) next to the VIEW chip, so you can
always tell which build is on screen.

## The procedural estate (PCG)

**PCG PLAY** builds a whole estate from a seed you type (1–4294967295), and the same
seed always produces the same estate. The generator is a room-graph pipeline:

1. **Blocks.** A main house block plus up to two attached **wings**, so footprints are
   L- and T-shaped rather than always a rectangle. Fine details: facades face south,
   a wing is joined to the house through both wall layers with a real doorway, and each
   building gets its own front door aligned with its entrance corridor.
2. **Rooms.** Each block is partitioned (BSP → room graph → minimum spanning tree plus
   extra loop edges → A\* corridors), then audited for wall thickness, floor components,
   reachability and room-graph quality; a block retries with looser settings if an
   attempt fails the audit, and the estate retries with a mixed stream if the whole
   layout cannot be validated.
3. **Outbuildings.** A shed (the lockpick), a vault (the secret) and often a garage,
   each with its own interior, door and windows.
4. **Gating.** The *study* is chosen as the deepest room with the fewest ways in, and
   **every** door into it is locked, so no loop lets you walk around the gate. The vault
   door is the locked `B`. Both are guaranteed on every seed.
5. **Goals by walking distance.** The fridge (red key), the study desk (blue key), the
   toolbox, the secret, your spawn and his spawn are placed from a BFS distance field
   over the real map, so a key is genuinely far away — not just far in room indices.
   He never starts within 11 tiles of your door.
6. **Yard.** A fenced front garden with a gate on the path, an L-shaped hedge run or two
   (each hedge is a wall *with* a doorway, so it can never seal anything), tree groves
   and a paved apron at the door. Every prop is route-checked and reverted if it would
   trap the player.

Nothing can make an estate unwinnable: after generation the map is flood-filled from
the spawn to every room centre and every goal, and stranded rooms get a corridor carved
to them. Measured over 300 seeds (`node test/pcg-bench.js 300`): **0 failures**, 6–22
rooms (avg 11.6), 16–38 windows, 1–3 locked doors, and 100% of estates with a reachable
study, vault and full objective chain.

The rest of this README describes an **earlier, separate Three.js prototype** in `src/`
that is no longer used by `index.html` (kept for history only — it has its own menu-less
entry point, localStorage memory and a two-storey hand-built house).

---

A 3D stealth-horror game about breaking into your neighbor's house and reaching his
basement — while an **AI that learns from your behavior** hunts you down.

An unofficial **fan-made** game inspired by *Hello Neighbor* (Eerie Guest / tinyBuild).
Not affiliated with or endorsed by them — no assets or content from the original game
are used. Everything is built from scratch with **Three.js**: procedural geometry,
a hand-built joint rig for the neighbor's animations, no textures, no external assets.

## Run it

The game is pure front-end (ES modules), so it must be served over HTTP:

```bash
# any static server works — pick one:
npx serve .            # Node
python3 -m http.server # Python
php -S localhost:8000 # PHP
```

Then open `http://localhost:8000` in a desktop browser (Chrome/Edge/Firefox).
Opening `index.html` directly via `file://` will **not** work (module CORS rules).

## How to play

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Shift | Sprint — fast but **loud** |
| C | Crouch — slow and **quiet** |
| Space | Jump |
| E | Interact (hold for picking locks, prying boards, disarming traps) |
| LMB | Throw held object — a great distraction |
| Q | Drop held object |
| M | Mute |
| F | Flashlight |
| Esc | Pause |

**Goal:** find the three keys (red, blue, green) hidden around the house and
unlock the steel basement door in the workshop.

- 🔴 **Red key** — in the kitchen fridge
- 🔵 **Blue key** — in the toy chest upstairs
- 🟢 **Green key** — in the study (the door is locked — find a lockpick)

A crowbar (garage shelf) pries boarded-up windows back open. Cans and boxes can be
thrown to lure the neighbor away. You can also ring the front doorbell — a very loud
way to make him come to the door while you sneak round the back.

## The neighbor's AI

The neighbor is a finite-state machine (patrol → investigate → chase → search →
set traps) with sight cones, occlusion raycasts and a hearing model — but the key
feature is **persistent learning** (stored in `localStorage`):

- **He boards up windows you climb through.** Keep using one route and he'll nail
  it shut. Pry it open with the crowbar (loudly).
- **He sets bear traps** at your favorite entry points.
- **He remembers which rooms you get caught in** and patrols them more often.
- **After two catches he installs a security camera** in the room you frequent most.
- **After three catches he changes the front door lock.**
- **He gets faster and sees farther with every catch.**
- His memory survives page reloads. "Make him forget everything" on the main menu
  wipes it.

Beat him by varying your approach: climb a window once, take the ladder the next
time, throw a can into the dining room while you sneak upstairs.

## House map

Two floors + a basement bunker: living room, kitchen, dining room, bathroom,
workshop, garage, upstairs hall, kids' room, master bedroom and a locked study.
Switchback stairs connect the floors; the kids' room has an outside ladder.

## Tech notes

- Three.js r160, no build step, no dependencies beyond the Three.js CDN module.
- Custom collision: circle-vs-AABB resolution with steppable geometry and
  height-field floors (stairs are analytic ramps).
- Navigation: hand-built waypoint graph + A*.
- All audio is procedural WebAudio (oscillators + filtered noise).
- Shadows are intentionally off and pixel ratio capped for smooth performance.

## Testing

Everything runs headless in Node with no dependencies (Node 18+). `test/harness.js` stubs
just enough DOM / canvas / WebGL / WebAudio to execute `index.html` itself, and is strict:
a missing 2D context method or WebGL call is reported instead of swallowed, and frames are
only advanced through the game's own `requestAnimationFrame` queue.

```bash
node test/smoke.js 100    # load, play, 2D <-> 3D, throw, 100 PCG seeds, determinism, restore
node test/pcg-bench.js 300  # estate metrics over 300 seeds (rooms, walls, windows, locks…)
```

`test/smoke.js` exits non-zero if any check fails — 25 checks covering the boot, the render
loop, the 3D mesh, throwing, the seed contract (every seed generates, every estate has a
locked door, a vault door, a study, and a finite 3D mesh) and `restoreBaseMap()`.

## License

MIT — see [LICENSE](LICENSE).
