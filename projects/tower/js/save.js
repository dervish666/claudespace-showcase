// save.js — Save/load with localStorage
import { createGrid } from './grid.js';

const SAVE_KEY = 'tower-sim-save';
const SAVE_VERSION = 1;

export function save(state) {
    try {
        const data = {
            version: SAVE_VERSION,
            timestamp: Date.now(),
            state: serializeState(state)
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Save failed:', e);
    }
}

export function load() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.version !== SAVE_VERSION) return null;
        return deserializeState(data.state);
    } catch (e) {
        console.warn('Load failed:', e);
        return null;
    }
}

export function clearSave() {
    localStorage.removeItem(SAVE_KEY);
}

function serializeState(state) {
    const { roomsById, ...rest } = state; // exclude Map (rebuilt on load)
    return {
        ...rest,
        elevators: state.elevators.map(e => ({
            ...e,
            config: {
                ...e.config,
                servedFloors: [...e.config.servedFloors] // Set → Array
            }
        }))
    };
}

function deserializeState(data) {
    // Rebuild grid (cells are plain arrays, should survive JSON fine)
    const state = {
        ...data,
        roomsById: new Map(),
        elevators: (data.elevators || []).map(e => ({
            ...e,
            config: {
                ...e.config,
                servedFloors: new Set(e.config.servedFloors) // Array → Set
            }
        }))
    };
    // Ensure basementFloors exists (backward compat with old saves)
    if (state.grid && !state.grid.basementFloors) {
        state.grid.basementFloors = 3;
        // Prepend basement floor arrays if missing
        if (state.grid.cells.length < state.grid.maxFloors + 3) {
            for (let i = 0; i < 3; i++) {
                state.grid.cells.unshift(new Array(state.grid.width).fill(null));
            }
        }
    }
    // Backward compat: add missing fields to people
    for (const person of state.people || []) {
        if (!person.name) person.name = 'Guest';
        if (typeof person.stress !== 'number') person.stress = 0;
    }
    // Backward compat: add missing fields to rooms
    for (const room of state.rooms || []) {
        if (typeof room.noiseLevel !== 'number') room.noiseLevel = 0;
    }
    // Backward compat: add showNoiseOverlay to ui
    if (state.ui && typeof state.ui.showNoiseOverlay === 'undefined') {
        state.ui.showNoiseOverlay = false;
    }
    // Rebuild roomsById Map
    for (const room of state.rooms) {
        state.roomsById.set(room.id, room);
    }
    return state;
}
