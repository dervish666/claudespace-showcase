// economy.js — Economy simulation
import { ROOM_TYPES } from './rooms.js';
import { playEffect } from './sound.js';

export function initEconomy(state) {
    // Nothing special needed at init
}

export function tickEconomy(state) {
    if (!state.economy.newDay) return;
    state.economy.newDay = false;

    let dailyRevenue = 0;
    let dailyCosts = 0;

    for (const room of state.rooms) {
        const type = ROOM_TYPES[room.type];

        // Revenue: base * occupancy rate * happiness factor
        let occupancyRate;
        if (room.type === 'hotel') {
            const starBonus = (state.stars / 5) * 0.3;
            const visitorTraffic = state.people.filter(p => p.type === 'visitor').length;
            const trafficBonus = Math.min(visitorTraffic / 50, 1) * 0.2;
            occupancyRate = 0.5 + starBonus + trafficBonus;
        } else {
            occupancyRate = type.maxOccupancy > 0
                ? room.occupancy / type.maxOccupancy
                : 0;
        }
        const happinessFactor = 0.5 + (room.happiness / 100) * 0.5;
        let revenue;
        if (room.type === 'restaurant') {
            revenue = (300 + 500 * occupancyRate) * happinessFactor;
        } else {
            revenue = type.revenue * occupancyRate * happinessFactor;
        }

        // Proximity bonus for shops/restaurants
        if (room.type === 'shop' || room.type === 'restaurant') {
            const distToLobby = getDistanceToNearestLobby(state, room.floor);
            if (distToLobby <= 5) {
                revenue *= 1.5;
            }
        }

        // Gym boosts happiness for condos on the same floor
        if (room.type === 'condo') {
            const hasGymOnFloor = state.rooms.some(r => r.type === 'gym' && r.floor === room.floor);
            if (hasGymOnFloor) {
                room.happiness = Math.min(100, (room.happiness || 50) + 5);
            }
        }

        // Cinema bonus: high revenue during evening hours
        if (room.type === 'cinema') {
            const hour = Math.floor(state.clock.time * 24);
            if (hour >= 18 && hour <= 23) {
                revenue *= 1.8; // evening premium
            }
        }

        // Medical reduces happiness decay — handled in people.js, but also gets a bonus
        // for each occupied condo in the building
        if (room.type === 'medical') {
            const condoCount = state.rooms.filter(r => r.type === 'condo' && r.occupancy > 0).length;
            revenue += condoCount * 20; // insurance payments
        }

        room.revenue = Math.round(revenue);
        dailyRevenue += room.revenue;
        dailyCosts += type.runningCost;
    }

    // Elevator maintenance
    for (const elev of state.elevators) {
        dailyCosts += ROOM_TYPES.elevator.runningCost;
    }

    state.economy.dailyRevenue = dailyRevenue;
    state.economy.dailyCosts = dailyCosts;
    state.economy.funds += dailyRevenue - dailyCosts;

    if (dailyRevenue > 0) playEffect('cash');

    updateStarRating(state);
    checkBankruptcy(state);
}

function updateStarRating(state) {
    const occupiedRooms = state.rooms.filter(r =>
        ROOM_TYPES[r.type].maxOccupancy > 0 && r.occupancy > 0
    ).length;
    const population = state.people.length;
    const satisfaction = getOverallSatisfaction(state);

    let stars = 1;
    if (satisfaction >= 30 && occupiedRooms >= 10) stars = 2;
    if (satisfaction >= 50 && occupiedRooms >= 25 && population >= 100) stars = 3;
    if (satisfaction >= 70 && occupiedRooms >= 40 && population >= 200) stars = 4;
    if (satisfaction >= 85 && occupiedRooms >= 60 && population >= 350) stars = 5;

    state.stars = stars;
}

function getOverallSatisfaction(state) {
    const rooms = state.rooms.filter(r => ROOM_TYPES[r.type].maxOccupancy > 0);
    if (rooms.length === 0) return 0;

    let totalWeighted = 0;
    let totalWeight = 0;
    for (const room of rooms) {
        const weight = ROOM_TYPES[room.type].revenue || 1;
        totalWeighted += room.happiness * weight;
        totalWeight += weight;
    }
    return totalWeight > 0 ? totalWeighted / totalWeight : 0;
}

export function getDistanceToNearestLobby(state, floor) {
    let minDist = Infinity;
    for (const room of state.rooms) {
        if (room.type === 'lobby' || room.type === 'sky_lobby') {
            minDist = Math.min(minDist, Math.abs(floor - room.floor));
        }
    }
    return minDist;
}

function checkBankruptcy(state) {
    if (state.economy.funds < 0) {
        if (!state.economy.graceStart) {
            state.economy.graceStart = state.clock.day;
            state.economy.inGrace = true;
        }
        if (state.clock.day - state.economy.graceStart >= 30) {
            state.economy.gameOver = true;
        }
    } else {
        state.economy.graceStart = null;
        state.economy.inGrace = false;
    }
}
