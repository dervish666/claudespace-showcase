// clock.js — Game clock: day/night cycle, time tracking

const DAY_DURATION = 240000; // 4 real minutes = 1 game day at 1x

export function createClock() {
    return { time: 0.25, speed: 1, paused: false, day: 1, daylight: 0.5 };
}

export function tickClock(state, dt) {
    if (state.clock.paused) return;
    const advance = (dt / DAY_DURATION) * state.clock.speed;
    state.clock.time += advance;
    if (state.clock.time >= 1) {
        state.clock.time -= 1;
        state.clock.day++;
        if (state.economy) state.economy.newDay = true;
    }
    // Smooth daylight: 0 at midnight (time=0), 1 at noon (time=0.5)
    state.clock.daylight = (1 - Math.cos(state.clock.time * Math.PI * 2)) / 2;
}

export function getHour(clock) {
    return Math.floor(clock.time * 24);
}

export function getTimeString(clock) {
    const totalMinutes = Math.floor(clock.time * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${h12}:${mins.toString().padStart(2, '0')} ${ampm}`;
}
