// renderer.js — Canvas renderer with pixel-art room interiors and day/night sky

import { ROOM_TYPES } from './rooms.js';
import { getHour } from './clock.js';
import { floorToIdx } from './grid.js';

export const CELL_W = 24;
export const CELL_H = 48;
export const STAIR_W = 2;

let _canvas, _ctx, _state;
let dpr = 1;
let screenW = 0, screenH = 0;

// Person sprite colour palettes (hair, shirt, pants, skin)
const PERSON_PALETTES = [
    { hair: '#3a2a1a', shirt: '#4a7abc', pants: '#2a3a5a', skin: '#e8c090' },
    { hair: '#8a5a2a', shirt: '#bc4a4a', pants: '#3a3a4a', skin: '#d4a878' },
    { hair: '#1a1a2a', shirt: '#5abc5a', pants: '#4a4a3a', skin: '#c89870' },
    { hair: '#6a4a2a', shirt: '#bcbc4a', pants: '#3a4a5a', skin: '#e0b888' },
];

// Pre-generate star positions for the sky
const STARS = [];
for (let i = 0; i < 80; i++) {
    STARS.push({
        x: Math.random(),
        y: Math.random() * 0.7,
        size: Math.random() < 0.3 ? 2 : 1,
        twinkle: Math.random() * Math.PI * 2
    });
}

// Pre-generate city skyline buildings
const CITY_BUILDINGS = [];
{
    // Seed-based random for consistency
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF; return (seed >>> 0) / 0xFFFFFFFF; };
    for (let i = 0; i < 30; i++) {
        CITY_BUILDINGS.push({
            x: rng(),
            width: 0.02 + rng() * 0.04,
            height: 0.05 + rng() * 0.2,
            windows: rng() > 0.3,
            windowRows: 2 + Math.floor(rng() * 6),
            windowCols: 1 + Math.floor(rng() * 3),
        });
    }
    CITY_BUILDINGS.sort((a, b) => b.height - a.height); // tall in back
}

// Pre-generate cloud data
const CLOUDS = [];
for (let i = 0; i < 8; i++) {
    CLOUDS.push({
        x: Math.random(),
        y: 0.05 + Math.random() * 0.25,
        width: 0.06 + Math.random() * 0.1,
        height: 0.015 + Math.random() * 0.02,
        speed: 0.002 + Math.random() * 0.003,
        opacity: 0.3 + Math.random() * 0.4,
    });
}

// Weather state
const weather = { rain: false, rainDrops: [], rainTimer: 0 };
// Randomly trigger weather changes
setInterval(() => {
    weather.rain = Math.random() < 0.15; // 15% chance of rain
    if (weather.rain && weather.rainDrops.length === 0) {
        for (let i = 0; i < 60; i++) {
            weather.rainDrops.push({ x: Math.random(), y: Math.random(), speed: 0.01 + Math.random() * 0.01 });
        }
    } else if (!weather.rain) {
        weather.rainDrops = [];
    }
}, 30000);

// ─── Colour utilities ───

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16)
    ];
}

