// grid.js — Grid data structure, placement logic, adjacency checks

import { ROOM_TYPES } from './rooms.js';

/**
 * Create the building grid.
 * Floor 0 is ground level. Positive floors go up, negative go down (basements).
 * Each cell is null (empty) or a room ID.
 * We store cells as a Map keyed by "floor,x" for sparse storage.
 */
export function createGrid(width, maxFloors, basementFloors = 3) {
    // cells are indexed by array index: [0..basementFloors+maxFloors-1]
    // Floor -basementFloors maps to index 0, floor 0 maps to index basementFloors
    // Use floorToIdx / idxToFloor to convert
    const totalFloors = basementFloors + maxFloors;
    const cells = [];
    for (let f = 0; f < totalFloors; f++) {
        cells[f] = new Array(width).fill(null);
    }
    return {
        width,
        maxFloors,
        basementFloors,
        cells,
        builtFloors: 1
    };
}

/** Convert a game floor number to array index */
export function floorToIdx(grid, floor) {
    return floor + grid.basementFloors;
}

/** Convert array index to game floor number */
export function idxToFloor(grid, idx) {
    return idx - grid.basementFloors;
}

/**
 * Get the effective width of a room type on this grid.
 */
function getRoomWidth(state, roomType) {
    const def = ROOM_TYPES[roomType];
    if (!def) return 0;
    return def.width === 'full' ? state.grid.width : def.width;
}

/**
 * Get the x position for full-width rooms (always 0).
 */
function getEffectiveX(state, roomType, x) {
    const def = ROOM_TYPES[roomType];
    return def.width === 'full' ? 0 : x;
}

/**
 * Check if a room can be placed at the given position.
 * Returns { valid: boolean, reason: string }
 */
export function canPlace(state, roomType, floor, x) {
    const def = ROOM_TYPES[roomType];
    if (!def) return { valid: false, reason: 'Unknown room type.' };

    const grid = state.grid;
    const width = getRoomWidth(state, roomType);
    const effectiveX = getEffectiveX(state, roomType, x);

    // Star requirement
    if (def.minStars > state.stars) {
        return { valid: false, reason: `Requires ${def.minStars} star${def.minStars > 1 ? 's' : ''}.` };
    }

    // Bounds check (allow basements down to -basementFloors)
    if (floor < -grid.basementFloors || floor >= grid.maxFloors) {
        return { valid: false, reason: 'Out of vertical bounds.' };
    }
    const fi = floorToIdx(grid, floor);
    if (effectiveX < 0 || effectiveX + width > grid.width) {
        return { valid: false, reason: 'Out of horizontal bounds.' };
    }

    // Funds check
    if (state.economy.funds < def.cost) {
        return { valid: false, reason: 'Insufficient funds.' };
    }

    // Overlap check
    for (let i = effectiveX; i < effectiveX + width; i++) {
        if (grid.cells[fi][i] !== null) {
            return { valid: false, reason: 'Space is occupied.' };
        }
    }

    // Lobby must be on floor 0 (or sky_lobby on higher floors)
    if (roomType === 'lobby' && floor !== 0) {
        return { valid: false, reason: 'Lobby must be on ground floor.' };
    }

    // Sky lobby cannot be on floor 0
    if (roomType === 'sky_lobby' && floor === 0) {
        return { valid: false, reason: 'Sky Lobby must be above ground.' };
    }

    // Parking goes in basements or ground floor
    if (roomType === 'parking' && floor > 0) {
        return { valid: false, reason: 'Parking must be on ground floor or basement.' };
    }

    // Floor-beneath rule: non-elevator rooms above floor 0 need support
    // Basements (floor < 0) and floor 0 can be placed freely
    // Floors above 0 need something beneath them
    if (roomType !== 'elevator' && floor > 0) {
        let hasSupport = false;
        const belowIdx = floorToIdx(grid, floor - 1);
        for (let i = effectiveX; i < effectiveX + width; i++) {
            if (grid.cells[belowIdx][i] !== null) {
                hasSupport = true;
                break;
            }
        }
        if (!hasSupport) {
            return { valid: false, reason: 'Must build on an existing floor.' };
        }
    }

    // Adjacency rule: condos should not be directly adjacent to restaurants
    if (roomType === 'condo' || roomType === 'restaurant') {
        const adjacent = getAdjacentRooms(state, floor, effectiveX, width);
        const badNeighbor = roomType === 'condo' ? 'restaurant' : 'condo';
        for (const adj of adjacent) {
            if (adj.type === badNeighbor) {
                return { valid: false, reason: `${def.name} cannot be next to ${ROOM_TYPES[badNeighbor].name}.` };
            }
        }
    }

    return { valid: true, reason: '' };
}

