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

/**
 * Parse and execute a SQL query on a list of flattened records
 * @param {string} sql SQL query string
 * @param {Array<Object>} records Flattened trip records
 * @param {Object} options Execution options, e.g. { tables: { trips, statuses, stations, routes } }
 * @returns {Object} { table, columns, rows, totalRows, executionTimeMs, rawTrips, isSelectAll }
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
    const peek = () => tokens[cursor];
    const consume = () => tokens[cursor++];
    const matchWord = (word) => {
        const tok = peek();
        if (tok && tok.type === 'WORD' && tok.value.toUpperCase() === word.toUpperCase()) {
            cursor++;
            return true;
        }
        return false;
    };

    // 1. SELECT clause
    if (!matchWord('SELECT')) {
        throw new Error("Query must begin with 'SELECT'");
    }

    const isDistinct = matchWord('DISTINCT');
    const selectedFields = [];
    while (cursor < tokens.length) {
        const tok = consume();
        if (!tok) break;

        if (tok.type === 'OPERATOR' && tok.value === '*') {
            selectedFields.push({ expr: '*', fn: null, arg: null, alias: '*' });
        } else if (tok.type === 'WORD' || tok.type === 'STRING') {
            const next = peek();
            if (next && next.type === 'PUNCT' && next.value === '(') {
                consume(); // '('
                const inner = consume(); // '*' or field
                consume(); // ')'
                const fn = tok.value.toUpperCase();
                const arg = inner ? (inner.value === '*' ? '*' : String(inner.value).toLowerCase()) : '*';
                const expr = `${fn}(${arg})`;
                let alias = expr;
                if (matchWord('AS')) {
                    const aliasTok = consume();
                    if (aliasTok) alias = String(aliasTok.value);
                }
                selectedFields.push({ expr, fn, arg, alias });
            } else {
                const col = String(tok.value).toLowerCase();
                let alias = col;
                if (matchWord('AS')) {
                    const aliasTok = consume();
                    if (aliasTok) alias = String(aliasTok.value);
                }
                selectedFields.push({ expr: col, fn: null, arg: col, alias });
            }
        }

        if (peek() && peek().type === 'COMMA') {
            consume(); // skip comma
        } else {
            break;
        }
    }

    // 2. FROM clause
    let targetTable = 'trips';
    if (matchWord('FROM')) {
        const tableTok = consume();
        const validTables = ['trips', 'trip', 'checkins', 'checkin', 'statuses', 'status', 'stations', 'station', 'routes', 'route', 'trips_runs', 'co_passengers', 'copassengers', 'companions', 'buddies'];
        if (!tableTok || !validTables.includes(String(tableTok.value).toLowerCase())) {
            throw new Error("Target table must be 'trips', 'statuses', 'stations', 'routes', or 'co_passengers'");
        }
        const rawTable = String(tableTok.value).toLowerCase();
        if (['statuses', 'status'].includes(rawTable)) targetTable = 'statuses';
        else if (['stations', 'station'].includes(rawTable)) targetTable = 'stations';
        else if (['routes', 'route', 'trips_runs'].includes(rawTable)) targetTable = 'routes';
        else if (['co_passengers', 'copassengers', 'companions', 'buddies'].includes(rawTable)) {
            targetTable = options?.tables?.co_passengers ? 'co_passengers' : 'trips';
        } else targetTable = 'trips';
    }

    // 3. WHERE clause
    let wherePredicate = null;
    if (matchWord('WHERE')) {
        const whereTokens = [];
        while (cursor < tokens.length) {
            const tok = peek();
            if (tok.type === 'WORD' && ['ORDER', 'LIMIT', 'OFFSET'].includes(tok.value.toUpperCase())) {
                break;
            }
            whereTokens.push(consume());
        }
        wherePredicate = compileWherePredicate(whereTokens);
    }

    // 4. ORDER BY clause
    const orderByList = [];
    if (matchWord('ORDER') && matchWord('BY')) {
        while (cursor < tokens.length) {
            const colTok = consume();
            if (!colTok || (colTok.type !== 'WORD' && colTok.type !== 'STRING')) break;
            let dir = 'ASC';
            if (matchWord('DESC')) dir = 'DESC';
            else if (matchWord('ASC')) dir = 'ASC';
            orderByList.push({ column: String(colTok.value).toLowerCase(), dir });

            if (peek() && peek().type === 'COMMA') {
                consume();
            } else {
                break;
            }
        }
    }

    // 5. LIMIT & OFFSET clause
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

    // Determine dataset to query
    let dataset = records;
    if (options && options.tables && options.tables[targetTable]) {
        dataset = options.tables[targetTable];
    } else if (targetTable !== 'trips') {
        dataset = [];
    }

    // EXECUTION
    // A. Filter
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

    // B. Sort
    if (orderByList.length) {
        filtered = filtered.slice().sort((a, b) => {
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

    const SUPPORTED_AGGS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    const schemaDef = TABLE_SCHEMAS[targetTable] || TABLE_SCHEMAS.trips;
    const availableCols = schemaDef.columns.map(c => c.name);
    const isSelectAll = selectedFields.length === 0 || selectedFields.some(f => f.expr === '*');

    if (!isSelectAll) {
        for (const field of selectedFields) {
            if (field.fn) {
                if (!SUPPORTED_AGGS.includes(field.fn)) {
                    throw new Error(`Unsupported aggregate function '${field.fn}'`);
                }
                if (field.arg !== '*' && !availableCols.includes(field.arg)) {
                    throw new Error(`Unknown column '${field.arg}' in table '${targetTable}'`);
                }
            } else if (!availableCols.includes(field.arg)) {
                throw new Error(`Unknown column '${field.arg}' in table '${targetTable}'`);
            }
        }
    }

    const hasAnyAgg = !isSelectAll && selectedFields.some(f => Boolean(f.fn));
    const allAggs = !isSelectAll && selectedFields.length > 0 && selectedFields.every(f => Boolean(f.fn));

    if (allAggs) {
        const aggRow = { id: 0 };
        const activeColumns = [];
        for (const field of selectedFields) {
            activeColumns.push(field.alias);
            let value = null;
            if (field.fn === 'COUNT') {
                value = field.arg === '*'
                    ? filtered.length
                    : filtered.filter(r => r[field.arg] !== null && r[field.arg] !== undefined && r[field.arg] !== '').length;
            } else {
                const nums = filtered
                    .map(r => r[field.arg])
                    .filter(v => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
                    .map(Number);
                if (nums.length > 0) {
                    if (field.fn === 'SUM') value = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
                    else if (field.fn === 'AVG') value = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
                    else if (field.fn === 'MIN') value = Math.min(...nums);
                    else if (field.fn === 'MAX') value = Math.max(...nums);
                }
            }
            aggRow[field.alias] = value;
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

    const activeColumns = isSelectAll ? availableCols : selectedFields.map(f => f.alias);

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

    // C. Paginate (Limit/Offset)
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

        // Column comparison rule: [col] [op] [val]
        const colTok = tokens[c++];
        if (!colTok) return () => true;
        const colName = String(colTok.value || '').toLowerCase();

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
