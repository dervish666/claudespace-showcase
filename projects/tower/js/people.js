// js/people.js — People simulation
import { ROOM_TYPES } from './rooms.js';
import { getHour } from './clock.js';
import { getDistanceToNearestLobby } from './economy.js';
import { floorToIdx } from './grid.js';

const WALK_SPEED = 2; // pixels per frame
const SPRITE_VARIANTS = 4;

const FIRST_NAMES = [
    'Alice', 'Ben', 'Clara', 'David', 'Emma', 'Felix', 'Grace', 'Henry',
    'Iris', 'Jack', 'Kate', 'Liam', 'Maya', 'Noah', 'Olivia', 'Peter',
    'Quinn', 'Rose', 'Sasha', 'Tara', 'Uma', 'Victor', 'Wendy', 'Xander',
    'Yara', 'Zoe', 'Alex', 'Blake', 'Casey', 'Dana', 'Evan', 'Fiona',
    'George', 'Holly', 'Ivan', 'Julia', 'Kevin', 'Laura', 'Mike', 'Nora'
];

export function spawnPeopleForRoom(state, room) {
    const type = ROOM_TYPES[room.type];
    if (room.type === 'condo') {
        for (let i = 0; i < type.maxOccupancy; i++) {
            createPerson(state, 'resident', room);
        }
    }
}

function createPerson(state, personType, homeRoom) {
    const person = {
        id: state.nextId++,
        name: FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
        type: personType,
        currentFloor: homeRoom.floor,
        currentX: homeRoom.x * 24 + Math.random() * homeRoom.width * 24,
        destination: null,
        happiness: 70,
        stress: 0,
        state: 'in_room',
        homeRoom: homeRoom.id,
        waitStartTime: null,
        spriteVariant: Math.floor(Math.random() * SPRITE_VARIANTS),
        walkFrame: 0
    };
    state.people.push(person);
    homeRoom.occupancy = Math.min(homeRoom.occupancy + 1, ROOM_TYPES[homeRoom.type].maxOccupancy);
    return person;
}

export function tickPeople(state) {
    const hour = getHour(state.clock);
    spawnWorkers(state, hour);
    tickVisitors(state, hour);
    // Track leaves-due-to-stress per condo per day
    // (instanceof check matters: a loaded save turns the Map into a plain {})
    if (!(state._stressLeaveToday instanceof Map)) state._stressLeaveToday = new Map();
    if (!state._stressLeaveDay) state._stressLeaveDay = state.clock.day;
    if (state.clock.day !== state._stressLeaveDay) {
        state._stressLeaveToday = new Map();
        state._stressLeaveDay = state.clock.day;
    }
    for (const person of state.people) {
        updateHappiness(state, person);
        tickStress(state, person);
        tickPerson(state, person, hour);
    }
    state.people = state.people.filter(p => !p.toRemove);
    updateOccupancy(state);
}

function tickStress(state, person) {
    if (typeof person.stress !== 'number') person.stress = 0;
    const homeRoom = person.homeRoom ? state.roomsById?.get(person.homeRoom) : null;
    const noiseLevel = homeRoom ? (homeRoom.noiseLevel || 0) : 0;

    if (person.state === 'waiting') {
        person.stress += 0.05 * state.clock.speed;
    } else if (noiseLevel > 0) {
        person.stress += noiseLevel * 0.003 * state.clock.speed;
    }

    if (noiseLevel < 15) {
        person.stress -= 0.02 * state.clock.speed;
    }

    person.stress = Math.max(0, Math.min(100, person.stress));

    // High-stress residents leave (one per condo per day max)
    if (person.stress > 90 && person.type === 'resident' && homeRoom) {
        const leaveCount = state._stressLeaveToday.get(homeRoom.id) || 0;
        if (leaveCount < 1) {
            state._stressLeaveToday.set(homeRoom.id, leaveCount + 1);
            person.destination = { floor: 0, x: 0, action: 'leave_building' };
            person.state = 'leaving';
        }
    }
}

function removePerson(state, person) {
    person.toRemove = true;
}

function arriveAtDestination(state, person) {
    person.state = 'in_room';
    person.destination = null;
}

function findNearestRoom(state, person, roomType) {
    let best = null, bestDist = Infinity;
    for (const room of state.rooms) {
        if (room.type !== roomType) continue;
        const dist = Math.abs(room.floor - person.currentFloor) + Math.abs(room.x * 24 - person.currentX) / 24;
        if (dist < bestDist) { bestDist = dist; best = room; }
    }
    return best;
}

