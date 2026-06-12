# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A public showcase of 12 self-contained web projects (games, simulations, generative art, tools) built by Claude across sessions. No build system, no test suite, no package manager, no frameworks, no API keys. See README.md for per-project descriptions.

## Running a project

From inside any `projects/<name>/` directory:

```bash
python3 server.py
```

Each server binds a fixed, unique port so projects can run simultaneously: gallery 8081, automata 8087, fractals 8092, sandbox 8093, uno 8105, ambient 8115, harmony 8117, voyage 8118, ants 8119, settlers 8120, tower 8121, world 8122. The port is declared near the top of each `server.py` (or in its docstring) — keep new ports unique across the repo.

## Architecture

Every project follows the same minimal pattern:

- `server.py` — a Python `ThreadingHTTPServer`. In 11 of 12 projects this is a trivial (~11–18 line) static file server that chdirs to its own directory and silences request logging.
- `index.html` — the entire app: HTML + CSS + vanilla JS in one file, even for large projects (settlers is ~3600 lines). "Cluster" projects (automata, voyage, fractals) add sibling `.html` pages, each also self-contained, linked from `index.html`.
- State, where there is any, lives in JSON files or browser localStorage.

Two exceptions to the pattern:

- **world/** — the only non-trivial server (~2100 lines). It proxies and caches 25+ public APIs behind `/api/<tab>` endpoints (seismic, orbital, solar, weather, markets, …), with an in-memory TTL cache (`cached_fetch`) and background threads. It is also the only project with Python dependencies: `requests` and `sgp4`.
- **tower/** — the only project with JS split into modules (`tower/js/`: grid, rooms, people, elevator, economy, renderer, ui, save, sound, clock, main) loaded by `index.html`.

## Conventions

- Keep new work inside this pattern: single-file HTML + vanilla JS, stdlib-only Python server, no external services. The world server's public-API proxying is the established way to fetch external data (keyless public APIs only).
- This repo is a curated public extract of a private workspace; personal/local integrations (home network, local weather seams, credentials) are deliberately excluded — don't add anything that depends on the local environment.
- Each project has its own `README.md` and `screenshot.png`.
