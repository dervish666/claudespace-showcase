// ui.js — Touch UI: build palette, placement, pan/zoom, info panels

import { ROOM_TYPES, ELEVATOR_TIERS } from './rooms.js';
import { canPlace, placeRoom, removeRoom, floorToIdx } from './grid.js';
import { onRoomPlaced } from './main.js';
import { CELL_W, CELL_H } from './renderer.js';
import { getTimeString } from './clock.js';
import { clearSave } from './save.js';
import { playEffect, toggleSound, isSoundEnabled } from './sound.js';

let _canvas, _state;
let _paletteEl, _panelEl;

// ─── Coordinate conversion ───

function screenToGrid(screenX, screenY) {
    const rect = _canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    const worldX = (x - _canvas.clientWidth / 2) / _state.camera.zoom + _state.camera.x;
    const worldY = (y - _canvas.clientHeight / 2) / _state.camera.zoom + _state.camera.y;
    const gridX = Math.floor(worldX / CELL_W);
    // Renderer draws floor N with top at worldY = -N * CELL_H, extending down by CELL_H.
    // Floor 0: worldY [0, CELL_H), Floor 1: worldY [-CELL_H, 0), etc.
    // So: floor = -Math.floor(worldY / CELL_H) for worldY <= 0, floor 0 for positive worldY in range.
    const floor = worldY >= CELL_H ? -1 : Math.max(0, -Math.floor(worldY / CELL_H));
    return { gridX, floor };
}

// ─── Format helpers ───

function formatMoney(amount) {
    if (amount < 0) return '-$' + Math.abs(amount).toLocaleString();
    return '$' + amount.toLocaleString();
}

function formatCost(cost) {
    if (cost >= 1000) return '$' + (cost / 1000) + 'k';
    return '$' + cost;
}

// ─── Build Palette ───

