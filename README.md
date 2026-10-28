# HelloMistral 🔦

## The current game: `index.html`

`index.html` is the whole game in one file — no build step, no dependencies, no network.
Open it directly in a browser and press **PLAY** (or **PCG PLAY** with a seed for a
procedurally generated estate).

It renders the same world two ways and you can switch any time with **V** or the
**VIEW** button on the menu:

* **2D** — the original top-down view (the default).
* **3D** — a WebGL third-person view of the very same map: extruded walls, floors and
  furniture, humanoid figures, vision cones, item art, and the X-ray overlays drawn in
  perspective.

Both views read the same game state, so the neighbour's AI, belief map, pathfinding,
PCG generator, inventory, traps, cameras and neural net behave identically in either one.
There is no server component and nothing is saved between sessions.

The rest of this README describes an **earlier, separate Three.js prototype** in `src/`
that is no longer used by `index.html` (kept for history only).

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

The repo ships a **headless smoke test** that stubs the DOM and Three.js,
boots the whole game and plays through the core loop — walking, opening
doors, the doorbell lure, both stair flights, crouching, lockpicking the
study, the chase (including the music switch), getting caught and retrying:

```bash
node test/smoke.js
```

No dependencies, Node 18+. It exits non-zero if any of the 25 checks fail —
run it after any change to the game code.

## License

MIT — see [LICENSE](LICENSE).
