import { describe, it, expect } from 'vitest';
import {
    executeTripQuery,
    TRIP_COLUMNS,
    STATUS_COLUMNS,
    STATION_COLUMNS,
    ROUTE_COLUMNS,
    TABLE_SCHEMAS,
    QUERY_RECIPES
} from '../../js/trips/sqlEngine.js';
import { getSQLCompletions } from '../../js/trips/sqlAutocomplete.js';

describe('Relational SQL Engine & Autocomplete', () => {
    const mockDatasets = {
        trips: [
            { id: 1, line: 'ICE 720', category: 'nationalExpress', origin: 'München Hbf', destination: 'Nürnberg Hbf', distance_km: 170, delay_dep: 12 },
            { id: 2, line: 'RE 1', category: 'regional', origin: 'Potsdam Hbf', destination: 'Berlin Hbf', distance_km: 30, delay_dep: 0 }
        ],
        stations: [
            { id: 8000261, name: 'München Hbf', latitude: 48.1402, longitude: 11.5583, eva_number: '8000261', country_code: 'DE' },
            { id: 8000105, name: 'Frankfurt(Main)Hbf', latitude: 50.1071, longitude: 8.6638, eva_number: '8000105', country_code: 'DE' },
            { id: 8503000, name: 'Zürich HB', latitude: 47.3782, longitude: 8.5402, eva_number: '8503000', country_code: 'CH' }
        ],
        statuses: [
            { id: 101, username: 'testuser', trip_id: 'ICE 720_orig_dest', origin_id: 8000261, destination_id: 8000105, departure_time: '2026-10-15T08:00:00Z', departure_delay: 20, distance_km: 400, business_type: 'business' },
            { id: 102, username: 'testuser', trip_id: 'RE 1_orig_dest', origin_id: 8000105, destination_id: 8000105, departure_time: '2026-10-16T09:00:00Z', departure_delay: 0, distance_km: 25, business_type: 'commute' }
        ],
        routes: [
            { id: 'ICE 720_orig_dest', line_name: 'ICE 720', category: 'nationalExpress', operator_name: 'DB Fernverkehr AG' },
            { id: 'RE 1_orig_dest', line_name: 'RE 1', category: 'regional', operator_name: 'DB Regio' }
        ]
    };

    describe('Schema Specifications & Definitions', () => {
        it('exports all 4 relational table schemas with documented columns', () => {
            expect(TRIP_COLUMNS.length).toBeGreaterThan(10);
            expect(STATUS_COLUMNS.length).toBeGreaterThan(10);
            expect(STATION_COLUMNS.length).toBeGreaterThan(4);
            expect(ROUTE_COLUMNS.length).toBeGreaterThan(4);

            expect(TABLE_SCHEMAS.trips.name).toBe('trips');
            expect(TABLE_SCHEMAS.statuses.name).toBe('statuses');
            expect(TABLE_SCHEMAS.stations.name).toBe('stations');
            expect(TABLE_SCHEMAS.routes.name).toBe('routes');
        });

        it('includes multi-table query recipes in QUERY_RECIPES', () => {
            const titles = QUERY_RECIPES.map(r => r.title);
            expect(titles.some(t => t.includes('Stations:'))).toBe(true);
            expect(titles.some(t => t.includes('Statuses:'))).toBe(true);
            expect(titles.some(t => t.includes('Routes:'))).toBe(true);
        });
    });

    describe('Multi-Table Query Routing & Execution', () => {
        it('queries the stations table with filtering and sorting', () => {
            const sql = "SELECT id, name, country_code FROM stations WHERE country_code = 'DE' ORDER BY name ASC";
            const res = executeTripQuery(sql, [], { tables: mockDatasets });

            expect(res.table).toBe('stations');
            expect(res.totalRows).toBe(2);
            expect(res.rows.length).toBe(2);
            expect(res.rows[0].name).toBe('Frankfurt(Main)Hbf');
            expect(res.rows[1].name).toBe('München Hbf');
            expect(res.columns).toEqual(['id', 'name', 'country_code']);
        });

        it('queries the statuses table with delay filter', () => {
            const sql = 'SELECT id, departure_delay, business_type FROM statuses WHERE departure_delay > 10';
            const res = executeTripQuery(sql, [], { tables: mockDatasets });

            expect(res.table).toBe('statuses');
            expect(res.totalRows).toBe(1);
            expect(res.rows[0].id).toBe(101);
            expect(res.rows[0].business_type).toBe('business');
        });

        it('queries the routes table with category projection', () => {
            const sql = "SELECT line_name, operator_name FROM routes WHERE category = 'nationalExpress'";
            const res = executeTripQuery(sql, [], { tables: mockDatasets });

            expect(res.table).toBe('routes');
            expect(res.totalRows).toBe(1);
            expect(res.rows[0].line_name).toBe('ICE 720');
            expect(res.rows[0].operator_name).toBe('DB Fernverkehr AG');
        });

        it('supports COUNT(*) on relational tables', () => {
            const sql = 'SELECT COUNT(*) FROM stations';
            const res = executeTripQuery(sql, [], { tables: mockDatasets });

            expect(res.table).toBe('stations');
            expect(res.rows[0]['COUNT(*)']).toBe(3);
        });

        it('rejects unrecognized tables and maintains backwards compatible error substring', () => {
            expect(() => executeTripQuery('SELECT * FROM random_table', [], { tables: mockDatasets }))
                .toThrow(/Target table must be 'trips'/);
        });

        it('parses and ignores single-line and multi-line comments containing SQL keywords', () => {
            const sql1 = "SELECT line, origin FROM trips WHERE delay_dep > 10 -- and check delay \n ORDER BY delay_dep DESC";
            const res1 = executeTripQuery(sql1, mockDatasets.trips);
            expect(res1.totalRows).toBe(1);
            expect(res1.rows[0].line).toBe('ICE 720');

            const sql2 = "SELECT line, origin FROM trips WHERE delay_dep > 10 /* and order by limit */ ORDER BY delay_dep DESC";
            const res2 = executeTripQuery(sql2, mockDatasets.trips);
            expect(res2.totalRows).toBe(1);
        });

        it('throws descriptive error on unknown column in SELECT projection', () => {
            expect(() => executeTripQuery('SELECT unknown_field, line FROM trips', mockDatasets.trips))
                .toThrow(/Unknown column 'unknown_field' in table 'trips'/);
        });
    });

    describe('Context-Aware SQL Autocomplete', () => {
        it('recommends table names after FROM', () => {
            const completions = getSQLCompletions('SELECT * FROM ', 14);
            const tableLabels = completions.items.filter(i => i.type === 'table').map(i => i.label);
            expect(tableLabels).toContain('trips');
            expect(tableLabels).toContain('statuses');
            expect(tableLabels).toContain('stations');
            expect(tableLabels).toContain('routes');
        });

        it('recommends stations columns when query targets stations', () => {
            const completions = getSQLCompletions('SELECT  FROM stations', 7);
            const columnLabels = completions.items.filter(i => i.type === 'column').map(i => i.label);
            expect(columnLabels).toContain('latitude');
            expect(columnLabels).toContain('longitude');
            expect(columnLabels).toContain('country_code');
        });

        it('recommends statuses columns when query targets statuses', () => {
            const completions = getSQLCompletions('SELECT  FROM statuses', 7);
            const columnLabels = completions.items.filter(i => i.type === 'column').map(i => i.label);
            expect(columnLabels).toContain('departure_delay');
            expect(columnLabels).toContain('business_type');
        });

        it('suggests business values for normalized business_type column', () => {
            const completions = getSQLCompletions('SELECT * FROM statuses WHERE business_type = ', 46);
            const labels = completions.items.map(i => i.label);
            expect(labels).toContain("'business'");
            expect(labels).toContain("'commute'");
            expect(labels).toContain("'private'");
        });

        it('suggests country codes for country_code column', () => {
            const completions = getSQLCompletions('SELECT * FROM stations WHERE country_code = ', 45);
            const labels = completions.items.map(i => i.label);
            expect(labels).toContain("'DE'");
            expect(labels).toContain("'AT'");
            expect(labels).toContain("'CH'");
        });
    });
});

