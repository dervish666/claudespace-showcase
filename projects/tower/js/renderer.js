// renderer.js — Canvas renderer: keyframed sky, parallax skyline, building shell,
// and baked room-interior sprites (drawn once at 3× supersample, blitted per frame)

import { ROOM_TYPES } from './rooms.js';
import { getHour } from './clock.js';
import { floorToIdx } from './grid.js';

export const CELL_W = 24;
export const CELL_H = 48;
export const STAIR_W = 2;

let _canvas, _ctx, _state;
let dpr = 1;
let screenW = 0, screenH = 0;

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

function hash(a, b) {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
}

// ─── Person palettes ───

const PERSON_PALETTES = [
    { hair: '#3a2a1a', shirt: '#4a7abc', pants: '#2a3a5a', skin: '#e8c090' },
    { hair: '#8a5a2a', shirt: '#bc4a4a', pants: '#3a3a4a', skin: '#d4a878' },
    { hair: '#1a1a2a', shirt: '#5abc5a', pants: '#4a4a3a', skin: '#c89870' },
    { hair: '#6a4a2a', shirt: '#bcbc4a', pants: '#3a4a5a', skin: '#e0b888' },
    { hair: '#caa84a', shirt: '#8a5abc', pants: '#3a2a3a', skin: '#f0d0a8' },
    { hair: '#4a3a3a', shirt: '#e8975a', pants: '#4a4a5c', skin: '#b88860' },
    { hair: '#7a7a82', shirt: '#5ab0b0', pants: '#34485c', skin: '#e2bc94' },
    { hair: '#2a1a0e', shirt: '#d0d0d8', pants: '#2c2c34', skin: '#caa078' },
];

// ─── Sky keyframes (by hour) ───

const SKY_KEYS = [
    { h: 0,    top: '#070716', mid: '#101030', bot: '#1c1c40' },
    { h: 5,    top: '#0d0d24', mid: '#1c1640', bot: '#3a2a50' },
    { h: 6.5,  top: '#3a4878', mid: '#b06a58', bot: '#f0a85c' },
    { h: 8,    top: '#4584c8', mid: '#7ab0dc', bot: '#b8d8ec' },
    { h: 13,   top: '#3a7cc4', mid: '#74b2e4', bot: '#b4dcf0' },
    { h: 17,   top: '#4a7cb4', mid: '#8aaed0', bot: '#d0bca0' },
    { h: 18.7, top: '#34386c', mid: '#90507c', bot: '#e88850' },
    { h: 20,   top: '#0c0c26', mid: '#1a1a3e', bot: '#2c2450' },
    { h: 24,   top: '#070716', mid: '#101030', bot: '#1c1c40' },
];

function skyAt(hourF) {
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
        if (hourF >= SKY_KEYS[i].h && hourF <= SKY_KEYS[i + 1].h) {
            a = SKY_KEYS[i]; b = SKY_KEYS[i + 1];
            break;
        }
    }
    const t = (hourF - a.h) / Math.max(0.001, b.h - a.h);
    return {
        top: lerpColor(a.top, b.top, t),
        mid: lerpColor(a.mid, b.mid, t),
        bot: lerpColor(a.bot, b.bot, t),
    };
}

// ─── Static sky assets ───

const STARS = [];
for (let i = 0; i < 110; i++) {
    STARS.push({
        x: hash(i, 1), y: hash(i, 2) * 0.75,
        size: hash(i, 3) < 0.25 ? 1.6 : 1,
        twinkle: hash(i, 4) * Math.PI * 2,
        tint: hash(i, 5)
    });
}

// Baked fluffy cloud sprites
const CLOUD_SPRITES = [];
function bakeClouds() {
    for (let v = 0; v < 3; v++) {
        const c = document.createElement('canvas');
        c.width = 220; c.height = 90;
        const g = c.getContext('2d');
        const puffs = 7 + v * 2;
        for (let p = 0; p < puffs; p++) {
            const px2 = 30 + hash(v * 10 + p, 1) * 160;
            const py2 = 48 + hash(v * 10 + p, 2) * 18;
            const pr = 14 + hash(v * 10 + p, 3) * 22;
            // shadowed under-side first
            g.fillStyle = 'rgba(170,180,205,0.5)';
            g.beginPath(); g.arc(px2 + 2, py2 + 5, pr, 0, Math.PI * 2); g.fill();
        }
        for (let p = 0; p < puffs; p++) {
            const px2 = 30 + hash(v * 10 + p, 1) * 160;
            const py2 = 48 + hash(v * 10 + p, 2) * 18;
            const pr = 14 + hash(v * 10 + p, 3) * 22;
            g.fillStyle = 'rgba(255,255,255,0.85)';
            g.beginPath(); g.arc(px2, py2 - pr * 0.25, pr * 0.92, 0, Math.PI * 2); g.fill();
        }
        // flatten base
        g.clearRect(0, 76, 220, 14);
        CLOUD_SPRITES.push(c);
    }
}
bakeClouds();

const CLOUDS = [];
for (let i = 0; i < 7; i++) {
    CLOUDS.push({
        x: hash(i, 7), y: 0.04 + hash(i, 8) * 0.3,
        scale: 0.5 + hash(i, 9) * 0.9,
        speed: 0.0025 + hash(i, 10) * 0.004,
        sprite: i % 3,
        opacity: 0.5 + hash(i, 11) * 0.4,
    });
}

// Parallax skyline: 3 depth layers × (day, night) baked on resize
const SKYLINE = { layers: [], builtW: 0 };
function bakeSkyline(w, h) {
    SKYLINE.layers = [];
    const defs = [
        { count: 26, hMin: 0.05, hMax: 0.14, par: 0.04, day: '#9fb2c5', night: '#181830', winChance: 0 },
        { count: 20, hMin: 0.10, hMax: 0.24, par: 0.09, day: '#7e92a8', night: '#14142a', winChance: 0.5 },
        { count: 15, hMin: 0.14, hMax: 0.34, par: 0.16, day: '#566a80', night: '#101022', winChance: 0.9 },
    ];
    for (let L = 0; L < 3; L++) {
        const def = defs[L];
        const variants = {};
        for (const mode of ['day', 'night']) {
            const c = document.createElement('canvas');
            c.width = w * 2; c.height = h;
            const g = c.getContext('2d');
            for (let i = 0; i < def.count * 2; i++) {
                const bx = hash(L * 100 + i, 21) * w * 2;
                const bw = (0.018 + hash(L * 100 + i, 22) * 0.05) * w;
                const bh = (def.hMin + hash(L * 100 + i, 23) * (def.hMax - def.hMin)) * h;
                const by = h - bh;
                g.fillStyle = mode === 'day' ? def.day : def.night;
                g.fillRect(bx, by, bw, bh);
                // simple rooftop variation
                const rv = hash(L * 100 + i, 24);
                if (rv > 0.72) { // antenna
                    g.fillRect(bx + bw / 2 - 1, by - bh * 0.12, 2, bh * 0.12);
                } else if (rv > 0.5) { // stepped top
                    g.fillRect(bx + bw * 0.2, by - 6, bw * 0.6, 6);
                }
                // windows
                if (def.winChance > 0 && hash(L * 100 + i, 25) < def.winChance) {
                    const cols = Math.max(1, Math.floor(bw / 7));
                    const rows = Math.max(2, Math.floor(bh / 11));
                    for (let wy = 0; wy < rows; wy++) {
                        for (let wx = 0; wx < cols; wx++) {
                            const litN = hash(i * 31 + wx, wy * 17) < 0.55;
                            const litD = hash(i * 31 + wx, wy * 17) < 0.12;
                            if (mode === 'night' ? litN : litD) {
                                g.fillStyle = mode === 'night'
                                    ? 'rgba(255,214,120,0.85)'
                                    : 'rgba(200,220,240,0.5)';
                                g.fillRect(bx + 2 + wx * (bw - 4) / cols, by + 4 + wy * (bh - 8) / rows, 2.4, 3.2);
                            }
                        }
                    }
                }
            }
            variants[mode] = c;
        }
        SKYLINE.layers.push({ par: def.par, day: variants.day, night: variants.night });
    }
    SKYLINE.builtW = w;
}

// Weather
const weather = { rain: false, rainDrops: [], rainTimer: 0 };
setInterval(() => {
    weather.rain = Math.random() < 0.15;
    if (weather.rain && weather.rainDrops.length === 0) {
        for (let i = 0; i < 110; i++) {
            weather.rainDrops.push({ x: Math.random(), y: Math.random(), speed: 0.012 + Math.random() * 0.012, len: 7 + Math.random() * 7 });
        }
    } else if (!weather.rain) {
        weather.rainDrops = [];
    }
}, 30000);

// Street traffic (world-space, decorative)
const TRAFFIC = [];
for (let i = 0; i < 5; i++) {
    TRAFFIC.push({
        x: hash(i, 31) * 2400 - 1200,
        dir: hash(i, 32) > 0.5 ? 1 : -1,
        speed: 0.6 + hash(i, 33) * 0.9,
        color: ['#b04a42', '#3f6fa8', '#c8c8cc', '#3a3a40', '#caa53e'][i % 5],
    });
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
    bakeSkyline(screenW, screenH);
}

// ─── World coordinate helpers ───

function worldY(floor) { return -floor * CELL_H; }

// ─── Main render ───

export function render(ctx, state) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, screenW, screenH);

    const cam = state.camera;
    const zoom = cam.zoom;
    const daylight = state.clock.daylight;

    drawSky(ctx, daylight, state.clock.time, cam);

    ctx.save();
    ctx.translate(screenW / 2, screenH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);

    const viewHalfH = (screenH / 2) / zoom;
    const viewHalfW = (screenW / 2) / zoom;
    const viewTop = cam.y - viewHalfH;
    const viewBottom = cam.y + viewHalfH;

    const minFloor = Math.max(-state.grid.basementFloors, Math.floor((-viewBottom) / CELL_H) - 1);
    const maxFloor = Math.min(state.grid.builtFloors, Math.ceil((-viewTop) / CELL_H) + 1);

    // ground, street and soil cutaway (world-anchored)
    drawGround(ctx, state, daylight, viewHalfW, cam);

    // building shell behind the floors
    drawBuildingShell(ctx, state, daylight);

    for (let f = minFloor; f < maxFloor; f++) {
        drawFloor(ctx, state, f, daylight);
    }

    for (let f = minFloor; f < maxFloor; f++) {
        if (f < state.grid.builtFloors) drawStairs(ctx, state, f, daylight);
    }

    drawElevators(ctx, state, minFloor, maxFloor, daylight);
    drawPeople(ctx, state, minFloor, maxFloor);

    // roof furniture above the top floor
    drawRoof(ctx, state, daylight);

    if (state.ui.showNoiseOverlay) drawNoiseOverlay(ctx, state, minFloor, maxFloor);
    if (state.ui.buildMode && state.ui.ghostPreview) drawGhostPreview(ctx, state);

    ctx.restore();
    ctx.restore();
}