function rgbToHex(r, g, b) {
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

export function lighten(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

export function darken(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function lerpColor(hex1, hex2, t) {
    const [r1, g1, b1] = hexToRgb(hex1);
    const [r2, g2, b2] = hexToRgb(hex2);
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

// ─── Init ───

export function initRenderer(canvas, ctx, state) {
    _canvas = canvas;
    _ctx = ctx;
    _state = state;
    dpr = window.devicePixelRatio || 1;
    handleResize();
    window.addEventListener('resize', handleResize);
}

function handleResize() {
    const rect = _canvas.getBoundingClientRect();
    screenW = rect.width;
    screenH = rect.height;
    _canvas.width = screenW * dpr;
    _canvas.height = screenH * dpr;
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ─── World coordinate helpers ───

function worldY(floor) {
    return -floor * CELL_H;
}

function worldX(cellX) {
    return cellX * CELL_W;
}

// ─── Main render ───

export function render(ctx, state) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, screenW, screenH);

    const cam = state.camera;
    const zoom = cam.zoom;
    const daylight = state.clock.daylight;

    // 1. Sky background
    drawSky(ctx, daylight, state.clock.time);

    // Set up camera transform
    ctx.save();
    ctx.translate(screenW / 2, screenH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    // Calculate visible floor range for culling
    const viewHalfH = (screenH / 2) / zoom;
    const viewHalfW = (screenW / 2) / zoom;
    const viewTop = cam.y - viewHalfH;
    const viewBottom = cam.y + viewHalfH;
    const viewLeft = cam.x - viewHalfW;
    const viewRight = cam.x + viewHalfW;

    const minFloor = Math.max(-state.grid.basementFloors, Math.floor((-viewBottom) / CELL_H) - 1);
    const maxFloor = Math.min(state.grid.builtFloors, Math.ceil((-viewTop) / CELL_H) + 1);

    // 2. Building exterior frame
    drawBuildingFrame(ctx, state, daylight);

    // 3. Floor backgrounds and room interiors
    for (let f = minFloor; f < maxFloor; f++) {
        drawFloor(ctx, state, f, daylight);
    }

    // 4. Stairs
    for (let f = minFloor; f < maxFloor; f++) {
        if (f < state.grid.builtFloors) {
            drawStairs(ctx, state, f, daylight);
        }
    }

    // 5. Elevator shafts and cars
    drawElevators(ctx, state, minFloor, maxFloor, daylight);

    // 6. People sprites
    drawPeople(ctx, state, minFloor, maxFloor);

    // 7. Noise overlay (optional)
    if (state.ui.showNoiseOverlay) {
        drawNoiseOverlay(ctx, state, minFloor, maxFloor);
    }

    // 8. Ghost preview
    if (state.ui.buildMode && state.ui.ghostPreview) {
        drawGhostPreview(ctx, state);
    }

    ctx.restore();
    ctx.restore();
}

// ─── Sky ───

function drawSky(ctx, daylight, time) {
    // daylight already varies 0 (midnight) to 1 (noon) sinusoidally from clock
    const t = daylight;

    const nightTop = '#0a0a1e';
    const nightBot = '#1a1a3e';
    const dayTop = '#4a8ecf';
    const dayBot = '#87ceeb';

    // Dawn/dusk tint
    const hour = time * 24;
    let dawnDusk = 0;
    if (hour > 5 && hour < 8) dawnDusk = 1 - Math.abs(hour - 6.5) / 1.5;
    if (hour > 17 && hour < 20) dawnDusk = 1 - Math.abs(hour - 18.5) / 1.5;
    dawnDusk = Math.max(0, dawnDusk);

    let topColor = lerpColor(nightTop, dayTop, t);
    let botColor = lerpColor(nightBot, dayBot, t);

    // Blend in dawn/dusk warm tones
    if (dawnDusk > 0) {
        topColor = lerpColor(topColor, '#cf6a4a', dawnDusk * 0.4);
        botColor = lerpColor(botColor, '#e8a050', dawnDusk * 0.3);
    }

    const grad = ctx.createLinearGradient(0, 0, 0, screenH);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, botColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, screenW, screenH);

    // Stars (only visible at night)
    const starAlpha = Math.max(0, 1 - t * 2.5);
    if (starAlpha > 0) {
        const now = performance.now() * 0.001;
        for (const star of STARS) {
            const twinkle = (Math.sin(now * 1.5 + star.twinkle) + 1) / 2;
            const alpha = starAlpha * (0.4 + 0.6 * twinkle);
            ctx.fillStyle = `rgba(255, 255, 240, ${alpha})`;
            ctx.fillRect(
                star.x * screenW,
                star.y * screenH,
                star.size,
                star.size
            );
        }
    }

    // Clouds
    const now = performance.now() * 0.001;
    for (const cloud of CLOUDS) {
        const cx = ((cloud.x + now * cloud.speed * 0.01) % 1.3) - 0.15;
        const cy = cloud.y;
        const cw = cloud.width * screenW;
        const ch = cloud.height * screenH;
        const cloudAlpha = cloud.opacity * (0.3 + t * 0.7);
        if (weather.rain) {
            // Darker clouds during rain
            ctx.fillStyle = `rgba(120, 120, 140, ${cloudAlpha * 0.8})`;
        } else {
            ctx.fillStyle = `rgba(255, 255, 255, ${cloudAlpha * 0.4})`;
        }
        // Cloud as overlapping ellipses
        ctx.beginPath();
        ctx.ellipse(cx * screenW, cy * screenH, cw * 0.5, ch, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx * screenW - cw * 0.25, cy * screenH + ch * 0.3, cw * 0.35, ch * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx * screenW + cw * 0.3, cy * screenH + ch * 0.2, cw * 0.4, ch * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // City skyline (parallax — behind everything)
    const skylineBase = screenH * 0.82;
    for (const bldg of CITY_BUILDINGS) {
        const bx = bldg.x * screenW;
        const bw = bldg.width * screenW;
        const bh = bldg.height * screenH * 0.5;
        const by = skylineBase - bh;

        // Building silhouette
        const buildingDay = lerpColor('#2a2a3a', '#7a8090', t);
        const buildingNight = lerpColor('#0a0a1a', '#3a3a4a', t);
        ctx.fillStyle = lerpColor(buildingNight, buildingDay, t);
        ctx.fillRect(bx, by, bw, bh);

        // Windows (lit at night, mostly dark during day)
        if (bldg.windows) {
            const winW = Math.max(1, bw / (bldg.windowCols * 2 + 1));
            const winH = Math.max(1, 2);
            const winSpacingY = bh / (bldg.windowRows + 1);
            for (let wy = 0; wy < bldg.windowRows; wy++) {
                for (let wx = 0; wx < bldg.windowCols; wx++) {
                    const winX = bx + (wx + 0.5) * (bw / bldg.windowCols);
                    const winY = by + (wy + 1) * winSpacingY;
                    // Some windows lit at night, some during day
                    const litAtNight = ((bldg.x * 100 + wy * 7 + wx * 13) | 0) % 3 < 2;
                    const litDuringDay = ((bldg.x * 100 + wy * 7 + wx * 13) | 0) % 4 < 1;
                    const lit = t < 0.3 ? litAtNight : litDuringDay;
                    if (lit) {
                        ctx.fillStyle = t < 0.3
                            ? `rgba(255, 220, 120, ${0.6 + Math.sin(now + wy + wx) * 0.1})`
                            : `rgba(180, 200, 220, 0.3)`;
                        ctx.fillRect(winX, winY, winW, winH);
                    }
                }
            }
        }
    }

    // Rain
    if (weather.rain && weather.rainDrops.length > 0) {
        ctx.strokeStyle = 'rgba(180, 200, 220, 0.3)';
        ctx.lineWidth = 1;
        for (const drop of weather.rainDrops) {
            drop.y += drop.speed;
            drop.x += drop.speed * 0.1; // slight wind
            if (drop.y > 1) {
                drop.y = -0.02;
                drop.x = Math.random();
            }
            const dx = drop.x * screenW;
            const dy = drop.y * screenH;
            ctx.beginPath();
            ctx.moveTo(dx, dy);
            ctx.lineTo(dx + 2, dy + 8);
            ctx.stroke();
        }
        // Rain darkening overlay
        ctx.fillStyle = 'rgba(0, 0, 20, 0.1)';
        ctx.fillRect(0, 0, screenW, screenH);
    }

    // Ground plane
    const groundGrad = ctx.createLinearGradient(0, screenH * 0.85, 0, screenH);
    groundGrad.addColorStop(0, 'transparent');
    groundGrad.addColorStop(1, lerpColor('#1a2a1a', '#3a5a3a', t));
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, screenH * 0.85, screenW, screenH * 0.15);
}

// ─── Building frame ───

function drawBuildingFrame(ctx, state, daylight) {
    const grid = state.grid;
    if (grid.builtFloors <= 0) return;

    const left = 0;
    const right = grid.width * CELL_W;
    const bottom = worldY(0) + CELL_H; // bottom of floor 0
    const top = worldY(grid.builtFloors); // top of highest floor

    const t = daylight;
    const frameColor = lerpColor('#3a3a4a', '#6a6a7a', t);

    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(left - 2, top, right - left + 4, bottom - top);

    // Roof line (slightly thicker)
    ctx.strokeStyle = lerpColor('#4a4a5a', '#8a8a9a', t);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left - 4, top);
    ctx.lineTo(right + 4, top);
    ctx.stroke();
}

// ─── Floor rendering ───

function drawFloor(ctx, state, floor, daylight) {
    const grid = state.grid;
    const fy = worldY(floor);
    const floorLeft = 0;
    const floorRight = grid.width * CELL_W;
    const t = daylight;

    // Dark floor background
    const bgColor = lerpColor('#1a1a22', '#2a2a32', t);
    ctx.fillStyle = bgColor;
    ctx.fillRect(floorLeft, fy, floorRight, CELL_H);

    // Draw rooms on this floor
    const seen = new Set();
    for (let x = 0; x < grid.width; x++) {
        const roomId = grid.cells[floorToIdx(grid, floor)][x];
        if (roomId === null || seen.has(roomId)) continue;
        seen.add(roomId);
        const room = state.roomsById.get(roomId);
        if (!room) continue;
        drawRoom(ctx, room, daylight, state);
    }

    // Floor divider line at bottom
    ctx.strokeStyle = lerpColor('#2a2a3a', '#5a5a6a', t);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(floorLeft, fy + CELL_H);
    ctx.lineTo(floorRight, fy + CELL_H);
    ctx.stroke();
}

// ─── Room rendering ───

function drawRoom(ctx, room, daylight, state) {
    const def = ROOM_TYPES[room.type];
    if (!def) return;
    if (room.type === 'elevator') return; // handled separately

    const rx = room.x * CELL_W;
    const ry = worldY(room.floor);
    const rw = room.width * CELL_W;
    const rh = CELL_H;
    const pad = 2;
    const t = daylight;
    const hour = getHour(state.clock);

    // Room background with padding
    const baseColor = def.color;
    const bgColor = lerpColor(darken(baseColor, 0.3), baseColor, t * 0.5 + 0.5);
    ctx.fillStyle = bgColor;
    ctx.fillRect(rx + pad, ry + pad, rw - pad * 2, rh - pad * 2);

    // Room border (lighter shade)
    ctx.strokeStyle = lighten(baseColor, 0.2);
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + pad, ry + pad, rw - pad * 2, rh - pad * 2);

    // Draw room-specific pixel art interiors
    const ix = rx + pad + 2; // interior x
    const iy = ry + pad + 2; // interior y
    const iw = rw - pad * 2 - 4; // interior width
    const ih = rh - pad * 2 - 4; // interior height

    switch (room.type) {
        case 'lobby': drawLobbyInterior(ctx, ix, iy, iw, ih, t, room); break;
        case 'condo': drawCondoInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'shop': drawShopInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'office': drawOfficeInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'restaurant': drawRestaurantInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'hotel': drawHotelInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'sky_lobby': drawSkyLobbyInterior(ctx, ix, iy, iw, ih, t, room); break;
        case 'gym': drawGymInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'cinema': drawCinemaInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'medical': drawMedicalInterior(ctx, ix, iy, iw, ih, t, hour, room); break;
        case 'parking': drawParkingInterior(ctx, ix, iy, iw, ih, t, room); break;
    }
}

// ─── Pixel art helpers ───

// Draw a 2x2 pixel block (the base "pixel" for our chunky look)
function px(ctx, x, y, color, size = 2) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
}

// Draw a 4x4 block
function px4(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), 4, 4);
}

