// sound.js — Ambient sound engine using Web Audio API
// Provides city ambience that responds to time of day and tower activity

let audioCtx = null;
let masterGain = null;
let enabled = false;
let initialized = false;

// Sound layers
let cityDrone = null;
let trafficNoise = null;

export function initSound() {
    // Sound starts on first user interaction (autoplay policy)
    const start = () => {
        if (initialized) return;
        initialized = true;

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.12;
        masterGain.connect(audioCtx.destination);

        createCityAmbience();
        enabled = true;

        document.removeEventListener('click', start);
        document.removeEventListener('touchstart', start);
    };

    document.addEventListener('click', start, { once: false });
    document.addEventListener('touchstart', start, { once: false });
}

function createCityAmbience() {
    // Low city drone — filtered noise
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);

    // Brown noise (more urban-sounding than white)
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
    }

    // City drone layer
    cityDrone = audioCtx.createBufferSource();
    cityDrone.buffer = noiseBuffer;
    cityDrone.loop = true;

    const droneFilter = audioCtx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 200;
    droneFilter.Q.value = 0.5;

    const droneGain = audioCtx.createGain();
    droneGain.gain.value = 0.6;

    cityDrone.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(masterGain);
    cityDrone.start();

    // Traffic layer — slightly higher frequency noise
    trafficNoise = audioCtx.createBufferSource();
    const trafficBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const tData = trafficBuffer.getChannelData(0);
    let tLast = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        tLast = (tLast + 0.04 * white) / 1.04;
        tData[i] = tLast * 2;
    }
    trafficNoise.buffer = trafficBuffer;
    trafficNoise.loop = true;

    const trafficFilter = audioCtx.createBiquadFilter();
    trafficFilter.type = 'bandpass';
    trafficFilter.frequency.value = 400;
    trafficFilter.Q.value = 0.3;

    const trafficGain = audioCtx.createGain();
    trafficGain.gain.value = 0.3;

    trafficNoise.connect(trafficFilter);
    trafficFilter.connect(trafficGain);
    trafficGain.connect(masterGain);
    trafficNoise.start();

    // Store references for time-of-day updates
    cityDrone._gain = droneGain;
    cityDrone._filter = droneFilter;
    trafficNoise._gain = trafficGain;
    trafficNoise._filter = trafficFilter;
}

// Call each frame to adjust ambience based on game state
export function updateSound(state) {
    if (!enabled || !audioCtx) return;

    const daylight = state.clock.daylight;
    const hour = Math.floor(state.clock.time * 24);
    const population = state.people.length;

    // City is louder during daytime, quieter at night
    const dayVolume = 0.08 + daylight * 0.08;
    masterGain.gain.linearRampToValueAtTime(dayVolume, audioCtx.currentTime + 0.5);

    // Traffic varies with time — rush hours are louder
    if (trafficNoise._gain) {
        let trafficLevel = 0.2;
        if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18)) {
            trafficLevel = 0.5; // rush hour
        } else if (hour >= 22 || hour <= 5) {
            trafficLevel = 0.05; // late night quiet
        }
        // More traffic with more population
        trafficLevel *= (0.5 + Math.min(population / 200, 1) * 0.5);
        trafficNoise._gain.gain.linearRampToValueAtTime(trafficLevel, audioCtx.currentTime + 1);
    }

    // Drone frequency shifts slightly with time
    if (cityDrone._filter) {
        const freq = 150 + daylight * 100; // deeper at night
        cityDrone._filter.frequency.linearRampToValueAtTime(freq, audioCtx.currentTime + 1);
    }
}

// Play a one-shot sound effect
export function playEffect(type) {
    if (!enabled || !audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(masterGain);

    switch (type) {
        case 'place':
            // Pleasant placement chime
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523, audioCtx.currentTime); // C5
            osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.08); // E5
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.3);
            break;

        case 'error':
            // Low buzz for invalid placement
            osc.type = 'square';
            osc.frequency.setValueAtTime(100, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.15);
            break;

        case 'ding':
            // Elevator ding
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.5);
            break;

        case 'cash':
            // Cash register for revenue
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1047, audioCtx.currentTime); // C6
            osc.frequency.setValueAtTime(1319, audioCtx.currentTime + 0.05);
            osc.frequency.setValueAtTime(1568, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.25);
            break;
    }
}

export function toggleSound() {
    if (!audioCtx) return false;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
        enabled = true;
    } else if (enabled) {
        audioCtx.suspend();
        enabled = false;
    } else {
        audioCtx.resume();
        enabled = true;
    }
    return enabled;
}

export function isSoundEnabled() {
    return enabled;
}
