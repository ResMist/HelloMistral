# Legacy 3D build (v1.3, archived)

This folder preserves the previous **Three.js 3D** version of HelloMistral. The
current game is the single-file 2D build in the repository root.

The archived build is unchanged from v1.3 and still works. It uses ES modules and
an import map, so it must be served over HTTP rather than opened from `file://`.

```bash
# from the repository root
python3 -m http.server 8000
# open http://localhost:8000/legacy-3d/
```

Controls: WASD + mouse, Shift sprint, C crouch, E interact/hold, LMB throw,
Q drop, M mute, F flashlight, Esc pause.

Its headless suite still passes:

```bash
node legacy-3d/test/smoke.js
# SMOKE OK — 25/25 checks passed
```

The 3D build's goal was the red, blue and green keys plus the basement door;
the 2D game uses a lockpick, red key, blue key and vault. Both share the same
persistent-learning premise, but the 2D AI is the newer implementation.
