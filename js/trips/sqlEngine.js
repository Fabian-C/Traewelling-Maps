// @ts-check
// Lightweight in-memory SQL parser & evaluator for Träwelling Trips dataset
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { normalizeCategory, getTripBusinessType } from '../data/processing.js';
import { hasJourneyOverlap } from './formatters.js';

export const TRIP_COLUMNS = [
    { name: 'id', label: 'ID', type: 'number', description: 'Check-in Status ID' },
    { name: 'line', label: 'Line', type: 'string', description: 'Train / transit line name' },
    { name: 'category', label: 'Category', type: 'string', description: 'Transport mode category' },
    { name: 'origin', label: 'Origin', type: 'string', description: 'Origin station name' },
    { name: 'destination', label: 'Destination', type: 'string', description: 'Destination station name' },
    { name: 'departure', label: 'Departure', type: 'datetime', description: 'Scheduled departure timestamp' },
    { name: 'arrival', label: 'Arrival', type: 'datetime', description: 'Scheduled arrival timestamp' },
    { name: 'year', label: 'Year', type: 'number', description: 'Departure year' },
    { name: 'delay_dep', label: 'Dep Delay (min)', type: 'number', description: 'Departure delay in minutes' },
    { name: 'delay_arr', label: 'Arr Delay (min)', type: 'number', description: 'Arrival delay in minutes' },
    { name: 'distance_km', label: 'Distance (km)', type: 'number', description: 'Traveled distance in kilometers' },
    { name: 'duration_min', label: 'Duration (min)', type: 'number', description: 'Trip duration in minutes' },
    { name: 'operator', label: 'Operator', type: 'string', description: 'Transport company / provider' },
    { name: 'business', label: 'Purpose', type: 'string', description: 'Travel purpose (private, business, commute)' },
    { name: 'backend_trip_id', label: 'Trip ID', type: 'number', description: 'Träwelling upstream trip ID' },
    { name: 'buddies', label: 'Companions', type: 'string', description: 'Fellow passengers / buddies' },
    { name: 'buddy_count', label: 'Buddy Count', type: 'number', description: 'Number of fellow passengers / buddies' },
    { name: 'notes', label: 'Notes', type: 'string', description: 'Check-in message body' }
];

export const STATUS_COLUMNS = [
    { name: 'id', label: 'ID', type: 'number', description: 'Check-in Status ID' },
    { name: 'username', label: 'User', type: 'string', description: 'Account username' },
    { name: 'trip_id', label: 'Trip ID', type: 'string', description: 'Line run identifier' },
    { name: 'origin_id', label: 'Origin ID', type: 'string', description: 'Origin station identifier' },
    { name: 'destination_id', label: 'Destination ID', type: 'string', description: 'Destination station identifier' },
    { name: 'departure_time', label: 'Departure', type: 'datetime', description: 'Departure timestamp' },
    { name: 'arrival_time', label: 'Arrival', type: 'datetime', description: 'Arrival timestamp' },
    { name: 'departure_delay', label: 'Dep Delay (min)', type: 'number', description: 'Departure delay in minutes' },
    { name: 'arrival_delay', label: 'Arr Delay (min)', type: 'number', description: 'Arrival delay in minutes' },
    { name: 'distance_km', label: 'Distance (km)', type: 'number', description: 'Traveled distance in kilometers' },
    { name: 'duration_min', label: 'Duration (min)', type: 'number', description: 'Trip duration in minutes' },
    { name: 'business_type', label: 'Purpose', type: 'string', description: 'Travel purpose (private, business, commute)' },
    { name: 'body', label: 'Notes', type: 'string', description: 'Check-in message body' },
    { name: 'created_at', label: 'Created At', type: 'datetime', description: 'Check-in creation timestamp' }
];

export const STATION_COLUMNS = [
    { name: 'id', label: 'ID', type: 'string', description: 'Station unique identifier / IBNR' },
    { name: 'name', label: 'Name', type: 'string', description: 'Station / stop name' },
    { name: 'latitude', label: 'Latitude', type: 'number', description: 'Geographic latitude coordinate' },
    { name: 'longitude', label: 'Longitude', type: 'number', description: 'Geographic longitude coordinate' },
    { name: 'eva_number', label: 'EVA / IBNR', type: 'string', description: 'European Station Identification Number' },
    { name: 'country_code', label: 'Country', type: 'string', description: 'Country code (e.g. DE, AT, CH)' }
];

export const ROUTE_COLUMNS = [
    { name: 'id', label: 'ID', type: 'string', description: 'Route / Line run identifier' },
    { name: 'line_name', label: 'Line', type: 'string', description: 'Transit line name (e.g. ICE 720, RE 1)' },
    { name: 'train_number', label: 'Number', type: 'string', description: 'Train number' },
    { name: 'category', label: 'Category', type: 'string', description: 'Transport mode category' },
    { name: 'operator_name', label: 'Operator', type: 'string', description: 'Operating transit company' },
    { name: 'origin_station_id', label: 'Origin ID', type: 'string', description: 'Origin terminal station ID' },
    { name: 'destination_station_id', label: 'Destination ID', type: 'string', description: 'Destination terminal station ID' }
];

export const CO_PASSENGER_COLUMNS = [
    { name: 'trip_id', label: 'Trip ID', type: 'number', description: 'Upstream Träwelling trip run ID' },
    { name: 'username', label: 'Username', type: 'string', description: 'Co-passenger username' },
    { name: 'displayName', label: 'Display Name', type: 'string', description: 'Co-passenger display name' },
    { name: 'status_id', label: 'Status ID', type: 'number', description: 'Co-passenger check-in status ID' },
    { name: 'origin', label: 'Origin', type: 'string', description: 'Co-passenger boarding station' },
    { name: 'destination', label: 'Destination', type: 'string', description: 'Co-passenger alighting station' },
    { name: 'departure_time', label: 'Departure', type: 'datetime', description: 'Co-passenger departure timestamp' },
    { name: 'arrival_time', label: 'Arrival', type: 'datetime', description: 'Co-passenger arrival timestamp' }
];

