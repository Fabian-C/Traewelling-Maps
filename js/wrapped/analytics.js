// Analytics calculation engine for Träwelling Rail Wrapped
import { normalizeCategory, normalizeTripStatus } from '../data/processing.js';

export const EARTH_CIRCUMFERENCE_KM = 40075;
export const MOON_DISTANCE_KM = 384400;

export const CATEGORY_LABELS = {
    nationalExpress: 'ICE / TGV',
    national: 'IC / EC',
    regionalExp: 'RE',
    regional: 'RB',
    suburban: 'S-Bahn',
    bus: 'Bus',
    tram: 'Tram',
    subway: 'U-Bahn',
    taxi: 'Taxi',
    plane: 'Flight',
    ferry: 'Ferry',
    unknown: 'Other'
};

export const CATEGORY_COLORS = {
    nationalExpress: '#e74c3c',
    national: '#e67e22',
    regionalExp: '#9b59b6',
    regional: '#3498db',
    suburban: '#2ecc71',
    bus: '#1abc9c',
    tram: '#f39c12',
    subway: '#34495e',
    taxi: '#f1c40f',
    plane: '#95a5a6',
    ferry: '#16a085',
    unknown: '#7f8c8d'
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Extract all unique years present in a list of trips.
 */
export function extractAvailableYears(trips = []) {
    const years = new Set();
    trips.forEach(t => {
        const train = t?.train || t?.checkin || {};
        const dateStr = t?.createdAt || t?.checkin?.createdAt ||
            train.origin?.departureReal || train.origin?.departurePlanned || train.origin?.departure;
        if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                years.add(date.getFullYear());
            }
        }
    });
    return Array.from(years).sort((a, b) => b - a);
}

/**
 * Filter trips by a specific year or return all.
 */
export function filterTripsByYear(trips = [], selectedYear = 'all') {
    if (!selectedYear || selectedYear === 'all' || selectedYear === 'All-Time') {
        return trips;
    }
    const targetYear = parseInt(selectedYear, 10);
    return trips.filter(t => {
        const train = t?.train || t?.checkin || {};
        const dateStr = t?.createdAt || t?.checkin?.createdAt ||
            train.origin?.departureReal || train.origin?.departurePlanned || train.origin?.departure;
        if (!dateStr) return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime()) && date.getFullYear() === targetYear;
    });
}

/**
 * Haversine formula to compute geodesic distance (in kilometers) between two coordinates.
 */
export function calculateHaversineKm(lat1, lon1, lat2, lon2) {
    if (typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
        typeof lat2 !== 'number' || typeof lon2 !== 'number') return null;
    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return null;
    // Reject Null Island or out-of-bounds coordinates
    if (Math.abs(lat1) < 0.1 && Math.abs(lon1) < 0.1) return null;
    if (Math.abs(lat2) < 0.1 && Math.abs(lon2) < 0.1) return null;
    if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) return null;
    if (lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) return null;

    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Sanitize trip distance in kilometers to avoid Hafas coordinate loop glitches (e.g. 5,000+ km ICE trips).
 */
