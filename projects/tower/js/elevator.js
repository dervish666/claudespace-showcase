// elevator.js — Elevator simulation
import { ELEVATOR_TIERS } from './rooms.js';
import { playEffect } from './sound.js';

export function createElevator(state, roomId, x) {
    const elevator = {
        id: state.nextId++,
        roomId,
        x,
        tier: 'basic',
        config: {
            servedFloors: new Set([0]),
            expressBase: null,
            expressTop: null,
            priorityBias: 0.5
        },
        cars: [{
            id: 0,
            position: 0,
            targetFloor: null,
            passengers: [],
            direction: 1,
            state: 'idle',
            doorTimer: 0
        }],
        queues: {},
        stats: {
            totalWaitTime: 0,
            totalTrips: 0,
            avgWaitTime: 0
        }
    };
    state.elevators.push(elevator);
    return elevator;
}

export function tickElevators(state) {
    for (const elev of state.elevators) {
        const tierDef = ELEVATOR_TIERS[elev.tier];

        // Smart tier: dispatch logic before processing cars
        if (elev.tier === 'smart') {
            tickSmartElevator(state, elev, tierDef);
        }

        for (const car of elev.cars) {
            tickCar(state, elev, car, tierDef);
        }
    }
}

function tickCar(state, elev, car, tierDef) {
    switch (car.state) {
        case 'idle': {
            const nextFloor = elev.tier === 'express'
                ? findNextStopExpress(elev, car)
                : findNextStop(elev, car);
            if (nextFloor !== null) {
                car.targetFloor = nextFloor;
                car.state = 'moving';
            }
            break;
        }

        case 'moving': {
            const speed = tierDef.speed;
            const dt = 1 / 30;
            const distance = speed * dt * state.clock.speed;

            if (car.position < car.targetFloor) {
                car.position = Math.min(car.position + distance, car.targetFloor);
                car.direction = 1;
            } else if (car.position > car.targetFloor) {
                car.position = Math.max(car.position - distance, car.targetFloor);
                car.direction = -1;
            }

            if (Math.abs(car.position - car.targetFloor) < 0.01) {
                car.position = Math.round(car.position);
                car.state = 'loading';
                car.doorTimer = 30;
                playEffect('ding');
            }
            break;
        }

        case 'loading': {
            car.doorTimer--;
            if (car.doorTimer <= 0) {
                unloadPassengers(state, elev, car);
                loadPassengers(state, elev, car, tierDef.capacity);

                const next = elev.tier === 'express'
                    ? findNextStopExpress(elev, car)
                    : findNextStop(elev, car);
                if (next !== null) {
                    car.targetFloor = next;
                    car.state = 'moving';
                } else {
                    car.state = 'idle';
                }
            }
            break;
        }
    }
}

// LOOK algorithm — continue in current direction, reverse when no more demand ahead
function findNextStop(elev, car) {
    const currentFloor = Math.round(car.position);
    const served = elev.config.servedFloors;

    const demandFloors = new Set();

    for (const [floor, queue] of Object.entries(elev.queues)) {
        if (queue.length > 0 && served.has(Number(floor))) {
            demandFloors.add(Number(floor));
        }
    }

    for (const p of car.passengers) {
        demandFloors.add(p.destFloor);
    }

    if (demandFloors.size === 0) return null;

    const inDirection = [...demandFloors].filter(f =>
        car.direction > 0 ? f > currentFloor : f < currentFloor
    ).sort((a, b) => car.direction > 0 ? a - b : b - a);

    if (inDirection.length > 0) return inDirection[0];

    // No demand in current direction — reverse
    const reversed = [...demandFloors].sort((a, b) =>
        car.direction > 0 ? b - a : a - b
    );

    if (reversed.length > 0) {
        car.direction *= -1;
        return reversed[0];
    }

    return null;
}

// Express tier: shuttle between expressBase and expressTop, then use LOOK
function findNextStopExpress(elev, car) {
    const current = Math.round(car.position);
    const { expressBase, expressTop } = elev.config;

    // If express range is configured and car is below the express top, shuttle
    if (expressBase !== null && expressTop !== null && current < expressTop) {
        if (car.direction > 0) return expressTop;
        return expressBase;
    }

    return findNextStop(elev, car);
}

// Smart tier: pre-dispatch idle cars toward highest-demand floors
function tickSmartElevator(state, elev, tierDef) {
    const demand = {};
    for (const [floor, queue] of Object.entries(elev.queues)) {
        demand[floor] = queue.length;
    }

    for (const car of elev.cars) {
        if (car.state === 'idle') {
            const floors = Object.entries(demand)
                .filter(([, d]) => d > 0)
                .sort((a, b) => b[1] - a[1]);

            if (floors.length > 0) {
                const bestFloor = Number(floors[0][0]);
                car.targetFloor = bestFloor;
                car.state = 'moving';
            }
        }
    }
}

function unloadPassengers(state, elev, car) {
    const floor = Math.round(car.position);
    const exiting = car.passengers.filter(p => p.destFloor === floor);

    for (const p of exiting) {
        const person = state.people.find(pp => pp.id === p.personId);
        if (person) {
            person.state = 'walking';
            person.currentFloor = floor;
            person.currentX = elev.x * 24; // CELL_W
        }
    }

    car.passengers = car.passengers.filter(p => p.destFloor !== floor);
}

function loadPassengers(state, elev, car, capacity) {
    const floor = Math.round(car.position);
    const queue = elev.queues[floor] || [];

    while (queue.length > 0 && car.passengers.length < capacity) {
        const personId = queue.shift();
        const person = state.people.find(p => p.id === personId);
        if (person) {
            person.state = 'riding';
            car.passengers.push({
                personId: person.id,
                destFloor: person.destination.floor
            });

            const waitTime = person.waitStartTime
                ? (state.gameTime - person.waitStartTime)
                : 0;
            elev.stats.totalWaitTime += waitTime;
            elev.stats.totalTrips++;
            elev.stats.avgWaitTime = elev.stats.totalWaitTime / elev.stats.totalTrips;
        }
    }

    elev.queues[floor] = queue;
}