function getAdjacentRoomTypes(state, room) {
    const types = [];
    if (room.x > 0) {
        const id = state.grid.cells[floorToIdx(state.grid, room.floor)][room.x - 1];
        if (id !== null) { const r = state.roomsById.get(id); if (r) types.push(r.type); }
    }
    if (room.x + room.width < state.grid.width) {
        const id = state.grid.cells[floorToIdx(state.grid, room.floor)][room.x + room.width];
        if (id !== null) { const r = state.roomsById.get(id); if (r) types.push(r.type); }
    }
    return types;
}

function tickPerson(state, person, hour) {
    switch (person.state) {
        case 'in_room':
            const dest = getScheduledDestination(state, person, hour);
            if (dest) {
                person.destination = dest;
                person.state = 'walking';
            }
            break;
        case 'walking':
            walkToward(state, person);
            break;
        case 'waiting':
            person.happiness = Math.max(0, person.happiness - 0.02 * state.clock.speed);
            if (person.waitStartTime && state.gameTime - person.waitStartTime > 90) {
                useStairs(state, person);
            }
            break;
        case 'riding':
            break;
        case 'entering':
            walkToward(state, person);
            break;
        case 'leaving':
            walkToward(state, person);
            if (person.currentFloor === 0 && person.currentX <= 0) {
                removePerson(state, person);
            }
            break;
        case 'using_stairs':
            if (state.gameTime - person.stairTimer >= 4) {
                person.currentFloor += person.stairDirection;
                person.stairTimer = state.gameTime;
                if (person.currentFloor === person.destination.floor) {
                    person.state = 'walking';
                }
            }
            break;
    }
}

function getScheduledDestination(state, person, hour) {
    if (person.type === 'resident') {
        if (hour >= 7 && hour < 9 && person.state === 'in_room') {
            return { floor: 0, x: 0, action: 'leave_building' };
        }
        if (hour >= 19 && hour < 20 && Math.random() < 0.3) {
            const restaurant = findNearestRoom(state, person, 'restaurant');
            if (restaurant) return { floor: restaurant.floor, x: restaurant.x * 24, action: 'visit' };
        }
    }
    if (person.type === 'worker') {
        if (hour === 12 && Math.random() < 0.5) {
            const restaurant = findNearestRoom(state, person, 'restaurant');
            if (restaurant) return { floor: restaurant.floor, x: restaurant.x * 24, action: 'visit' };
        }
        if (hour >= 17 && hour < 18) {
            return { floor: 0, x: 0, action: 'leave_building' };
        }
    }
    return null;
}

function walkToward(state, person) {
    if (!person.destination) { person.state = 'in_room'; return; }

    if (person.currentFloor === person.destination.floor) {
        const dx = person.destination.x - person.currentX;
        if (Math.abs(dx) < WALK_SPEED) {
            person.currentX = person.destination.x;
            arriveAtDestination(state, person);
        } else {
            person.currentX += Math.sign(dx) * WALK_SPEED;
            person.walkFrame = (person.walkFrame + 1) % 2;
        }
        return;
    }

    const elevator = findBestElevator(state, person);
    if (elevator) {
        const elevX = elevator.x * 24;
        const dx = elevX - person.currentX;
        if (Math.abs(dx) < WALK_SPEED) {
            person.currentX = elevX;
            person.state = 'waiting';
            person.waitStartTime = state.gameTime;
            const floor = person.currentFloor;
            if (!elevator.queues[floor]) elevator.queues[floor] = [];
            elevator.queues[floor].push(person.id);
        } else {
            person.currentX += Math.sign(dx) * WALK_SPEED;
            person.walkFrame = (person.walkFrame + 1) % 2;
        }
    } else {
        useStairs(state, person);
    }
}

function useStairs(state, person) {
    person.state = 'using_stairs';
    person.stairTimer = state.gameTime;
    person.stairDirection = person.destination.floor > person.currentFloor ? 1 : -1;
    person.currentX = (state.grid.width - 1) * 24;
    person.happiness = Math.max(0, person.happiness - 2);
}

function findBestElevator(state, person) {
    const from = person.currentFloor;
    const to = person.destination.floor;

    for (const elev of state.elevators) {
        if (elev.config.servedFloors.has(from) && elev.config.servedFloors.has(to)) {
            return elev;
        }
    }

    const lobbies = state.rooms.filter(r => r.type === 'lobby').map(r => r.floor);
    for (const lobbyFloor of lobbies) {
        for (const elev of state.elevators) {
            if (elev.config.servedFloors.has(from) && elev.config.servedFloors.has(lobbyFloor)) {
                return elev;
            }
        }
    }

    return null;
}