export const TABLE_SCHEMAS = {
    trips: {
        name: 'trips',
        label: 'Trips (Journeys)',
        description: 'Denormalized journey records with human-readable stations, delays, companions, and lines.',
        columns: TRIP_COLUMNS,
        defaultQuery: 'SELECT line, origin, destination, distance_km, delay_dep FROM trips WHERE delay_dep > 15 ORDER BY delay_dep DESC LIMIT 50'
    },
    statuses: {
        name: 'statuses',
        label: 'Statuses (Check-ins)',
        description: 'Normalized user check-in events referencing trips and stations by foreign keys.',
        columns: STATUS_COLUMNS,
        defaultQuery: 'SELECT id, trip_id, departure_time, departure_delay, distance_km FROM statuses WHERE departure_delay > 15 ORDER BY departure_delay DESC LIMIT 50'
    },
    stations: {
        name: 'stations',
        label: 'Stations (Nodes)',
        description: 'Deduplicated transit stops, stations, and coordinates.',
        columns: STATION_COLUMNS,
        defaultQuery: 'SELECT id, name, latitude, longitude, country_code FROM stations ORDER BY name ASC LIMIT 50'
    },
    routes: {
        name: 'routes',
        label: 'Routes (Line Runs)',
        description: 'Normalized transit line runs, categories, and operators.',
        columns: ROUTE_COLUMNS,
        defaultQuery: 'SELECT id, line_name, category, operator_name FROM routes ORDER BY line_name ASC LIMIT 50'
    },
    co_passengers: {
        name: 'co_passengers',
        label: 'Co-Passengers',
        description: 'Upstream fellow passengers discovered via incremental trip scans.',
        columns: CO_PASSENGER_COLUMNS,
        defaultQuery: 'SELECT username, origin, destination, trip_id FROM co_passengers LIMIT 50'
    }
};

export const QUERY_RECIPES = [
    {
        title: 'Top 10 Most Delayed Trips',
        sql: 'SELECT line, origin, destination, delay_dep, departure FROM trips WHERE delay_dep > 15 ORDER BY delay_dep DESC LIMIT 10'
    },
    {
        title: 'Group Travel (2+ Travel Buddies)',
        sql: 'SELECT line, origin, destination, buddies, buddy_count, departure FROM trips WHERE buddy_count >= 2 ORDER BY buddy_count DESC'
    },
    {
        title: 'Solo Journeys (No Companions)',
        sql: 'SELECT line, origin, destination, distance_km, departure FROM trips WHERE buddy_count = 0 ORDER BY departure DESC'
    },
    {
        title: 'High-Speed Long Distance (> 300 km)',
        sql: "SELECT line, origin, destination, distance_km, duration_min FROM trips WHERE category = 'nationalExpress' AND distance_km > 300 ORDER BY distance_km DESC"
    },
    {
        title: 'Night Rides (Late Night & Early Morning)',
        sql: "SELECT line, origin, destination, departure, distance_km FROM trips WHERE (departure LIKE '%T22:%' OR departure LIKE '%T23:%' OR departure LIKE '%T00:%' OR departure LIKE '%T01:%' OR departure LIKE '%T02:%' OR departure LIKE '%T03:%' OR departure LIKE '%T04:%' OR departure LIKE '%T05:%') ORDER BY departure DESC"
    },
    {
        title: 'Trips with Travel Companions',
        sql: 'SELECT line, origin, destination, buddies, departure FROM trips WHERE buddies IS NOT NULL ORDER BY departure DESC'
    },
    {
        title: '100% Punctual Regional Runs',
        sql: "SELECT line, origin, destination, distance_km, departure FROM trips WHERE category = 'regional' AND delay_dep = 0 ORDER BY departure DESC LIMIT 20"
    },
    {
        title: 'Commutes & Business Travel',
        sql: "SELECT line, origin, destination, business, distance_km, departure FROM trips WHERE business IN ('commute', 'business') ORDER BY departure DESC"
    },
    {
        title: 'Stations: All Visited Transit Stations',
        sql: 'SELECT id, name, latitude, longitude, country_code FROM stations ORDER BY name ASC LIMIT 50'
    },
    {
        title: 'Stations: Geographic Coordinates Overview',
        sql: 'SELECT name, latitude, longitude FROM stations WHERE latitude IS NOT NULL ORDER BY name ASC'
    },
    {
        title: 'Statuses: High-Delay Check-ins (> 15 min)',
        sql: 'SELECT id, trip_id, departure_time, departure_delay, distance_km FROM statuses WHERE departure_delay > 15 ORDER BY departure_delay DESC LIMIT 20'
    },
    {
        title: 'Statuses: Commute & Business Check-ins',
        sql: "SELECT id, trip_id, departure_time, business_type, distance_km FROM statuses WHERE business_type IN ('commute', 'business') ORDER BY departure_time DESC"
    },
    {
        title: 'Routes: High-Speed Line Runs (ICE/TGV)',
        sql: "SELECT id, line_name, category, operator_name FROM routes WHERE category = 'nationalExpress' ORDER BY line_name ASC"
    },
    {
        title: 'Routes: Operating Transit Providers',
        sql: 'SELECT id, line_name, category, operator_name FROM routes ORDER BY operator_name ASC LIMIT 50'
    },
    {
        title: 'Travel Buddies: Journeys with Companions',
        sql: 'SELECT line, origin, destination, buddies, buddy_count, departure FROM trips WHERE buddy_count > 0 ORDER BY departure DESC LIMIT 50'
    },
    {
        title: 'Analytics: Distance & Avg Delay by Category',
        sql: 'SELECT category, COUNT(*) AS trips, SUM(distance_km) AS total_km, AVG(delay_dep) AS avg_delay FROM trips GROUP BY category ORDER BY total_km DESC'
    },
    {
        title: 'Analytics: Yearly Travel Summary',
        sql: 'SELECT year, COUNT(*) AS trips, SUM(distance_km) AS total_km, AVG(delay_dep) AS avg_delay FROM trips WHERE year IS NOT NULL GROUP BY year ORDER BY year DESC'
    },
    {
        title: 'Analytics: Most Frequently Used Operators',
        sql: 'SELECT operator, COUNT(*) AS trips, SUM(distance_km) AS total_km FROM trips GROUP BY operator HAVING COUNT(*) >= 3 ORDER BY trips DESC LIMIT 20'
    },
    {
        title: 'JOIN: Statuses with Line & Operator Details',
        sql: 'SELECT s.id, r.line_name, r.operator_name, s.distance_km, s.departure_delay FROM statuses s INNER JOIN routes r ON s.trip_id = r.id ORDER BY s.departure_delay DESC LIMIT 50'
    },
    {
        title: 'JOIN: Top Co-Passengers Across Scanned Trips',
        sql: 'SELECT c.username, COUNT(*) AS shared_trips, SUM(t.distance_km) AS shared_km FROM trips t INNER JOIN co_passengers c ON t.backend_trip_id = c.trip_id GROUP BY c.username ORDER BY shared_trips DESC LIMIT 25'
    }
];

/**
 * Flatten a raw trip object into standard column dictionary
 * @param {Object} trip Raw or normalized trip status
 * @returns {Object} Column dictionary
 */
