// rooms.js — Room type definitions and elevator tiers

export const ROOM_TYPES = {
    lobby:      { name: 'Lobby',      width: 'full', cost: 0,     revenue: 0,   runningCost: 0,   maxOccupancy: 0,  minStars: 1, category: 'special',     color: '#8b7d5e', description: 'Main entrance.',                                noise: 20 },
    condo:      { name: 'Condo',      width: 3,      cost: 4000,  revenue: 300, runningCost: 15,  maxOccupancy: 2,  minStars: 1, category: 'residential', color: '#4a3c6e', description: 'Residents live here. Quiet preferred.',         noise: 5  },
    shop:       { name: 'Shop',       width: 2,      cost: 2500,  revenue: 200, runningCost: 10,  maxOccupancy: 4,  minStars: 1, category: 'commercial',  color: '#3a5e4a', description: 'Retail. Better revenue near lobby.',            noise: 15 },
    office:     { name: 'Office',     width: 4,      cost: 10000, revenue: 500, runningCost: 50,  maxOccupancy: 6,  minStars: 2, category: 'commercial',  color: '#3a4a5e', description: 'Workers commute in during the day.',            noise: 10 },
    restaurant: { name: 'Restaurant', width: 5,      cost: 15000, revenue: 500, runningCost: 50,  maxOccupancy: 10, minStars: 2, category: 'commercial',  color: '#5e3a3a', description: 'Lunch & dinner peaks. Noisy for condos.',       noise: 40 },
    hotel:      { name: 'Hotel',      width: 2,      cost: 8000,  revenue: 300, runningCost: 30,  maxOccupancy: 2,  minStars: 3, category: 'residential', color: '#4a4a3a', description: 'Guests check in/out daily.',                    noise: 5  },
    gym:        { name: 'Gym',        width: 3,      cost: 8000,  revenue: 200, runningCost: 30,  maxOccupancy: 8,  minStars: 1, category: 'commercial',  color: '#5e4a3a', description: 'Boosts happiness for condos on same floor.',    noise: 35 },
    cinema:     { name: 'Cinema',     width: 5,      cost: 20000, revenue: 800, runningCost: 80,  maxOccupancy: 20, minStars: 3, category: 'commercial',  color: '#3a2a4e', description: 'Evening entertainment. High capacity.',         noise: 30 },
    medical:    { name: 'Medical',    width: 3,      cost: 12000, revenue: 400, runningCost: 40,  maxOccupancy: 6,  minStars: 2, category: 'commercial',  color: '#3a5e5e', description: 'Health services. Reduces happiness decay.',     noise: 10 },
    parking:    { name: 'Parking',    width: 4,      cost: 5000,  revenue: 100, runningCost: 10,  maxOccupancy: 0,  minStars: 1, category: 'special',     color: '#4a4a4a', description: 'Boosts visitor traffic 50%. Place on lower floors.', noise: 25 },
    elevator:   { name: 'Elevator',   width: 1,      cost: 2000,  revenue: 0,   runningCost: 25,  maxOccupancy: 0,  minStars: 1, category: 'transport',   color: '#333344', description: 'Vertical transport. The core mechanic.',       noise: 20 },
    sky_lobby:  { name: 'Sky Lobby',  width: 'full', cost: 25000, revenue: 0,   runningCost: 100, maxOccupancy: 0,  minStars: 4, category: 'special',     color: '#7d8b6e', description: 'Transfer point for elevators.',                noise: 15 }
};

export const ELEVATOR_TIERS = {
    basic:   { name: 'Basic',   cost: 2000,  capacity: 6,  speed: 0.5, minStars: 1, carsPerShaft: 1 },
    express: { name: 'Express', cost: 5000,  capacity: 10, speed: 1.0, minStars: 2, carsPerShaft: 1 },
    smart:   { name: 'Smart',   cost: 10000, capacity: 12, speed: 1.0, minStars: 3, carsPerShaft: 3 }
};