function populatePalette() {
    _paletteEl.innerHTML = '';
    for (const [key, def] of Object.entries(ROOM_TYPES)) {
        if (key === 'lobby') continue; // lobby is auto-placed, not buildable
        const btn = document.createElement('button');
        btn.className = 'palette-btn';
        btn.dataset.roomType = key;

        const locked = def.minStars > _state.stars;
        if (locked) btn.classList.add('locked');

        btn.innerHTML = `
            <span class="palette-swatch" style="background:${def.color}"></span>
            <span class="palette-info">
                <span class="palette-name">${def.name}</span>
                <span class="palette-cost">${formatCost(def.cost)}</span>
            </span>
            ${locked ? '<span class="palette-lock">' + def.minStars + '&#9733;</span>' : ''}
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (locked) return;
            toggleBuildTool(key);
        });

        // Prevent touch events from propagating to canvas
        btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

        _paletteEl.appendChild(btn);
    }
}

function toggleBuildTool(roomType) {
    if (_state.ui.selectedTool === roomType) {
        // Deselect
        _state.ui.selectedTool = null;
        _state.ui.buildMode = false;
        _state.ui.ghostPreview = null;
        hideBuildHint();
    } else {
        _state.ui.selectedTool = roomType;
        _state.ui.buildMode = true;
        _state.ui.ghostPreview = null;
        closePanel();
        showBuildHint(roomType);
    }
    updatePaletteHighlight();
}

function showBuildHint(roomType) {
    let hint = document.getElementById('build-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'build-hint';
        hint.style.cssText = `
            position:fixed;top:68px;left:50%;transform:translateX(-50%);
            background:rgba(233,69,96,0.9);color:white;padding:8px 16px;
            border-radius:20px;font-size:13px;font-weight:600;z-index:15;
            pointer-events:none;white-space:nowrap;
            animation:hintPulse 2s ease-in-out infinite;
        `;
        document.body.appendChild(hint);
        // Add animation
        if (!document.getElementById('hint-anim')) {
            const anim = document.createElement('style');
            anim.id = 'hint-anim';
            anim.textContent = '@keyframes hintPulse{0%,100%{opacity:0.9}50%{opacity:0.6}}';
            document.head.appendChild(anim);
        }
    }
    const def = ROOM_TYPES[roomType];
    hint.textContent = `Tap on the building to place ${def.name}`;
    hint.style.display = 'block';
}

function hideBuildHint() {
    const hint = document.getElementById('build-hint');
    if (hint) hint.style.display = 'none';
}

function updatePaletteHighlight() {
    const btns = _paletteEl.querySelectorAll('.palette-btn');
    for (const btn of btns) {
        btn.classList.toggle('selected', btn.dataset.roomType === _state.ui.selectedTool);
    }
}

function refreshPaletteLocks() {
    const btns = _paletteEl.querySelectorAll('.palette-btn');
    for (const btn of btns) {
        const key = btn.dataset.roomType;
        const def = ROOM_TYPES[key];
        const locked = def.minStars > _state.stars;
        btn.classList.toggle('locked', locked);
        // Update or remove lock badge
        let lockBadge = btn.querySelector('.palette-lock');
        if (locked && !lockBadge) {
            lockBadge = document.createElement('span');
            lockBadge.className = 'palette-lock';
            lockBadge.innerHTML = def.minStars + '&#9733;';
            btn.appendChild(lockBadge);
        } else if (!locked && lockBadge) {
            lockBadge.remove();
        }
    }
}

// ─── Panel ───

function showPanel(html) {
    _panelEl.innerHTML = html;
    _panelEl.classList.add('open');
    // Wire up close button
    const closeBtn = _panelEl.querySelector('.panel-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
}

function closePanel() {
    _panelEl.classList.remove('open');
    _panelEl.innerHTML = '';
}

function showPersonInfo(person) {
    const stressBarWidth = Math.round((person.stress || 0));
    const stressColor = stressBarWidth > 75 ? '#f87171' : stressBarWidth > 40 ? '#fbbf24' : '#4ade80';
    const hapBarWidth = Math.round(person.happiness || 0);
    const dest = person.destination
        ? `Floor ${person.destination.floor}`
        : (person.state === 'in_room' ? 'Staying' : person.state);
    showPanel(`
        <div class="panel-header">
            <h3 style="margin:0;color:#60a5fa">${person.name || 'Person'}</h3>
            <button class="panel-close">&#10005;</button>
        </div>
        <div class="panel-body">
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Type</span><span style="text-transform:capitalize">${person.type}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Destination</span><span>${dest}</span></div>
                <div class="panel-stat">
                    <span class="panel-stat-label">Happiness</span>
                    <span style="display:flex;align-items:center;gap:6px">
                        <span style="width:60px;height:6px;background:#1a2a3a;border-radius:3px;display:inline-block;position:relative">
                            <span style="position:absolute;left:0;top:0;height:100%;width:${hapBarWidth}%;background:#4ade80;border-radius:3px"></span>
                        </span>
                        ${hapBarWidth}%
                    </span>
                </div>
                <div class="panel-stat">
                    <span class="panel-stat-label">Stress</span>
                    <span style="display:flex;align-items:center;gap:6px">
                        <span style="width:60px;height:6px;background:#1a2a3a;border-radius:3px;display:inline-block;position:relative">
                            <span style="position:absolute;left:0;top:0;height:100%;width:${stressBarWidth}%;background:${stressColor};border-radius:3px"></span>
                        </span>
                        ${stressBarWidth}%
                    </span>
                </div>
            </div>
        </div>
    `);
}

function showRoomInfo(room) {
    const def = ROOM_TYPES[room.type];
    if (!def) return;
    const demoCost = Math.floor(def.cost * 0.5);
    const happiness = Math.round(room.happiness || 0);
    const noiseLevel = Math.round(room.noiseLevel || 0);
    const noiseColor = noiseLevel > 75 ? '#f87171' : noiseLevel > 50 ? '#fb923c' : noiseLevel > 20 ? '#fbbf24' : '#4ade80';
    showPanel(`
        <div class="panel-header">
            <h3 style="margin:0;color:${def.color}">${def.name}</h3>
            <button class="panel-close">&#10005;</button>
        </div>
        <div class="panel-body">
            <p style="opacity:0.7;margin:4px 0 12px">${def.description}</p>
            <div class="panel-stats">
                ${def.maxOccupancy > 0 ? `<div class="panel-stat"><span class="panel-stat-label">Occupancy</span><span>${room.occupancy}/${room.maxOccupancy}</span></div>` : ''}
                <div class="panel-stat"><span class="panel-stat-label">Happiness</span><span>${happiness}%</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Noise Level</span><span style="color:${noiseColor}">${noiseLevel}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Revenue</span><span>${formatMoney(def.revenue)}/day</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Running Cost</span><span>${formatMoney(def.runningCost)}/day</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Floor</span><span>${room.floor}</span></div>
            </div>
            <button class="demolish-btn" data-room-id="${room.id}">Demolish (${formatMoney(demoCost)})</button>
        </div>
    `);
    // Wire demolish
    const demoBtn = _panelEl.querySelector('.demolish-btn');
    if (demoBtn) {
        demoBtn.addEventListener('click', () => {
            removeRoom(_state, room.id);
            closePanel();
        });
    }
}

function showElevatorInfo(room) {
    const elev = _state.elevators.find(e => e.roomId === room.id);
    const def = ROOM_TYPES['elevator'];
    const tierDef = elev ? ELEVATOR_TIERS[elev.tier] : null;

    let floorsHtml = '';
    if (elev) {
        for (let f = _state.grid.builtFloors - 1; f >= 0; f--) {
            const served = elev.config.servedFloors.has(f);
            const queueCount = (elev.queues[f] || []).length;
            floorsHtml += `<div class="elev-floor-toggle" data-floor="${f}" style="
                display:flex;justify-content:space-between;align-items:center;
                padding:6px 8px;margin:2px 0;border-radius:4px;cursor:pointer;
                background:${served ? '#1a4a7a' : '#0a1a30'};
                border:1px solid ${served ? '#2a6aaa' : '#0f2a40'};
            ">
                <span>Floor ${f}${f === 0 ? ' (Lobby)' : ''}</span>
                <span style="display:flex;gap:8px;align-items:center">
                    ${queueCount > 0 ? `<span style="color:#fbbf24;font-size:11px">${queueCount} waiting</span>` : ''}
                    <span style="color:${served ? '#4ade80' : '#666'}">${served ? 'ON' : 'OFF'}</span>
                </span>
            </div>`;
        }
    }

    showPanel(`
        <div class="panel-header">
            <h3 style="margin:0;color:${def.color}">Elevator${tierDef ? ' — ' + tierDef.name : ''}</h3>
            <button class="panel-close">&#10005;</button>
        </div>
        <div class="panel-body">
            <p style="opacity:0.7;margin:4px 0 12px">${def.description}</p>
            ${elev ? `
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Capacity</span><span>${tierDef.capacity}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Speed</span><span>${tierDef.speed}x</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Avg Wait</span><span>${elev.stats.totalTrips > 0 ? Math.round(elev.stats.avgWaitTime) + 's' : 'N/A'}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Total Trips</span><span>${elev.stats.totalTrips}</span></div>
            </div>
            <p style="font-size:12px;opacity:0.6;margin:8px 0 4px">Served Floors (tap to toggle)</p>
            <div class="elev-floors">${floorsHtml}</div>
            ` : ''}
            <button class="demolish-btn" data-room-id="${room.id}" style="margin-top:12px">Demolish (${formatMoney(Math.floor(def.cost * 0.5))})</button>
        </div>
    `);

    // Wire floor toggles
    if (elev) {
        for (const toggle of _panelEl.querySelectorAll('.elev-floor-toggle')) {
            toggle.addEventListener('click', () => {
                const f = Number(toggle.dataset.floor);
                if (elev.config.servedFloors.has(f)) {
                    if (f !== 0) elev.config.servedFloors.delete(f); // can't unserve lobby
                } else {
                    elev.config.servedFloors.add(f);
                }
                showElevatorInfo(room); // refresh
            });
        }
    }

    // Wire demolish
    const demoBtn = _panelEl.querySelector('.demolish-btn');
    if (demoBtn) {
        demoBtn.addEventListener('click', () => {
            removeRoom(_state, room.id);
            // Remove elevator data
            if (elev) {
                const idx = _state.elevators.indexOf(elev);
                if (idx !== -1) _state.elevators.splice(idx, 1);
            }
            closePanel();
        });
    }
}

function showOverview() {
    const s = _state;
    const residents = s.people.filter(p => p.type === 'resident').length;
    const workers = s.people.filter(p => p.type === 'worker').length;
    const visitors = s.people.filter(p => p.type === 'visitor').length;

    const roomCounts = {};
    for (const room of s.rooms) {
        roomCounts[room.type] = (roomCounts[room.type] || 0) + 1;
    }

    const avgHappiness = s.rooms.length > 0
        ? Math.round(s.rooms.reduce((sum, r) => sum + (r.happiness || 0), 0) / s.rooms.length)
        : 0;

    // Star progress
    const starThresholds = [
        { stars: 2, rooms: 10, pop: 0, sat: 30 },
        { stars: 3, rooms: 25, pop: 100, sat: 50 },
        { stars: 4, rooms: 40, pop: 200, sat: 70 },
        { stars: 5, rooms: 60, pop: 350, sat: 85 },
    ];
    const next = starThresholds.find(t => t.stars > s.stars);
    let progressHtml = '';
    if (next) {
        const occupiedRooms = s.rooms.filter(r => ROOM_TYPES[r.type].maxOccupancy > 0 && r.occupancy > 0).length;
        progressHtml = `
            <p style="font-size:12px;opacity:0.6;margin:12px 0 4px">Next star (${next.stars}★)</p>
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Occupied Rooms</span><span>${occupiedRooms}/${next.rooms}</span></div>
                ${next.pop > 0 ? `<div class="panel-stat"><span class="panel-stat-label">Population</span><span>${s.people.length}/${next.pop}</span></div>` : ''}
                <div class="panel-stat"><span class="panel-stat-label">Satisfaction</span><span>${avgHappiness}%/${next.sat}%</span></div>
            </div>
        `;
    }

    let roomListHtml = '';
    for (const [type, count] of Object.entries(roomCounts)) {
        const def = ROOM_TYPES[type];
        if (def) roomListHtml += `<div class="panel-stat"><span class="panel-stat-label">${def.name}</span><span>${count}</span></div>`;
    }

    showPanel(`
        <div class="panel-header">
            <h3 style="margin:0;color:#fbbf24">${'★'.repeat(s.stars)} Tower Overview</h3>
            <button class="panel-close">&#10005;</button>
        </div>
        <div class="panel-body">
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Day</span><span>${s.clock.day}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Funds</span><span style="color:#4ade80">${formatMoney(s.economy.funds)}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Daily Revenue</span><span style="color:#4ade80">+${formatMoney(s.economy.dailyRevenue)}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Daily Costs</span><span style="color:#f87171">-${formatMoney(s.economy.dailyCosts)}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Net Income</span><span style="color:${s.economy.dailyRevenue - s.economy.dailyCosts >= 0 ? '#4ade80' : '#f87171'}">${formatMoney(s.economy.dailyRevenue - s.economy.dailyCosts)}</span></div>
            </div>
            <p style="font-size:12px;opacity:0.6;margin:12px 0 4px">Population</p>
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Residents</span><span style="color:#60a5fa">${residents}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Workers</span><span style="color:#a78bfa">${workers}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Visitors</span><span style="color:#fbbf24">${visitors}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Total</span><span>${s.people.length}</span></div>
            </div>
            <p style="font-size:12px;opacity:0.6;margin:12px 0 4px">Happiness</p>
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Average</span><span>${avgHappiness}%</span></div>
            </div>
            ${progressHtml}
            <p style="font-size:12px;opacity:0.6;margin:12px 0 4px">Rooms</p>
            <div class="panel-stats">${roomListHtml}</div>
            <div style="display:flex;gap:8px;margin-top:12px">
                <button class="demolish-btn" id="btn-new-game" style="background:#0f3460;border-color:#1a4a7a;color:#e0e0e0">New Game</button>
            </div>
        </div>
    `);

    document.getElementById('btn-new-game').addEventListener('click', () => {
        if (confirm('Start new tower? Current progress will be lost.')) {
            clearSave();
            location.reload();
        }
    });
}

// ─── Canvas Touch/Mouse Handling ───

const touch = {
    active: false,
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    moved: false,
    isPinch: false,
    pinchDist: 0,
    identifier: null,
};

const MOVE_THRESHOLD = 10;

function getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getEffectiveX(roomType, gridX) {
    const def = ROOM_TYPES[roomType];
    if (def.width === 'full') return 0;
    return gridX;
}

function updateGhost(screenX, screenY) {
    if (!_state.ui.buildMode || !_state.ui.selectedTool) {
        _state.ui.ghostPreview = null;
        return;
    }
    const { gridX, floor } = screenToGrid(screenX, screenY);
    const roomType = _state.ui.selectedTool;
    const effectiveX = getEffectiveX(roomType, gridX);
    const result = canPlace(_state, roomType, floor, effectiveX);
    _state.ui.ghostPreview = {
        floor,
        x: effectiveX,
        type: roomType,
        valid: result.valid,
        reason: result.reason
    };
}

function tryPlaceRoom(screenX, screenY) {
    const { gridX, floor } = screenToGrid(screenX, screenY);
    const roomType = _state.ui.selectedTool;
    const effectiveX = getEffectiveX(roomType, gridX);
    const result = canPlace(_state, roomType, floor, effectiveX);
    if (result.valid) {
        const room = placeRoom(_state, roomType, floor, effectiveX);
        onRoomPlaced(_state, room);
        flashFeedback(screenX, screenY, true);
        playEffect('place');
        refreshPaletteLocks();
        // Keep build mode active for quick multiple placement
        showBuildHint(roomType);
    } else {
        flashFeedback(screenX, screenY, false, result.reason);
        playEffect('error');
    }
}

function screenToWorld(screenX, screenY) {
    const rect = _canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    const worldX = (x - _canvas.clientWidth / 2) / _state.camera.zoom + _state.camera.x;
    const worldY = (y - _canvas.clientHeight / 2) / _state.camera.zoom + _state.camera.y;
    return { worldX, worldY };
}

function handleTap(screenX, screenY) {
    // Dismiss any quick-build popup
    dismissQuickBuild();

    if (_state.ui.buildMode && _state.ui.selectedTool) {
        tryPlaceRoom(screenX, screenY);
    } else {
        // Check for person hit-test first
        const { worldX, worldY } = screenToWorld(screenX, screenY);
        let nearestPerson = null;
        let nearestDist = 16; // 16px world-space threshold
        for (const person of _state.people) {
            if (person.state === 'in_room' || person.state === 'riding') continue;
            const px0 = person.currentX;
            const py0 = -person.currentFloor * CELL_H + CELL_H - 8;
            const dx = worldX - (px0 + 1.5); // center of 3px sprite
            const dy = worldY - (py0 - 4);   // center of sprite height
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPerson = person;
            }
        }
        if (nearestPerson) {
            showPersonInfo(nearestPerson);
            return;
        }

        const { gridX, floor } = screenToGrid(screenX, screenY);
        if (floor >= -_state.grid.basementFloors && floor < _state.grid.maxFloors && gridX >= 0 && gridX < _state.grid.width) {
            const roomId = _state.grid.cells[floorToIdx(_state.grid, floor)]?.[gridX];
            if (roomId !== null && roomId !== undefined) {
                const room = _state.roomsById.get(roomId);
                if (room) {
                    if (room.type === 'elevator') {
                        showElevatorInfo(room);
                    } else {
                        showRoomInfo(room);
                    }
                }
            } else {
                // Tapped empty space — show quick build menu
                showQuickBuild(screenX, screenY, floor, gridX);
            }
        }
    }
}

function showQuickBuild(screenX, screenY, floor, gridX) {
    dismissQuickBuild();
    const popup = document.createElement('div');
    popup.id = 'quick-build';
    popup.style.cssText = `
        position:fixed;left:${Math.min(screenX, window.innerWidth - 220)}px;top:${Math.max(screenY - 10, 70)}px;
        background:#16213e;border:2px solid #0f3460;border-radius:12px;padding:8px;
        z-index:25;display:flex;flex-direction:column;gap:4px;min-width:200px;
        box-shadow:0 4px 20px rgba(0,0,0,0.5);
    `;
    popup.innerHTML = '<div style="font-size:11px;opacity:0.5;padding:2px 8px">Build on Floor ' + floor + '</div>';

    for (const [key, def] of Object.entries(ROOM_TYPES)) {
        if (key === 'lobby') continue;
        const locked = def.minStars > _state.stars;
        const tooExpensive = _state.economy.funds < def.cost;
        const effectiveX = getEffectiveX(key, gridX);
        const placeable = canPlace(_state, key, floor, effectiveX);

        const btn = document.createElement('button');
        btn.style.cssText = `
            display:flex;justify-content:space-between;align-items:center;
            padding:10px 12px;background:${locked || tooExpensive ? '#0a1a30' : '#0f3460'};
            border:1px solid ${locked ? '#0f2a40' : '#1a4a7a'};border-radius:8px;
            color:${locked || tooExpensive ? '#666' : '#e0e0e0'};cursor:${locked ? 'not-allowed' : 'pointer'};
            font-size:14px;touch-action:manipulation;min-height:44px;width:100%;
        `;
        btn.innerHTML = `<span>${def.name}</span><span style="color:${tooExpensive ? '#f87171' : '#4ade80'}">${formatCost(def.cost)}${locked ? ' ' + def.minStars + '★' : ''}</span>`;

        if (!locked) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissQuickBuild();
                _state.ui.selectedTool = key;
                _state.ui.buildMode = true;
                updatePaletteHighlight();
                showBuildHint(key);
                // If this specific spot is valid, place immediately
                if (placeable.valid) {
                    const room = placeRoom(_state, key, floor, effectiveX);
                    onRoomPlaced(_state, room);
                    flashFeedback(screenX, screenY, true);
                    refreshPaletteLocks();
                }
            });
        }

        popup.appendChild(btn);
    }

    document.body.appendChild(popup);
    // Auto-dismiss on outside tap
    setTimeout(() => {
        document.addEventListener('click', dismissQuickBuild, { once: true });
    }, 100);
}

function dismissQuickBuild() {
    const popup = document.getElementById('quick-build');
    if (popup) popup.remove();
}

// Flash feedback overlay
let flashTimeout = null;
function flashFeedback(x, y, success, reason) {
    // Create a brief flash element
    let flash = document.getElementById('place-flash');
    if (!flash) {
        flash = document.createElement('div');
        flash.id = 'place-flash';
        document.body.appendChild(flash);
    }
    flash.textContent = success ? '✓' : (reason || '✗');
    flash.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y - 30}px;
        transform: translateX(-50%);
        color: ${success ? '#4ade80' : '#f87171'};
        font-size: 16px;
        font-weight: 700;
        pointer-events: none;
        z-index: 100;
        opacity: 1;
        transition: opacity 0.5s, top 0.5s;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        white-space: nowrap;
        max-width: 200px;
        text-align: center;
    `;
    if (flashTimeout) clearTimeout(flashTimeout);
    requestAnimationFrame(() => {
        flash.style.opacity = '0';
        flash.style.top = (y - 60) + 'px';
    });
    flashTimeout = setTimeout(() => {
        flash.remove();
        flashTimeout = null;
    }, 600);
}

// ─── Touch events ───

function onTouchStart(e) {
    if (e.touches.length === 2) {
        // Pinch start
        touch.isPinch = true;
        touch.pinchDist = getTouchDist(e.touches[0], e.touches[1]);
        touch.moved = true; // prevent tap
        return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touch.active = true;
    touch.startX = t.clientX;
    touch.startY = t.clientY;
    touch.lastX = t.clientX;
    touch.lastY = t.clientY;
    touch.moved = false;
    touch.isPinch = false;
    touch.identifier = t.identifier;

    updateGhost(t.clientX, t.clientY);
}

function onTouchMove(e) {
    e.preventDefault();
    if (touch.isPinch && e.touches.length === 2) {
        const newDist = getTouchDist(e.touches[0], e.touches[1]);
        const ratio = newDist / touch.pinchDist;
        _state.camera.zoom = Math.max(0.5, Math.min(2.0, _state.camera.zoom * ratio));
        touch.pinchDist = newDist;
        return;
    }
    if (!touch.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.lastX;
    const dy = t.clientY - touch.lastY;
    const totalDx = t.clientX - touch.startX;
    const totalDy = t.clientY - touch.startY;

    if (!touch.moved && (Math.abs(totalDx) > MOVE_THRESHOLD || Math.abs(totalDy) > MOVE_THRESHOLD)) {
        touch.moved = true;
    }

    if (touch.moved) {
        if (_state.ui.buildMode) {
            // In build mode, update ghost position instead of panning
            updateGhost(t.clientX, t.clientY);
        } else {
            // Pan
            _state.camera.x -= dx / _state.camera.zoom;
            _state.camera.y -= dy / _state.camera.zoom;
        }
    }

    touch.lastX = t.clientX;
    touch.lastY = t.clientY;
}

function onTouchEnd(e) {
    if (touch.isPinch) {
        if (e.touches.length < 2) {
            touch.isPinch = false;
            touch.active = false;
        }
        return;
    }
    if (!touch.active) return;
    touch.active = false;

    if (!touch.moved) {
        handleTap(touch.startX, touch.startY);
    } else if (_state.ui.buildMode && _state.ui.ghostPreview?.valid) {
        // If dragged in build mode and released on a valid spot, place it
        tryPlaceRoom(touch.lastX, touch.lastY);
    }
    _state.ui.ghostPreview = null;
}

// ─── Mouse events (desktop testing) ───

let mouseDown = false;
let mouseStartX = 0, mouseStartY = 0;
let mouseLastX = 0, mouseLastY = 0;
let mouseMoved = false;

function onMouseDown(e) {
    if (e.button !== 0) return;
    mouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseLastX = e.clientX;
    mouseLastY = e.clientY;
    mouseMoved = false;

    updateGhost(e.clientX, e.clientY);
}

function onMouseMove(e) {
    if (_state.ui.buildMode) {
        updateGhost(e.clientX, e.clientY);
    }
    if (!mouseDown) return;
    const dx = e.clientX - mouseLastX;
    const dy = e.clientY - mouseLastY;
    const totalDx = e.clientX - mouseStartX;
    const totalDy = e.clientY - mouseStartY;

    if (!mouseMoved && (Math.abs(totalDx) > MOVE_THRESHOLD || Math.abs(totalDy) > MOVE_THRESHOLD)) {
        mouseMoved = true;
    }

    if (mouseMoved && !_state.ui.buildMode) {
        _state.camera.x -= dx / _state.camera.zoom;
        _state.camera.y -= dy / _state.camera.zoom;
    }

    mouseLastX = e.clientX;
    mouseLastY = e.clientY;
}

function onMouseUp(e) {
    if (!mouseDown) return;
    mouseDown = false;

    if (!mouseMoved) {
        handleTap(mouseStartX, mouseStartY);
    }
}

function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    _state.camera.zoom = Math.max(0.5, Math.min(2.0, _state.camera.zoom * delta));
}

// ─── Speed Controls ───

function initSpeedControls() {
    const btnPause = document.getElementById('btn-pause');
    const btn1x = document.getElementById('btn-1x');
    const btn2x = document.getElementById('btn-2x');
    const btn4x = document.getElementById('btn-4x');
    const allBtns = [btnPause, btn1x, btn2x, btn4x];

    function setActive(btn) {
        for (const b of allBtns) b.classList.remove('active');
        btn.classList.add('active');
    }

    btnPause.addEventListener('click', () => {
        _state.clock.paused = true;
        setActive(btnPause);
    });
    btn1x.addEventListener('click', () => {
        _state.clock.paused = false;
        _state.clock.speed = 1;
        setActive(btn1x);
    });
    btn2x.addEventListener('click', () => {
        _state.clock.paused = false;
        _state.clock.speed = 2;
        setActive(btn2x);
    });
    btn4x.addEventListener('click', () => {
        _state.clock.paused = false;
        _state.clock.speed = 4;
        setActive(btn4x);
    });
}

// ─── Top Bar Updates ───

let lastStars = -1;

function updateTopBar() {
    document.getElementById('money-display').textContent = formatMoney(_state.economy.funds);
    document.getElementById('pop-display').textContent = _state.people.length;
    document.getElementById('time-display').textContent =
        getTimeString(_state.clock) + '  Day ' + _state.clock.day;

    // Stars — only update DOM when changed
    if (_state.stars !== lastStars) {
        lastStars = _state.stars;
        document.getElementById('stars-display').textContent = '\u2605'.repeat(_state.stars);
        refreshPaletteLocks();
    }

    // Grace period warning
    updateGraceWarning();

    // Game over check
    if (_state.economy.gameOver && !_gameOverShown) {
        showGameOver();
    }
}

let _gameOverShown = false;

function updateGraceWarning() {
    let bar = document.getElementById('grace-warning');
    if (_state.economy.inGrace) {
        const daysLeft = 30 - (_state.clock.day - _state.economy.graceStart);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'grace-warning';
            bar.style.cssText = 'background:#7f1d1d;color:#fca5a5;text-align:center;padding:6px;font-size:13px;font-weight:600;';
            document.getElementById('top-bar').after(bar);
        }
        bar.textContent = `FUNDS CRITICAL — ${Math.max(0, daysLeft)} days remaining`;
    } else if (bar) {
        bar.remove();
    }
}

function showGameOver() {
    _gameOverShown = true;
    _state.clock.paused = true;
    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.85);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        z-index:100;color:#e0e0e0;
    `;
    overlay.innerHTML = `
        <h1 style="color:#e94560;font-size:48px;margin:0">BANKRUPT</h1>
        <p style="opacity:0.7;margin:16px 0 32px">Your tower has run out of funds.</p>
        <div style="background:#16213e;padding:24px;border-radius:12px;min-width:280px">
            <div class="panel-stats">
                <div class="panel-stat"><span class="panel-stat-label">Days Survived</span><span>${_state.clock.day}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Max Population</span><span>${_state.people.length}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Stars Reached</span><span>${'★'.repeat(_state.stars)}</span></div>
                <div class="panel-stat"><span class="panel-stat-label">Rooms Built</span><span>${_state.rooms.length}</span></div>
            </div>
            <button id="go-new-game" style="width:100%;padding:14px;background:#e94560;border:none;color:white;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;margin-top:16px">New Game</button>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('go-new-game').addEventListener('click', () => {
        clearSave();
        location.reload();
    });
}