export function sanitizeTripDistanceKm(rawKm, originLat, originLon, destLat, destLon, category) {
    if (typeof rawKm !== 'number' || isNaN(rawKm) || rawKm < 0) {
        rawKm = 0;
    }

    const haversineKm = calculateHaversineKm(originLat, originLon, destLat, destLon);

    // Realistic physical maximum single trip distances by transit mode
    const MAX_BY_CATEGORY = {
        highspeed: 1400, // ICE/TGV single trip max in Central Europe
        regional: 600,   // RE/IC regional max
        suburban: 160,   // S-Bahn max
        subway: 80,      // U-Bahn max
        tram: 80,        // Tram / Strab
        bus: 200,        // Bus
        ferry: 800,      // Ferry
        cablecar: 30,    // Seilbahn
        other: 1500
    };
    const maxAllowedKm = MAX_BY_CATEGORY[category] || 1500;

    if (haversineKm !== null && haversineKm > 0) {
        // If raw distance is missing or zero, estimate track distance as ~1.25x straight line
        if (rawKm === 0) {
            return Math.min(Math.round(haversineKm * 1.25 * 10) / 10, maxAllowedKm);
        }
        // If raw distance exceeds 3x the straight-line distance + 50km or exceeds category max, it's an upstream coordinate loop / Null Island glitch!
        if (rawKm > (haversineKm * 3 + 50) || rawKm > maxAllowedKm) {
            return Math.min(Math.round(haversineKm * 1.25 * 10) / 10, maxAllowedKm);
        }
        return Math.min(rawKm, maxAllowedKm);
    }

    // No valid coordinates: clamp to physical category ceiling
    return Math.min(rawKm, maxAllowedKm);
}

/**
 * Compute comprehensive analytics and Rail Wrapped insights for a list of trips.
 */