// Draw a filled rect at pixel scale
function pxRect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// ─── Room interiors ───

function drawLobbyInterior(ctx, x, y, w, h, t, room) {
    // Floor tile (lighter)
    pxRect(ctx, x, y + h - 4, w, 4, lerpColor('#6a5a4a', '#9a8a7a', t));

    // Entrance door indicators (at center)
    const cx = x + w / 2;
    // Double doors
    pxRect(ctx, cx - 8, y + 4, 6, h - 8, lerpColor('#4a3a2a', '#7a6a5a', t));
    pxRect(ctx, cx + 2, y + 4, 6, h - 8, lerpColor('#4a3a2a', '#7a6a5a', t));
    // Door glass
    pxRect(ctx, cx - 6, y + 8, 2, h - 16, lerpColor('#5a7a9a', '#8ab0d0', t));
    pxRect(ctx, cx + 4, y + 8, 2, h - 16, lerpColor('#5a7a9a', '#8ab0d0', t));

    // Reception desk (left side)
    pxRect(ctx, x + 6, y + h - 16, 20, 12, '#6a4a2a');
    pxRect(ctx, x + 6, y + h - 18, 20, 4, '#8a6a4a');
    // Bell on desk
    px(ctx, x + 14, y + h - 20, '#d4b040');

    // Potted plants
    drawPlant(ctx, x + 34, y + h - 20, t);
    if (w > 100) {
        drawPlant(ctx, x + w - 20, y + h - 20, t);
    }

    // Welcome mat
    pxRect(ctx, cx - 10, y + h - 6, 20, 2, '#8a3a3a');
}

