// Time and date utilities

/**
 * Parse a date value to Date object
 */
export function getDelayDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute trip duration in minutes from train data
 */
export function computeTripDurationMinutes(train = {}) {
    if (!train) return null;
    const origin = train.origin || {};
    const dest = train.destination || {};

    // 1. First check actual / real-time departure and arrival
    const actualDeparture = getDelayDate(origin.departureReal || origin.departure || train.departure || train.manualDeparture);
    const actualArrival = getDelayDate(dest.arrivalReal || dest.arrival || train.arrival || train.manualArrival);

    if (actualDeparture && actualArrival) {
        const diffMs = actualArrival.getTime() - actualDeparture.getTime();
        if (diffMs > 0) {
            return Math.max(1, Math.round(diffMs / 60000));
        }
    }

    // 2. Fall back to planned timetable schedule if real-time times are identical, inverted, or missing
    const plannedDeparture = getDelayDate(origin.departurePlanned || train.plannedDeparture || train.manualDeparture);
    const plannedArrival = getDelayDate(dest.arrivalPlanned || train.plannedArrival || train.manualArrival);

    if (plannedDeparture && plannedArrival) {
        const plannedDiffMs = plannedArrival.getTime() - plannedDeparture.getTime();
        if (plannedDiffMs > 0) {
            return Math.max(1, Math.round(plannedDiffMs / 60000));
        }
    }

    // 3. Fall back to any combination of departure/arrival
    const anyDeparture = actualDeparture || plannedDeparture;
    const anyArrival = actualArrival || plannedArrival;
    if (anyDeparture && anyArrival) {
        const diffMs = anyArrival.getTime() - anyDeparture.getTime();
        if (diffMs > 0) {
            return Math.max(1, Math.round(diffMs / 60000));
        }
    }

    // 4. Fall back to train.duration or train.totalDuration (provided in minutes in Träwelling API)
    const duration = typeof train.totalDuration === 'number' ? train.totalDuration : (typeof train.duration === 'number' ? train.duration : null);
    if (typeof duration === 'number' && duration > 0) {
        return Math.round(duration);
    }

    // 5. If origin and dest are distinct valid stations, minimum transit time is 1 min
    if (origin.name && dest.name && origin.name !== dest.name) {
        return 1;
    }

    return null;
}

/**
 * Derive delay seconds from train data
 */
export function deriveDelaySeconds(train = {}) {
    if (!train) return { departure: null, arrival: null, worst: null };
    const origin = train.origin || {};
    const dest = train.destination || {};

    const plannedDeparture = getDelayDate(origin.departurePlanned || train.plannedDeparture || train.manualDeparture);
    const actualDeparture = getDelayDate(origin.departureReal || origin.departure || train.departure || train.manualDeparture);
    const plannedArrival = getDelayDate(dest.arrivalPlanned || train.plannedArrival || train.manualArrival);
    const actualArrival = getDelayDate(dest.arrivalReal || dest.arrival || train.arrival || train.manualArrival);

    const derivedDepartureDelay = (plannedDeparture && actualDeparture) ? Math.round((actualDeparture - plannedDeparture) / 1000) : null;
    const derivedArrivalDelay = (plannedArrival && actualArrival) ? Math.round((actualArrival - plannedArrival) / 1000) : null;

    const departureDelay = typeof train.departureDelay === 'number' ? train.departureDelay : derivedDepartureDelay;
    const arrivalDelay = typeof train.arrivalDelay === 'number' ? train.arrivalDelay : derivedArrivalDelay;

    const delays = [departureDelay, arrivalDelay].filter(value => typeof value === 'number' && !Number.isNaN(value));
    const worst = delays.length ? Math.max(...delays) : null;

    return { departure: departureDelay ?? null, arrival: arrivalDelay ?? null, worst };
}