export function calculateWrappedInsights(trips = [], username = '') {
    const validTrips = Array.isArray(trips) ? trips.map(normalizeTripStatus) : [];
    
    let totalKm = 0;
    let totalDurationMs = 0;
    let totalDelayMinutes = 0;
    let onTimeCount = 0;
    let delayedCount = 0;

    // Delay tiers (4-tier spectrum)
    let tierOnTime = 0;   // <= 5 min
    let tierMinor = 0;    // 6 - 15 min
    let tierModerate = 0; // 16 - 30 min
    let tierSevere = 0;   // > 30 min

    let worstDelay = null;
    let longestTrip = null;

    // Line and Category counters
    const lineCounts = {};
    const categoryStats = {};
    
    // Day (0..6) x Hour (0..23) matrix
    const dayHourMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    const dayTotals = Array(7).fill(0);
    const hourTotals = Array(24).fill(0);
    const monthTotals = Array(12).fill(0);

    // Station frequency & coordinate lookup
    const stationStats = {};

    // Buddy counters
    const buddyStats = {};

    validTrips.forEach(trip => {
        const train = trip.train || trip.checkin || {};
        const cat = normalizeCategory(train.category);

        // Distance: Träwelling API records distances in meters (e.g. 280000 = 280 km)
        const rawDist = (typeof train.totalDistance === 'number' ? train.totalDistance :
                        (typeof train.distance === 'number' ? train.distance :
                        (typeof trip.distance === 'number' ? trip.distance : 0))) || 0;
        const rawKm = rawDist > 0 ? (rawDist / 1000) : 0;

        const originLat = typeof train.origin?.latitude === 'number' ? train.origin.latitude : train.origin?.station?.latitude;
        const originLon = typeof train.origin?.longitude === 'number' ? train.origin.longitude : train.origin?.station?.longitude;
        const destLat = typeof train.destination?.latitude === 'number' ? train.destination.latitude : train.destination?.station?.latitude;
        const destLon = typeof train.destination?.longitude === 'number' ? train.destination.longitude : train.destination?.station?.longitude;

        const dist = sanitizeTripDistanceKm(rawKm, originLat, originLon, destLat, destLon, cat);
        totalKm += dist;

        // Longest Trip (distance stored in km)
        if (!longestTrip || dist > longestTrip.distance) {
            longestTrip = {
                id: trip.id,
                distance: dist,
                lineName: train.lineName || train.number || 'Train',
                category: cat,
                origin: train.origin?.name || train.origin?.station?.name || 'Unknown',
                destination: train.destination?.name || train.destination?.station?.name || 'Unknown',
                date: trip.createdAt || train.origin?.departure || null
            };
        }

        // Category
        if (!categoryStats[cat]) {
            categoryStats[cat] = { trips: 0, distance: 0 };
        }
        categoryStats[cat].trips++;
        categoryStats[cat].distance += dist;

        // Line
        const line = (train.lineName || train.number || 'Unknown').trim();
        if (line && line !== 'Unknown') {
            lineCounts[line] = (lineCounts[line] || 0) + 1;
        }

        // Dates & Timing
        const depStr = train.origin?.departureReal || train.origin?.departurePlanned || train.origin?.departure || trip.createdAt;
        const arrStr = train.destination?.arrivalReal || train.destination?.arrivalPlanned || train.destination?.arrival;
        if (depStr) {
            const depDate = new Date(depStr);
            if (!isNaN(depDate.getTime())) {
                const day = depDate.getDay();
                const hour = depDate.getHours();
                const month = depDate.getMonth();
                dayHourMatrix[day][hour]++;
                dayTotals[day]++;
                hourTotals[hour]++;
                monthTotals[month]++;

                let tripDurationMs = 0;
                if (arrStr) {
                    const arrDate = new Date(arrStr);
                    if (!isNaN(arrDate.getTime()) && arrDate > depDate) {
                        tripDurationMs = (arrDate.getTime() - depDate.getTime());
                    }
                }
                // Fallback to train.duration (minutes in Träwelling API)
                if (tripDurationMs === 0 && typeof train.duration === 'number' && train.duration > 0) {
                    tripDurationMs = train.duration * 60 * 1000;
                }
                totalDurationMs += tripDurationMs;
            }
        }

        // Delays: evaluate explicit delay numbers or calculate from planned vs real telemetry
        let derivedArrDelay = null;
        if (train.destination?.arrivalReal && train.destination?.arrivalPlanned) {
            const p = new Date(train.destination.arrivalPlanned).getTime();
            const r = new Date(train.destination.arrivalReal).getTime();
            if (!isNaN(p) && !isNaN(r)) {
                derivedArrDelay = Math.round((r - p) / 60000);
            }
        }
        let derivedDepDelay = null;
        if (train.origin?.departureReal && train.origin?.departurePlanned) {
            const p = new Date(train.origin.departurePlanned).getTime();
            const r = new Date(train.origin.departureReal).getTime();
            if (!isNaN(p) && !isNaN(r)) {
                derivedDepDelay = Math.round((r - p) / 60000);
            }
        }

        const arrDelay = typeof train.arrivalDelay === 'number' ? train.arrivalDelay : (derivedArrDelay ?? 0);
        const depDelay = typeof train.departureDelay === 'number' ? train.departureDelay : (derivedDepDelay ?? 0);
        const delay = Math.max(arrDelay, depDelay);

        if (delay > 0) {
            totalDelayMinutes += delay;
        }

        if (delay <= 5) {
            onTimeCount++;
            tierOnTime++;
        } else {
            delayedCount++;
            if (delay <= 15) {
                tierMinor++;
            } else if (delay <= 30) {
                tierModerate++;
            } else {
                tierSevere++;
            }
        }

        if (!worstDelay || delay > worstDelay.delayMinutes) {
            if (delay > 0) {
                worstDelay = {
                    id: trip.id,
                    delayMinutes: delay,
                    lineName: train.lineName || train.number || 'Train',
                    category: cat,
                    origin: train.origin?.name || train.origin?.station?.name || 'Unknown',
                    destination: train.destination?.name || train.destination?.station?.name || 'Unknown',
                    date: depStr
                };
            }
        }

        // Stations: ONLY record arrival stations (destination stations)
        const recordArrivalStation = (stn) => {
            if (!stn) return;
            const name = (stn.name || stn.station?.name || '').trim();
            if (!name) return;

            const lat = typeof stn.latitude === 'number' ? stn.latitude : stn.station?.latitude;
            const lon = typeof stn.longitude === 'number' ? stn.longitude : stn.station?.longitude;
            const coords = (typeof lat === 'number' && typeof lon === 'number') ? [lon, lat] : null;
            const stnDate = arrStr || depStr;

            if (!stationStats[name]) {
                stationStats[name] = {
                    name,
                    visits: 0,
                    firstDate: stnDate,
                    lastDate: stnDate,
                    coords
                };
            }
            stationStats[name].visits++;
            if (stnDate && (!stationStats[name].lastDate || stnDate > stationStats[name].lastDate)) {
                stationStats[name].lastDate = stnDate;
            }
            if (stnDate && (!stationStats[name].firstDate || stnDate < stationStats[name].firstDate)) {
                stationStats[name].firstDate = stnDate;
            }
            if (!stationStats[name].coords && coords) {
                stationStats[name].coords = coords;
            }
        };

        if (train.destination) recordArrivalStation(train.destination);

        // Travel Buddies (aggregate from buddies, bodyMentions, fellowPassengers, createdBy, and @notes)
        const buddyUsers = new Set();
        const recordBuddy = (usernameCandidate, displayCandidate, avatarCandidate) => {
            const bUser = (usernameCandidate || displayCandidate || '').toLowerCase().trim();
            if (!bUser || bUser === username.toLowerCase() || buddyUsers.has(bUser)) return;
            buddyUsers.add(bUser);

            if (!buddyStats[bUser]) {
                buddyStats[bUser] = {
                    username: usernameCandidate || bUser,
                    displayName: displayCandidate || usernameCandidate || bUser,
                    avatar: avatarCandidate || null,
                    sharedTrips: 0,
                    sharedKm: 0
                };
            }
            buddyStats[bUser].sharedTrips++;
            buddyStats[bUser].sharedKm += dist;
        };

        if (Array.isArray(trip.buddies)) {
            trip.buddies.forEach(b => recordBuddy(b.username, b.displayName, b.profilePicture));
        }
        if (Array.isArray(trip.bodyMentions)) {
            trip.bodyMentions.forEach(m => recordBuddy(m.user?.username || m.username, m.user?.displayName, m.user?.profilePicture));
        }
        if (Array.isArray(trip.fellowPassengers)) {
            trip.fellowPassengers.forEach(fp => recordBuddy(fp.user?.username || fp.username, fp.user?.displayName, fp.user?.profilePicture));
        }
        if (trip.createdBy?.username) {
            recordBuddy(trip.createdBy.username, trip.createdBy.displayName, trip.createdBy.profilePicture);
        }
        if (typeof trip.body === 'string' && trip.body.includes('@')) {
            const matches = trip.body.match(/@([a-zA-Z0-9_-]+)/g);
            if (matches) {
                matches.forEach(m => recordBuddy(m.substring(1)));
            }
        }
    });

    // Fallback duration estimation if arrival times weren't recorded: avg rail speed 80 km/h
    if (totalDurationMs === 0 && totalKm > 0) {
        totalDurationMs = (totalKm / 80) * 3600 * 1000;
    }
    const totalDurationHours = Math.round(totalDurationMs / (1000 * 60 * 60));

    // Top Line
    const sortedLines = Object.entries(lineCounts)
        .map(([line, count]) => ({ line, count }))
        .sort((a, b) => b.count - a.count);
    const favoriteLine = sortedLines[0] || null;

    // Top Category
    const sortedCategories = Object.entries(categoryStats)
        .map(([cat, stats]) => ({
            category: cat,
            label: CATEGORY_LABELS[cat] || cat,
            color: CATEGORY_COLORS[cat] || '#888',
            trips: stats.trips,
            distance: Math.round(stats.distance),
            percent: validTrips.length ? Math.round((stats.trips / validTrips.length) * 100) : 0
        }))
        .sort((a, b) => b.trips - a.trips);
    const favoriteCategory = sortedCategories[0] || null;

    // Top Stations (Only arrival destinations)
    const sortedStations = Object.values(stationStats)
        .sort((a, b) => b.visits - a.visits);

    // Top Buddies
    const sortedBuddies = Object.values(buddyStats)
        .sort((a, b) => b.sharedTrips - a.sharedTrips);

    // Busiest Day & Hour
    let maxDayIdx = 0;
    dayTotals.forEach((count, idx) => {
        if (count > dayTotals[maxDayIdx]) maxDayIdx = idx;
    });

    let maxHourIdx = 0;
    hourTotals.forEach((count, idx) => {
        if (count > hourTotals[maxHourIdx]) maxHourIdx = idx;
    });

    let maxMonthIdx = 0;
    monthTotals.forEach((count, idx) => {
        if (count > monthTotals[maxMonthIdx]) maxMonthIdx = idx;
    });

    // Punctuality rate
    const punctualityRate = validTrips.length > 0
        ? Math.round((onTimeCount / validTrips.length) * 100)
        : 100;

    // CO2 savings vs car (approx 120g net saving per passenger-km)
    const co2SavedKg = Math.round(totalKm * 0.12);

    return {
        totalTrips: validTrips.length,
        totalKm: Math.round(totalKm),
        earthCircumferences: Number((totalKm / EARTH_CIRCUMFERENCE_KM).toFixed(2)),
        moonDistancePercent: Number(((totalKm / MOON_DISTANCE_KM) * 100).toFixed(1)),
        totalDurationHours,
        co2SavedKg,
        punctuality: {
            rate: punctualityRate,
            onTimeCount,
            delayedCount,
            totalDelayMinutes,
            worstDelay,
            tiers: {
                onTime: tierOnTime,
                minor: tierMinor,
                moderate: tierModerate,
                severe: tierSevere,
                onTimePct: validTrips.length > 0 ? Math.round((tierOnTime / validTrips.length) * 100) : 100,
                minorPct: validTrips.length > 0 ? Math.round((tierMinor / validTrips.length) * 100) : 0,
                moderatePct: validTrips.length > 0 ? Math.round((tierModerate / validTrips.length) * 100) : 0,
                severePct: validTrips.length > 0 ? Math.round((tierSevere / validTrips.length) * 100) : 0
            }
        },
        habits: {
            dayHourMatrix,
            busiestDayName: DAY_NAMES[maxDayIdx],
            busiestHourLabel: `${String(maxHourIdx).padStart(2, '0')}:00`,
            busiestMonthName: MONTH_NAMES[maxMonthIdx],
            dayTotals,
            hourTotals
        },
        records: {
            longestTrip,
            favoriteLine,
            favoriteCategory,
            uniqueStationsCount: sortedStations.length,
            topStations: sortedStations.slice(0, 10),
            categoryBreakdown: sortedCategories,
            topBuddies: sortedBuddies.slice(0, 5)
        }
    };
}