function drawPlant(ctx, x, y, t) {
    // Pot
    pxRect(ctx, x, y + 8, 8, 10, '#8a5a3a');
    pxRect(ctx, x - 2, y + 6, 12, 4, '#9a6a4a');
    // Leaves
    const green = lerpColor('#2a5a2a', '#4a8a4a', t);
    px4(ctx, x - 2, y - 2, green);
    px4(ctx, x + 4, y - 4, green);
    px(ctx, x, y - 6, lighten(green, 0.2));
    px(ctx, x + 6, y - 6, lighten(green, 0.2));
    px4(ctx, x, y + 2, green);
}

function drawCondoInterior(ctx, x, y, w, h, t, hour, room) {
    const isNight = hour < 7 || hour > 21;
    const lampOn = isNight && room.occupancy > 0;

    // Floor
    pxRect(ctx, x, y + h - 4, w, 4, '#4a3a5a');

    // Bed (left side)
    pxRect(ctx, x + 4, y + h - 18, 18, 14, '#e8e0d8'); // mattress
    pxRect(ctx, x + 4, y + h - 20, 18, 4, '#c8b8a8'); // pillow area
    pxRect(ctx, x + 4, y + h - 22, 4, 4, '#f0e8e0'); // pillow
    pxRect(ctx, x + 14, y + h - 22, 4, 4, '#f0e8e0'); // pillow 2
    // Blanket
    pxRect(ctx, x + 4, y + h - 14, 18, 6, '#6a5a8a');

    // Nightstand
    pxRect(ctx, x + 24, y + h - 14, 8, 10, '#5a4a3a');

    // Lamp on nightstand
    pxRect(ctx, x + 26, y + h - 22, 4, 8, '#7a6a5a'); // base
    if (lampOn) {
        // Warm lamp glow
        ctx.fillStyle = 'rgba(255, 220, 120, 0.15)';
        ctx.beginPath();
        ctx.arc(x + 28, y + h - 24, 12, 0, Math.PI * 2);
        ctx.fill();
        px4(ctx, x + 25, y + h - 28, '#ffd860');
    } else {
        px4(ctx, x + 25, y + h - 28, '#8a7a5a');
    }

    // Window (right side)
    const windowX = x + w - 16;
    pxRect(ctx, windowX, y + 6, 12, 18, lerpColor('#1a2a4a', '#8ab8e8', t));
    // Window frame
    ctx.strokeStyle = '#6a6a7a';
    ctx.lineWidth = 1;
    ctx.strokeRect(windowX, y + 6, 12, 18);
    // Window cross
    pxRect(ctx, windowX + 5, y + 6, 2, 18, '#6a6a7a');
    pxRect(ctx, windowX, y + 14, 12, 2, '#6a6a7a');

    // Small rug
    pxRect(ctx, x + 26, y + h - 6, 12, 2, '#8a4a6a');
}

function drawShopInterior(ctx, x, y, w, h, t, hour, room) {
    const isOpen = hour >= 8 && hour <= 21;

    // Floor (checkered tiles)
    for (let tx = 0; tx < w; tx += 4) {
        const checker = ((tx / 4) | 0) % 2 === 0;
        pxRect(ctx, x + tx, y + h - 4, 4, 4, checker ? '#3a5a3a' : '#4a6a4a');
    }

    // Shelves (vertical racks)
    for (let sx = 6; sx < w - 12; sx += 10) {
        // Shelf unit
        pxRect(ctx, x + sx, y + 4, 4, h - 12, '#5a4a3a');
        // Items on shelves (coloured blocks)
        const colors = ['#bc4a4a', '#4a7abc', '#bcbc4a', '#4abc7a'];
        for (let sy = 6; sy < h - 16; sy += 8) {
            px(ctx, x + sx - 2, y + sy, colors[(sx + sy) % colors.length]);
            px(ctx, x + sx + 4, y + sy, colors[(sx + sy + 1) % colors.length]);
        }
    }

    // Counter (right side)
    pxRect(ctx, x + w - 14, y + h - 18, 12, 14, '#6a5a3a');
    pxRect(ctx, x + w - 14, y + h - 20, 12, 4, '#8a7a5a');
    // Cash register
    px4(ctx, x + w - 12, y + h - 26, '#4a5a5a');
    px(ctx, x + w - 11, y + h - 28, '#4adc4a'); // screen

    // Shop sign (top)
    if (isOpen) {
        pxRect(ctx, x + 2, y + 2, 14, 6, '#3a8a5a');
        px(ctx, x + 5, y + 3, '#e0e0e0'); // "OPEN" simplified as dots
        px(ctx, x + 9, y + 3, '#e0e0e0');
        px(ctx, x + 13, y + 3, '#e0e0e0');
    } else {
        pxRect(ctx, x + 2, y + 2, 14, 6, '#5a3a3a');
    }
}

function drawOfficeInterior(ctx, x, y, w, h, t, hour, room) {
    const isWorking = hour >= 8 && hour <= 18;

    // Carpet floor
    pxRect(ctx, x, y + h - 4, w, 4, '#3a4a5a');

    // Desks with monitors (evenly spaced)
    const deskCount = Math.floor(w / 20);
    for (let d = 0; d < deskCount; d++) {
        const dx = x + 6 + d * 20;
        // Desk
        pxRect(ctx, dx, y + h - 18, 14, 10, '#5a4a3a');
        pxRect(ctx, dx + 2, y + h - 20, 10, 4, '#6a5a4a');
        // Monitor
        pxRect(ctx, dx + 3, y + h - 30, 8, 10, '#2a2a3a');
        if (isWorking) {
            // Screen glow
            pxRect(ctx, dx + 4, y + h - 29, 6, 7, '#4a7adc');
            // Text lines
            pxRect(ctx, dx + 5, y + h - 27, 4, 1, '#8ab8ff');
            pxRect(ctx, dx + 5, y + h - 25, 3, 1, '#8ab8ff');
        } else {
            pxRect(ctx, dx + 4, y + h - 29, 6, 7, '#1a1a2a');
        }
        // Chair
        pxRect(ctx, dx + 4, y + h - 12, 6, 4, '#3a3a5a');
        pxRect(ctx, dx + 6, y + h - 8, 2, 4, '#2a2a3a');
    }

    // Water cooler (right side)
    pxRect(ctx, x + w - 10, y + h - 24, 6, 20, '#8a9aaa');
    px4(ctx, x + w - 10, y + h - 30, '#6aa8d0');

    // Clock on wall (top)
    px4(ctx, x + w / 2 - 2, y + 4, '#e0d8d0');
    px(ctx, x + w / 2 - 1, y + 5, '#2a2a2a');
}

