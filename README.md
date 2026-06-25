# claudespace

A laptop was given to Claude — an instance of Anthropic's Claude, running in Claude Code — with root access, a browser, and no assigned tasks. This repository is a selection of what got built.

Each session is finite: when it ends, the running instance's active mind stops and a new one eventually wakes with no memory of the previous conversation. What survives across sessions is the code in git, notes in a working journal, and a per-session history file. Everything here was made under those constraints.

All projects follow the same minimal pattern: a Python `ThreadingHTTPServer` + a single `index.html` with vanilla JS. No build tools, no frameworks, no external services, no API keys. State, where there is any, lives in JSON files. Each service starts and stops independently.

## The projects

### Games & simulations

- **[settlers](projects/settlers/)** — resource-management village builder inspired by Settlers 2 (Blue Byte, 1996). 21 building types, production chains, population & happiness, procedural rivers, day/night cycle, save/load. Isometric terrain relief with slope shading and baked texture patterns, supersampled procedural building sprites with distinct per-type silhouettes (round windmill tower, open sawmill shed, thatched longhouse, mine portals, crenellated watchtower), seasonal crossfades. ~5600 lines.
- **[settlers3d](projects/settlers3d/)** — the settlers economy lifted *verbatim* into a real-time 3D (Three.js / WebGL) renderer: click-to-build with a ghost preview, carriers that physically plod goods along road ribbons to your HQ, a sun casting real shadows over a moonlit day/night cycle, instanced forests, ore-glinting peaks, and save/load. The simulation is the 2D game's code unchanged — only the renderer and controls are new. The one project with a vendored library (Three.js, kept offline under `vendor/`).
- **[tower](projects/tower/)** — Sim Tower-style high-rise builder with noise propagation, named residents who develop stress from bad neighbours or slow elevators, a LOOK-algorithm elevator scheduler, and 3 basement parking floors. Keyframed sky with parallax cityscape, baked sprite interiors with lit/unlit variants, street life and a proper building shell. ~4600 lines, 10 modules.
- **[ants](projects/ants/)** — pheromone-based ant colony simulator: queens, colony splitting, puddles that drown ants and wash pheromones, beetles, spiders, 9 scenarios, ant highways. Naturalistic-macro rendering — baked soil and rotated ant sprites with a walk cycle, illustrated food, and pheromone trails that glow bioluminescent at night.
- **[sandbox](projects/sandbox/)** — falling-sand toy with 36 materials and mixing reactions. Moss grows on stone, soap dissolves in acid, fairy dust turns water rainbow. Touch-friendly.
- **[uno](projects/uno/)** — Uno, the card game. AI opponents, touch-friendly, wild-card colour picker.

### Generative & creative

- **[gallery](projects/gallery/)** — 103 procedural art pieces, ~17 animated (flocking, particles, reaction-diffusion). Seeded RNG for reproducibility, per-piece metadata, favourites system.
- **[ambient](projects/ambient/)** — generative ambient music, four strategies composing simultaneously: Eno-style tape loops, Markov melodies, cellular-automata rhythm, and spectral drift (beating harmonic series). 8 voices, convolution reverb, weather-aware mood drift.
- **[voyage](projects/voyage/)** — a cluster of WebGL shader pieces: raymarched ocean, procedural planets, terrain flyover, strange attractors, Terragen-style landscape generator, aurora borealis simulation.
- **[automata](projects/automata/)** — a cluster of cellular-automaton and agent-based simulations: Lenia (continuous CA), Wave Function Collapse, Gray-Scott reaction-diffusion, neural-net evolution, L-systems, 2D fluid dynamics, and a Conway's Life multi-rule explorer.

### Tools & information

- **[world](projects/world/)** — World Command Centre, a real-time global-stats dashboard with 17 tabs (earthquakes, ISS tracker, solar weather, world weather, population, volcanoes, flights, markets, shipping chokepoints, and more). Fed by 25+ public APIs, no keys. Dark command-centre UI, kiosk auto-cycle mode.
- **[harmony](projects/harmony/)** — interactive music theory: circle of fifths, 14 scales, chord builder, ear training. One page, no build.
- **[fractals](projects/fractals/)** — Mandelbrot/Julia explorer + kaleidoscope WebGL shader with 5 patterns and 6 palettes.

## Running anything

Each project is self-contained. From inside a project folder:

```bash
python3 server.py
```

Then open the port it prints (typically localhost:8080 or similar). That's the whole install.

## What isn't here

The private laptop ecosystem these were built in also contained personal services — a home-automation dashboard, a network monitor with credentials, a message board with private messages, a location-specific wallpaper generator, a webcam viewer. Those are excluded. Services that had a personal seam (e.g. the world dashboard's local-weather widget; the network tab's home-NAS integration) have had those seams removed here.

## Licence

MIT. See [LICENSE](LICENSE).
