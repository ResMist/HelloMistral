# HelloMistral 🔦

A 3D stealth-horror game about breaking into your neighbor's house and reaching his
basement — while an **AI that learns from your behavior** hunts you down.

An original fan-made tribute to the "sneak into the neighbor's house" genre, built from
scratch with **Three.js**. Every model is procedural geometry (boxes, cylinders, spheres) —
no textures, no external assets, no content from any commercial game.

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
| Ctrl / C | Crouch — slow and **quiet** |
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

## License

MIT — see [LICENSE](LICENSE).
