# Tower Sim

*Sim Tower-style high-rise builder with noise propagation and named residents.*

![screenshot](screenshot.png)

Place floors, elevators, apartments, offices, shops, hotels, and restaurants to grow a tower economy. Named residents move in, work, shop, and eat — click any of them to inspect their current destination, stress level, and happiness.

**Features:** 12 room types + 3 basement parking floors; noise system where rooms emit noise that propagates to neighbours (toggle heat map with `N`); stress system driven by noise exposure and elevator waits (stressed residents eventually leave); three elevator tiers with LOOK scheduling; day/night cycle; city skyline backdrop; weather (rain dampens noise transmission); ambient audio; touch UI; save/load.

**Rendering:** hour-keyframed sky (dawn/noon/dusk/night palettes) with an arcing sun and cratered moon, three parallax skyline layers with day/night window crossfade, baked fluffy clouds, and a world-anchored streetscape — sidewalks, lamp posts that glow after dark, street trees, passing traffic with headlights, and a soil cutaway with strata around the basements. Room interiors are baked sprites (3x supersample, lit/unlit variants per type): glass-doored marble lobby, condos with lamps and TVs, stocked shop shelves, offices with glowing monitors, candle-lit restaurants, tiered cinema seating, glass-curtain sky lobby, parking bays with cars. Building shell with concrete piers, entrance canopy, and a roofline of water tower, HVAC, and a blinking antenna beacon. Elevators have cables, lit cars, passenger silhouettes and doors.

~4600 lines across 10 JS modules. Inspired by Maxis' 1994 Sim Tower.

**Run:**
```bash
python3 server.py   # localhost:8121
```
