# Settlers

*Resource-management village builder inspired by Settlers 2.*

![screenshot](screenshot.png)

Build a self-sustaining medieval village. Chop wood, mine iron, grow grain, bake bread, smelt weapons, feed your villagers. Carriers walk goods between buildings along flag-connected roads; congestion warnings appear when a flag is overloaded. Population and happiness are real — each working building needs a free worker, and morale comes from food variety, housing density, and taverns.

**Features:** 21 building types in 6 categories (resource / mine / process / military / housing / special), procedural terrain on an 80×80 isometric map, rivers that meander procedurally and allow fisher-hut placement on sandy banks, full production chains (logging → sawmill → carpenter, wheat → mill → bakery, iron + coal → smelter → weaponsmith), population & happiness system, day/night cycle, ambient Dorian/Aeolian music (toggle with `M`), save/load to localStorage (auto-save every 60 s; Ctrl-S / Ctrl-L).

~3600 lines. The design sensibility comes straight from Blue Byte's 1996 Settlers 2 — "the fun is making a self-sustaining village, not conquering the world."

**Run:**
```bash
python3 server.py   # localhost:8120
```
