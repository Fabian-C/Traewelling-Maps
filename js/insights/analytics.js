// Analytics calculation engine for Träwelling Insights & Wrapped
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
        const dateStr = t?.createdAt || t?.checkin?.createdAt || t?.train?.origin?.departure;
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
        const dateStr = t?.createdAt || t?.checkin?.createdAt || t?.train?.origin?.departure;
        if (!dateStr) return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime()) && date.getFullYear() === targetYear;
    });
}

/**
 * Compute comprehensive analytics and Wrapped insights for a list of trips.
 */
export function calculateWrappedInsights(trips = [], username = '') {
    const validTrips = Array.isArray(trips) ? trips.map(normalizeTripStatus) : [];
    
    let totalKm = 0;
    let totalDurationMs = 0;
    let totalDelayMinutes = 0;
    let onTimeCount = 0;
    let delayedCount = 0;

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

        // Distance: Träwelling API records distances in meters (e.g. 280000 = 280 km)
        const rawDist = (typeof train.totalDistance === 'number' ? train.totalDistance :
                        (typeof train.distance === 'number' ? train.distance :
                        (typeof trip.distance === 'number' ? trip.distance : 0))) || 0;
        const dist = rawDist > 0 ? (rawDist / 1000) : 0;
        totalKm += dist;

        // Longest Trip (distance stored in km)
        if (!longestTrip || dist > longestTrip.distance) {
            longestTrip = {
                id: trip.id,
                distance: dist,
                lineName: train.lineName || train.number || 'Train',
                category: normalizeCategory(train.category),
                origin: train.origin?.name || 'Unknown',
                destination: train.destination?.name || 'Unknown',
                date: trip.createdAt || train.origin?.departure || null
            };
        }

        // Category
        const cat = normalizeCategory(train.category);
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
        const depStr = train.origin?.departure || trip.createdAt;
        const arrStr = train.destination?.arrival;
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

                if (arrStr) {
                    const arrDate = new Date(arrStr);
                    if (!isNaN(arrDate.getTime()) && arrDate > depDate) {
                        totalDurationMs += (arrDate.getTime() - depDate.getTime());
                    }
                }
            }
        }

        // Delays
        const arrDelay = typeof train.arrivalDelay === 'number' ? train.arrivalDelay : 0;
        const depDelay = typeof train.departureDelay === 'number' ? train.departureDelay : 0;
        const delay = Math.max(arrDelay, depDelay);

        if (delay > 0) {
            totalDelayMinutes += delay;
        }

        if (delay <= 5) {
            onTimeCount++;
        } else {
            delayedCount++;
        }

        if (!worstDelay || delay > worstDelay.delayMinutes) {
            if (delay > 0) {
                worstDelay = {
                    id: trip.id,
                    delayMinutes: delay,
                    lineName: train.lineName || train.number || 'Train',
                    category: cat,
                    origin: train.origin?.name || 'Unknown',
                    destination: train.destination?.name || 'Unknown',
                    date: depStr
                };
            }
        }

        // Stations
        const recordStation = (stn) => {
            if (!stn || !stn.name) return;
            const name = stn.name.trim();
            if (!stationStats[name]) {
                stationStats[name] = {
                    name,
                    visits: 0,
                    firstDate: depStr,
                    lastDate: depStr,
                    coords: (stn.latitude && stn.longitude) ? [stn.longitude, stn.latitude] : null
                };
            }
            stationStats[name].visits++;
            if (depStr && (!stationStats[name].lastDate || depStr > stationStats[name].lastDate)) {
                stationStats[name].lastDate = depStr;
            }
            if (depStr && (!stationStats[name].firstDate || depStr < stationStats[name].firstDate)) {
                stationStats[name].firstDate = depStr;
            }
            if (!stationStats[name].coords && stn.latitude && stn.longitude) {
                stationStats[name].coords = [stn.longitude, stn.latitude];
            }
        };

        if (train.origin) recordStation(train.origin);
        if (train.destination) recordStation(train.destination);
        if (Array.isArray(train.stopovers)) {
            train.stopovers.forEach(so => recordStation(so.station || so));
        }

        // Travel Buddies
        const buddies = Array.isArray(trip.buddies) ? trip.buddies : [];
        buddies.forEach(buddy => {
            const bUser = (buddy.username || buddy.displayName || '').toLowerCase().trim();
            if (bUser && bUser !== username.toLowerCase()) {
                if (!buddyStats[bUser]) {
                    buddyStats[bUser] = {
                        username: buddy.username || bUser,
                        displayName: buddy.displayName || buddy.username || bUser,
                        avatar: buddy.profilePicture || null,
                        sharedTrips: 0,
                        sharedKm: 0
                    };
                }
                buddyStats[bUser].sharedTrips++;
                buddyStats[bUser].sharedKm += dist;
            }
        });
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

    // Top Stations
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
            worstDelay
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

    return {
        userA: { name: userA, km: insightsA.totalKm, trips: insightsA.totalTrips, hours: insightsA.totalDurationHours, punctuality: insightsA.punctuality.rate, stations: insightsA.records.uniqueStationsCount },
        userB: { name: userB, km: insightsB.totalKm, trips: insightsB.totalTrips, hours: insightsB.totalDurationHours, punctuality: insightsB.punctuality.rate, stations: insightsB.records.uniqueStationsCount },
        winners: {
            km: insightsA.totalKm >= insightsB.totalKm ? 'userA' : 'userB',
            trips: insightsA.totalTrips >= insightsB.totalTrips ? 'userA' : 'userB',
            hours: insightsA.totalDurationHours >= insightsB.totalDurationHours ? 'userA' : 'userB',
            punctuality: insightsA.punctuality.rate >= insightsB.punctuality.rate ? 'userA' : 'userB',
            stations: insightsA.records.uniqueStationsCount >= insightsB.records.uniqueStationsCount ? 'userA' : 'userB'
        }
    };
}
