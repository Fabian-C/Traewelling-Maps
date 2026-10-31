// Autocomplete & Smart Recommendations Engine for Database Studio SQL Console
import { TRIP_COLUMNS, STATUS_COLUMNS, STATION_COLUMNS, ROUTE_COLUMNS, TABLE_SCHEMAS } from './sqlEngine.js';

export const SQL_KEYWORDS = [
    { label: 'SELECT', insertText: 'SELECT ', type: 'keyword', detail: 'Select columns or expressions' },
    { label: 'FROM', insertText: 'FROM trips ', type: 'keyword', detail: 'Specify source table' },
    { label: 'WHERE', insertText: 'WHERE ', type: 'keyword', detail: 'Filter rows with conditions' },
    { label: 'ORDER BY', insertText: 'ORDER BY ', type: 'keyword', detail: 'Sort result rows' },
    { label: 'LIMIT', insertText: 'LIMIT ', type: 'keyword', detail: 'Limit row count' },
    { label: 'AND', insertText: 'AND ', type: 'keyword', detail: 'Logical AND condition' },
    { label: 'OR', insertText: 'OR ', type: 'keyword', detail: 'Logical OR condition' },
    { label: 'NOT', insertText: 'NOT ', type: 'keyword', detail: 'Logical NOT condition' },
    { label: 'LIKE', insertText: "LIKE '%...%' ", type: 'keyword', detail: 'Pattern matching (% wildcard)' },
    { label: 'ILIKE', insertText: "ILIKE '%...%' ", type: 'keyword', detail: 'Case-insensitive pattern matching' },
    { label: 'IN', insertText: "IN (...) ", type: 'keyword', detail: 'Set inclusion check' },
    { label: 'BETWEEN', insertText: 'BETWEEN ... AND ... ', type: 'keyword', detail: 'Range check (inclusive)' },
    { label: 'IS NULL', insertText: 'IS NULL ', type: 'keyword', detail: 'Check for missing/null values' },
    { label: 'IS NOT NULL', insertText: 'IS NOT NULL ', type: 'keyword', detail: 'Check for non-null values' },
    { label: 'DESC', insertText: 'DESC ', type: 'keyword', detail: 'Sort descending (highest first)' },
    { label: 'ASC', insertText: 'ASC ', type: 'keyword', detail: 'Sort ascending (lowest first)' },
    { label: 'DISTINCT', insertText: 'DISTINCT ', type: 'keyword', detail: 'Filter unique values' },
    { label: 'COUNT(*)', insertText: 'COUNT(*) ', type: 'keyword', detail: 'Count matching rows' },
    { label: 'AVG()', insertText: 'AVG(distance_km) ', type: 'keyword', detail: 'Average of numeric column' },
    { label: 'SUM()', insertText: 'SUM(distance_km) ', type: 'keyword', detail: 'Sum of numeric column' },
    { label: 'MAX()', insertText: 'MAX(delay_dep) ', type: 'keyword', detail: 'Maximum value of column' },
    { label: 'MIN()', insertText: 'MIN(delay_dep) ', type: 'keyword', detail: 'Minimum value of column' }
];

export const SQL_TABLES = [
    { label: 'trips', insertText: 'trips ', type: 'table', detail: 'Denormalized journeys table (default)' },
    { label: 'statuses', insertText: 'statuses ', type: 'table', detail: 'Normalized check-in events referencing trips & stations' },
    { label: 'stations', insertText: 'stations ', type: 'table', detail: 'Normalized transit stops & station coordinates' },
    { label: 'routes', insertText: 'routes ', type: 'table', detail: 'Normalized transit line runs, categories & operators' }
];

