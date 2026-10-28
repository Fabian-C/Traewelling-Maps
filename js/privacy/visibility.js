/**
 * Träwelling StatusVisibility Enum & Bulk Privacy Filtering Helpers
 * Matches upstream App\Enum\StatusVisibility (0=public, 1=unlisted, 2=followers, 3=private, 4=authenticated, 5=trusted).
 */

export const VISIBILITY_LEVELS = {
    0: {
        value: 0,
        key: 'PUBLIC',
        label: 'Public',
        shortDesc: 'Visible to everyone on profiles, dashboards, and leaderboards',
        badgeClass: 'vis-public'
    },
    1: {
        value: 1,
        key: 'UNLISTED',
        label: 'Unlisted',
        shortDesc: 'Visible on your profile and via direct link, hidden from global feeds',
        badgeClass: 'vis-unlisted'
    },
    2: {
        value: 2,
        key: 'FOLLOWERS',
        label: 'Followers only',
        shortDesc: 'Visible only to your approved followers',
        badgeClass: 'vis-followers'
    },
    3: {
        value: 3,
        key: 'PRIVATE',
        label: 'Private',
        shortDesc: 'Visible only to you when signed in',
        badgeClass: 'vis-private'
    },
    4: {
        value: 4,
        key: 'AUTHENTICATED',
        label: 'Logged-in users',
        shortDesc: 'Visible to any signed-in Träwelling user',
        badgeClass: 'vis-authenticated'
    },
    5: {
        value: 5,
        key: 'TRUSTED',
        label: 'Trusted users',
        shortDesc: 'Visible only to users you have marked as trusted',
        badgeClass: 'vis-trusted'
    }
};

export function getTripVisibilityValue(trip) {
    const raw = trip?.visibility ?? trip?.checkin?.visibility ?? trip?.train?.visibility ?? 0;
    const num = Number(raw);
    return Number.isInteger(num) && VISIBILITY_LEVELS[num] ? num : 0;
}

export function getVisibilityMeta(value) {
    const num = Number(value);
    return VISIBILITY_LEVELS[num] || VISIBILITY_LEVELS[0];
}

export function isVisibilityLocked(trip) {
    return Boolean(trip?.lock_visibility || trip?.lockVisibility || trip?.checkin?.lock_visibility);
}

export function summarizeVisibilityCounts(trips = []) {
    const counts = { total: 0, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, locked: 0 };
    if (!Array.isArray(trips)) return counts;

    trips.forEach((trip) => {
        counts.total += 1;
        const v = getTripVisibilityValue(trip);
        counts[v] = (counts[v] || 0) + 1;
        if (isVisibilityLocked(trip)) {
            counts.locked += 1;
        }
    });
    return counts;
}

export function filterTripsForPrivacy(trips = [], filters = {}) {
    if (!Array.isArray(trips)) return [];
    const {
        visibilityFilter = 'non-public',
        fromDate = '',
        toDate = '',
        searchQuery = ''
    } = filters;

    const q = String(searchQuery || '').trim().toLowerCase();
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;

    return trips.filter((trip) => {
        const vis = getTripVisibilityValue(trip);

        if (visibilityFilter === 'non-public' && vis === 0) return false;
        if (visibilityFilter === 'private-only' && vis !== 3) return false;
        if (/^[0-5]$/.test(String(visibilityFilter)) && vis !== Number(visibilityFilter)) return false;

        const checkin = trip.checkin || trip.train || {};
        const depRaw = checkin.origin?.departureReal || checkin.origin?.departurePlanned || trip.createdAt;
        if ((fromTs || toTs) && depRaw) {
            const ts = new Date(depRaw).getTime();
            if (Number.isFinite(ts)) {
                if (fromTs && ts < fromTs) return false;
                if (toTs && ts > toTs) return false;
            }
        }

        if (q) {
            const line = String(checkin.lineName || checkin.number || '').toLowerCase();
            const orig = String(checkin.origin?.name || checkin.origin?.station?.name || '').toLowerCase();
            const dest = String(checkin.destination?.name || checkin.destination?.station?.name || '').toLowerCase();
            const body = String(trip.body || '').toLowerCase();
            const idStr = String(trip.id || '');
            if (
                !line.includes(q)
                && !orig.includes(q)
                && !dest.includes(q)
                && !body.includes(q)
                && !idStr.includes(q)
            ) {
                return false;
            }
        }

        return true;
    });
}