export function flattenTripRecord(trip) {
    const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || trip.properties || trip || {};
    const origin = train.origin || {};
    const dest = train.destination || {};
    const depTime = origin.departureReal || origin.departure || origin.departurePlanned || train.departure || train.plannedDeparture || train.manualDeparture || trip.createdAt || '';
    const arrTime = dest.arrivalReal || dest.arrival || dest.arrivalPlanned || train.arrival || train.plannedArrival || train.manualArrival || '';
    const delays = deriveDelaySeconds(train);
    const depDelaySec = delays.departure !== null ? delays.departure : (delays.worst || 0);
    const arrDelaySec = delays.arrival !== null ? delays.arrival : (delays.worst || 0);

    // Extract companions including bodyMentions, buddies, companions, and @mentions (case-insensitive deduplication)
    const buddiesMap = new Map();
    const addBuddy = (u) => {
        if (!u || typeof u !== 'string') return;
        const clean = u.replace(/^@/, '').trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        if (!buddiesMap.has(key)) {
            buddiesMap.set(key, `@${clean}`);
        }
    };
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        mentions.forEach(m => addBuddy(m.username || m.name || m));
    }
    const companionLists = [
        trip.buddies,
        trip.properties?.buddies,
        trip.companions,
        trip.properties?.companions,
        trip.fellowPassengers,
        trip.properties?.fellowPassengers,
        trip.co_passengers,
        trip.properties?.co_passengers,
        trip.users,
        trip.properties?.users
    ];
    companionLists.forEach(list => {
        if (!list) return;
        let arr = list;
        if (typeof arr === 'string') {
            try { arr = JSON.parse(arr); } catch (e) { return; }
        }
        if (Array.isArray(arr)) {
            arr.forEach(c => {
                if (c && typeof c === 'object' && !hasJourneyOverlap(trip, c)) {
                    return;
                }
                addBuddy(c.username || c.user?.username || c.name || c);
            });
        }
    });
    const bodyText = trip.body || trip.properties?.body || '';
    if (bodyText.includes('@')) {
        const matches = bodyText.match(/@([a-zA-Z0-9_\-\.]+)/g);
        if (matches) matches.forEach(m => addBuddy(m));
    }
    const buddiesStr = buddiesMap.size ? Array.from(buddiesMap.values()).join(', ') : null;
    const buddyCount = buddiesMap.size;

    const bType = getTripBusinessType(trip);
    const businessStr = bType === 1 ? 'business' : (bType === 2 ? 'commute' : 'private');

    const yr = depTime ? new Date(depTime).getFullYear() : null;
    const rawDist = typeof train.totalDistance === 'number' ? train.totalDistance : (typeof train.distance === 'number' ? train.distance : 0);

    return {
        _rawTrip: trip,
        id: trip.id || 0,
        line: train.lineName || train.number || 'Train',
        category: normalizeCategory(train.category || 'other'),
        origin: origin.name || 'Unknown',
        destination: dest.name || 'Unknown',
        departure: depTime ? depTime.replace(/\+.*$/, 'Z') : '',
        arrival: arrTime ? arrTime.replace(/\+.*$/, 'Z') : '',
        year: yr,
        delay_dep: Math.round(depDelaySec / 60),
        delay_arr: Math.round(arrDelaySec / 60),
        distance_km: rawDist > 0 ? Math.round((rawDist / 1000) * 10) / 10 : 0,
        duration_min: computeTripDurationMinutes(train) || 0,
        operator: train.operator?.name || (typeof train.operator === 'string' ? train.operator : 'Unknown'),
        business: businessStr,
        backend_trip_id: train.trip || train.tripId || trip.trip || trip.backend_trip_id || null,
        buddies: buddiesStr,
        buddy_count: buddyCount,
        buddies_count: buddyCount,
        notes: trip.body || trip.properties?.body || null
    };
}

/**
 * Tokenize a SQL query into lexical tokens
 */
function tokenize(sql) {
    const tokens = [];
    let i = 0;
    const len = sql.length;

    while (i < len) {
        const char = sql[i];

        if (/\s/.test(char)) {
            i++;
            continue;
        }

        // Single-line comment: -- until newline
        if (char === '-' && sql[i + 1] === '-') {
            i += 2;
            while (i < len && sql[i] !== '\n' && sql[i] !== '\r') {
                i++;
            }
            continue;
        }

        // Multi-line block comment: /* ... */
        if (char === '/' && sql[i + 1] === '*') {
            i += 2;
            while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
                i++;
            }
            if (i < len) i += 2; // skip */
            continue;
        }

        // Single or double quote strings
        if (char === "'" || char === '"') {
            const quote = char;
            const startPos = i;
            let str = '';
            i++;
            while (i < len && sql[i] !== quote) {
                if (sql[i] === '\\' && i + 1 < len) {
                    i++;
                    str += sql[i];
                } else {
                    str += sql[i];
                }
                i++;
            }
            if (i >= len || sql[i] !== quote) {
                throw new Error(`Unclosed string literal starting at position ${startPos}: missing closing ${quote}`);
            }
            i++; // skip closing quote
            tokens.push({ type: 'STRING', value: str });
            continue;
        }

        // Parentheses, commas, operators
        if (char === '(' || char === ')') {
            tokens.push({ type: 'PUNCT', value: char });
            i++;
            continue;
        }

        if (char === ',') {
            tokens.push({ type: 'COMMA', value: ',' });
            i++;
            continue;
        }

        if (char === '.') {
            tokens.push({ type: 'DOT', value: '.' });
            i++;
            continue;
        }

        // Multi-char operators: <=, >=, !=, <>
        const twoChar = sql.substring(i, i + 2);
        if (twoChar === '<=' || twoChar === '>=' || twoChar === '!=' || twoChar === '<>') {
            tokens.push({ type: 'OPERATOR', value: twoChar === '<>' ? '!=' : twoChar });
            i += 2;
            continue;
        }

        // Single-char operators: =, <, >, +, -, *
        if ('=<>+*'.includes(char)) {
            tokens.push({ type: 'OPERATOR', value: char });
            i++;
            continue;
        }

        // Numbers (integers or floats)
        if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(sql[i + 1] || ''))) {
            let num = char;
            i++;
            while (i < len && /[0-9.]/.test(sql[i])) {
                num += sql[i];
                i++;
            }
            tokens.push({ type: 'NUMBER', value: parseFloat(num) });
            continue;
        }

        // Words / Identifiers / Keywords
        if (/[a-zA-Z_]/.test(char)) {
            let word = '';
            while (i < len && /[a-zA-Z0-9_]/.test(sql[i])) {
                word += sql[i];
                i++;
            }
            tokens.push({ type: 'WORD', value: word });
            continue;
        }

        // Default: advance
        i++;
    }

    return tokens;
}

const CLAUSE_STOP_WORDS = new Set([
    'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET',
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON'
]);

