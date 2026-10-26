// Lightweight in-memory SQL parser & evaluator for Träwelling Trips dataset
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { normalizeCategory, getTripBusinessType } from '../data/processing.js';

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
    { name: 'buddies', label: 'Companions', type: 'string', description: 'Fellow passengers / buddies' },
    { name: 'notes', label: 'Notes', type: 'string', description: 'Check-in message body' }
];

export const QUERY_RECIPES = [
    {
        title: 'Top 10 Most Delayed Trips',
        sql: 'SELECT line, origin, destination, delay_dep, departure FROM trips WHERE delay_dep > 15 ORDER BY delay_dep DESC LIMIT 10'
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
    }
];

/**
 * Flatten a raw trip object into standard column dictionary
 * @param {Object} trip Raw or normalized trip status
 * @returns {Object} Column dictionary
 */
export function flattenTripRecord(trip) {
    const train = trip.train || {};
    const origin = train.origin || {};
    const dest = train.destination || {};
    const depTime = origin.departureReal || origin.departure || trip.createdAt || '';
    const arrTime = dest.arrivalReal || dest.arrival || '';
    const delays = deriveDelaySeconds(train);
    const depDelaySec = delays.departure !== null ? delays.departure : (delays.worst || 0);
    const arrDelaySec = delays.arrival !== null ? delays.arrival : (delays.worst || 0);

    const buddiesList = Array.isArray(trip.buddies)
        ? trip.buddies.map(b => b.username || b.name || '').filter(Boolean)
        : (Array.isArray(trip.fellowPassengers) ? trip.fellowPassengers.map(b => b.username || b.name || '').filter(Boolean) : []);

    const yr = depTime ? new Date(depTime).getFullYear() : null;

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
        distance_km: train.totalDistance ? Math.round((train.totalDistance / 1000) * 10) / 10 : 0,
        duration_min: computeTripDurationMinutes(origin, dest) || 0,
        operator: train.operator?.name || train.operator || 'Unknown',
        business: getTripBusinessType(trip),
        buddies: buddiesList.length ? buddiesList.join(', ') : null,
        notes: trip.body || null
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

        // Single or double quote strings
        if (char === "'" || char === '"') {
            const quote = char;
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
 * @returns {Object} { columns, rows, totalRows, executionTimeMs, rawTrips }
 */
export function executeTripQuery(sql, records = []) {
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

    const selectedFields = [];
    while (cursor < tokens.length) {
        const tok = consume();
        if (!tok) break;

        if (tok.type === 'OPERATOR' && tok.value === '*') {
            selectedFields.push('*');
        } else if (tok.type === 'WORD') {
            // Check for aggregate like COUNT(*)
            const next = peek();
            if (next && next.type === 'PUNCT' && next.value === '(') {
                consume(); // '('
                const inner = consume(); // '*' or field
                consume(); // ')'
                selectedFields.push(`${tok.value.toUpperCase()}(${inner.value})`);
            } else {
                selectedFields.push(tok.value);
            }
        }

        if (peek() && peek().type === 'COMMA') {
            consume(); // skip comma
        } else {
            break;
        }
    }

    // 2. FROM clause
    if (matchWord('FROM')) {
        const tableTok = consume();
        if (!tableTok || (tableTok.value.toLowerCase() !== 'trips' && tableTok.value.toLowerCase() !== 'checkins')) {
            throw new Error("Target table must be 'trips'");
        }
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
            if (!colTok || colTok.type !== 'WORD') break;
            let dir = 'ASC';
            if (matchWord('DESC')) dir = 'DESC';
            else if (matchWord('ASC')) dir = 'ASC';
            orderByList.push({ column: colTok.value, dir });

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

    // EXECUTION
    // A. Filter
    let filtered = records;
    if (wherePredicate) {
        filtered = records.filter(row => {
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

    const totalMatching = filtered.length;

    // C. Paginate (Limit/Offset)
    let paged = filtered;
    if (offset > 0 || limit !== null) {
        const start = offset;
        const end = limit !== null ? start + limit : filtered.length;
        paged = filtered.slice(start, end);
    }

    // D. Column Projection
    const isSelectAll = selectedFields.length === 0 || selectedFields.includes('*');
    const availableCols = TRIP_COLUMNS.map(c => c.name);
    const activeColumns = isSelectAll
        ? availableCols
        : selectedFields.filter(f => availableCols.includes(f) || f.startsWith('COUNT('));

    const projectedRows = paged.map(row => {
        if (isSelectAll) return { ...row };
        const res = { _rawTrip: row._rawTrip, id: row.id };
        for (const col of activeColumns) {
            res[col] = row[col];
        }
        return res;
    });

    const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

    return {
        columns: activeColumns,
        rows: projectedRows,
        totalRows: totalMatching,
        rawTrips: paged.map(r => r._rawTrip).filter(Boolean),
        executionTimeMs,
        isSelectAll
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
        const colName = colTok.value;

        if (c >= len) return () => true;
        const opTok = tokens[c++];
        if (!opTok) return () => true;
        const op = opTok.value.toUpperCase();

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
                return inValues.has(rowVal);
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
                return val >= min && val <= max;
            };
        }

        // Standard comparison with operand
        const valTok = tokens[c++];
        if (!valTok) return () => true;
        const targetVal = valTok.value;

        return row => {
            const rowVal = row[colName];

            // String patterns LIKE / ILIKE
            if (op === 'LIKE' || op === 'ILIKE') {
                const pattern = String(targetVal)
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/%/g, '.*')
                    .replace(/_/g, '.');
                const regex = new RegExp(`^${pattern}$`, op === 'ILIKE' ? 'i' : '');
                return regex.test(String(rowVal || ''));
            }

            if (op === '=') {
                if (typeof rowVal === 'number') return rowVal === Number(targetVal);
                return String(rowVal || '').toLowerCase() === String(targetVal || '').toLowerCase();
            }
            if (op === '!=') {
                if (typeof rowVal === 'number') return rowVal !== Number(targetVal);
                return String(rowVal || '').toLowerCase() !== String(targetVal || '').toLowerCase();
            }
            if (op === '>') return Number(rowVal) > Number(targetVal);
            if (op === '<') return Number(rowVal) < Number(targetVal);
            if (op === '>=') return Number(rowVal) >= Number(targetVal);
            if (op === '<=') return Number(rowVal) <= Number(targetVal);

            return true;
        };
    }

    return parseOr();
}

/**
 * Generate a SQL string from Visual Filter conditions
 * @param {Array<Object>} conditions List of { column, operator, value }
 * @param {string} logicalMode 'AND' | 'OR'
 * @returns {string}
 */
export function visualFilterToSQL(conditions = [], logicalMode = 'AND') {
    if (!conditions.length) {
        return 'SELECT * FROM trips';
    }

    const clauses = [];
    for (const rule of conditions) {
        const { column, operator, value } = rule;
        if (!column || !operator) continue;

        const colDef = TRIP_COLUMNS.find(c => c.name === column);
        const isNum = colDef?.type === 'number';

        switch (operator) {
            case 'equals':
                clauses.push(`${column} = ${isNum ? value : `'${value.replace(/'/g, "''")}'`}`);
                break;
            case 'not_equals':
                clauses.push(`${column} != ${isNum ? value : `'${value.replace(/'/g, "''")}'`}`);
                break;
            case 'contains':
                clauses.push(`${column} LIKE '%${value.replace(/'/g, "''")}%'`);
                break;
            case 'starts_with':
                clauses.push(`${column} LIKE '${value.replace(/'/g, "''")}%'`);
                break;
            case 'greater_than':
                clauses.push(`${column} > ${value}`);
                break;
            case 'less_than':
                clauses.push(`${column} < ${value}`);
                break;
            case 'greater_equal':
                clauses.push(`${column} >= ${value}`);
                break;
            case 'less_equal':
                clauses.push(`${column} <= ${value}`);
                break;
            case 'is_empty':
                clauses.push(`${column} IS NULL`);
                break;
            case 'is_not_empty':
                clauses.push(`${column} IS NOT NULL`);
                break;
            default:
                break;
        }
    }

    if (!clauses.length) return 'SELECT * FROM trips';

    const whereStr = clauses.join(` ${logicalMode} `);
    return `SELECT * FROM trips WHERE ${whereStr}`;
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