/**
 * Compare two user summaries for head-to-head traveler duel mode.
 */
export function compareUsers(insightsA, insightsB, userA = 'Player 1', userB = 'Player 2') {
    if (!insightsA || !insightsB) return null;

    const judgeWinner = (valA, valB) => {
        if (valA > valB) return 'userA';
        if (valB > valA) return 'userB';
        return 'tie';
    };

    return {
        userA: { name: userA, km: insightsA.totalKm, trips: insightsA.totalTrips, hours: insightsA.totalDurationHours, punctuality: insightsA.punctuality.rate, stations: insightsA.records.uniqueStationsCount },
        userB: { name: userB, km: insightsB.totalKm, trips: insightsB.totalTrips, hours: insightsB.totalDurationHours, punctuality: insightsB.punctuality.rate, stations: insightsB.records.uniqueStationsCount },
        winners: {
            km: judgeWinner(insightsA.totalKm, insightsB.totalKm),
            trips: judgeWinner(insightsA.totalTrips, insightsB.totalTrips),
            hours: judgeWinner(insightsA.totalDurationHours, insightsB.totalDurationHours),
            punctuality: judgeWinner(insightsA.punctuality.rate, insightsB.punctuality.rate),
            stations: judgeWinner(insightsA.records.uniqueStationsCount, insightsB.records.uniqueStationsCount)
        }
    };
}