/**
 * Place a room on the grid. Assumes canPlace already returned valid.
 * Returns the room object.
 */
export function placeRoom(state, roomType, floor, x) {
    const def = ROOM_TYPES[roomType];
    const grid = state.grid;
    const width = getRoomWidth(state, roomType);
    const effectiveX = getEffectiveX(state, roomType, x);

    const room = {
        id: state.nextId++,
        type: roomType,
        floor,
        x: effectiveX,
        width,
        occupancy: 0,
        maxOccupancy: def.maxOccupancy,
        happiness: 50,
        revenue: 0,
        built: true
    };

    // Write to grid cells
    const fi = floorToIdx(grid, floor);
    for (let i = effectiveX; i < effectiveX + width; i++) {
        grid.cells[fi][i] = room.id;
    }

    // Update built floors
    if (floor + 1 > grid.builtFloors) {
        grid.builtFloors = floor + 1;
    }

    // Deduct cost
    state.economy.funds -= def.cost;

    // Add to rooms array and map
    state.rooms.push(room);
    state.roomsById.set(room.id, room);

    return room;
}

/**
 * Remove a room from the grid.
 * Clears cells, evicts people, charges demolition cost (50% of build cost).
 */
export function removeRoom(state, roomId) {
    const room = state.roomsById.get(roomId);
    if (!room) return;

    const def = ROOM_TYPES[room.type];
    const grid = state.grid;

    // Clear grid cells
    const fi = floorToIdx(grid, room.floor);
    for (let i = room.x; i < room.x + room.width; i++) {
        if (grid.cells[fi][i] === roomId) {
            grid.cells[fi][i] = null;
        }
    }

    // Evict people
    for (const person of state.people) {
        if (person.roomId === roomId || person.homeId === roomId || person.workId === roomId) {
            if (person.state === 'working' || person.state === 'idle') {
                person.state = 'leaving';
            } else {
                person.toRemove = true;
            }
            if (person.homeId === roomId) person.homeId = null;
            if (person.workId === roomId) person.workId = null;
            if (person.roomId === roomId) person.roomId = null;
        }
    }

    // Remove from rooms array
    const idx = state.rooms.indexOf(room);
    if (idx !== -1) state.rooms.splice(idx, 1);

    // Remove from map
    state.roomsById.delete(roomId);

    // Charge demolition cost (50% of build cost)
    const demoCost = Math.floor(def.cost * 0.5);
    state.economy.funds -= demoCost;
}

/**
 * Get rooms adjacent (left and right) to a given span on a floor.
 * Returns array of room objects.
 */
export function getAdjacentRooms(state, floor, x, width) {
    const grid = state.grid;
    const adjacent = [];
    const seen = new Set();
    const fi = floorToIdx(grid, floor);

    // Check cell to the left
    if (x > 0) {
        const leftId = grid.cells[fi][x - 1];
        if (leftId !== null && !seen.has(leftId)) {
            seen.add(leftId);
            const room = state.roomsById.get(leftId);
            if (room) adjacent.push(room);
        }
    }

    // Check cell to the right
    const rightX = x + width;
    if (rightX < grid.width) {
        const rightId = grid.cells[fi][rightX];
        if (rightId !== null && !seen.has(rightId)) {
            seen.add(rightId);
            const room = state.roomsById.get(rightId);
            if (room) adjacent.push(room);
        }
    }

    return adjacent;
}