export const SQL_VALUES = [
    // Categories
    { label: "'nationalExpress'", insertText: "'nationalExpress'", type: 'value', detail: 'High-speed rail (ICE, TGV, Eurostar)' },
    { label: "'national'", insertText: "'national'", type: 'value', detail: 'InterCity & EuroCity trains (IC, EC)' },
    { label: "'regional'", insertText: "'regional'", type: 'value', detail: 'Regional trains (RE, RB, MEX)' },
    { label: "'suburban'", insertText: "'suburban'", type: 'value', detail: 'Suburban commuter rail (S-Bahn)' },
    { label: "'subway'", insertText: "'subway'", type: 'value', detail: 'Underground transit (U-Bahn, Metro)' },
    { label: "'tram'", insertText: "'tram'", type: 'value', detail: 'Streetcar / Light rail' },
    { label: "'bus'", insertText: "'bus'", type: 'value', detail: 'Local & regional bus lines' },
    { label: "'ferry'", insertText: "'ferry'", type: 'value', detail: 'Water transit & ferries' },
    // Business travel types
    { label: "'private'", insertText: "'private'", type: 'value', detail: 'Personal leisure travel' },
    { label: "'business'", insertText: "'business'", type: 'value', detail: 'Work & business trips' },
    { label: "'commute'", insertText: "'commute'", type: 'value', detail: 'Daily commute to workplace' },
    // Country codes
    { label: "'DE'", insertText: "'DE'", type: 'value', detail: 'Germany' },
    { label: "'AT'", insertText: "'AT'", type: 'value', detail: 'Austria' },
    { label: "'CH'", insertText: "'CH'", type: 'value', detail: 'Switzerland' },
    { label: "'NL'", insertText: "'NL'", type: 'value', detail: 'Netherlands' },
    { label: "'BE'", insertText: "'BE'", type: 'value', detail: 'Belgium' },
    { label: "'FR'", insertText: "'FR'", type: 'value', detail: 'France' },
    { label: "'PL'", insertText: "'PL'", type: 'value', detail: 'Poland' },
    { label: "'CZ'", insertText: "'CZ'", type: 'value', detail: 'Czech Republic' },
    { label: "'IT'", insertText: "'IT'", type: 'value', detail: 'Italy' },
    { label: "'DK'", insertText: "'DK'", type: 'value', detail: 'Denmark' },
    // Operators
    { label: "'DB Fernverkehr AG'", insertText: "'DB Fernverkehr AG'", type: 'value', detail: 'Deutsche Bahn Long Distance' },
    { label: "'DB Regio'", insertText: "'DB Regio'", type: 'value', detail: 'Deutsche Bahn Regional' },
    { label: "'ÖBB'", insertText: "'ÖBB'", type: 'value', detail: 'Austrian Federal Railways' },
    { label: "'SBB'", insertText: "'SBB'", type: 'value', detail: 'Swiss Federal Railways' },
    { label: "'SNCF'", insertText: "'SNCF'", type: 'value', detail: 'French National Railway Company' },
    { label: "'Eurostar'", insertText: "'Eurostar'", type: 'value', detail: 'High-speed cross-border rail' }
];

export const SQL_SNIPPETS = [
    {
        label: 'SELECT columns template',
        insertText: 'SELECT line, origin, destination, distance_km, delay_dep, departure FROM trips ',
        type: 'recipe',
        detail: 'Standard overview columns'
    },
    {
        label: 'SELECT * FROM stations',
        insertText: 'SELECT id, name, latitude, longitude, country_code FROM stations ORDER BY name ASC LIMIT 50',
        type: 'recipe',
        detail: 'List visited transit stations & coordinates'
    },
    {
        label: 'SELECT * FROM statuses',
        insertText: 'SELECT id, trip_id, departure_time, departure_delay, distance_km FROM statuses WHERE departure_delay > 15 ORDER BY departure_delay DESC LIMIT 50',
        type: 'recipe',
        detail: 'List delayed check-in statuses'
    },
    {
        label: 'SELECT * FROM routes',
        insertText: 'SELECT id, line_name, category, operator_name FROM routes ORDER BY line_name ASC LIMIT 50',
        type: 'recipe',
        detail: 'List line runs and transport providers'
    },
    {
        label: 'delay_dep > 15',
        insertText: 'delay_dep > 15 ',
        type: 'recipe',
        detail: 'Trips delayed by more than 15 minutes'
    },
    {
        label: 'distance_km > 300',
        insertText: 'distance_km > 300 ',
        type: 'recipe',
        detail: 'Long distance trips (> 300 km)'
    },
    {
        label: "category = 'nationalExpress'",
        insertText: "category = 'nationalExpress' ",
        type: 'recipe',
        detail: 'Filter ICE / High-speed trains'
    },
    {
        label: "category = 'regional'",
        insertText: "category = 'regional' ",
        type: 'recipe',
        detail: 'Filter Regional RE / RB trains'
    },
    {
        label: 'buddies IS NOT NULL',
        insertText: 'buddies IS NOT NULL ',
        type: 'recipe',
        detail: 'Trips shared with travel companions'
    },
    {
        label: 'buddy_count >= 2',
        insertText: 'buddy_count >= 2 ',
        type: 'recipe',
        detail: 'Group trips with 2 or more travel companions'
    },
    {
        label: 'buddy_count = 0',
        insertText: 'buddy_count = 0 ',
        type: 'recipe',
        detail: 'Solo trips with no travel companions'
    },
    {
        label: 'ORDER BY delay_dep DESC',
        insertText: 'ORDER BY delay_dep DESC ',
        type: 'recipe',
        detail: 'Sort highest delay first'
    },
    {
        label: 'ORDER BY distance_km DESC',
        insertText: 'ORDER BY distance_km DESC ',
        type: 'recipe',
        detail: 'Sort longest distance first'
    },
    {
        label: 'ORDER BY departure DESC',
        insertText: 'ORDER BY departure DESC ',
        type: 'recipe',
        detail: 'Sort newest trips first'
    },
    {
        label: 'LIMIT 50',
        insertText: 'LIMIT 50',
        type: 'recipe',
        detail: 'Return top 50 rows'
    }
];