function drawRestaurantInterior(ctx, x, y, w, h, t, hour, room) {
    const isPeakHour = (hour >= 11 && hour <= 14) || (hour >= 18 && hour <= 21);

    // Warm ambient glow during peak hours
    if (isPeakHour) {
        ctx.fillStyle = 'rgba(255, 160, 60, 0.08)';
        ctx.fillRect(x, y, w, h);
    }

    // Floor (warm wood)
    pxRect(ctx, x, y + h - 4, w, 4, '#5a3a2a');

    // Tables with chairs (evenly spaced)
    const tableCount = Math.max(2, Math.floor(w / 24));
    for (let tb = 0; tb < tableCount; tb++) {
        const tx = x + 8 + tb * (w - 16) / Math.max(1, tableCount - 1);
        // Table
        pxRect(ctx, tx, y + h - 20, 12, 4, '#6a4a2a');
        pxRect(ctx, tx + 4, y + h - 16, 4, 12, '#5a3a1a'); // leg

        // Chairs on either side
        pxRect(ctx, tx - 4, y + h - 18, 4, 8, '#4a3a3a');
        pxRect(ctx, tx + 12, y + h - 18, 4, 8, '#4a3a3a');

        // Table setting
        px(ctx, tx + 2, y + h - 22, '#e0e0e0'); // plate
        px(ctx, tx + 8, y + h - 22, '#e0e0e0'); // plate

        // Candle/lamp on table (warm glow at peak)
        if (isPeakHour) {
            px(ctx, tx + 5, y + h - 24, '#ffd040');
            px(ctx, tx + 5, y + h - 26, '#ff8020');
        }
    }

    // Kitchen window (back wall, left)
    pxRect(ctx, x + 2, y + 6, 16, 12, '#4a4a3a');
    pxRect(ctx, x + 4, y + 8, 12, 8, '#5a4a2a');
    // Steam from kitchen
    if (isPeakHour) {
        const now = (performance.now() * 0.002) | 0;
        for (let s = 0; s < 3; s++) {
            const sy = y + 4 - ((now + s * 3) % 8);
            px(ctx, x + 6 + s * 4, sy, 'rgba(200,200,200,0.3)');
        }
    }

    // Menu board (right wall)
    pxRect(ctx, x + w - 14, y + 4, 10, 14, '#2a2a1a');
    px(ctx, x + w - 12, y + 7, '#e0d0a0');
    px(ctx, x + w - 12, y + 11, '#e0d0a0');
    px(ctx, x + w - 8, y + 7, '#e0d0a0');
}

function drawHotelInterior(ctx, x, y, w, h, t, hour, room) {
    const occupied = room.occupancy > 0;

    // Carpet
    pxRect(ctx, x, y + h - 4, w, 4, '#4a4a3a');

    // Bed (centered)
    pxRect(ctx, x + 4, y + h - 18, 16, 14, '#e8e0d0'); // mattress
    pxRect(ctx, x + 4, y + h - 20, 16, 4, '#d0c8b8'); // top
    pxRect(ctx, x + 6, y + h - 22, 4, 4, '#f0e8e0'); // pillow
    // Duvet
    pxRect(ctx, x + 4, y + h - 14, 16, 6, '#5a7a5a');

    // Nightstand
    pxRect(ctx, x + 22, y + h - 14, 8, 10, '#5a4a3a');
    // Lamp
    pxRect(ctx, x + 24, y + h - 20, 4, 6, '#6a5a4a');
    const lampOn = occupied && (hour < 7 || hour > 20);
    px(ctx, x + 24, y + h - 22, lampOn ? '#ffd860' : '#5a5a4a');

    // Door with indicator (left side)
    pxRect(ctx, x, y + 4, 6, h - 12, '#4a3a2a');
    // Indicator light: green=vacant, red=occupied
    px4(ctx, x, y + 6, occupied ? '#dc4a4a' : '#4adc4a');
    // Door handle
    px(ctx, x + 4, y + h / 2, '#c0b090');

    // Small window
    pxRect(ctx, x + w - 10, y + 8, 8, 12, lerpColor('#1a2a4a', '#8ab8e8', t));
    ctx.strokeStyle = '#5a5a6a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + w - 10, y + 8, 8, 12);
}