const VALID_TABLE_ALIASES = {
    trips: 'trips',
    trip: 'trips',
    checkins: 'trips',
    checkin: 'trips',
    statuses: 'statuses',
    status: 'statuses',
    stations: 'stations',
    station: 'stations',
    routes: 'routes',
    route: 'routes',
    trips_runs: 'routes',
    co_passengers: 'co_passengers',
    copassengers: 'co_passengers',
    companions: 'co_passengers',
    buddies: 'co_passengers'
};

const SUPPORTED_AGGS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

/**
 * Resolve a raw SQL table identifier to a canonical schema table name.
 * @param {string} rawName
 * @param {Object} options
 * @returns {string}
 */
function resolveCanonicalTable(rawName, options) {
    const key = String(rawName || '').toLowerCase();
    const mapped = VALID_TABLE_ALIASES[key];
    if (!mapped) {
        throw new Error("Target table must be 'trips', 'statuses', 'stations', 'routes', or 'co_passengers'");
    }
    if (mapped === 'co_passengers' && !options?.tables?.co_passengers) {
        return 'trips';
    }
    return mapped;
}

/**
 * Retrieve row array for a canonical table name.
 * @param {string} tableName
 * @param {Array<Object>} fallbackRecords
 * @param {Object} options
 * @returns {Array<Object>}
 */
function getTableDataset(tableName, fallbackRecords, options) {
    if (options && options.tables && options.tables[tableName]) {
        return options.tables[tableName];
    }
    if (tableName === 'trips') {
        return fallbackRecords;
    }
    return [];
}

/**
 * Normalize a join key value so numeric and string IDs match consistently.
 * Returns null if the value is null/undefined/empty.
 * @param {any} val
 * @returns {string | null}
 */
function normalizeJoinKey(val) {
    if (val === null || val === undefined || val === '') return null;
    return String(val);
}

/**
 * Compute an aggregate function over an array of rows.
 * @param {string} fn
 * @param {string} arg
 * @param {Array<Object>} rows
 * @param {boolean} [distinct=false]
 * @returns {number | null}
 */
function computeAggregate(fn, arg, rows, distinct = false) {
    if (fn === 'COUNT') {
        if (arg === '*') return rows.length;
        if (distinct) {
            const seen = new Set();
            for (const r of rows) {
                const v = r[arg];
                if (v !== null && v !== undefined && v !== '') {
                    seen.add(String(v));
                }
            }
            return seen.size;
        }
        let count = 0;
        for (const r of rows) {
            const v = r[arg];
            if (v !== null && v !== undefined && v !== '') count++;
        }
        return count;
    }

    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    const seenDistinct = distinct ? new Set() : null;

    for (const r of rows) {
        const raw = r[arg];
        if (raw === null || raw === undefined || raw === '') continue;
        const num = Number(raw);
        if (Number.isNaN(num)) continue;
        if (seenDistinct) {
            if (seenDistinct.has(num)) continue;
            seenDistinct.add(num);
        }
        sum += num;
        count++;
        if (num < min) min = num;
        if (num > max) max = num;
    }

    if (count === 0) return null;
    if (fn === 'SUM') return Math.round(sum * 100) / 100;
    if (fn === 'AVG') return Math.round((sum / count) * 100) / 100;
    if (fn === 'MIN') return min;
    if (fn === 'MAX') return max;
    return null;
}

/**
 * Sort rows in-place copy according to ORDER BY specification.
 * @param {Array<Object>} rows
 * @param {Array<{column: string, dir: string}>} orderByList
 * @returns {Array<Object>}
 */
function sortResultRows(rows, orderByList) {
    if (!orderByList.length) return rows;
    return rows.slice().sort((a, b) => {
        for (const { column, dir } of orderByList) {
            const valA = a[column];
            const valB = b[column];
            if (valA === valB) continue;
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;

            let cmp = 0;
            if (typeof valA === 'number' && typeof valB === 'number') {
                cmp = valA - valB;
            } else {
                cmp = String(valA).localeCompare(String(valB));
            }
            return dir === 'DESC' ? -cmp : cmp;
        }
        return 0;
    });
}

/**
 * Parse and execute a SQL query on a list of flattened records
 * @param {string} sql SQL query string
 * @param {Array<Object>} records Flattened trip records
 * @param {Object} options Execution options, e.g. { tables: { trips, statuses, stations, routes, co_passengers } }
 * @returns {Object} { table, columns, rows, totalRows, executionTimeMs, rawTrips, isSelectAll, isAggregate }
 */