// ─── Sky ───

function drawSky(ctx, daylight, time, cam) {
    const t = daylight;
    const hourF = time * 24;
    const pal = skyAt(hourF);

    const grad = ctx.createLinearGradient(0, 0, 0, screenH);
    grad.addColorStop(0, pal.top);
    grad.addColorStop(0.55, pal.mid);
    grad.addColorStop(1, pal.bot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, screenW, screenH);

    const now = performance.now() * 0.001;

    // stars
    const starAlpha = Math.max(0, 1 - t * 2.5);
    if (starAlpha > 0) {
        for (const star of STARS) {
            const twinkle = (Math.sin(now * 1.5 + star.twinkle) + 1) / 2;
            const alpha = starAlpha * (0.35 + 0.65 * twinkle);
            ctx.fillStyle = star.tint > 0.85
                ? `rgba(200,215,255,${alpha})`
                : `rgba(255,250,235,${alpha})`;
            ctx.fillRect(star.x * screenW, star.y * screenH, star.size, star.size);
        }
    }

    // sun: rises 6h, sets 19h — arc across the sky
    if (hourF > 5.4 && hourF < 19.6) {
        const sp = (hourF - 5.4) / 14.2;
        const sx = sp * screenW;
        const sy = screenH * 0.78 - Math.sin(sp * Math.PI) * screenH * 0.62;
        const low = Math.min(1, Math.max(0, 1 - Math.sin(sp * Math.PI) * 2.2)); // near horizon
        const sunCol = lerpColor('#fff3c8', '#ff9440', low);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
        glow.addColorStop(0, sunCol + 'cc');
        glow.addColorStop(0.18, sunCol + '55');
        glow.addColorStop(1, sunCol + '00');
        ctx.fillStyle = glow;
        ctx.fillRect(sx - 90, sy - 90, 180, 180);
        ctx.fillStyle = sunCol;
        ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath(); ctx.arc(sx - 3, sy - 4, 7, 0, Math.PI * 2); ctx.fill();
    }

    // moon: visible at night, opposite arc
    if (hourF < 6.8 || hourF > 18.4) {
        const mp = hourF > 18.4 ? (hourF - 18.4) / 12.4 : (hourF + 5.6) / 12.4;
        const mx = mp * screenW;
        const my = screenH * 0.72 - Math.sin(mp * Math.PI) * screenH * 0.55;
        const mAlpha = Math.min(1, starAlpha + 0.25);
        ctx.globalAlpha = mAlpha;
        const mglow = ctx.createRadialGradient(mx, my, 0, mx, my, 55);
        mglow.addColorStop(0, 'rgba(220,230,255,0.5)');
        mglow.addColorStop(1, 'rgba(220,230,255,0)');
        ctx.fillStyle = mglow;
        ctx.fillRect(mx - 55, my - 55, 110, 110);
        ctx.fillStyle = '#e8ecf4';
        ctx.beginPath(); ctx.arc(mx, my, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(180,190,210,0.6)';
        ctx.beginPath(); ctx.arc(mx - 4, my - 2, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(mx + 3, my + 4, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(mx + 5, my - 5, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }

    // clouds (baked sprites)
    for (const cloud of CLOUDS) {
        const cx = ((cloud.x + now * cloud.speed * 0.01) % 1.25) - 0.125;
        const w = 220 * cloud.scale, h = 90 * cloud.scale;
        let a = cloud.opacity * (0.35 + t * 0.65);
        if (weather.rain) a *= 1.15;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(CLOUD_SPRITES[cloud.sprite], cx * screenW - w / 2, cloud.y * screenH - h / 2, w, h);
        if (weather.rain || t < 0.45) {
            // dusk/storm tint over the cloud body
            ctx.globalAlpha = Math.min(1, a) * (weather.rain ? 0.65 : (0.45 - t));
            ctx.globalCompositeOperation = 'source-atop';
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = weather.rain ? '#6a7080' : pal.mid;
            ctx.fillRect(cx * screenW - w / 2, cloud.y * screenH - h / 2, w, h);
            ctx.globalCompositeOperation = 'source-over';
        }
    }
    ctx.globalAlpha = 1;

    // parallax skyline layers with day/night crossfade
    if (SKYLINE.builtW !== screenW) bakeSkyline(screenW, screenH);
    const skylineBase = screenH * 0.86;
    for (const layer of SKYLINE.layers) {
        const off = ((cam.x * layer.par) % (screenW * 2) + screenW * 2) % (screenW * 2);
        const dy = skylineBase - screenH;
        const nightA = Math.max(0, 1 - t * 1.6);
        ctx.drawImage(layer.day, -off, dy);
        ctx.drawImage(layer.day, screenW * 2 - off, dy);
        if (nightA > 0.02) {
            ctx.globalAlpha = nightA;
            ctx.drawImage(layer.night, -off, dy);
            ctx.drawImage(layer.night, screenW * 2 - off, dy);
            ctx.globalAlpha = 1;
        }
    }

    // horizon haze
    const haze = ctx.createLinearGradient(0, screenH * 0.55, 0, screenH * 0.9);
    haze.addColorStop(0, pal.bot + '00');
    haze.addColorStop(1, pal.bot + '88');
    ctx.fillStyle = haze;
    ctx.fillRect(0, screenH * 0.55, screenW, screenH * 0.35);

    // rain
    if (weather.rain && weather.rainDrops.length > 0) {
        ctx.strokeStyle = 'rgba(190,210,230,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const drop of weather.rainDrops) {
            drop.y += drop.speed;
            drop.x += drop.speed * 0.12;
            if (drop.y > 1) { drop.y = -0.02; drop.x = Math.random(); }
            const dx = drop.x * screenW;
            const dy = drop.y * screenH;
            ctx.moveTo(dx, dy);
            ctx.lineTo(dx + 1.6, dy + drop.len);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,20,0.12)';
        ctx.fillRect(0, 0, screenW, screenH);
    }
}

// ─── Ground / street / soil (world space) ───

function drawGround(ctx, state, daylight, viewHalfW, cam) {
    const t = daylight;
    const grid = state.grid;
    const W = grid.width * CELL_W;
    const left = cam.x - viewHalfW - 100;
    const right = cam.x + viewHalfW + 100;
    const gY = CELL_H; // grade level (bottom of floor 0)
    const soilDepth = (grid.basementFloors + 1.5) * CELL_H;

    // soil block under everything
    const soil = ctx.createLinearGradient(0, gY, 0, gY + soilDepth);
    soil.addColorStop(0, lerpColor('#3a2c20', '#52402e', t));
    soil.addColorStop(1, lerpColor('#231a12', '#322618', t));
    ctx.fillStyle = soil;
    ctx.fillRect(left, gY, right - left, soilDepth);
    // strata + stones
    ctx.strokeStyle = 'rgba(20,14,8,0.35)';
    ctx.lineWidth = 1;
    for (let s = 1; s <= 3; s++) {
        const sy = gY + s * soilDepth / 4 + Math.sin(s * 5) * 4;
        ctx.beginPath();
        ctx.moveTo(left, sy);
        for (let x = left; x < right; x += 60) {
            ctx.lineTo(x, sy + Math.sin(x * 0.02 + s * 3) * 3);
        }
        ctx.stroke();
    }
    ctx.fillStyle = 'rgba(90,76,60,0.5)';
    for (let x = Math.floor(left / 50) * 50; x < right; x += 50) {
        const ry = gY + 8 + hash(x, 1) * (soilDepth - 16);
        ctx.beginPath();
        ctx.ellipse(x + hash(x, 2) * 30, ry, 3 + hash(x, 3) * 4, 2 + hash(x, 4) * 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // street + sidewalk on both sides of the tower (drawn over soil at grade)
    const sideRegions = [[left, -8], [W + 8, right]];
    for (const [x0, x1] of sideRegions) {
        if (x1 <= x0) continue;
        // sidewalk
        ctx.fillStyle = lerpColor('#5a5a5e', '#9a9a96', t);
        ctx.fillRect(x0, gY, x1 - x0, 8);
        ctx.strokeStyle = 'rgba(30,30,32,0.4)';
        ctx.lineWidth = 1;
        for (let x = Math.floor(x0 / 36) * 36; x < x1; x += 36) {
            ctx.beginPath(); ctx.moveTo(x, gY); ctx.lineTo(x, gY + 8); ctx.stroke();
        }
        // kerb + asphalt
        ctx.fillStyle = lerpColor('#46464a', '#7e7e82', t);
        ctx.fillRect(x0, gY + 8, x1 - x0, 2.5);
        ctx.fillStyle = lerpColor('#26262c', '#48484e', t);
        ctx.fillRect(x0, gY + 10.5, x1 - x0, 18);
        // dashed centre line
        ctx.fillStyle = lerpColor('#6a6a40', '#c8c870', t);
        for (let x = Math.floor(x0 / 30) * 30; x < x1; x += 30) {
            ctx.fillRect(x, gY + 19, 14, 1.6);
        }
        // street lamps
        for (let x = Math.floor(x0 / 170) * 170; x < x1; x += 170) {
            if (x > -40 && x < W + 40) continue;
            ctx.fillStyle = lerpColor('#2a2a30', '#54545c', t);
            ctx.fillRect(x, gY - 30, 2.4, 30);
            ctx.fillRect(x - 0.5, gY - 31.5, 8, 2.4);
            const lampOn = t < 0.45;
            ctx.fillStyle = lampOn ? '#ffd870' : '#9a9a92';
            ctx.fillRect(x + 5.4, gY - 30.4, 3.4, 2.2);
            if (lampOn) {
                const lg = ctx.createRadialGradient(x + 7, gY - 28, 0, x + 7, gY - 28, 30);
                lg.addColorStop(0, 'rgba(255,216,112,0.22)');
                lg.addColorStop(1, 'rgba(255,216,112,0)');
                ctx.fillStyle = lg;
                ctx.fillRect(x - 23, gY - 58, 60, 60);
            }
        }
        // little street trees
        for (let x = Math.floor(x0 / 130) * 130 + 65; x < x1; x += 130) {
            if (x > -30 && x < W + 30) continue;
            ctx.fillStyle = '#4a3826';
            ctx.fillRect(x, gY - 11, 2.2, 11);
            const tg = lerpColor('#1e3a1c', '#3f7038', t);
            ctx.fillStyle = tg;
            ctx.beginPath(); ctx.arc(x + 1, gY - 14, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = lerpColor('#2a4c26', '#549048', t);
            ctx.beginPath(); ctx.arc(x - 1, gY - 16, 4.4, 0, Math.PI * 2); ctx.fill();
        }
    }

    // passing cars (decorative)
    const dt = Math.min(50, performance.now() - (drawGround._last || performance.now()));
    drawGround._last = performance.now();
    for (const car of TRAFFIC) {
        if (!state.clock.paused) car.x += car.dir * car.speed * dt * 0.06;
        if (car.x > right + 200) car.x = left - 200;
        if (car.x < left - 200) car.x = right + 200;
        // hide while "behind" the tower footprint
        if (car.x > -30 && car.x < W + 10) continue;
        const cy = car.dir > 0 ? gY + 12 : gY + 20;
        ctx.fillStyle = car.color;
        ctx.fillRect(car.x, cy, 16, 4.5);
        ctx.fillStyle = darken(car.color, 0.2);
        ctx.fillRect(car.x + 3, cy - 3, 9, 3.4);
        ctx.fillStyle = lerpColor('#1a2a40', '#9cc4e4', t);
        ctx.fillRect(car.x + 4, cy - 2.4, 3, 2.2);
        ctx.fillRect(car.x + 8.4, cy - 2.4, 3, 2.2);
        ctx.fillStyle = '#16161a';
        ctx.beginPath(); ctx.arc(car.x + 3.4, cy + 4.6, 1.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(car.x + 12.6, cy + 4.6, 1.7, 0, Math.PI * 2); ctx.fill();
        if (t < 0.45) { // headlights
            ctx.fillStyle = 'rgba(255,240,180,0.85)';
            ctx.fillRect(car.dir > 0 ? car.x + 15 : car.x - 1, cy + 0.6, 1.6, 1.6);
        }
    }
}

// ─── Building shell ───

function drawBuildingShell(ctx, state, daylight) {
    const grid = state.grid;
    if (grid.builtFloors <= 0) return;
    const t = daylight;
    const W = grid.width * CELL_W;
    const top = worldY(grid.builtFloors);
    const gY = CELL_H;
    const bsBottom = gY + grid.basementFloors * CELL_H;

    // exterior side columns (concrete piers)
    const pierW = 7;
    for (const side of [-pierW, W]) {
        const grad = ctx.createLinearGradient(side, 0, side + pierW, 0);
        const base = lerpColor('#4c4c58', '#9c9ca8', t);
        grad.addColorStop(0, lighten(base, side < 0 ? 0.12 : 0));
        grad.addColorStop(1, darken(base, side < 0 ? 0.1 : 0.28));
        ctx.fillStyle = grad;
        ctx.fillRect(side, top - 4, pierW, gY - top + 4);
        // panel joints
        ctx.strokeStyle = 'rgba(20,20,26,0.35)';
        ctx.lineWidth = 1;
        for (let f = 0; f <= grid.builtFloors; f++) {
            ctx.beginPath();
            ctx.moveTo(side, worldY(f));
            ctx.lineTo(side + pierW, worldY(f));
            ctx.stroke();
        }
    }

    // basement retaining walls
    ctx.fillStyle = lerpColor('#3a3a42', '#5c5c66', t);
    ctx.fillRect(-pierW, gY, pierW, bsBottom - gY);
    ctx.fillRect(W, gY, pierW, bsBottom - gY);
    // foundation slab
    ctx.fillStyle = lerpColor('#33333b', '#52525c', t);
    ctx.fillRect(-pierW, bsBottom, W + pierW * 2, 6);

    // entrance canopy over the lobby centre
    const cx = W / 2;
    const canopyW = 86;
    ctx.fillStyle = lerpColor('#5c1f1f', '#8e3030', t);
    ctx.fillRect(cx - canopyW / 2, gY - CELL_H + 7, canopyW, 7);
    ctx.fillStyle = lerpColor('#3e1414', '#6a2222', t);
    ctx.fillRect(cx - canopyW / 2, gY - CELL_H + 14, canopyW, 2);
    // scalloped trim
    ctx.fillStyle = lerpColor('#702626', '#a83a3a', t);
    for (let sc = 0; sc < canopyW; sc += 10) {
        ctx.beginPath();
        ctx.arc(cx - canopyW / 2 + sc + 5, gY - CELL_H + 16, 5, 0, Math.PI);
        ctx.fill();
    }
}

function drawRoof(ctx, state, daylight) {
    const grid = state.grid;
    if (grid.builtFloors <= 0) return;
    const t = daylight;
    const W = grid.width * CELL_W;
    const top = worldY(grid.builtFloors);

    // roof slab + parapet
    ctx.fillStyle = lerpColor('#4a4a54', '#8e8e9a', t);
    ctx.fillRect(-7, top - 6, W + 14, 6);
    ctx.fillStyle = lerpColor('#5a5a66', '#a8a8b4', t);
    ctx.fillRect(-9, top - 9, W + 18, 4);

    // water tower
    const wtX = W * 0.18;
    ctx.strokeStyle = lerpColor('#3a3a42', '#6a6a74', t);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wtX + 3, top - 9); ctx.lineTo(wtX + 6, top - 22);
    ctx.moveTo(wtX + 21, top - 9); ctx.lineTo(wtX + 18, top - 22);
    ctx.stroke();
    const wtGrad = ctx.createLinearGradient(wtX, 0, wtX + 24, 0);
    wtGrad.addColorStop(0, lerpColor('#6a4a34', '#a87c58', t));
    wtGrad.addColorStop(1, lerpColor('#46301f', '#7a5638', t));
    ctx.fillStyle = wtGrad;
    ctx.fillRect(wtX, top - 40, 24, 18);
    ctx.strokeStyle = 'rgba(30,20,12,0.5)';
    ctx.lineWidth = 1;
    for (let b = 1; b < 4; b++) {
        ctx.beginPath();
        ctx.moveTo(wtX, top - 40 + b * 4.5);
        ctx.lineTo(wtX + 24, top - 40 + b * 4.5);
        ctx.stroke();
    }
    ctx.fillStyle = lerpColor('#3c2a1c', '#6a4c32', t);
    ctx.beginPath();
    ctx.moveTo(wtX - 2, top - 40);
    ctx.lineTo(wtX + 12, top - 48);
    ctx.lineTo(wtX + 26, top - 40);
    ctx.closePath();
    ctx.fill();

    // HVAC unit
    const hvX = W * 0.55;
    ctx.fillStyle = lerpColor('#55555f', '#9a9aa4', t);
    ctx.fillRect(hvX, top - 19, 30, 10);
    ctx.fillStyle = 'rgba(20,20,26,0.5)';
    for (let v = 0; v < 5; v++) ctx.fillRect(hvX + 3 + v * 5.4, top - 17, 3, 6);

    // antenna with blinking beacon
    const anX = W * 0.82;
    ctx.strokeStyle = lerpColor('#4a4a54', '#8a8a94', t);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(anX, top - 9); ctx.lineTo(anX, top - 46);
    ctx.moveTo(anX - 6, top - 22); ctx.lineTo(anX + 6, top - 22);
    ctx.moveTo(anX - 4, top - 33); ctx.lineTo(anX + 4, top - 33);
    ctx.stroke();
    const blink = (Math.sin(performance.now() * 0.004) + 1) / 2;
    ctx.fillStyle = `rgba(255,60,60,${0.35 + blink * 0.65})`;
    ctx.beginPath(); ctx.arc(anX, top - 48, 2.2, 0, Math.PI * 2); ctx.fill();
    if (blink > 0.6) {
        ctx.fillStyle = `rgba(255,60,60,${(blink - 0.6) * 0.4})`;
        ctx.beginPath(); ctx.arc(anX, top - 48, 6, 0, Math.PI * 2); ctx.fill();
    }
}

// ─── Floor rendering ───

function drawFloor(ctx, state, floor, daylight) {
    const grid = state.grid;
    const fy = worldY(floor);
    const W = grid.width * CELL_W;
    const t = daylight;

    // empty floor interior: bare concrete with studwork hints
    ctx.fillStyle = floor < 0
        ? lerpColor('#16161c', '#22222a', t)
        : lerpColor('#1c1c24', '#2e2e38', t);
    ctx.fillRect(0, fy, W, CELL_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += CELL_W * 2) {
        ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(x, fy + CELL_H); ctx.stroke();
    }

    const seen = new Set();
    for (let x = 0; x < grid.width; x++) {
        const roomId = grid.cells[floorToIdx(grid, floor)][x];
        if (roomId === null || seen.has(roomId)) continue;
        seen.add(roomId);
        const room = state.roomsById.get(roomId);
        if (!room) continue;
        drawRoom(ctx, room, daylight, state);
    }

    // concrete floor slab
    ctx.fillStyle = lerpColor('#35353f', '#5e5e6a', t);
    ctx.fillRect(0, fy + CELL_H - 2.5, W, 2.5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, fy + CELL_H - 3.2, W, 0.8);
}

// ─── Room sprite system ───
// Each room interior is painted once per (type,width,variant) at 3× supersample.

const _roomSprites = new Map();
const RSS = 3; // supersample

function getRoomSprite(type, widthCells, variant, extra) {
    const key = `${type}:${widthCells}:${variant}:${extra || 0}`;
    let spr = _roomSprites.get(key);
    if (spr) return spr;
    const w = widthCells * CELL_W;
    const h = CELL_H;
    const c = document.createElement('canvas');
    c.width = w * RSS; c.height = h * RSS;
    const g = c.getContext('2d');
    g.scale(RSS, RSS);
    paintRoomSprite(g, type, w, h, variant, extra || 0);
    spr = { c, w, h };
    _roomSprites.set(key, spr);
    return spr;
}

// shared furniture helpers — 1px-granularity pixel art with outline + highlight
function oRect(g, x, y, w, h, fill) {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(18,14,10,0.55)';
    g.lineWidth = 0.6;
    g.strokeRect(x + 0.3, y + 0.3, w - 0.6, h - 0.6);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(x + 0.6, y + 0.6, w - 1.2, 1);
}

function wallPaper(g, w, h, c1, c2, style) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    if (style === 'stripes') {
        g.fillStyle = 'rgba(255,255,255,0.045)';
        for (let x = 3; x < w; x += 9) g.fillRect(x, 2, 3.5, h - 8);
    } else if (style === 'tiles') {
        g.strokeStyle = 'rgba(0,0,0,0.10)';
        g.lineWidth = 0.5;
        for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        for (let y = 0; y < h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    } else if (style === 'panel') {
        g.fillStyle = 'rgba(0,0,0,0.10)';
        g.fillRect(0, h * 0.42, w, 1.2);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(0, h * 0.42 + 1.2, w, 1);
    }
    // ceiling shadow + corner AO
    const ao = g.createLinearGradient(0, 0, 0, 7);
    ao.addColorStop(0, 'rgba(0,0,0,0.38)');
    ao.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ao;
    g.fillRect(0, 0, w, 7);
    const aoL = g.createLinearGradient(0, 0, 6, 0);
    aoL.addColorStop(0, 'rgba(0,0,0,0.28)');
    aoL.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = aoL;
    g.fillRect(0, 0, 6, h);
    const aoR = g.createLinearGradient(w, 0, w - 6, 0);
    aoR.addColorStop(0, 'rgba(0,0,0,0.28)');
    aoR.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = aoR;
    g.fillRect(w - 6, 0, 6, h);
}

function floorStrip(g, w, h, c1, c2, style) {
    const fh = 6;
    const grad = g.createLinearGradient(0, h - fh, 0, h);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, h - fh, w, fh);
    if (style === 'boards') {
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = 0.5;
        for (let x = 4; x < w; x += 11) { g.beginPath(); g.moveTo(x, h - fh); g.lineTo(x - 2, h); g.stroke(); }
    } else if (style === 'checker') {
        for (let x = 0; x < w; x += 5) {
            if (((x / 5) | 0) % 2) continue;
            g.fillStyle = 'rgba(255,255,255,0.10)';
            g.fillRect(x, h - fh, 5, fh);
        }
    }
    // baseboard
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.fillRect(0, h - fh - 1.4, w, 1.4);
}

function winView(g, x, y, w, h, lit) {
    // sees the outside sky
    const grad = g.createLinearGradient(0, y, 0, y + h);
    if (lit) { grad.addColorStop(0, '#8fc4ec'); grad.addColorStop(1, '#c8e4f4'); }
    else { grad.addColorStop(0, '#0e1838'); grad.addColorStop(1, '#1c2c50'); }
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    if (!lit) { // city lights outside
        g.fillStyle = 'rgba(255,214,120,0.8)';
        for (let i = 0; i < Math.max(2, w / 4); i++) {
            if (hash(x + i, y) > 0.5) g.fillRect(x + 1 + hash(i, x) * (w - 3), y + h * 0.5 + hash(i, y) * h * 0.4, 1.2, 1.2);
        }
    } else {
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.15, y + h); g.lineTo(x, y + h * 0.8);
        g.closePath(); g.fill();
    }
    g.strokeStyle = '#5a5246';
    g.lineWidth = 1.1;
    g.strokeRect(x, y, w, h);
    g.beginPath();
    g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h);
    g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2);
    g.lineWidth = 0.7;
    g.stroke();
    // sill
    g.fillStyle = '#cfc8b8';
    g.fillRect(x - 1, y + h, w + 2, 1.6);
}

function plantPot(g, x, y, big) {
    const s = big ? 1.3 : 1;
    g.fillStyle = '#9a5e38';
    g.fillRect(x - 3 * s, y - 4 * s, 6 * s, 4 * s);
    g.fillStyle = '#7c4a2a';
    g.fillRect(x - 3.6 * s, y - 4.6 * s, 7.2 * s, 1.6 * s);
    g.fillStyle = '#2e6a2c';
    g.beginPath(); g.arc(x - 1.5 * s, y - 7 * s, 2.6 * s, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + 1.7 * s, y - 8 * s, 2.9 * s, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#489440';
    g.beginPath(); g.arc(x, y - 9.5 * s, 2.4 * s, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6ab858';
    g.beginPath(); g.arc(x - 1, y - 10.2 * s, 1.2 * s, 0, Math.PI * 2); g.fill();
}

function tableLamp(g, x, y, on) {
    g.fillStyle = '#6a5a48';
    g.fillRect(x - 0.8, y - 5, 1.6, 5);
    g.fillStyle = on ? '#ffd860' : '#8a7a5e';
    g.beginPath();
    g.moveTo(x - 3.2, y - 5); g.lineTo(x + 3.2, y - 5); g.lineTo(x + 2.2, y - 9); g.lineTo(x - 2.2, y - 9);
    g.closePath(); g.fill();
    if (on) {
        const lg = g.createRadialGradient(x, y - 6, 0, x, y - 6, 11);
        lg.addColorStop(0, 'rgba(255,216,112,0.30)');
        lg.addColorStop(1, 'rgba(255,216,112,0)');
        g.fillStyle = lg;
        g.fillRect(x - 11, y - 17, 22, 22);
    }
}

function pictureFrame(g, x, y) {
    oRect(g, x, y, 7, 5.5, '#7a6448');
    g.fillStyle = ['#7c9cc4', '#b48a6a', '#86a47c'][((x * 7) | 0) % 3];
    g.fillRect(x + 1, y + 1, 5, 3.5);
}

function ceilingLight(g, x, y, on) {
    g.fillStyle = '#3c3c44';
    g.fillRect(x - 4, y, 8, 1.6);
    g.fillStyle = on ? '#fff2c0' : '#777770';
    g.fillRect(x - 3, y + 1.6, 6, 1.8);
    if (on) {
        const lg = g.createLinearGradient(0, y, 0, y + 26);
        lg.addColorStop(0, 'rgba(255,240,190,0.16)');
        lg.addColorStop(1, 'rgba(255,240,190,0)');
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(x - 3, y + 3); g.lineTo(x + 3, y + 3); g.lineTo(x + 12, y + 28); g.lineTo(x - 12, y + 28);
        g.closePath(); g.fill();
    }
}

// ─── Room painters ───

function paintRoomSprite(g, type, w, h, variant, extra) {
    const lit = variant === 'on';
    switch (type) {
        case 'lobby': {
            wallPaper(g, w, h, '#b8a47e', '#9a8662', 'panel');
            floorStrip(g, w, h, '#cfc4ae', '#a89a80', 'checker');
            // marble columns every ~7 cells
            for (let x = 36; x < w - 30; x += 130) {
                const cg = g.createLinearGradient(x, 0, x + 9, 0);
                cg.addColorStop(0, '#d8d0c0'); cg.addColorStop(0.5, '#b8ae9a'); cg.addColorStop(1, '#8e8470');
                g.fillStyle = cg;
                g.fillRect(x, 4, 9, h - 10);
                g.fillStyle = '#cabfa9';
                g.fillRect(x - 1.6, 3, 12.2, 3);
                g.fillRect(x - 1.6, h - 9, 12.2, 3);
            }
            // red carpet to the doors
            const cx = w / 2;
            g.fillStyle = '#8e2e34';
            g.beginPath();
            g.moveTo(cx - 16, h - 6.5); g.lineTo(cx + 16, h - 6.5);
            g.lineTo(cx + 22, h); g.lineTo(cx - 22, h);
            g.closePath(); g.fill();
            g.fillStyle = 'rgba(255,220,160,0.4)';
            g.fillRect(cx - 17, h - 6.5, 34, 1);
            // double glass doors with brass frames
            for (const dx of [-13, 1]) {
                g.fillStyle = '#caa84e';
                g.fillRect(cx + dx, 9, 12, h - 15);
                const dg = g.createLinearGradient(cx + dx, 9, cx + dx + 12, h - 8);
                dg.addColorStop(0, lit ? '#bcd8ec' : '#28384e');
                dg.addColorStop(1, lit ? '#7ea8c8' : '#16243a');
                g.fillStyle = dg;
                g.fillRect(cx + dx + 1.4, 10.4, 9.2, h - 17.8);
                g.fillStyle = '#caa84e';
                g.fillRect(cx + dx + 1.4, 9 + (h - 15) / 2, 9.2, 1);
                g.fillStyle = '#8a6c2e';
                g.fillRect(cx + dx + (dx < 0 ? 8.6 : 2.4), 9 + (h - 15) / 2 + 3, 1.4, 4);
            }
            // reception desk
            oRect(g, 12, h - 19, 26, 13, '#7a5a38');
            g.fillStyle = '#9a7a52';
            g.fillRect(11, h - 21, 28, 3.4);
            g.fillStyle = '#e8d8a0';
            g.fillRect(20, h - 24, 4, 3); // bell/lamp
            // sofa
            if (w > 260) {
                oRect(g, w - 62, h - 15, 30, 9, '#6e3a44');
                g.fillStyle = '#844852';
                g.fillRect(w - 62, h - 19, 30, 4.4);
                g.fillRect(w - 65, h - 17, 4, 11);
                g.fillRect(w - 31, h - 17, 4, 11);
            }
            plantPot(g, 52, h - 6, true);
            plantPot(g, w - 14, h - 6, true);
            for (let x = 80; x < w - 60; x += 130) ceilingLight(g, x, 0, true);
            break;
        }

        case 'condo': {
            wallPaper(g, w, h, lit ? '#a89478' : '#5c5246', lit ? '#8e7a60' : '#463e36', 'stripes');
            floorStrip(g, w, h, lit ? '#8a6844' : '#54402c', lit ? '#6e5234' : '#3e3022', 'boards');
            // window with curtains
            winView(g, w - 19, 9, 13, 19, lit);
            g.fillStyle = '#7c4a4a';
            g.fillRect(w - 21.5, 7.5, 3.4, 22);
            g.fillRect(w - 7.5, 7.5, 3.4, 22);
            g.fillStyle = '#5e3838';
            g.fillRect(w - 22.5, 7, 19.5, 2);
            // bed
            oRect(g, 5, h - 17, 22, 11, '#e2d8c8');
            g.fillStyle = '#b46a5a';
            g.fillRect(5, h - 12.6, 22, 6.6);
            g.fillStyle = 'rgba(0,0,0,0.18)';
            g.fillRect(5, h - 12.6, 22, 1);
            g.fillStyle = '#f4ece0';
            g.fillRect(6.4, h - 16, 6, 3.6);
            g.fillStyle = '#6e4a30';
            g.fillRect(3.4, h - 20, 2.4, 14);
            // nightstand + lamp
            oRect(g, 30, h - 12.5, 8, 6.5, '#6e5238');
            tableLamp(g, 34, h - 12.5, lit && extra === 1);
            // dresser + TV
            if (w > 60) {
                oRect(g, 42, h - 13.5, 13, 7.5, '#7a5c3e');
                g.fillStyle = '#22262e';
                g.fillRect(43.6, h - 21, 9.8, 6.6);
                g.fillStyle = lit ? '#4a7ab8' : '#161a22';
                g.fillRect(44.4, h - 20.3, 8.2, 5.2);
            }
            pictureFrame(g, 12, 11);
            // rug
            g.fillStyle = '#8e5a6a';
            g.beginPath(); g.ellipse(36, h - 4.4, 9, 2, 0, 0, Math.PI * 2); g.fill();
            break;
        }

        case 'shop': {
            wallPaper(g, w, h, lit ? '#9aa89a' : '#4e564e', lit ? '#7e8c7e' : '#3a423a', 'tiles');
            floorStrip(g, w, h, lit ? '#b8b4a8' : '#6a665c', lit ? '#9a968a' : '#504c44', 'checker');
            // awning band
            for (let x = 0; x < w; x += 8) {
                g.fillStyle = (x / 8) % 2 ? '#b84a42' : '#e8e0d0';
                g.fillRect(x, 4, 8, 5);
            }
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(0, 9, w, 1.2);
            // shelf racks with stocked goods
            for (let sx = 5; sx < w - 18; sx += 16) {
                oRect(g, sx, 14, 11, h - 22, '#6e5640');
                for (let sy = 16.5; sy < h - 12; sy += 6.5) {
                    g.fillStyle = 'rgba(0,0,0,0.3)';
                    g.fillRect(sx + 1, sy + 4.4, 9, 1);
                    const items = ['#c45a4e', '#5a82c4', '#cfc25a', '#5ac482', '#a86ac4'];
                    for (let it = 0; it < 3; it++) {
                        g.fillStyle = items[(sx + it + ((sy * 2) | 0)) % items.length];
                        g.fillRect(sx + 1.4 + it * 3.1, sy, 2.4, 4.2);
                    }
                }
            }
            // counter + register
            oRect(g, w - 16, h - 16, 13, 10, '#7a5e40');
            g.fillStyle = '#3c424c';
            g.fillRect(w - 13.4, h - 21.4, 6.4, 5.4);
            g.fillStyle = lit ? '#62d472' : '#26342a';
            g.fillRect(w - 12.4, h - 20.4, 4.4, 2.2);
            ceilingLight(g, w / 2, 9.5, lit);
            break;
        }

        case 'office': {
            wallPaper(g, w, h, lit ? '#8e9aa8' : '#4a525c', lit ? '#76828e' : '#3a424a', 'panel');
            floorStrip(g, w, h, lit ? '#5e6a7a' : '#3c4450', lit ? '#4c5866' : '#303844', null);
            // pinboard + clock
            oRect(g, 8, 9, 12, 8, '#8a7a5a');
            g.fillStyle = '#d8d0c0'; g.fillRect(9.5, 10.5, 3.5, 2.4);
            g.fillStyle = '#b8d0e0'; g.fillRect(14, 11.5, 3.5, 2.4);
            g.fillStyle = '#e8e2d6';
            g.beginPath(); g.arc(w / 2, 11, 3.4, 0, Math.PI * 2); g.fill();
            g.strokeStyle = '#3a3a40'; g.lineWidth = 0.7;
            g.beginPath(); g.moveTo(w / 2, 11); g.lineTo(w / 2, 8.6); g.moveTo(w / 2, 11); g.lineTo(w / 2 + 2, 11.6); g.stroke();
            // desks
            const deskCount = Math.max(2, Math.floor(w / 30));
            for (let d = 0; d < deskCount; d++) {
                const dx = 7 + d * (w - 22) / Math.max(1, deskCount - 1);
                // chair
                oRect(g, dx + 3.4, h - 14.5, 7, 2.4, '#34425c');
                g.fillStyle = '#2c3850';
                g.fillRect(dx + 5.8, h - 12, 2.2, 5);
                g.fillRect(dx + 2.8, h - 20, 2.2, 7.4);
                // desk
                oRect(g, dx, h - 17, 15, 2.6, '#8a6c48');
                g.fillStyle = '#6e5438';
                g.fillRect(dx + 1, h - 14.4, 1.8, 8.4);
                g.fillRect(dx + 12.2, h - 14.4, 1.8, 8.4);
                // monitor
                g.fillStyle = '#23272f';
                g.fillRect(dx + 4, h - 25.4, 8.4, 6.8);
                g.fillStyle = lit ? '#5a8ad8' : '#141820';
                g.fillRect(dx + 4.8, h - 24.6, 6.8, 5.2);
                if (lit) {
                    g.fillStyle = '#aacdf4';
                    g.fillRect(dx + 5.6, h - 23.6, 4, 0.9);
                    g.fillRect(dx + 5.6, h - 22, 3, 0.9);
                    g.fillRect(dx + 5.6, h - 20.4, 4.6, 0.9);
                }
                g.fillStyle = '#2e323a';
                g.fillRect(dx + 7.4, h - 18.6, 1.6, 1.8);
            }
            // water cooler
            g.fillStyle = '#9aa6b2';
            g.fillRect(w - 10, h - 21, 6, 15);
            g.fillStyle = '#7ec0e8';
            g.fillRect(w - 9, h - 26, 4, 5);
            ceilingLight(g, w * 0.3, 0, lit);
            ceilingLight(g, w * 0.7, 0, lit);
            break;
        }

        case 'restaurant': {
            wallPaper(g, w, h, lit ? '#8e5648' : '#4c3430', lit ? '#74443a' : '#3a2824', 'panel');
            floorStrip(g, w, h, lit ? '#8a5e36' : '#54381e', lit ? '#6e4828' : '#402c18', 'boards');
            // kitchen pass
            oRect(g, 5, 10, 20, 12, '#5e4632');
            g.fillStyle = lit ? '#caa05e' : '#6a4e34';
            g.fillRect(6.5, 11.5, 17, 9);
            g.fillStyle = '#3c2e22';
            g.fillRect(6.5, 16.5, 17, 1);
            // pots
            g.fillStyle = '#9aa0a8';
            g.fillRect(8.5, 13.6, 4, 3); g.fillRect(14.5, 13, 5, 3.6);
            // menu board
            oRect(g, w - 17, 9, 12, 13, '#2c241c');
            g.fillStyle = '#e8d8a8';
            g.fillRect(w - 15, 11.5, 6, 1); g.fillRect(w - 15, 14.5, 8, 1); g.fillRect(w - 15, 17.5, 5, 1);
            // tables with cloth, candles, chairs
            const tcount = Math.max(2, Math.floor(w / 38));
            for (let tb = 0; tb < tcount; tb++) {
                const tx = 13 + tb * (w - 30) / Math.max(1, tcount - 1);
                g.fillStyle = '#e8e2d2';
                g.beginPath();
                g.moveTo(tx - 8, h - 19); g.lineTo(tx + 8, h - 19); g.lineTo(tx + 6.4, h - 12.5); g.lineTo(tx - 6.4, h - 12.5);
                g.closePath(); g.fill();
                g.strokeStyle = 'rgba(20,14,8,0.4)'; g.lineWidth = 0.6;
                g.stroke();
                g.fillStyle = '#5e442c';
                g.fillRect(tx - 1.2, h - 12.5, 2.4, 7);
                // plates + candle
                g.fillStyle = '#f4f0e4';
                g.beginPath(); g.ellipse(tx - 4.2, h - 19.8, 2, 0.9, 0, 0, Math.PI * 2); g.fill();
                g.beginPath(); g.ellipse(tx + 4.2, h - 19.8, 2, 0.9, 0, 0, Math.PI * 2); g.fill();
                g.fillStyle = '#d8d0b8';
                g.fillRect(tx - 0.7, h - 22.4, 1.4, 2.8);
                // chairs
                oRect(g, tx - 13, h - 17.4, 4, 9, '#6a4434');
                oRect(g, tx + 9, h - 17.4, 4, 9, '#6a4434');
            }
            // pendant lamps
            for (let pl = 0; pl < tcount; pl++) {
                const tx = 13 + pl * (w - 30) / Math.max(1, tcount - 1);
                g.strokeStyle = '#2c2018'; g.lineWidth = 0.7;
                g.beginPath(); g.moveTo(tx, 0); g.lineTo(tx, 6.5); g.stroke();
                g.fillStyle = lit ? '#ffca5e' : '#7a6444';
                g.beginPath();
                g.moveTo(tx - 3, 9); g.lineTo(tx + 3, 9); g.lineTo(tx + 1.6, 6); g.lineTo(tx - 1.6, 6);
                g.closePath(); g.fill();
                if (lit) {
                    const lg = g.createRadialGradient(tx, 10, 0, tx, 10, 14);
                    lg.addColorStop(0, 'rgba(255,200,94,0.30)');
                    lg.addColorStop(1, 'rgba(255,200,94,0)');
                    g.fillStyle = lg;
                    g.fillRect(tx - 14, 0, 28, 26);
                }
            }
            break;
        }

        case 'hotel': {
            wallPaper(g, w, h, lit ? '#8a8a6e' : '#4a4a3e', lit ? '#727258' : '#3a3a30', 'stripes');
            floorStrip(g, w, h, lit ? '#7c5e46' : '#4c3a2c', lit ? '#624a36' : '#3a2c20', null);
            // door with indicator
            oRect(g, 2, 9, 8, h - 17, '#5e442e');
            g.fillStyle = '#caa84e';
            g.fillRect(8, h / 2, 1.4, 3);
            g.fillStyle = extra === 1 ? '#e05050' : '#52d452';
            g.fillRect(3.4, 11, 2.8, 2);
            // bed with fancy duvet
            oRect(g, 14, h - 17, 20, 11, '#ece4d4');
            g.fillStyle = '#4e7a64';
            g.fillRect(14, h - 12.8, 20, 6.8);
            g.fillStyle = 'rgba(255,255,255,0.25)';
            g.fillRect(14, h - 12.8, 20, 1.1);
            g.fillStyle = '#f6f0e2';
            g.fillRect(15.4, h - 16, 5.4, 3.4);
            g.fillStyle = '#6e4a30';
            g.fillRect(12.2, h - 20, 2.2, 14);
            // nightstand + lamp
            oRect(g, 36, h - 12.4, 7, 6.4, '#6e5238');
            tableLamp(g, 39.4, h - 12.4, lit && extra === 1);
            pictureFrame(g, 22, 10);
            // small window
            if (w > 44) winView(g, w - 11, 10, 8, 12, lit);
            break;
        }

        case 'sky_lobby': {
            wallPaper(g, w, h, '#76828a', '#5a666e', null);
            floorStrip(g, w, h, '#9aa8a0', '#7c8a82', 'checker');
            // floor-to-ceiling glass curtain wall
            for (let x = 8; x < w - 20; x += 30) {
                winView(g, x, 7, 22, h - 17, lit);
            }
            // benches + planters
            for (let x = 22; x < w - 30; x += 95) {
                oRect(g, x, h - 12.4, 18, 3, '#6e5a40');
                g.fillStyle = '#54442e';
                g.fillRect(x + 1.4, h - 9.4, 2, 3.6);
                g.fillRect(x + 14.6, h - 9.4, 2, 3.6);
                plantPot(g, x + 26, h - 6, true);
            }
            // directory sign
            const cx = w / 2;
            oRect(g, cx - 9, 9, 18, 11, '#2e3a32');
            g.fillStyle = '#8ee29a';
            g.fillRect(cx - 6.4, 11.5, 5, 1); g.fillRect(cx - 6.4, 14, 7, 1); g.fillRect(cx - 6.4, 16.5, 4, 1);
            break;
        }

        case 'gym': {
            wallPaper(g, w, h, lit ? '#7a8a96' : '#424a52', lit ? '#62727e' : '#343c44', null);
            floorStrip(g, w, h, lit ? '#5e4a3a' : '#3c3026', lit ? '#4a3a2e' : '#2e251e', null);
            // mirror wall
            const mg = g.createLinearGradient(0, 8, 0, 20);
            mg.addColorStop(0, lit ? '#aac4d8' : '#3c4c5c');
            mg.addColorStop(1, lit ? '#7c9ab4' : '#2a3848');
            g.fillStyle = mg;
            g.fillRect(4, 8, w - 8, 12);
            g.strokeStyle = '#5a626a'; g.lineWidth = 1;
            g.strokeRect(4, 8, w - 8, 12);
            g.fillStyle = 'rgba(255,255,255,0.25)';
            g.beginPath();
            g.moveTo(10, 8); g.lineTo(18, 8); g.lineTo(8, 20); g.lineTo(4, 20);
            g.closePath(); g.fill();
            // treadmill
            g.fillStyle = '#3a3e46';
            g.beginPath();
            g.moveTo(6, h - 8); g.lineTo(22, h - 8); g.lineTo(20, h - 11); g.lineTo(8, h - 11);
            g.closePath(); g.fill();
            g.fillStyle = '#272b33';
            g.fillRect(7, h - 10.4, 13.4, 1.4);
            g.fillStyle = '#4c525c';
            g.fillRect(18.4, h - 22, 1.8, 12);
            g.fillRect(14.4, h - 21, 6, 1.6);
            g.fillStyle = lit ? '#6ad0e8' : '#2c3a44';
            g.fillRect(17.6, h - 24, 4.4, 2.8);
            // dumbbell rack
            const rx = w / 2 - 2;
            oRect(g, rx, h - 18, 13, 12, '#3c4048');
            for (let dy2 = 0; dy2 < 3; dy2++) {
                g.fillStyle = ['#6a7078', '#7c828a', '#585e66'][dy2];
                g.fillRect(rx + 1.4, h - 16 + dy2 * 4, 10.2, 2.4);
                g.fillStyle = '#23272d';
                g.fillRect(rx + 2.4, h - 16 + dy2 * 4, 1.6, 2.4);
                g.fillRect(rx + 8.8, h - 16 + dy2 * 4, 1.6, 2.4);
            }
            // bench press
            if (w > 56) {
                const bx = w - 22;
                oRect(g, bx, h - 12, 16, 4, '#5e4634');
                g.fillStyle = '#7c828a';
                g.fillRect(bx + 1.6, h - 17, 1.8, 5.4);
                g.fillRect(bx + 12.6, h - 17, 1.8, 5.4);
                g.fillStyle = '#9aa0a8';
                g.fillRect(bx - 2, h - 17.8, 20, 1.6);
                g.fillStyle = '#3c4048';
                g.fillRect(bx - 3.4, h - 19.4, 2.8, 4.8);
                g.fillRect(bx + 16.6, h - 19.4, 2.8, 4.8);
            }
            // rolled mats
            g.fillStyle = '#7a5acc';
            g.beginPath(); g.arc(w - 30, h - 8.4, 2.6, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#5a48a8';
            g.beginPath(); g.arc(w - 30, h - 8.4, 1.2, 0, Math.PI * 2); g.fill();
            break;
        }

        case 'cinema': {
            wallPaper(g, w, h, '#2c2434', '#1e1826', null);
            floorStrip(g, w, h, '#241e2c', '#181420', null);
            // screen with curtains
            g.fillStyle = '#0c0a12';
            g.fillRect(8, 5, w - 16, 16);
            if (lit) { // showtime — frame drawn live for flicker, keep a base image
                g.fillStyle = '#34506e';
                g.fillRect(10, 6.5, w - 20, 13);
            } else {
                g.fillStyle = '#5e2630';
                g.fillRect(10, 6.5, w - 20, 13);
                g.fillStyle = 'rgba(0,0,0,0.35)';
                for (let cxx = 12; cxx < w - 12; cxx += 5) g.fillRect(cxx, 6.5, 1.6, 13);
            }
            // curtain sides always
            for (const sx of [4, w - 10]) {
                g.fillStyle = '#6e2a34';
                g.fillRect(sx, 4, 6, 19);
                g.fillStyle = 'rgba(0,0,0,0.3)';
                g.fillRect(sx + 1.8, 4, 1.2, 19);
                g.fillRect(sx + 4.4, 4, 1, 19);
            }
            // tiered seating
            for (let r = 0; r < 3; r++) {
                const ry = 26 + r * 7;
                const indent = (2 - r) * 5;
                for (let sx = indent + 6; sx < w - indent - 8; sx += 7.4) {
                    g.fillStyle = lit ? '#3c2630' : '#50303c';
                    g.fillRect(sx, ry + 2.4, 5.4, 4);
                    g.fillStyle = lit ? '#4a2e3a' : '#643c4a';
                    g.fillRect(sx, ry, 5.4, 2.6);
                    g.fillStyle = 'rgba(0,0,0,0.4)';
                    g.fillRect(sx, ry + 6, 5.4, 0.8);
                }
                // row step
                g.fillStyle = 'rgba(255,255,255,0.05)';
                g.fillRect(indent + 4, ry + 7, w - indent * 2 - 8, 0.8);
            }
            // aisle lights
            g.fillStyle = '#caa84e';
            for (let r = 0; r < 3; r++) {
                g.fillRect(8 + (2 - r) * 5 - 2, 28 + r * 7 + 4, 1.2, 1.2);
                g.fillRect(w - 8 - (2 - r) * 5 + 1, 28 + r * 7 + 4, 1.2, 1.2);
            }
            // exit sign
            g.fillStyle = '#1c3a24';
            g.fillRect(w - 15, 2, 11, 5);
            g.fillStyle = '#5ae87a';
            g.fillRect(w - 13.6, 3.4, 8.2, 2.2);
            break;
        }

        case 'medical': {
            wallPaper(g, w, h, lit ? '#c8d4dc' : '#5e6a72', lit ? '#aebec8' : '#4c5860', 'tiles');
            floorStrip(g, w, h, lit ? '#d4dce4' : '#6a7680', lit ? '#b4c2cc' : '#566270', 'checker');
            // cross sign
            const cx = w / 2;
            g.fillStyle = '#e05050';
            g.fillRect(cx - 1.6, 7, 3.2, 9);
            g.fillRect(cx - 4.6, 10, 9.2, 3.2);
            // reception
            oRect(g, 5, h - 16, 15, 10, '#e4ded4');
            g.fillStyle = '#2e323c';
            g.fillRect(8, h - 21.4, 6.4, 5.4);
            g.fillStyle = lit ? '#5a9ad8' : '#1c2430';
            g.fillRect(8.8, h - 20.6, 4.8, 3.8);
            // exam bed with curtain rail
            if (w > 52) {
                const bx = w - 26;
                g.strokeStyle = '#8a949c'; g.lineWidth = 1;
                g.beginPath(); g.moveTo(bx - 4, 9); g.lineTo(bx + 24, 9); g.stroke();
                g.fillStyle = lit ? '#bce0d4' : '#5a7a70';
                g.fillRect(bx - 3, 9.5, 8, 13);
                g.fillStyle = 'rgba(0,0,0,0.15)';
                for (let cf = 0; cf < 3; cf++) g.fillRect(bx - 2 + cf * 2.6, 9.5, 1, 13);
                oRect(g, bx + 2, h - 14, 20, 5, '#e8eef4');
                g.fillStyle = '#cdd8e0';
                g.fillRect(bx + 2, h - 16, 6, 2.4);
                g.fillStyle = '#8a949c';
                g.fillRect(bx + 4, h - 9, 2, 4);
                g.fillRect(bx + 17, h - 9, 2, 4);
            }
            // medicine cabinet
            oRect(g, 26, 9, 11, 13, '#e8e8ea');
            g.fillStyle = '#52c462'; g.fillRect(28, 12, 2.4, 3.4);
            g.fillStyle = '#d45252'; g.fillRect(31.6, 12, 2.4, 3.4);
            g.fillStyle = '#5278d4'; g.fillRect(28, 17, 2.4, 3.4);
            ceilingLight(g, w * 0.65, 0, lit);
            break;
        }

        case 'parking': {
            wallPaper(g, w, h, '#54565c', '#404248', null);
            floorStrip(g, w, h, '#5e6066', '#4a4c52', null);
            // concrete columns
            for (let x = 18; x < w - 10; x += 72) {
                const cg = g.createLinearGradient(x, 0, x + 7, 0);
                cg.addColorStop(0, '#74767c'); cg.addColorStop(1, '#54565c');
                g.fillStyle = cg;
                g.fillRect(x, 4, 7, h - 10);
                g.fillStyle = '#caa53e';
                g.fillRect(x, h - 18, 7, 3);
            }
            // parking bay lines
            for (let i = 0; i * 26 < w; i++) {
                g.fillStyle = '#b8b468';
                g.fillRect(i * 26, h - 14, 1.8, 9);
            }
            // strip lights
            for (let lx = 14; lx < w - 12; lx += 48) {
                g.fillStyle = '#3a3c42';
                g.fillRect(lx, 3, 16, 2);
                g.fillStyle = '#e2e8c4';
                g.fillRect(lx + 1.6, 5, 12.8, 1.6);
            }
            // parked cars from the per-room bitmask (extra)
            const carCols = ['#4a5aaa', '#aa4a4a', '#4a8a5a', '#b08a3e', '#7a4a8a', '#5a8a9a', '#c8c8cc'];
            const bays = Math.floor(w / 26);
            for (let i = 0; i < bays; i++) {
                if (!((extra >> (i % 8)) & 1)) continue;
                const cx2 = i * 26 + 4;
                const cy2 = h - 14;
                const col = carCols[(i + extra) % carCols.length];
                // body
                g.fillStyle = col;
                g.fillRect(cx2, cy2, 17, 6);
                g.fillStyle = 'rgba(255,255,255,0.2)';
                g.fillRect(cx2, cy2, 17, 1.2);
                // cabin
                g.fillStyle = col;
                g.fillRect(cx2 + 3.5, cy2 - 4, 10, 4.4);
                const wg = g.createLinearGradient(0, cy2 - 4, 0, cy2);
                wg.addColorStop(0, '#bcd4e8');
                wg.addColorStop(1, '#74a0c4');
                g.fillStyle = wg;
                g.fillRect(cx2 + 4.6, cy2 - 3.2, 3.4, 3);
                g.fillRect(cx2 + 9.2, cy2 - 3.2, 3.4, 3);
                g.strokeStyle = 'rgba(15,12,10,0.5)';
                g.lineWidth = 0.6;
                g.strokeRect(cx2 + 0.3, cy2 - 0.3, 16.4, 6);
                // wheels
                g.fillStyle = '#16161a';
                g.beginPath(); g.arc(cx2 + 4, cy2 + 6.4, 2.2, 0, Math.PI * 2); g.fill();
                g.beginPath(); g.arc(cx2 + 13, cy2 + 6.4, 2.2, 0, Math.PI * 2); g.fill();
                g.fillStyle = '#3c3c44';
                g.beginPath(); g.arc(cx2 + 4, cy2 + 6.4, 0.9, 0, Math.PI * 2); g.fill();
                g.beginPath(); g.arc(cx2 + 13, cy2 + 6.4, 0.9, 0, Math.PI * 2); g.fill();
                // ground shadow
                g.fillStyle = 'rgba(0,0,0,0.25)';
                g.fillRect(cx2 - 1, cy2 + 7.8, 19, 1.2);
            }
            // exit arrow sign
            g.fillStyle = '#1c4426';
            g.fillRect(4, 6, 16, 7);
            g.fillStyle = '#52d46a';
            g.fillRect(6.5, 8.8, 8, 1.6);
            g.beginPath();
            g.moveTo(14, 6.8); g.lineTo(17.4, 9.6); g.lineTo(14, 12.4);
            g.closePath(); g.fill();
            break;
        }

        default: {
            wallPaper(g, w, h, '#6a6a72', '#54545c', null);
            floorStrip(g, w, h, '#7a7a82', '#62626a', null);
        }
    }
}

// pick the active variant for a room right now
function roomVariant(room, hour) {
    switch (room.type) {
        case 'condo': {
            const isNight = hour < 7 || hour > 21;
            return { v: isNight ? (room.occupancy > 0 ? 'on' : 'off') : 'on', e: (isNight && room.occupancy > 0) ? 1 : 0 };
        }
        case 'office': return { v: (hour >= 8 && hour <= 18) ? 'on' : 'off', e: 0 };
        case 'shop': return { v: (hour >= 8 && hour <= 21) ? 'on' : 'off', e: 0 };
        case 'restaurant': return { v: ((hour >= 11 && hour <= 14) || (hour >= 18 && hour <= 21)) ? 'on' : 'off', e: 0 };
        case 'hotel': return { v: room.occupancy > 0 ? 'on' : 'off', e: room.occupancy > 0 ? 1 : 0 };
        case 'gym': return { v: (hour >= 6 && hour <= 22) ? 'on' : 'off', e: 0 };
        case 'cinema': return { v: ((hour >= 13 && hour <= 16) || (hour >= 18 && hour <= 23)) ? 'on' : 'off', e: 0 };
        case 'medical': return { v: (hour >= 8 && hour <= 18) ? 'on' : 'off', e: 0 };
        case 'parking': return { v: 'on', e: (room.x * 7 + Math.abs(room.floor) * 31 + 13) % 255 };
        default: return { v: 'on', e: 0 };
    }
}

function drawRoom(ctx, room, daylight, state) {
    const def = ROOM_TYPES[room.type];
    if (!def) return;
    if (room.type === 'elevator') return;

    const rx = room.x * CELL_W;
    const ry = worldY(room.floor);
    const rw = room.width * CELL_W;
    const hour = getHour(state.clock);
    const { v, e } = roomVariant(room, hour);

    const spr = getRoomSprite(room.type, room.width, v, e);
    ctx.drawImage(spr.c, rx, ry, rw, CELL_H);

    // night exterior dimming: closed rooms recede
    if (v === 'off' && daylight < 0.5) {
        ctx.fillStyle = `rgba(8,10,24,${(0.5 - daylight) * 0.5})`;
        ctx.fillRect(rx, ry, rw, CELL_H);
    }

    // live animated overlays
    drawRoomLive(ctx, room, rx, ry, rw, CELL_H, hour, v);

    // unit separator
    ctx.strokeStyle = 'rgba(12,10,8,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, CELL_H - 1);
}

function drawRoomLive(ctx, room, x, y, w, h, hour, v) {
    const now = performance.now();
    switch (room.type) {
        case 'cinema': {
            if (v === 'on') {
                const frame = ((now / 480) | 0) % 5;
                const colors = ['#3a5a8a', '#5a3a7a', '#4a6a5a', '#7a5a3a', '#356a78'];
                ctx.fillStyle = colors[frame];
                ctx.globalAlpha = 0.85;
                ctx.fillRect(x + 10, y + 6.5, w - 20, 13);
                ctx.globalAlpha = 0.12;
                ctx.fillStyle = '#cfe2ff';
                ctx.beginPath();
                ctx.moveTo(x + w / 2, y + h - 6);
                ctx.lineTo(x + 10, y + 6.5);
                ctx.lineTo(x + w - 10, y + 6.5);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            break;
        }
        case 'restaurant': {
            if (v === 'on') {
                // candle flames flicker
                const tcount = Math.max(2, Math.floor(w / 38));
                for (let tb = 0; tb < tcount; tb++) {
                    const tx = x + 13 + tb * (w - 30) / Math.max(1, tcount - 1);
                    const fl = Math.sin(now * 0.012 + tb * 2.4) * 0.6;
                    ctx.fillStyle = '#ffc84e';
                    ctx.fillRect(tx - 0.6 + fl * 0.4, y + h - 24.6, 1.2, 1.8);
                }
                // steam from the kitchen pass
                for (let s = 0; s < 3; s++) {
                    const sy = ((now * 0.012 + s * 9) % 16);
                    ctx.fillStyle = `rgba(220,220,225,${0.25 * (1 - sy / 16)})`;
                    ctx.fillRect(x + 9 + s * 4 + Math.sin(now * 0.003 + s) * 1.4, y + 12 - sy * 0.4, 1.8, 1.8);
                }
            }
            break;
        }
        case 'gym': {
            if (v === 'on') {
                const frame = ((now / 160) | 0) % 3;
                ctx.fillStyle = '#6a727e';
                ctx.fillRect(x + 8 + frame * 4, y + h - 10.2, 2.4, 1);
            }
            break;
        }
        case 'shop': {
            if (v === 'on') {
                const blink = ((now / 900) | 0) % 2;
                ctx.fillStyle = blink ? '#7ae28a' : '#52b462';
                ctx.fillRect(x + w - 24, y + 5.4, 6, 2.4);
            }
            break;
        }
        case 'office': {
            if (v === 'on' && ((now / 1100) | 0) % 4 === 0) {
                // occasional screen refresh shimmer on one monitor
                const deskCount = Math.max(2, Math.floor(w / 30));
                const d = ((now / 1100) | 0) % deskCount;
                const dx = x + 7 + d * (w - 22) / Math.max(1, deskCount - 1);
                ctx.fillStyle = 'rgba(170,205,244,0.25)';
                ctx.fillRect(dx + 4.8, y + h - 24.6, 6.8, 5.2);
            }
            break;
        }
    }
}

// ─── Stairs ───

function drawStairs(ctx, state, floor, daylight) {
    const grid = state.grid;
    const sx = (grid.width - STAIR_W) * CELL_W;
    const sy = worldY(floor);
    const sw = STAIR_W * CELL_W;
    const t = daylight;

    const cellCheck = grid.cells[floorToIdx(grid, floor)]?.[grid.width - 1];
    if (cellCheck !== null) return;

    // stairwell shaft
    const bg = ctx.createLinearGradient(sx, sy, sx + sw, sy);
    bg.addColorStop(0, lerpColor('#191920', '#2c2c34', t));
    bg.addColorStop(1, lerpColor('#121218', '#222228', t));
    ctx.fillStyle = bg;
    ctx.fillRect(sx, sy, sw, CELL_H);

    // zigzag flight
    const stepColor = lerpColor('#3e3e4c', '#6e6e7c', t);
    const stepH = 5;
    const steps = Math.floor(CELL_H / stepH);
    for (let s = 0; s < steps; s++) {
        const stepY = sy + s * stepH;
        const indent = (s / steps) * (sw * 0.62);
        ctx.fillStyle = stepColor;
        ctx.fillRect(sx + indent, stepY + stepH - 2, sw - indent - 2, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(sx + indent, stepY + stepH - 0.8, sw - indent - 2, 0.8);
    }
    // handrail
    ctx.strokeStyle = lerpColor('#6a6a78', '#a8a8b6', t);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sx + 3, sy + CELL_H - 4);
    ctx.lineTo(sx + sw - 6, sy + 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(110,110,124,0.5)';
    ctx.lineWidth = 0.8;
    for (let p = 0; p < 4; p++) {
        const pt = p / 3;
        const px2 = sx + 3 + (sw - 9) * pt;
        const py2 = sy + CELL_H - 4 - (CELL_H - 10) * pt;
        ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(px2, py2 + 6); ctx.stroke();
    }
    // EXIT sign
    ctx.fillStyle = '#1c3a24';
    ctx.fillRect(sx + 2, sy + 3, 10, 4.5);
    ctx.fillStyle = '#5ae87a';
    ctx.fillRect(sx + 3.2, sy + 4.2, 7.6, 2.1);
}

// ─── Elevators ───

function drawElevators(ctx, state, minFloor, maxFloor, daylight) {
    const t = daylight;

    for (const elev of state.elevators) {
        const ex = elev.x * CELL_W;
        let shaftTop = Infinity, shaftBottom = -Infinity;

        for (let f = minFloor; f < maxFloor; f++) {
            const fy = worldY(f);
            const cellId = state.grid.cells[floorToIdx(state.grid, f)]?.[elev.x];
            if (cellId === null || cellId === undefined) continue;
            const room = state.roomsById.get(cellId);
            if (!room || room.type !== 'elevator') continue;
            shaftTop = Math.min(shaftTop, fy);
            shaftBottom = Math.max(shaftBottom, fy + CELL_H);

            // shaft back panel
            const sg = ctx.createLinearGradient(ex, fy, ex + CELL_W, fy);
            sg.addColorStop(0, '#15151c');
            sg.addColorStop(0.5, '#23232c');
            sg.addColorStop(1, '#101016');
            ctx.fillStyle = sg;
            ctx.fillRect(ex + 1.5, fy, CELL_W - 3, CELL_H);
            // guide rails
            ctx.fillStyle = lerpColor('#3c3c4a', '#5c5c6c', t);
            ctx.fillRect(ex + 3.4, fy, 1.8, CELL_H);
            ctx.fillRect(ex + CELL_W - 5.2, fy, 1.8, CELL_H);
            // cross brace + floor marker
            ctx.strokeStyle = 'rgba(90,90,108,0.35)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(ex + 4, fy + 4); ctx.lineTo(ex + CELL_W - 4, fy + CELL_H - 4);
            ctx.stroke();
            ctx.fillStyle = 'rgba(180,180,200,0.25)';
            ctx.fillRect(ex + 1.5, fy + CELL_H - 1.4, CELL_W - 3, 1.4);
        }

        // cars with cables and lit interiors
        if (elev.cars) {
            for (const car of elev.cars) {
                const carY = worldY(0) - car.position * CELL_H;
                const carH = CELL_H - 9;
                // cable
                if (shaftTop < carY) {
                    ctx.strokeStyle = 'rgba(160,160,176,0.7)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(ex + CELL_W / 2 - 2, shaftTop);
                    ctx.lineTo(ex + CELL_W / 2 - 2, carY + 4);
                    ctx.moveTo(ex + CELL_W / 2 + 2, shaftTop);
                    ctx.lineTo(ex + CELL_W / 2 + 2, carY + 4);
                    ctx.stroke();
                }
                // car body
                const cg = ctx.createLinearGradient(ex + 5, 0, ex + CELL_W - 5, 0);
                cg.addColorStop(0, lerpColor('#7c7c8c', '#a8a8b8', t));
                cg.addColorStop(1, lerpColor('#54545f', '#7e7e8c', t));
                ctx.fillStyle = cg;
                ctx.fillRect(ex + 5, carY + 4, CELL_W - 10, carH);
                // lit interior visible through door crack
                ctx.fillStyle = 'rgba(255,236,170,0.85)';
                ctx.fillRect(ex + 7, carY + 7, CELL_W - 14, carH - 8);
                // passengers silhouettes
                const load = car.passengers ? car.passengers.length : 0;
                ctx.fillStyle = '#3c3640';
                for (let p2 = 0; p2 < Math.min(4, load); p2++) {
                    ctx.fillRect(ex + 8 + p2 * 3, carY + carH - 8, 2.2, 6);
                    ctx.beginPath();
                    ctx.arc(ex + 9.1 + p2 * 3, carY + carH - 9.2, 1.3, 0, Math.PI * 2);
                    ctx.fill();
                }
                // doors (closing toward centre)
                ctx.fillStyle = lerpColor('#62626e', '#8e8e9c', t);
                const doorW = (CELL_W - 14) / 2;
                ctx.fillRect(ex + 7, carY + 7, doorW * (car.doorOpen != null ? 1 - car.doorOpen : 0.5), carH - 8);
                ctx.fillRect(ex + CELL_W - 7 - doorW * (car.doorOpen != null ? 1 - car.doorOpen : 0.5), carY + 7, doorW * (car.doorOpen != null ? 1 - car.doorOpen : 0.5), carH - 8);
                // roof + floor indicator
                ctx.fillStyle = lerpColor('#46464f', '#6e6e7a', t);
                ctx.fillRect(ex + 5, carY + 2, CELL_W - 10, 3);
                ctx.fillStyle = '#e0512f';
                ctx.fillRect(ex + CELL_W / 2 - 3.4, carY + 2.4, 6.8, 2.2);
            }
        }

        // call dots
        if (elev.queue) {
            for (const stop of elev.queue) {
                const dotY = worldY(stop) + CELL_H / 2;
                ctx.fillStyle = '#e8584a';
                ctx.beginPath();
                ctx.arc(ex + CELL_W - 3, dotY, 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

// ─── People ───

function drawPeople(ctx, state, minFloor, maxFloor) {
    const animFrame = ((performance.now() / 260) | 0) % 2;

    for (const person of state.people) {
        if (person.state === 'in_room' || person.state === 'riding') continue;
        const pFloor = person.currentFloor;
        if (pFloor == null || pFloor < minFloor || pFloor >= maxFloor) continue;

        const pal = PERSON_PALETTES[person.id % PERSON_PALETTES.length];
        const px0 = person.currentX;
        const py0 = worldY(pFloor) + CELL_H - 3.4; // feet on slab

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.ellipse(px0 + 2, py0 + 0.6, 3, 1, 0, 0, Math.PI * 2);
        ctx.fill();

        const bob = (person.state === 'walking' && animFrame === 1) ? -0.6 : 0;
        // legs
        ctx.fillStyle = pal.pants;
        if (person.state === 'walking' && animFrame === 1) {
            ctx.fillRect(px0 + 0.2, py0 - 4, 1.6, 4);
            ctx.fillRect(px0 + 2.4, py0 - 4, 1.6, 3.2);
        } else {
            ctx.fillRect(px0 + 0.4, py0 - 4, 1.5, 4);
            ctx.fillRect(px0 + 2.2, py0 - 4, 1.5, 4);
        }
        // torso
        ctx.fillStyle = pal.shirt;
        ctx.fillRect(px0 - 0.2, py0 - 9 + bob, 4.6, 5.4);
        // arms
        ctx.fillStyle = darken(pal.shirt, 0.18);
        ctx.fillRect(px0 - 0.9, py0 - 8.6 + bob, 1.2, 4.4);
        ctx.fillRect(px0 + 3.9, py0 - 8.6 + bob, 1.2, 4.4);
        // head + hair
        ctx.fillStyle = pal.skin;
        ctx.fillRect(px0 + 0.6, py0 - 12.6 + bob, 3.2, 3.6);
        ctx.fillStyle = pal.hair;
        ctx.fillRect(px0 + 0.4, py0 - 13.4 + bob, 3.6, 1.8);
        // stress marker
        if ((person.stress || 0) > 60) {
            const pulse = (Math.sin(performance.now() * 0.012) + 1) / 2;
            ctx.fillStyle = `rgba(255,60,48,${0.5 + pulse * 0.5})`;
            ctx.beginPath();
            ctx.arc(px0 + 2.2, py0 - 16 + bob, 1.4, 0, Math.PI * 2);
            ctx.fill();
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
            if (noise <= 20) { r = 0; g = 200; b = 0; }
            else if (noise <= 50) { r = 230; g = 220; b = 0; }
            else if (noise <= 75) { r = 255; g = 120; b = 0; }
            else { r = 230; g = 30; b = 30; }
            const alpha = 0.1 + (noise / 100) * 0.3;

            const rx = room.x * CELL_W;
            const ry = worldY(room.floor);
            const rw = room.width * CELL_W;
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.fillRect(rx + 2, ry + 2, rw - 4, CELL_H - 4);

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

    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, gx + gw / 2, gy + gh / 2 + 3);
    ctx.textAlign = 'left';

    ctx.globalAlpha = 1;
}