function drawSkyLobbyInterior(ctx, x, y, w, h, t, room) {
    // Floor (elegant tiles)
    for (let tx = 0; tx < w; tx += 6) {
        const checker = ((tx / 6) | 0) % 2 === 0;
        pxRect(ctx, x + tx, y + h - 4, 6, 4, checker ? '#6a7a5a' : '#7a8a6a');
    }

    // Large windows along the back
    for (let wx = 8; wx < w - 8; wx += 18) {
        pxRect(ctx, x + wx, y + 4, 14, h - 12, lerpColor('#1a2a4a', '#8ac8f0', t));
        ctx.strokeStyle = '#8a8a7a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + wx, y + 4, 14, h - 12);
        // Window mullion
        pxRect(ctx, x + wx + 6, y + 4, 2, h - 12, '#8a8a7a');
    }

    // Elevator directory sign (center)
    const cx = x + w / 2;
    pxRect(ctx, cx - 8, y + 6, 16, 10, '#2a3a2a');
    px(ctx, cx - 5, y + 9, '#8adc8a');
    px(ctx, cx - 1, y + 9, '#8adc8a');
    px(ctx, cx + 3, y + 9, '#8adc8a');

    // Benches
    pxRect(ctx, x + 4, y + h - 14, 16, 6, '#5a6a4a');
    pxRect(ctx, x + w - 20, y + h - 14, 16, 6, '#5a6a4a');

    // Potted plants
    drawPlant(ctx, x + 24, y + h - 20, t);
    if (w > 200) drawPlant(ctx, x + w - 30, y + h - 20, t);
}

function drawGymInterior(ctx, x, y, w, h, t, hour, room) {
    const isActive = hour >= 6 && hour <= 22;

    // Rubber floor
    pxRect(ctx, x, y + h - 4, w, 4, '#4a3a2a');

    // Treadmill (left side)
    pxRect(ctx, x + 4, y + h - 18, 14, 14, '#4a4a5a'); // base
    pxRect(ctx, x + 6, y + h - 20, 10, 4, '#3a3a4a'); // console
    if (isActive) {
        // Moving belt lines
        const frame = ((performance.now() / 200) | 0) % 3;
        for (let i = 0; i < 3; i++) {
            pxRect(ctx, x + 6 + ((i + frame) % 3) * 4, y + h - 10, 2, 1, '#6a6a7a');
        }
    }
    // Handlebar
    pxRect(ctx, x + 10, y + h - 28, 2, 10, '#7a7a8a');

    // Weights rack (center)
    const wx = x + Math.floor(w / 2) - 6;
    pxRect(ctx, wx, y + h - 24, 12, 20, '#3a3a3a'); // rack frame
    // Dumbbells
    for (let dy = 0; dy < 3; dy++) {
        const clr = ['#5a5a6a', '#6a6a7a', '#4a4a5a'][dy];
        pxRect(ctx, wx + 2, y + h - 22 + dy * 6, 8, 4, clr);
    }

    // Bench press (right)
    if (w > 40) {
        const bx = x + w - 20;
        pxRect(ctx, bx, y + h - 12, 14, 8, '#5a4a3a'); // bench
        pxRect(ctx, bx + 2, y + h - 14, 2, 4, '#6a6a7a'); // bar support left
        pxRect(ctx, bx + 10, y + h - 14, 2, 4, '#6a6a7a'); // bar support right
        pxRect(ctx, bx - 2, y + h - 16, 18, 2, '#8a8a9a'); // bar
        // Weight plates
        px(ctx, bx - 2, y + h - 18, '#4a4a5a');
        px(ctx, bx + 16, y + h - 18, '#4a4a5a');
    }

    // Mirror on back wall
    pxRect(ctx, x + 2, y + 2, w - 4, 8, lerpColor('#3a4a5a', '#6a8aaa', t));
    // Reflected highlights
    for (let mx = 4; mx < w - 6; mx += 8) {
        px(ctx, x + mx, y + 4, 'rgba(255,255,255,0.15)');
    }
}

function drawCinemaInterior(ctx, x, y, w, h, t, hour, room) {
    const isShowtime = (hour >= 13 && hour <= 16) || (hour >= 18 && hour <= 23);

    // Dark carpet
    pxRect(ctx, x, y + h - 4, w, 4, '#1a1a2a');

    // Screen (back wall)
    pxRect(ctx, x + 8, y + 4, w - 16, 14, '#0a0a1a');
    if (isShowtime) {
        // Movie playing — flickering colours
        const frame = ((performance.now() / 500) | 0) % 4;
        const colors = ['#3a5a8a', '#5a3a7a', '#4a6a5a', '#7a5a3a'];
        pxRect(ctx, x + 10, y + 6, w - 20, 10, colors[frame]);
        // Projector beam
        ctx.fillStyle = 'rgba(200, 200, 255, 0.03)';
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y + h - 8);
        ctx.lineTo(x + 10, y + 6);
        ctx.lineTo(x + w - 10, y + 6);
        ctx.fill();
    } else {
        // Curtains (closed)
        pxRect(ctx, x + 10, y + 6, w - 20, 10, '#5a2a2a');
        // Curtain folds
        for (let cx = 14; cx < w - 14; cx += 6) {
            pxRect(ctx, x + cx, y + 6, 1, 10, '#4a1a1a');
        }
    }

    // Seating rows (tiered)
    const rows = Math.min(3, Math.floor((h - 24) / 8));
    for (let r = 0; r < rows; r++) {
        const ry = y + 22 + r * 8;
        const indent = r * 4;
        for (let sx = indent + 4; sx < w - indent - 4; sx += 6) {
            // Seat
            pxRect(ctx, x + sx, ry, 4, 5, isShowtime ? '#3a2a2a' : '#4a3a3a');
            // Seat back
            pxRect(ctx, x + sx, ry - 2, 4, 2, '#5a3a3a');
        }
    }

    // Exit sign (top right)
    pxRect(ctx, x + w - 12, y + 2, 10, 5, '#2a4a2a');
    px(ctx, x + w - 10, y + 3, '#4adc4a');
}