export function executeTripQuery(sql, records = [], options = {}) {
    const startTime = performance.now();
    if (!sql || typeof sql !== 'string' || !sql.trim()) {
        throw new Error('Query string is empty.');
    }

    const tokens = tokenize(sql.trim());
    if (!tokens.length) {
        throw new Error('Could not parse SQL query.');
    }

    let cursor = 0;
    const peek = (offset = 0) => tokens[cursor + offset];
    const consume = () => tokens[cursor++];
    const matchWord = (word) => {
        const tok = peek();
        if (tok && tok.type === 'WORD' && tok.value.toUpperCase() === word.toUpperCase()) {
            cursor++;
            return true;
        }
        return false;
    };

    /**
     * Read a possibly table-qualified column identifier (e.g. `col` or `t.col` or `t.*`).
     */
    const readColumnRef = () => {
        const first = consume();
        if (!first) return '';
        let name = String(first.value).toLowerCase();
        if (peek() && peek().type === 'DOT') {
            consume(); // '.'
            const second = consume();
            if (second) {
                name = `${name}.${String(second.value).toLowerCase()}`;
            }
        }
        return name;
    };

    /**
     * Read an optional table alias (`[AS] alias`) if not a SQL clause keyword.
     */
    const readOptionalAlias = (defaultAlias) => {
        if (matchWord('AS')) {
            const aliasTok = consume();
            if (aliasTok && (aliasTok.type === 'WORD' || aliasTok.type === 'STRING')) {
                return String(aliasTok.value).toLowerCase();
            }
        } else {
            const next = peek();
            if (next && next.type === 'WORD' && !CLAUSE_STOP_WORDS.has(next.value.toUpperCase())) {
                consume();
                return String(next.value).toLowerCase();
            }
        }
        return defaultAlias;
    };

    // 1. SELECT clause
    if (!matchWord('SELECT')) {
        throw new Error("Query must begin with 'SELECT'");
    }

    const isDistinct = matchWord('DISTINCT');
    const selectedFields = [];
    while (cursor < tokens.length) {
        const tok = peek();
        if (!tok) break;

        if (tok.type === 'OPERATOR' && tok.value === '*') {
            consume();
            selectedFields.push({ expr: '*', fn: null, arg: null, alias: '*', distinct: false });
        } else if (tok.type === 'WORD' || tok.type === 'STRING') {
            const next = peek(1);
            if (next && next.type === 'PUNCT' && next.value === '(') {
                consume(); // fn name
                consume(); // '('
                const aggDistinct = matchWord('DISTINCT');
                let arg = '*';
                if (peek() && peek().type === 'OPERATOR' && peek().value === '*') {
                    consume();
                    arg = '*';
                } else {
                    arg = readColumnRef() || '*';
                }
                if (peek() && peek().type === 'PUNCT' && peek().value === ')') {
                    consume(); // ')'
                }
                const fn = String(tok.value).toUpperCase();
                const expr = aggDistinct ? `${fn}(DISTINCT ${arg})` : `${fn}(${arg})`;
                let alias = expr;
                if (matchWord('AS')) {
                    const aliasTok = consume();
                    if (aliasTok) alias = String(aliasTok.value);
                }
                selectedFields.push({ expr, fn, arg, alias, distinct: aggDistinct });
            } else {
                const col = readColumnRef();
                let alias = col;
                if (matchWord('AS')) {
                    const aliasTok = consume();
                    if (aliasTok) alias = String(aliasTok.value);
                }
                selectedFields.push({ expr: col, fn: null, arg: col, alias, distinct: false });
            }
        } else {
            consume();
        }

        if (peek() && peek().type === 'COMMA') {
            consume(); // skip comma
        } else {
            break;
        }
    }

    // 2. FROM clause
    let targetTable = 'trips';
    let targetAlias = 'trips';
    if (matchWord('FROM')) {
        const tableTok = consume();
        if (!tableTok) {
            throw new Error("Target table must be 'trips', 'statuses', 'stations', 'routes', or 'co_passengers'");
        }
        targetTable = resolveCanonicalTable(tableTok.value, options);
        targetAlias = readOptionalAlias(targetTable);
    }

    // 2b. Optional JOIN clauses (INNER JOIN, LEFT [OUTER] JOIN, JOIN)
    const joins = [];
    while (cursor < tokens.length) {
        let joinType = null;
        if (matchWord('INNER')) {
            if (!matchWord('JOIN')) throw new Error("Expected 'JOIN' after 'INNER'");
            joinType = 'INNER';
        } else if (matchWord('LEFT')) {
            matchWord('OUTER'); // optional OUTER
            if (!matchWord('JOIN')) throw new Error("Expected 'JOIN' after 'LEFT'");
            joinType = 'LEFT';
        } else if (matchWord('JOIN')) {
            joinType = 'INNER';
        } else {
            break;
        }

        const joinTableTok = consume();
        if (!joinTableTok) {
            throw new Error("Expected table name after 'JOIN'");
        }
        const joinTable = resolveCanonicalTable(joinTableTok.value, options);
        const joinAlias = readOptionalAlias(joinTable);

        if (!matchWord('ON')) {
            throw new Error(`Expected 'ON' condition for JOIN '${joinTable}'`);
        }
        const leftCol = readColumnRef();
        const opTok = consume();
        if (!opTok || opTok.type !== 'OPERATOR' || opTok.value !== '=') {
            throw new Error(`JOIN ON clause currently requires '=' equality (got '${opTok?.value || ''}')`);
        }
        const rightCol = readColumnRef();
        if (!leftCol || !rightCol) {
            throw new Error(`Invalid JOIN ON condition for '${joinTable}'`);
        }

        joins.push({
            type: joinType,
            table: joinTable,
            alias: joinAlias,
            leftCol,
            rightCol
        });
    }

    // 3. WHERE clause
    let wherePredicate = null;
    if (matchWord('WHERE')) {
        const whereTokens = [];
        while (cursor < tokens.length) {
            const tok = peek();
            if (tok.type === 'WORD' && ['GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET'].includes(tok.value.toUpperCase())) {
                break;
            }
            whereTokens.push(consume());
        }
        wherePredicate = compileWherePredicate(whereTokens);
    }

    // 4. GROUP BY clause
    const groupByCols = [];
    if (matchWord('GROUP')) {
        if (!matchWord('BY')) {
            throw new Error("Expected 'BY' after 'GROUP'");
        }
        while (cursor < tokens.length) {
            const tok = peek();
            if (!tok || (tok.type !== 'WORD' && tok.type !== 'STRING')) break;
            if (tok.type === 'WORD' && ['HAVING', 'ORDER', 'LIMIT', 'OFFSET'].includes(tok.value.toUpperCase())) {
                break;
            }
            groupByCols.push(readColumnRef());
            if (peek() && peek().type === 'COMMA') {
                consume();
            } else {
                break;
            }
        }
    }

    // 5. HAVING clause
    let havingTokens = null;
    let havingPredicate = null;
    if (matchWord('HAVING')) {
        havingTokens = [];
        while (cursor < tokens.length) {
            const tok = peek();
            if (tok.type === 'WORD' && ['ORDER', 'LIMIT', 'OFFSET'].includes(tok.value.toUpperCase())) {
                break;
            }
            havingTokens.push(consume());
        }
        havingPredicate = compileWherePredicate(havingTokens);
    }

    // 6. ORDER BY clause
    const orderByList = [];
    if (matchWord('ORDER') && matchWord('BY')) {
        while (cursor < tokens.length) {
            const tok = peek();
            if (!tok || (tok.type !== 'WORD' && tok.type !== 'STRING')) break;
            let colExpr = '';
            if (peek(1) && peek(1).type === 'PUNCT' && peek(1).value === '(') {
                const fnTok = consume();
                consume(); // '('
                const aggDistinct = matchWord('DISTINCT');
                let arg = '*';
                if (peek() && peek().type === 'OPERATOR' && peek().value === '*') {
                    consume();
                } else {
                    arg = readColumnRef() || '*';
                }
                if (peek() && peek().type === 'PUNCT' && peek().value === ')') consume();
                colExpr = (aggDistinct ? `${fnTok.value}(DISTINCT ${arg})` : `${fnTok.value}(${arg})`).toLowerCase();
            } else {
                colExpr = readColumnRef();
            }
            let dir = 'ASC';
            if (matchWord('DESC')) dir = 'DESC';
            else if (matchWord('ASC')) dir = 'ASC';
            orderByList.push({ column: colExpr, dir });

            if (peek() && peek().type === 'COMMA') {
                consume();
            } else {
                break;
            }
        }
    }

    // 7. LIMIT & OFFSET clause
    let limit = null;
    let offset = 0;
    if (matchWord('LIMIT')) {
        const numTok = consume();
        if (numTok && numTok.type === 'NUMBER') limit = Math.max(0, parseInt(numTok.value, 10));
    }
    if (matchWord('OFFSET')) {
        const numTok = consume();
        if (numTok && numTok.type === 'NUMBER') offset = Math.max(0, parseInt(numTok.value, 10));
    }

    // Build participating table metadata & column validation set
    const participatingTables = [{ table: targetTable, alias: targetAlias }];
    for (const j of joins) {
        participatingTables.push({ table: j.table, alias: j.alias });
    }

    const schemaDef = TABLE_SCHEMAS[targetTable] || TABLE_SCHEMAS.trips;
    const baseCols = schemaDef.columns.map(c => c.name);
    const validColsSet = new Set();
    const allSelectStarCols = [];

    if (joins.length === 0) {
        for (const c of baseCols) {
            validColsSet.add(c);
            validColsSet.add(`${targetAlias}.${c}`);
            validColsSet.add(`${targetTable}.${c}`);
            allSelectStarCols.push(c);
        }
    } else {
        for (const pt of participatingTables) {
            const cols = (TABLE_SCHEMAS[pt.table] || TABLE_SCHEMAS.trips).columns.map(c => c.name);
            for (const c of cols) {
                validColsSet.add(c);
                validColsSet.add(`${pt.alias}.${c}`);
                validColsSet.add(`${pt.table}.${c}`);
                allSelectStarCols.push(`${pt.alias}.${c}`);
            }
        }
    }

    const isSelectAll = selectedFields.length === 0 || selectedFields.some(f => f.expr === '*');

    if (!isSelectAll) {
        for (const field of selectedFields) {
            if (field.fn) {
                if (!SUPPORTED_AGGS.includes(field.fn)) {
                    throw new Error(`Unsupported aggregate function '${field.fn}'`);
                }
                if (field.arg !== '*' && !validColsSet.has(field.arg)) {
                    throw new Error(`Unknown column '${field.arg}' in table '${targetTable}'`);
                }
            } else if (!field.arg.endsWith('.*') && !validColsSet.has(field.arg)) {
                throw new Error(`Unknown column '${field.arg}' in table '${targetTable}'`);
            }
        }
    }

    for (const gCol of groupByCols) {
        if (!validColsSet.has(gCol)) {
            throw new Error(`Unknown column '${gCol}' in GROUP BY`);
        }
    }

    // Prepare base dataset (with alias-qualified keys if alias differs or joins exist)
    const rawBaseDataset = getTableDataset(targetTable, records, options);
    let dataset = rawBaseDataset;

    if (joins.length > 0 || targetAlias !== targetTable) {
        const needsQualify = joins.length > 0 || selectedFields.some(f => f.arg && f.arg.includes('.')) || groupByCols.some(c => c.includes('.'));
        if (needsQualify) {
            dataset = rawBaseDataset.map(row => {
                const qualified = { ...row };
                for (const key of Object.keys(row)) {
                    if (key.startsWith('_')) continue;
                    qualified[`${targetAlias}.${key}`] = row[key];
                    if (targetTable !== targetAlias) {
                        qualified[`${targetTable}.${key}`] = row[key];
                    }
                }
                return qualified;
            });
        }
    }

    // Execute Hash Joins sequentially
    for (const join of joins) {
        const rightRows = getTableDataset(join.table, records, options);
        const rightCols = (TABLE_SCHEMAS[join.table] || TABLE_SCHEMAS.trips).columns.map(c => c.name);
        const rightPrefixAlias = `${join.alias}.`;
        const rightPrefixTable = `${join.table}.`;

        // Determine which side of ON refers to the right table
        let leftKeyCol = join.leftCol;
        let rightKeyCol = join.rightCol;
        if (join.leftCol.startsWith(rightPrefixAlias) || join.leftCol.startsWith(rightPrefixTable)) {
            leftKeyCol = join.rightCol;
            rightKeyCol = join.leftCol;
        }
        const rightBareKey = rightKeyCol.includes('.') ? rightKeyCol.split('.').pop() : rightKeyCol;

        // Build hash index on right table
        const rightIndex = new Map();
        for (const rRow of rightRows) {
            const key = normalizeJoinKey(rRow[rightBareKey]);
            if (key === null) continue;
            let bucket = rightIndex.get(key);
            if (!bucket) {
                bucket = [];
                rightIndex.set(key, bucket);
            }
            bucket.push(rRow);
        }

        const joinedRows = [];
        for (const lRow of dataset) {
            const lKey = normalizeJoinKey(lRow[leftKeyCol]);
            const matches = lKey !== null ? rightIndex.get(lKey) : null;
            if (matches && matches.length > 0) {
                for (const rRow of matches) {
                    const merged = { ...lRow };
                    for (const k of Object.keys(rRow)) {
                        if (k.startsWith('_')) continue;
                        merged[`${join.alias}.${k}`] = rRow[k];
                        if (join.table !== join.alias) {
                            merged[`${join.table}.${k}`] = rRow[k];
                        }
                        if (!(k in merged)) {
                            merged[k] = rRow[k];
                        }
                    }
                    joinedRows.push(merged);
                }
            } else if (join.type === 'LEFT') {
                const merged = { ...lRow };
                for (const k of rightCols) {
                    merged[`${join.alias}.${k}`] = null;
                    if (join.table !== join.alias) {
                        merged[`${join.table}.${k}`] = null;
                    }
                    if (!(k in merged)) {
                        merged[k] = null;
                    }
                }
                joinedRows.push(merged);
            }
        }
        dataset = joinedRows;
    }

    // EXECUTION
    // A. Filter (WHERE)
    let filtered = dataset;
    if (wherePredicate) {
        filtered = dataset.filter(row => {
            try {
                return Boolean(wherePredicate(row));
            } catch (e) {
                return false;
            }
        });
    }

    const hasAnyAgg = !isSelectAll && selectedFields.some(f => Boolean(f.fn));
    const allAggs = !isSelectAll && selectedFields.length > 0 && selectedFields.every(f => Boolean(f.fn));

    // B. GROUP BY execution
    if (groupByCols.length > 0) {
        const groups = new Map();
        for (const row of filtered) {
            const keyParts = groupByCols.map(c => {
                const v = row[c];
                return v === null || v === undefined ? '\0NULL' : String(v);
            });
            const gKey = keyParts.join('\x1f');
            let bucket = groups.get(gKey);
            if (!bucket) {
                bucket = [];
                groups.set(gKey, bucket);
            }
            bucket.push(row);
        }

        const activeFields = isSelectAll
            ? groupByCols.map(c => ({ expr: c, fn: null, arg: c, alias: c, distinct: false }))
            : selectedFields;

        const activeColumns = activeFields.map(f => f.alias);

        // Extract any aggregate expressions referenced in HAVING or ORDER BY that might not be in SELECT
        const extraAggs = new Map();
        const collectExtraAgg = (exprStr) => {
            const m = String(exprStr || '').match(/^(count|sum|avg|min|max)\((distinct\s+)?([^)]+)\)$/i);
            if (!m) return;
            const fn = m[1].toUpperCase();
            const distinct = Boolean(m[2]);
            const arg = m[3].trim().toLowerCase();
            const normKey = distinct ? `${fn.toLowerCase()}(distinct ${arg})` : `${fn.toLowerCase()}(${arg})`;
            extraAggs.set(normKey, { fn, arg, distinct });
        };
        if (havingTokens) {
            for (let i = 0; i < havingTokens.length; i++) {
                const t = havingTokens[i];
                if (t.type === 'WORD' && SUPPORTED_AGGS.includes(t.value.toUpperCase()) && havingTokens[i + 1]?.value === '(') {
                    let j = i + 2;
                    let distinct = false;
                    if (havingTokens[j]?.type === 'WORD' && havingTokens[j].value.toUpperCase() === 'DISTINCT') {
                        distinct = true;
                        j++;
                    }
                    let arg = '';
                    while (j < havingTokens.length && havingTokens[j].value !== ')') {
                        arg += havingTokens[j].value;
                        j++;
                    }
                    collectExtraAgg(`${t.value}(${distinct ? 'distinct ' : ''}${arg})`);
                }
            }
        }
        for (const o of orderByList) {
            collectExtraAgg(o.column);
        }

        const groupedRows = [];
        let rowIdx = 0;
        for (const groupRows of groups.values()) {
            const sample = groupRows[0];
            /** @type {Record<string, any>} */
            const outRow = { id: rowIdx++ };
            /** @type {Record<string, any>} */
            const evalRow = {};

            // Populate group-by keys into evalRow so HAVING/ORDER BY can reference them even if aliased
            for (const gCol of groupByCols) {
                evalRow[gCol] = sample[gCol];
            }

            for (const field of activeFields) {
                const val = field.fn
                    ? computeAggregate(field.fn, field.arg, groupRows, field.distinct)
                    : sample[field.arg];
                outRow[field.alias] = val;
                evalRow[field.alias] = val;
                evalRow[field.alias.toLowerCase()] = val;
                evalRow[field.expr.toLowerCase()] = val;
            }

            for (const [normKey, spec] of extraAggs.entries()) {
                if (!(normKey in evalRow)) {
                    evalRow[normKey] = computeAggregate(spec.fn, spec.arg, groupRows, spec.distinct);
                }
            }

            if (!havingPredicate || havingPredicate(evalRow)) {
                groupedRows.push({ outRow, evalRow });
            }
        }

        // Sort grouped rows using evalRow (supports alias, column, or aggregate expr)
        if (orderByList.length) {
            groupedRows.sort((a, b) => {
                for (const { column, dir } of orderByList) {
                    const valA = a.evalRow[column];
                    const valB = b.evalRow[column];
                    if (valA === valB) continue;
                    if (valA === null || valA === undefined) return 1;
                    if (valB === null || valB === undefined) return -1;
                    const cmp = (typeof valA === 'number' && typeof valB === 'number')
                        ? valA - valB
                        : String(valA).localeCompare(String(valB));
                    return dir === 'DESC' ? -cmp : cmp;
                }
                return 0;
            });
        }

        let finalRows = groupedRows.map(g => g.outRow);
        if (isDistinct) {
            const seenKeys = new Set();
            finalRows = finalRows.filter(row => {
                const key = JSON.stringify(activeColumns.map(col => row[col] ?? null));
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
            });
        }

        const totalMatching = finalRows.length;
        if (offset > 0 || limit !== null) {
            const start = offset;
            const end = limit !== null ? start + limit : finalRows.length;
            finalRows = finalRows.slice(start, end);
        }

        return {
            table: targetTable,
            columns: activeColumns,
            rows: finalRows,
            totalRows: totalMatching,
            rawTrips: [],
            executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
            isSelectAll: false,
            isAggregate: true
        };
    }

    // C. Whole-table aggregate query (no GROUP BY)
    if (allAggs) {
        const aggRow = { id: 0 };
        const activeColumns = [];
        for (const field of selectedFields) {
            activeColumns.push(field.alias);
            aggRow[field.alias] = computeAggregate(field.fn, field.arg, filtered, field.distinct);
        }
        return {
            table: targetTable,
            columns: activeColumns,
            rows: [aggRow],
            totalRows: 1,
            rawTrips: [],
            executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
            isSelectAll: false,
            isAggregate: true
        };
    }

    if (hasAnyAgg) {
        throw new Error('Cannot mix aggregate functions and raw columns without GROUP BY');
    }

    // D. Standard row projection + sorting
    // Map alias -> source column so ORDER BY can reference either raw column or SELECT alias
    const aliasToSource = new Map();
    for (const f of selectedFields) {
        if (!f.fn && f.alias && f.arg) {
            aliasToSource.set(f.alias.toLowerCase(), f.arg);
        }
    }
    const resolvedOrderBy = orderByList.map(o => ({
        column: aliasToSource.get(o.column) || o.column,
        dir: o.dir
    }));

    if (resolvedOrderBy.length) {
        filtered = sortResultRows(filtered, resolvedOrderBy);
    }

    const activeColumns = isSelectAll ? allSelectStarCols : selectedFields.map(f => f.alias);

    const projectRow = (row) => {
        if (isSelectAll) return { ...row };
        const res = { id: row.id };
        if (row._rawTrip) res._rawTrip = row._rawTrip;
        for (const field of selectedFields) {
            res[field.alias] = row[field.arg];
        }
        return res;
    };

    let projectedAll = filtered.map(projectRow);

    if (isDistinct) {
        const seenKeys = new Set();
        projectedAll = projectedAll.filter(row => {
            const key = JSON.stringify(activeColumns.map(col => row[col] ?? null));
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });
    }

    const totalMatching = projectedAll.length;

    // E. Paginate (Limit/Offset)
    let paged = projectedAll;
    if (offset > 0 || limit !== null) {
        const start = offset;
        const end = limit !== null ? start + limit : projectedAll.length;
        paged = projectedAll.slice(start, end);
    }

    const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

    return {
        table: targetTable,
        columns: activeColumns,
        rows: paged,
        totalRows: totalMatching,
        rawTrips: targetTable === 'trips' ? paged.map(r => r._rawTrip).filter(Boolean) : [],
        executionTimeMs,
        isSelectAll,
        isAggregate: false
    };
}