// ─── Init ───

export function initUI(canvas, state) {
    _canvas = canvas;
    _state = state;
    _paletteEl = document.getElementById('build-palette');
    _panelEl = document.getElementById('panel-overlay');

    // Inject palette CSS
    injectStyles();

    // Build palette buttons
    populatePalette();

    // Canvas touch events
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });

    // Canvas mouse events
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            _state.ui.selectedTool = null;
            _state.ui.buildMode = false;
            _state.ui.ghostPreview = null;
            updatePaletteHighlight();
            closePanel();
        }
        if (e.key === 'n' || e.key === 'N') {
            _state.ui.showNoiseOverlay = !_state.ui.showNoiseOverlay;
        }
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            import('./save.js').then(m => { m.save(_state); });
        }
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            import('./save.js').then(m => {
                const loaded = m.load();
                if (loaded) {
                    Object.assign(_state, loaded);
                    updatePaletteHighlight();
                }
            });
        }
    });

    // Speed controls
    initSpeedControls();

    // Sound toggle
    const soundBtn = document.getElementById('btn-sound');
    soundBtn.addEventListener('click', () => {
        const on = toggleSound();
        soundBtn.textContent = on ? '\u{1F50A}' : '\u{1F507}';
    });

    // Overview button
    document.getElementById('btn-overview').addEventListener('click', () => {
        showOverview();
    });

    // Top bar update interval
    setInterval(updateTopBar, 500);
    updateTopBar();
}