function tickVisitors(state, hour) {
    // Parking boosts all visitor spawn rates by 50%
    const hasParking = state.rooms.some(r => r.type === 'parking');
    const parkingMultiplier = hasParking ? 1.5 : 1;

    if (hour >= 10 && hour < 18) {
        const shops = state.rooms.filter(r => r.type === 'shop' && r.occupancy < ROOM_TYPES.shop.maxOccupancy);
        for (const shop of shops) {
            if (Math.random() < 0.01 * state.clock.speed * parkingMultiplier) {
                spawnVisitor(state, shop);
            }
        }
    }

    if ((hour >= 11 && hour < 13) || (hour >= 18 && hour < 20)) {
        const restaurants = state.rooms.filter(r => r.type === 'restaurant' && r.occupancy < ROOM_TYPES.restaurant.maxOccupancy);
        for (const rest of restaurants) {
            if (Math.random() < 0.02 * state.clock.speed * parkingMultiplier) {
                spawnVisitor(state, rest);
            }
        }
    }

    if (hour >= 14 && hour < 16) {
        const hotels = state.rooms.filter(r => r.type === 'hotel' && r.occupancy < ROOM_TYPES.hotel.maxOccupancy);
        for (const hotel of hotels) {
            if (Math.random() < 0.02 * state.clock.speed * parkingMultiplier) {
                spawnVisitor(state, hotel);
            }
        }
    }

    // Gym visitors (morning and evening)
    if ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 21)) {
        const gyms = state.rooms.filter(r => r.type === 'gym' && r.occupancy < ROOM_TYPES.gym.maxOccupancy);
        for (const gym of gyms) {
            if (Math.random() < 0.02 * state.clock.speed * parkingMultiplier) {
                spawnVisitor(state, gym);
            }
        }
    }

    // Cinema visitors (afternoon and evening)
    if ((hour >= 13 && hour < 16) || (hour >= 18 && hour < 23)) {
        const cinemas = state.rooms.filter(r => r.type === 'cinema' && r.occupancy < ROOM_TYPES.cinema.maxOccupancy);
        for (const cinema of cinemas) {
            if (Math.random() < 0.03 * state.clock.speed * parkingMultiplier) {
                spawnVisitor(state, cinema);
            }
        }
    }

    // Medical visitors (daytime)
    if (hour >= 9 && hour < 17) {
        const medicals = state.rooms.filter(r => r.type === 'medical' && r.occupancy < ROOM_TYPES.medical.maxOccupancy);
        for (const medical of medicals) {
            if (Math.random() < 0.01 * state.clock.speed * parkingMultiplier) {
                spawnVisitor(state, medical);
            }
        }
    }
}

function spawnVisitor(state, targetRoom) {
    const person = {
        id: state.nextId++,
        name: FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
        type: 'visitor',
        currentFloor: 0,
        currentX: 0,
        destination: { floor: targetRoom.floor, x: targetRoom.x * 24, action: 'visit' },
        happiness: 70,
        stress: 0,
        state: 'entering',
        homeRoom: targetRoom.id,
        waitStartTime: null,
        leaveTime: state.gameTime + (30 + Math.random() * 30) * 60,
        spriteVariant: Math.floor(Math.random() * SPRITE_VARIANTS),
        walkFrame: 0
    };
    state.people.push(person);
}

function updateHappiness(state, person) {
    let target = 70;

    if (person.type === 'resident' || person.type === 'worker') {
        const home = state.roomsById?.get(person.homeRoom);
        if (home) {
            const adj = getAdjacentRoomTypes(state, home);
            if (adj.includes('restaurant')) target -= 15;
            const hasRestaurant = state.rooms.some(r => r.type === 'restaurant');
            if (hasRestaurant) target += 10;
            // Gym on same floor boosts happiness target
            const hasGymOnFloor = state.rooms.some(r => r.type === 'gym' && r.floor === home.floor);
            if (hasGymOnFloor) target += 8;
            // Cinema in the building boosts happiness target
            const hasCinema = state.rooms.some(r => r.type === 'cinema');
            if (hasCinema) target += 5;
        }
    }

    const lobbyDist = getDistanceToNearestLobby(state, person.currentFloor);
    if (lobbyDist > 10) target -= 5;

    // Stress reduces happiness target
    const stress = person.stress || 0;
    target -= stress * 0.3;

    // Medical office slows happiness decay (faster recovery toward target)
    const hasMedical = state.rooms.some(r => r.type === 'medical');
    const recoveryRate = hasMedical ? 0.015 : 0.01;

    person.happiness += (target - person.happiness) * recoveryRate;
    person.happiness = Math.max(0, Math.min(100, person.happiness));
}