/**
 * Get suggestions for current SQL query and caret position
 * @param {string} sql Full SQL query text
 * @param {number} cursorPos Caret index
 * @returns {{ items: Array, token: string, tokenStart: number }}
 */
export function getSQLCompletions(sql = '', cursorPos = 0) {
    const textBefore = sql.slice(0, cursorPos);
    const match = textBefore.match(/([a-zA-Z0-9_'%*]+)$/);
    const token = match ? match[1] : '';
    const tokenStart = cursorPos - token.length;
    const precedingText = textBefore.slice(0, tokenStart).trim();
    const precedingUpper = precedingText.toUpperCase();

    // Detect target table if present in query
    let targetTable = 'trips';
    const fromMatch = sql.match(/\bFROM\s+([a-zA-Z_]+)/i);
    if (fromMatch) {
        const t = fromMatch[1].toLowerCase();
        if (['statuses', 'status'].includes(t)) targetTable = 'statuses';
        else if (['stations', 'station'].includes(t)) targetTable = 'stations';
        else if (['routes', 'route', 'trips_runs'].includes(t)) targetTable = 'routes';
    }

    // Map column objects into suggestion items based on detected active table
    const activeSchema = TABLE_SCHEMAS[targetTable]?.columns || TRIP_COLUMNS;
    const columnSuggestions = activeSchema.map(c => ({
        label: c.name,
        insertText: c.name,
        type: 'column',
        detail: `${c.label} (${c.type}) - ${c.description}`
    }));

    let candidateList = [];

    // Context 1: Just after FROM
    if (precedingUpper.endsWith('FROM')) {
        candidateList = [
            ...SQL_TABLES,
            ...columnSuggestions
        ];
    }
    // Context 2: Just after WHERE, AND, OR
    else if (precedingUpper.endsWith('WHERE') || precedingUpper.endsWith('AND') || precedingUpper.endsWith('OR')) {
        candidateList = [
            ...SQL_SNIPPETS.filter(s => !s.label.startsWith('SELECT') && !s.label.startsWith('ORDER BY') && !s.label.startsWith('LIMIT')),
            ...columnSuggestions,
            ...SQL_KEYWORDS.filter(k => ['NOT', 'IS NULL', 'IS NOT NULL', 'IN', 'LIKE', 'ILIKE', 'BETWEEN'].includes(k.label))
        ];
    }
    // Context 3: After ORDER BY
    else if (precedingUpper.endsWith('ORDER BY') || precedingUpper.endsWith('BY')) {
        candidateList = [
            { label: 'delay_dep DESC', insertText: 'delay_dep DESC ', type: 'recipe', detail: 'Sort by delay (worst first)' },
            { label: 'distance_km DESC', insertText: 'distance_km DESC ', type: 'recipe', detail: 'Sort by distance (longest first)' },
            { label: 'duration_min DESC', insertText: 'duration_min DESC ', type: 'recipe', detail: 'Sort by duration (longest first)' },
            { label: 'departure DESC', insertText: 'departure DESC ', type: 'recipe', detail: 'Sort by departure (newest first)' },
            { label: 'departure ASC', insertText: 'departure ASC ', type: 'recipe', detail: 'Sort by departure (oldest first)' },
            ...columnSuggestions,
            ...SQL_KEYWORDS.filter(k => ['DESC', 'ASC', 'LIMIT'].includes(k.label))
        ];
    }
    // Context 4: Checking category / business equality or IN
    else if (/category\s*(=|IN|\!=|<>)\s*\(?$/i.test(precedingText)) {
        candidateList = [
            ...SQL_VALUES.filter(v => v.detail.includes('rail') || v.detail.includes('trains') || v.detail.includes('bus') || v.detail.includes('transit')),
            ...SQL_KEYWORDS
        ];
    }
    else if (/business(_type)?\s*(=|IN|\!=|<>)\s*\(?$/i.test(precedingText)) {
        candidateList = [
            ...SQL_VALUES.filter(v => ['\'private\'', '\'business\'', '\'commute\''].includes(v.label)),
            ...SQL_KEYWORDS
        ];
    }
    else if (/(country|country_code)\s*(=|IN|\!=|<>)\s*\(?$/i.test(precedingText)) {
        candidateList = [
            ...SQL_VALUES.filter(v => ['\'DE\'', '\'AT\'', '\'CH\'', '\'NL\'', '\'BE\'', '\'FR\'', '\'PL\'', '\'CZ\'', '\'IT\'', '\'DK\''].includes(v.label)),
            ...SQL_KEYWORDS
        ];
    }
    else if (/(operator|operator_name)\s*(=|IN|\!=|<>)\s*\(?$/i.test(precedingText)) {
        candidateList = [
            ...SQL_VALUES.filter(v => v.detail.includes('Railway') || v.detail.includes('Deutsche Bahn') || v.detail.includes('rail')),
            ...SQL_KEYWORDS
        ];
    }
    // Context 5: Start of query or SELECT
    else if (precedingUpper === '' || precedingUpper.endsWith('SELECT')) {
        candidateList = [
            ...columnSuggestions,
            { label: '*', insertText: '* ', type: 'keyword', detail: 'Select all columns' },
            { label: 'COUNT(*)', insertText: 'COUNT(*) ', type: 'keyword', detail: 'Count matching rows' },
            ...SQL_SNIPPETS.filter(s => s.label.startsWith('SELECT')),
            ...SQL_KEYWORDS
        ];
    }
    // Default context: Everything available
    else {
        candidateList = [
            ...columnSuggestions,
            ...SQL_KEYWORDS,
            ...SQL_TABLES,
            ...SQL_VALUES,
            ...SQL_SNIPPETS
        ];
    }

    // Filter by typed token prefix if any
    let filtered = candidateList;
    if (token) {
        const lowerToken = token.toLowerCase().replace(/^['%]/, '');
        filtered = candidateList.filter(item => {
            const lowerLabel = item.label.toLowerCase();
            const lowerInsert = item.insertText.toLowerCase();
            return lowerLabel.includes(lowerToken) || lowerInsert.includes(lowerToken);
        });

        // Sort: Exact prefix matches first, then contains
        filtered.sort((a, b) => {
            const aStartsWith = a.label.toLowerCase().startsWith(lowerToken) ? -1 : 1;
            const bStartsWith = b.label.toLowerCase().startsWith(lowerToken) ? -1 : 1;
            if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith;
            return a.label.localeCompare(b.label);
        });
    }

    // Deduplicate by label
    const seen = new Set();
    const unique = [];
    for (const item of filtered) {
        if (!seen.has(item.label)) {
            seen.add(item.label);
            unique.push(item);
        }
    }

    return {
        items: unique.slice(0, 15), // Show top 15 items
        token,
        tokenStart
    };
}