// ─── Injected styles ───

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .palette-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            min-width: 100px;
            min-height: 60px;
            background: #0f3460;
            border: 2px solid #1a4a7a;
            border-radius: 8px;
            color: #e0e0e0;
            cursor: pointer;
            touch-action: manipulation;
            flex-shrink: 0;
            position: relative;
            transition: border-color 0.15s, background 0.15s;
        }
        .palette-btn:active {
            background: #1a4a7a;
        }
        .palette-btn.selected {
            border-color: #e94560;
            background: #1a2a50;
            box-shadow: 0 0 8px rgba(233,69,96,0.4);
        }
        .palette-btn.locked {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .palette-swatch {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            flex-shrink: 0;
        }
        .palette-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            text-align: left;
        }
        .palette-name {
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
        }
        .palette-cost {
            font-size: 11px;
            color: #4ade80;
        }
        .palette-lock {
            position: absolute;
            top: 4px;
            right: 6px;
            font-size: 10px;
            color: #fbbf24;
            background: rgba(0,0,0,0.5);
            padding: 1px 4px;
            border-radius: 3px;
        }
        /* Panel styles */
        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .panel-close {
            background: none;
            border: none;
            color: #e0e0e0;
            font-size: 20px;
            cursor: pointer;
            padding: 4px 8px;
            touch-action: manipulation;
            min-width: 44px;
            min-height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .panel-body p {
            font-size: 13px;
        }
        .panel-stats {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
        }
        .panel-stat {
            display: flex;
            justify-content: space-between;
            font-size: 14px;
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .panel-stat-label {
            opacity: 0.6;
        }
        .demolish-btn {
            width: 100%;
            padding: 12px;
            background: #7f1d1d;
            border: 1px solid #991b1b;
            color: #fca5a5;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            touch-action: manipulation;
            min-height: 48px;
        }
        .demolish-btn:active {
            background: #991b1b;
        }
    `;
    document.head.appendChild(style);
}
