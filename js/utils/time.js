// Time and date utilities

/**
 * Parse a date value to Date object
 */
export function getDelayDate(value) {
    return value ? new Date(value) : null;
}

/**
 * Compute trip duration in minutes from train data
 */
export function computeTripDurationMinutes(train = {}) {
    if (!train) return null;
    const origin = train.origin || {};
    const dest = train.destination || {};
    const departure = getDelayDate(origin.departureReal || origin.departure || train.departure || train.plannedDeparture);
    const arrival = getDelayDate(dest.arrivalReal || dest.arrival || train.arrival || train.plannedArrival);
    if (departure && arrival) {
        return Math.max(1, Math.round((arrival - departure) / 60000));
    }
    if (typeof train.duration === 'number' && train.duration > 0) {
        return Math.round(train.duration);
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

    const plannedDeparture = getDelayDate(origin.departurePlanned || train.plannedDeparture);
    const actualDeparture = getDelayDate(origin.departureReal || origin.departure || train.departure);
    const plannedArrival = getDelayDate(dest.arrivalPlanned || train.plannedArrival);
    const actualArrival = getDelayDate(dest.arrivalReal || dest.arrival || train.arrival);

    const derivedDepartureDelay = (plannedDeparture && actualDeparture) ? Math.round((actualDeparture - plannedDeparture) / 1000) : null;
    const derivedArrivalDelay = (plannedArrival && actualArrival) ? Math.round((actualArrival - plannedArrival) / 1000) : null;

    const departureDelay = typeof train.departureDelay === 'number' ? train.departureDelay : derivedDepartureDelay;
    const arrivalDelay = typeof train.arrivalDelay === 'number' ? train.arrivalDelay : derivedArrivalDelay;

    const delays = [departureDelay, arrivalDelay].filter(value => typeof value === 'number' && !Number.isNaN(value));
    const worst = delays.length ? Math.max(...delays) : null;

    return { departure: departureDelay ?? null, arrival: arrivalDelay ?? null, worst };
}
