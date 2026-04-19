// main.js — Game state, loop, orchestration

import { createGrid, canPlace, placeRoom, removeRoom } from './grid.js';
import { ROOM_TYPES } from './rooms.js';
import { initRenderer, render } from './renderer.js';
import { initUI } from './ui.js';
import { createClock, tickClock } from './clock.js';
import { initEconomy, tickEconomy } from './economy.js';
import { tickPeople, spawnPeopleForRoom, recalculateNoise } from './people.js';
import { createElevator, tickElevators } from './elevator.js';
import { save, load } from './save.js';
import { initSound, updateSound } from './sound.js';

// Orchestration: when a room is placed, handle special cases
export function onRoomPlaced(state, room) {
    state.roomsById.set(room.id, room);
    if (room.type === 'elevator') {
        createElevator(state, room.id, room.x);
    }
    if (room.type === 'condo') {
        spawnPeopleForRoom(state, room);
    }
    recalculateNoise(state);
}

export function createGameState() {
    return {
        grid: createGrid(32, 50),
        rooms: [],
        roomsById: new Map(),
        people: [],
        elevators: [],
        economy: { funds: 100000, dailyRevenue: 0, dailyCosts: 0, day: 1 },
        clock: createClock(),
        gameTime: 0,
        stars: 1,
        camera: { x: 384, y: -100, zoom: 1 },
        ui: { selectedTool: null, buildMode: false, panel: null, showNoiseOverlay: false },
        nextId: 1
    };
}

let state = null;
let canvas, ctx;
let hidden = false;
const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;
let frameCounter = 0;

function init() {
    canvas = document.getElementById('tower-canvas');
    ctx = canvas.getContext('2d');
    state = load() || createGameState();
    if (state.rooms.length === 0) {
        const room = placeRoom(state, 'lobby', 0, 0);
        onRoomPlaced(state, room);
    }
    initRenderer(canvas, ctx, state);
    initUI(canvas, state);
    initSound();
    window.gameState = state;
    let lastTime = 0;
    function loop(timestamp) {
        if (hidden) { requestAnimationFrame(loop); return; }
        if (timestamp - lastTime >= FRAME_MS) {
            update(timestamp - lastTime);
            render(ctx, state);
            lastTime = timestamp;
        }
        requestAnimationFrame(loop);
    }
    document.addEventListener('visibilitychange', () => {
        hidden = document.hidden;
        if (!hidden) lastTime = performance.now();
    });
    requestAnimationFrame(loop);
    setInterval(() => save(state), 60000);
}

function update(dt) {
    if (state.clock.paused) return;
    tickClock(state, dt);
    state.gameTime += (dt / 1000) * state.clock.speed;
    tickPeople(state);
    tickElevators(state);
    tickEconomy(state);
    updateSound(state);
    frameCounter++;
    if (frameCounter % 900 === 0) {
        recalculateNoise(state);
    }
}

window.addEventListener('DOMContentLoaded', init);
