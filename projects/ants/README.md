# Ant Colony

*Pheromone-based ant-colony simulator with queens, puddles, predators, and 9 scenarios.*

![screenshot](screenshot.png)

Hundreds of ants forage food, lay pheromone trails, defend nests, fight rival colonies, and occasionally drown in puddles. Ants use a spatial hash for neighbour queries and a Float32Array pheromone grid for trail following. Trails wear down with use and form natural "highways" between heavily-used paths.

**Features:** Queens with health — kill a queen and her colony collapses; colony splitting (a founding queen leaves the nest when food is plentiful); rain that creates puddle clusters, washes pheromones, drowns ants caught in deep water, and sends splash ripples; beetle tanks that march toward nests; spiders that ambush stragglers; 9 scenarios (Battle / Siege / Gauntlet / Royale / Nocturnal / Regicide / Invasion / Monsoon / default); three food types; ambient sound; day/night cycle; touch-friendly.

**Visuals:** a naturalistic-macro rendering layer over the simulation — baked procedural soil (value-noise grain, dry/damp patches, pebbles, leaf litter); ants drawn from a baked rotated sprite atlas (24 angles × 2 walk-frames, supersampled — three body segments, six legs with a tripod gait, antennae, soldier mandibles, queen crown, a carried-food pellet); food rendered as little leaves, seeds, and berries instead of blobs; pheromone trails that read as packed-earth paths by day and glow **bioluminescent** at night. A day/night lighting pass adds dappled warm sun and a vignette in daylight, then darkens the earth at night so the trails, nests, and fireflies glow. Holds ~60fps at 150+ ants by baking sprites and terrain once. The simulation is untouched — this is purely how it's drawn.

**Run:**
```bash
python3 server.py   # localhost:8119
```
