# HelloMistral 2D 🔦

A single-file browser stealth game about breaking into your neighbour's house and
stealing the secret in his vault — while an adaptive AI patrols, listens, searches
a belief map, and remembers how you play.

Everything lives in **[`index.html`](index.html)**: no build step, no dependencies,
no external assets.

![Gameplay](docs/gameplay.png)

*Sneaking through the living room while he cooks dinner in the kitchen.*

Open it directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## How to play

| Input | Action |
| --- | --- |
| **WASD** | Move |
| **Shift** | Sprint — fast but very loud |
| **C** | Crouch — slow, quiet, harder to see |
| **E** | Pick up / press. **Hold E** to search containers, pick locks, or disarm traps |
| **Click / F** | Throw the held object (tomatoes are grown in the garden) |
| **Q** | Drop the held object |
| **1–4** | Select inventory slot |
| **Mouse wheel** | Zoom |
| **H** | Show his belief map |
| **P** | Show his current path |
| **Esc** | Pause |

**Objective:** steal the SECRET from the vault.

1. Find the **lockpick** in the shed (west yard).
2. Find the **red key** in the kitchen fridge.
3. Find the **blue key** in the study desk — the study door needs the lockpick.
4. Unlock the basement door in the workshop with the red + blue keys and take the SECRET.

The front door and every window are viable routes. Breaking a window is loud but
works; boarded windows are not. `MAKE HIM FORGET EVERYTHING` on the title screen
wipes his persistent memory.

## What changed in this revision

### The old build did not run

The pasted HTML contained literal line breaks inside JavaScript string literals
(in the catch screen and the HUD), so the whole script failed to parse. Those are
fixed, along with several runtime bugs:

- **The chase crash.** The cut-off branch read `P.vel`, which does not exist, and
  threw `TypeError: Cannot read properties of undefined` as soon as the neighbour
  had line of sight from more than six tiles away. It now uses the player's real
  `vx/vy`. Throw leading also uses the player's velocity instead of the neighbour's.
- **The window trap.** `inner()` fell back to the window tile itself when no
  adjacent `'.'` floor existed (the TV blocks one side, the yard is `','`, not `'.'`).
  The neighbour therefore walked *into* the window cell, repaired or boarded it,
  and sealed himself inside a now-solid tile. He could never move again.
- **Retry soft-lock.** A catch reset the key flags but left every container marked
  looted, so the keys were gone forever. Retry now resets containers, tomato
  plants, loose items, doors, projectiles and the SECRET while keeping his learned
  fortifications.
- **A thrown object could be picked out of the air**, could hit him through a
  wall, and made him investigate his own throw. A full inventory also still
  consumed a tomato. All fixed.

### The window fix is layered

Fixing `inner()` alone would be fragile, so there are now four separate guards:

1. **Safe inspection spots.** Window work is done from an adjacent, standable
   cell on the neighbour's side of the window — never from the window tile.
2. **Eviction before sealing.** If the player or neighbour is standing in the
   target tile when it is boarded/repaired/locked, they are pushed to the nearest
   safe cell first. If that is impossible, the seal is cancelled.
3. **Un-stick safety net.** Every quarter second the game checks whether either
   character is inside a solid tile and relocates them if so.
4. **Watchdogs.** `follow()` detects no-progress, side-steps, and re-paths, and
   abandons a step after five failed jinks; every `go` step also has a 25-second
   limit. A single unreachable target can no longer freeze the whole AI.

### A smarter neighbour

- **63 new routines** — 156 tasks across 30 stations, from `defrost_freezer` to
  `build_birdhouse`, `oil_gate`, `stamp_invoices` and `scrub_ring`.
- **Persistent heat map.** He records where he sees you on a 4×4-cell grid. Chores
  whose stations are in your favourite areas get chosen more often, patrols drift
  there, and his sight range is slightly better in places he associates with you.
- **Time memory.** He records the hour you are active and sees and hears further
  at that hour on later attempts.
- **Objective guard.** When he finds a looted fridge, desk or toolbox, he raises
  his suspicion and starts guarding the next objective. With both keys stolen, or
  two containers found empty, he camps the basement door.
- **Interception instead of pure pursuit.** When he still sees you but cannot walk
  straight at you, he routes toward a predicted point on your path to your likely
  objective (shed → kitchen → study → vault) rather than to where you are now.
- **Smarter searching.** Losing you seeds a belief map from your last position,
  velocity *and* your predicted goal. He clears the most likely spots, sweeps rooms
  from multiple points, checks the wardrobe/bed/bath hiding places, avoids
  re-searching places he just cleared, and gives up after ~30 seconds.
- **Noise discipline.** Repeated footsteps near the same point update his current
  target instead of resetting his script every 0.36 s. Glass sends him to the window,
  door noise sends him to check and close the door, and thrown objects train a
  persistent decoy memory: after enough throws in one area, he goes looking where
  the object came from.
- **Better logistics.** He repairs the *nearest* broken window, places traps on a
  safe tile even if the planned tile was boarded, reacts to camera and trap alarms,
  and plans fortifications across attempts. Disarming a trap also removes it from
  his long-term memory, so it does not quietly return after a reload.

Press **H** while playing to see the game the way he does — the belief map he has
built of where you probably are, and the route he is taking to check it:

![The neighbour's belief map and path](docs/vision.png)

*Red = where he thinks you are. Blue line = his current path. The `?` is his
alertness. This is a real frame, not concept art.*

He still sleeps, bathes, cooks, does chores, gets bored, and can be distracted —
the routine is what makes the hunt feel human.

## Tests

```bash
node test/game2d.js
```

77 headless checks, including a full playthrough driven only by simulated key
presses — shed → kitchen → study → basement → vault — which proves the level is
physically completable, not just logically. The suite boots `index.html` in a
stubbed DOM/canvas and covers: task data, map reachability, rendering/HUD, all 10
windows (repair + board), eviction and un-sticking, the old chase crash, throws
and in-flight items, looting, catching, retry, winning, memory persistence and
wiping, objective discovery/guarding, search, noise dedupe, door checks, decoys,
trap placement/disarming, five minutes of routine play and three randomized fuzz
runs.

The previous 3D Three.js build is preserved in [`legacy-3d/`](legacy-3d/) with
its own 25-check suite (`node legacy-3d/test/smoke.js`).

## Repository layout

```
index.html            the entire 2D game + AI
docs/                 screenshots used by this README
test/game2d.js        77-check headless regression suite
test/harness.js       dependency-free DOM/canvas stub + seeded RNG
legacy-3d/            archived v1.3 Three.js build
README.md             this file
LICENSE               MIT
```

## Design notes

- **World:** a 56×40 tile house and yard. Walls, furniture, doors, windows and
  yard props are data (`G`, `FU`, `RMC`, `ST`).
- **Navigation:** 8-direction A* with octile heuristic, no corner cutting,
  clearance and trap costs, plus line-of-sight string pulling. Broken windows are
  passable but expensive.
- **AI:** perception (sight cone, peripheral vision, occlusion, hearing through
  walls) → alertness → routine / investigate / chase / search. A utility planner
  chooses between chores, patrols, guards, investigations and fortifications.
- **Memory:** `localStorage` under `hm2d.v1`; all new fields are normalized on load
  so old saves keep working.
- **No dependencies, no build, no assets.** Audio isn't included in the 2D build.

A fan-made stealth-game homage built from scratch. Not affiliated with, endorsed
by, or using assets from any commercial game.

## License

MIT — see [LICENSE](LICENSE).