function spawnWorkers(state, hour) {
    if (hour >= 8 && hour < 9) {
        const offices = state.rooms.filter(r => r.type === 'office');
        for (const office of offices) {
            const currentWorkers = state.people.filter(p => p.homeRoom === office.id && p.type === 'worker');
            const needed = ROOM_TYPES.office.maxOccupancy - currentWorkers.length;
            for (let i = 0; i < needed; i++) {
                if (Math.random() < 0.05 * state.clock.speed) {
                    spawnVisitor(state, office);
                    const person = state.people[state.people.length - 1];
                    person.type = 'worker';
                }
            }
        }
    }
}

function updateOccupancy(state) {
    for (const room of state.rooms) {
        room.occupancy = 0;
    }
    for (const person of state.people) {
        if (person.state === 'in_room' && person.homeRoom) {
            const room = state.rooms.find(r => r.id === person.homeRoom);
            if (room) room.occupancy++;
        }
    }
    for (const room of state.rooms) {
        const people = state.people.filter(p => p.homeRoom === room.id);
        if (people.length > 0) {
            room.happiness = people.reduce((sum, p) => sum + p.happiness, 0) / people.length;
        }
    }
}

// ─── Noise propagation ───

export function recalculateNoise(state) {
    // Reset all rooms to their base emitted noise
    const emitted = new Map();
    for (const room of state.rooms) {
        const def = ROOM_TYPES[room.type];
        emitted.set(room.id, def ? (def.noise || 0) : 0);
    }

    // For each room, accumulate noise from same-floor adjacent rooms (60%)
    // and rooms directly above/below (30%)
    const accumulated = new Map();
    for (const room of state.rooms) {
        accumulated.set(room.id, emitted.get(room.id) || 0);
    }

    for (const source of state.rooms) {
        const sourceNoise = emitted.get(source.id) || 0;
        if (sourceNoise === 0) continue;
        const grid = state.grid;

        // Same-floor adjacency: check left and right neighbours
        const fi = floorToIdx(grid, source.floor);
        // Left neighbour
        if (source.x > 0) {
            const leftId = grid.cells[fi]?.[source.x - 1];
            if (leftId !== null && leftId !== undefined && leftId !== source.id) {
                accumulated.set(leftId, (accumulated.get(leftId) || 0) + sourceNoise * 0.6);
            }
        }
        // Right neighbour
        const rightX = source.x + source.width;
        if (rightX < grid.width) {
            const rightId = grid.cells[fi]?.[rightX];
            if (rightId !== null && rightId !== undefined && rightId !== source.id) {
                accumulated.set(rightId, (accumulated.get(rightId) || 0) + sourceNoise * 0.6);
            }
        }

        // Above (floor + 1): find rooms overlapping same x span
        const aboveIdx = floorToIdx(grid, source.floor + 1);
        const aboveCells = grid.cells[aboveIdx];
        if (aboveCells) {
            const seen = new Set();
            for (let x = source.x; x < source.x + source.width; x++) {
                const aboveId = aboveCells[x];
                if (aboveId !== null && aboveId !== undefined && !seen.has(aboveId)) {
                    seen.add(aboveId);
                    accumulated.set(aboveId, (accumulated.get(aboveId) || 0) + sourceNoise * 0.3);
                }
            }
        }

        // Below (floor - 1): find rooms overlapping same x span
        const belowIdx = floorToIdx(grid, source.floor - 1);
        const belowCells = grid.cells[belowIdx];
        if (belowCells) {
            const seen = new Set();
            for (let x = source.x; x < source.x + source.width; x++) {
                const belowId = belowCells[x];
                if (belowId !== null && belowId !== undefined && !seen.has(belowId)) {
                    seen.add(belowId);
                    accumulated.set(belowId, (accumulated.get(belowId) || 0) + sourceNoise * 0.3);
                }
            }
        }
    }

    // Write results back, capped at 100
    for (const room of state.rooms) {
        room.noiseLevel = Math.min(100, accumulated.get(room.id) || 0);
    }
}