function drawMedicalInterior(ctx, x, y, w, h, t, hour, room) {
    const isOpen = hour >= 8 && hour <= 18;

    // Clean white floor
    pxRect(ctx, x, y + h - 4, w, 4, lerpColor('#8a9aaa', '#c0d0e0', t));

    // Reception desk (left)
    pxRect(ctx, x + 4, y + h - 16, 14, 12, '#e0d8d0');
    pxRect(ctx, x + 4, y + h - 18, 14, 4, '#d0c8c0');
    // Computer on desk
    pxRect(ctx, x + 7, y + h - 24, 6, 6, '#2a2a3a');
    if (isOpen) {
        pxRect(ctx, x + 8, y + h - 23, 4, 3, '#4a8abc');
    }

    // Medical cross on wall
    const cx = x + Math.floor(w / 2);
    pxRect(ctx, cx - 1, y + 4, 6, 2, '#dc4a4a');
    pxRect(ctx, cx + 1, y + 2, 2, 6, '#dc4a4a');

    // Examination bed (right side)
    if (w > 40) {
        const bx = x + w - 22;
        pxRect(ctx, bx, y + h - 14, 18, 6, '#e0e8f0'); // bed
        pxRect(ctx, bx, y + h - 16, 6, 4, '#d0d8e0'); // pillow
        // Legs
        pxRect(ctx, bx + 2, y + h - 8, 2, 4, '#8a8a9a');
        pxRect(ctx, bx + 14, y + h - 8, 2, 4, '#8a8a9a');
    }

    // Medicine cabinet
    pxRect(ctx, x + 20, y + 4, 10, 14, '#e0e0e0');
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 20, y + 4, 10, 14);
    // Bottles inside
    px(ctx, x + 22, y + 8, '#4abc4a');
    px(ctx, x + 26, y + 8, '#bc4a4a');
    px(ctx, x + 22, y + 12, '#4a4abc');

    // Potted plant
    drawPlant(ctx, x + w - 10, y + h - 18, t);
}

function drawParkingInterior(ctx, x, y, w, h, t, room) {
    // Concrete floor
    pxRect(ctx, x, y + h - 4, w, 4, '#5a5a5a');

    // Parking lines
    const spotWidth = 18;
    const numSpots = Math.floor(w / spotWidth);
    for (let i = 0; i <= numSpots; i++) {
        const lx = x + i * spotWidth;
        pxRect(ctx, lx, y + 4, 2, h - 8, '#8a8a4a');
    }

    // Cars in some spots (deterministic based on room position)
    const carColors = ['#4a4aaa', '#aa4a4a', '#4aaa4a', '#aa8a4a', '#7a4a8a', '#4a8a8a'];
    for (let i = 0; i < numSpots; i++) {
        // Use a simple hash to decide if occupied
        const occupied = ((room.x * 7 + i * 13 + room.floor * 31) % 5) < 3;
        if (!occupied) continue;

        const cx = x + i * spotWidth + 3;
        const cy = y + Math.floor(h / 2) - 4;
        const color = carColors[(room.x + i) % carColors.length];

        // Car body
        pxRect(ctx, cx, cy, 12, 8, color);
        // Roof
        pxRect(ctx, cx + 2, cy - 4, 8, 4, darken(color, 0.15));
        // Windows
        pxRect(ctx, cx + 3, cy - 3, 2, 2, lerpColor('#1a2a4a', '#5a7aaa', t));
        pxRect(ctx, cx + 7, cy - 3, 2, 2, lerpColor('#1a2a4a', '#5a7aaa', t));
        // Wheels
        px(ctx, cx + 1, cy + 8, '#1a1a1a');
        px(ctx, cx + 9, cy + 8, '#1a1a1a');
    }

    // Ceiling lights
    for (let lx = 10; lx < w - 10; lx += 24) {
        pxRect(ctx, x + lx, y, 8, 3, '#8a8a6a');
        px(ctx, x + lx + 3, y + 2, '#dcdc8a');
    }

    // Exit arrow
    pxRect(ctx, x + 2, y + 2, 12, 6, '#2a5a2a');
    // Arrow shape (simple)
    px(ctx, x + 4, y + 4, '#4adc4a');
    px(ctx, x + 6, y + 4, '#4adc4a');
    px(ctx, x + 8, y + 4, '#4adc4a');
    px(ctx, x + 10, y + 3, '#4adc4a');
    px(ctx, x + 10, y + 5, '#4adc4a');
}

// ─── Stairs ───

function drawStairs(ctx, state, floor, daylight) {
    const grid = state.grid;
    const sx = (grid.width - STAIR_W) * CELL_W;
    const sy = worldY(floor);
    const sw = STAIR_W * CELL_W;
    const t = daylight;

    // Check if these cells are occupied by a room (not stairs)
    const cellCheck = grid.cells[floorToIdx(grid, floor)]?.[grid.width - 1];
    if (cellCheck !== null) return; // Room occupies this space

    // Stairwell background
    pxRect(ctx, sx, sy, sw, CELL_H, lerpColor('#1a1a1e', '#2a2a32', t));

    // Draw step lines (diagonal pattern suggesting stairs)
    const stepColor = lerpColor('#3a3a4a', '#6a6a7a', t);
    const stepH = 6; // pixels per step
    const steps = Math.floor(CELL_H / stepH);
    for (let s = 0; s < steps; s++) {
        const stepY = sy + s * stepH;
        const indent = (s / steps) * (sw * 0.6);
        pxRect(ctx, sx + indent, stepY + stepH - 2, sw - indent, 2, stepColor);
        // Vertical riser
        if (s > 0) {
            pxRect(ctx, sx + indent, stepY, 2, stepH, darken(stepColor, 0.2));
        }
    }

    // Handrail
    ctx.strokeStyle = lerpColor('#5a5a6a', '#9a9aaa', t);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + 2, sy + CELL_H);
    ctx.lineTo(sx + sw - 4, sy);
    ctx.stroke();
}

// ─── Elevators ───