/**
 * Compile a token list into a JavaScript predicate function (row => boolean)
 */
function compileWherePredicate(tokens) {
    if (!tokens.length) return () => true;

    let c = 0;
    const len = tokens.length;

    function parseOr() {
        let left = parseAnd();
        while (c < len && tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'OR') {
            c++; // skip OR
            const right = parseAnd();
            const prev = left;
            left = row => prev(row) || right(row);
        }
        return left;
    }

    function parseAnd() {
        let left = parsePrimary();
        while (c < len && tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'AND') {
            c++; // skip AND
            const right = parsePrimary();
            const prev = left;
            left = row => prev(row) && right(row);
        }
        return left;
    }

    function parsePrimary() {
        if (c >= len) return () => true;

        // Group ( expr )
        if (tokens[c].type === 'PUNCT' && tokens[c].value === '(') {
            c++; // skip '('
            const inner = parseOr();
            if (c < len && tokens[c].type === 'PUNCT' && tokens[c].value === ')') {
                c++; // skip ')'
            }
            return inner;
        }

        // NOT expr
        if (tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'NOT') {
            c++;
            const inner = parsePrimary();
            return row => !inner(row);
        }

        // Column or aggregate comparison rule: [col | alias.col | AGG(col)] [op] [val]
        const colTok = tokens[c++];
        if (!colTok) return () => true;
        let colName = String(colTok.value || '').toLowerCase();
        if (c < len && tokens[c].type === 'DOT') {
            c++; // skip '.'
            if (c < len) {
                colName = `${colName}.${String(tokens[c++].value || '').toLowerCase()}`;
            }
        } else if (c < len && tokens[c].type === 'PUNCT' && tokens[c].value === '(') {
            c++; // skip '('
            let aggDistinct = false;
            if (c < len && tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'DISTINCT') {
                aggDistinct = true;
                c++;
            }
            let arg = '';
            while (c < len && !(tokens[c].type === 'PUNCT' && tokens[c].value === ')')) {
                arg += String(tokens[c++].value || '').toLowerCase();
            }
            if (c < len && tokens[c].type === 'PUNCT' && tokens[c].value === ')') {
                c++; // skip ')'
            }
            colName = aggDistinct ? `${colName}(distinct ${arg})` : `${colName}(${arg})`;
        }

        if (c >= len) return () => true;
        let opTok = tokens[c++];
        if (!opTok) return () => true;
        let op = opTok.value.toUpperCase();
        let negateOp = false;
        if (op === 'NOT' && c < len) {
            negateOp = true;
            opTok = tokens[c++];
            op = opTok.value.toUpperCase();
        }

        // IS NULL / IS NOT NULL
        if (op === 'IS') {
            let isNot = false;
            if (c < len && tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'NOT') {
                c++;
                isNot = true;
            }
            if (c < len && tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'NULL') {
                c++;
            }
            return row => {
                const val = row[colName];
                const isNull = val === null || val === undefined || val === '';
                return isNot ? !isNull : isNull;
            };
        }

        // IN (val1, val2, ...)
        if (op === 'IN') {
            if (c < len && tokens[c].type === 'PUNCT' && tokens[c].value === '(') c++;
            const inValues = new Set();
            while (c < len) {
                const t = tokens[c++];
                if (t.type === 'STRING' || t.type === 'NUMBER' || t.type === 'WORD') {
                    inValues.add(String(t.value).toLowerCase());
                }
                if (c < len && tokens[c].type === 'COMMA') c++;
                if (c < len && tokens[c].type === 'PUNCT' && tokens[c].value === ')') {
                    c++;
                    break;
                }
            }
            return row => {
                const rowVal = String(row[colName] || '').toLowerCase();
                const matched = inValues.has(rowVal);
                return negateOp ? !matched : matched;
            };
        }

        // BETWEEN x AND y
        if (op === 'BETWEEN') {
            const minTok = tokens[c++];
            if (c < len && tokens[c].type === 'WORD' && tokens[c].value.toUpperCase() === 'AND') c++;
            const maxTok = tokens[c++];
            const min = minTok ? minTok.value : 0;
            const max = maxTok ? maxTok.value : Infinity;
            return row => {
                const val = row[colName];
                if (val === null || val === undefined || val === '') return false;
                const numVal = Number(val);
                const numMin = Number(min);
                const numMax = Number(max);
                if (!isNaN(numVal) && !isNaN(numMin) && !isNaN(numMax)) {
                    return numVal >= numMin && numVal <= numMax;
                }
                return String(val) >= String(min) && String(val) <= String(max);
            };
        }

        // Standard comparison with operand
        const valTok = tokens[c++];
        if (!valTok) return () => true;
        const targetVal = valTok.value;

        return row => {
            const rowVal = row[colName];

            // In SQL, comparing NULL with any relational operator returns NULL (false)
            // (Unless checked via IS NULL / IS NOT NULL handled above)
            const isNullVal = rowVal === null || rowVal === undefined || rowVal === '';

            // String patterns LIKE / ILIKE
            if (op === 'LIKE' || op === 'ILIKE') {
                if (isNullVal) return false;
                const pattern = String(targetVal)
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/%/g, '.*')
                    .replace(/_/g, '.');
                const regex = new RegExp(`^${pattern}$`, op === 'ILIKE' ? 'i' : '');
                const matched = regex.test(String(rowVal));
                return negateOp ? !matched : matched;
            }

            if (op === '=') {
                if (targetVal === null || targetVal === 'NULL') return isNullVal;
                if (isNullVal) return false;
                if (typeof rowVal === 'number' || !isNaN(Number(targetVal)) && typeof rowVal === 'number') {
                    return rowVal === Number(targetVal);
                }
                return String(rowVal).toLowerCase() === String(targetVal).toLowerCase();
            }
            if (op === '!=') {
                if (targetVal === null || targetVal === 'NULL') return !isNullVal;
                if (isNullVal) return false;
                if (typeof rowVal === 'number' || !isNaN(Number(targetVal)) && typeof rowVal === 'number') {
                    return rowVal !== Number(targetVal);
                }
                return String(rowVal).toLowerCase() !== String(targetVal).toLowerCase();
            }

            // Numeric/relational comparisons: MUST be non-null and numeric
            if (isNullVal) return false;
            const numA = Number(rowVal);
            const numB = Number(targetVal);
            if (isNaN(numA) || isNaN(numB)) {
                // Lexicographical fallback
                const strA = String(rowVal);
                const strB = String(targetVal);
                if (op === '>') return strA > strB;
                if (op === '<') return strA < strB;
                if (op === '>=') return strA >= strB;
                if (op === '<=') return strA <= strB;
                return false;
            }

            if (op === '>') return numA > numB;
            if (op === '<') return numA < numB;
            if (op === '>=') return numA >= numB;
            if (op === '<=') return numA <= numB;

            return true;
        };
    }

    return parseOr();
}

/**
 * Export rows array to CSV string
 */
export function exportRowsToCSV(rows = [], columns = []) {
    if (!rows.length) return '';
    const cols = columns.length ? columns : Object.keys(rows[0]).filter(k => !k.startsWith('_'));
    const header = cols.map(c => `"${c}"`).join(',');
    const lines = rows.map(r => {
        return cols.map(c => {
            const val = r[c];
            if (val === null || val === undefined) return '""';
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',');
    });
    return [header, ...lines].join('\n');
}