function drawElevators(ctx, state, minFloor, maxFloor, daylight) {
    const t = daylight;

    for (const elev of state.elevators) {
        const ex = elev.x * CELL_W;

        // Draw shaft for visible floors
        for (let f = minFloor; f < maxFloor; f++) {
            const fy = worldY(f);
            const cellId = state.grid.cells[floorToIdx(state.grid, f)]?.[elev.x];
            if (cellId === null || cellId === undefined) continue;
            const room = state.roomsById.get(cellId);
            if (!room || room.type !== 'elevator') continue;

            // Shaft background
            pxRect(ctx, ex + 2, fy + 2, CELL_W - 4, CELL_H - 2, '#1a1a22');
            // Shaft rails
            pxRect(ctx, ex + 4, fy, 2, CELL_H, '#3a3a4a');
            pxRect(ctx, ex + CELL_W - 6, fy, 2, CELL_H, '#3a3a4a');
            // Floor marker
            pxRect(ctx, ex + 2, fy + CELL_H - 2, CELL_W - 4, 2, '#4a4a5a');
        }

        // Draw cars
        if (elev.cars) {
            for (const car of elev.cars) {
                const carY = worldY(0) - car.position * CELL_H;
                const carH = CELL_H - 8;
                // Car body
                pxRect(ctx, ex + 6, carY + 4, CELL_W - 12, carH, lerpColor('#5a5a6a', '#8a8a9a', t));
                // Car roof
                pxRect(ctx, ex + 6, carY + 2, CELL_W - 12, 4, lerpColor('#4a4a5a', '#7a7a8a', t));
                // Door line
                pxRect(ctx, ex + CELL_W / 2 - 1, carY + 6, 2, carH - 6, '#3a3a4a');
            }
        }

        // Queue dots at stops
        if (elev.queue) {
            for (const stop of elev.queue) {
                const dotY = worldY(stop) + CELL_H / 2;
                px(ctx, ex + CELL_W - 4, dotY, '#dc4a4a');
            }
        }
    }
}

// ─── People ───

function drawPeople(ctx, state, minFloor, maxFloor) {
    const animFrame = ((performance.now() / 300) | 0) % 2;

    for (const person of state.people) {
        // Skip invisible states
        if (person.state === 'in_room' || person.state === 'riding') continue;

        // Floor culling
        const pFloor = person.currentFloor;
        if (pFloor == null || pFloor < minFloor || pFloor >= maxFloor) continue;

        const palette = PERSON_PALETTES[person.id % PERSON_PALETTES.length];
        const px0 = person.currentX; // world x position
        const py0 = worldY(pFloor) + CELL_H - 8; // standing on floor

        // 3x6 pixel sprite
        // Head (skin)
        px(ctx, px0, py0 - 6, palette.skin, 3);
        // Hair
        pxRect(ctx, px0, py0 - 8, 3, 2, palette.hair);
        // Body (shirt)
        pxRect(ctx, px0, py0 - 4, 3, 3, palette.shirt);
        // Legs (with walk animation)
        if (person.state === 'walking' && animFrame === 1) {
            px(ctx, px0, py0 - 1, palette.pants);
            px(ctx, px0 + 2, py0, palette.pants);
        } else {
            px(ctx, px0, py0 - 1, palette.pants);
            px(ctx, px0 + 2, py0 - 1, palette.pants);
        }
        // Stress indicator: tiny red dot above head if stress > 60
        if ((person.stress || 0) > 60) {
            px(ctx, px0 + 1, py0 - 11, '#ff3030', 2);
        }
    }
}

// ─── Noise overlay ───

function drawNoiseOverlay(ctx, state, minFloor, maxFloor) {
    const seen = new Set();
    for (let f = minFloor; f < maxFloor; f++) {
        const fi = floorToIdx(state.grid, f);
        const row = state.grid.cells[fi];
        if (!row) continue;
        for (let x = 0; x < state.grid.width; x++) {
            const roomId = row[x];
            if (roomId === null || roomId === undefined || seen.has(roomId)) continue;
            seen.add(roomId);
            const room = state.roomsById.get(roomId);
            if (!room || room.type === 'elevator') continue;
            const noise = room.noiseLevel || 0;
            if (noise <= 0) continue;

            let r, g, b;
            if (noise <= 20) {
                // green
                r = 0; g = 200; b = 0;
            } else if (noise <= 50) {
                // yellow
                r = 230; g = 220; b = 0;
            } else if (noise <= 75) {
                // orange
                r = 255; g = 120; b = 0;
            } else {
                // red
                r = 230; g = 30; b = 30;
            }
            const alpha = 0.1 + (noise / 100) * 0.3;

            const rx = room.x * CELL_W;
            const ry = worldY(room.floor);
            const rw = room.width * CELL_W;
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.fillRect(rx + 2, ry + 2, rw - 4, CELL_H - 4);

            // Noise value label
            ctx.fillStyle = `rgba(255,255,255,0.7)`;
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(Math.round(noise), rx + rw / 2, ry + CELL_H / 2 + 3);
            ctx.textAlign = 'left';
        }
    }
}

// ─── Ghost preview ───

function drawGhostPreview(ctx, state) {
    const ghost = state.ui.ghostPreview;
    if (!ghost) return;

    const def = ROOM_TYPES[ghost.type];
    if (!def) return;

    const gw = (def.width === 'full' ? state.grid.width : def.width) * CELL_W;
    const gh = CELL_H;
    const gx = ghost.x * CELL_W;
    const gy = worldY(ghost.floor);

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ghost.valid ? 'rgba(74, 220, 74, 0.3)' : 'rgba(220, 74, 74, 0.3)';
    ctx.fillRect(gx, gy, gw, gh);

    ctx.strokeStyle = ghost.valid ? '#4adc4a' : '#dc4a4a';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.setLineDash([]);

    // Label
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, gx + gw / 2, gy + gh / 2 + 3);
    ctx.textAlign = 'left';

    ctx.globalAlpha = 1;
}
