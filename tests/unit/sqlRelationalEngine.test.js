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

    describe('Aggregates, DISTINCT, AS, NOT IN & co_passengers', () => {
        it('supports SUM, AVG, MIN, MAX with AS aliases', () => {
            const sql = 'SELECT SUM(distance_km) AS total_km, AVG(distance_km) AS avg_km, MIN(delay_dep) AS min_d, MAX(delay_dep) AS max_d FROM trips';
            const res = executeTripQuery(sql, mockDatasets.trips);
            expect(res.isAggregate).toBe(true);
            expect(res.columns).toEqual(['total_km', 'avg_km', 'min_d', 'max_d']);
            expect(res.rows[0].total_km).toBe(200);
            expect(res.rows[0].avg_km).toBe(100);
            expect(res.rows[0].min_d).toBe(0);
            expect(res.rows[0].max_d).toBe(12);
        });

        it('supports SELECT DISTINCT and NOT IN', () => {
            const resDistinct = executeTripQuery("SELECT DISTINCT country_code FROM stations WHERE country_code NOT IN ('CH')", [], {
                tables: {
                    ...mockDatasets,
                    stations: [
                        ...mockDatasets.stations,
                        { id: 8000001, name: 'Berlin Hbf', country_code: 'DE' }
                    ]
                }
            });
            expect(resDistinct.rows).toHaveLength(1);
            expect(resDistinct.rows[0].country_code).toBe('DE');
        });

        it('queries co_passengers table when supplied in tables option', () => {
            const res = executeTripQuery('SELECT username, origin FROM co_passengers ORDER BY username ASC', [], {
                tables: {
                    ...mockDatasets,
                    co_passengers: [
                        { trip_id: 1, username: 'bob', origin: 'Berlin Hbf' },
                        { trip_id: 1, username: 'alice', origin: 'Hamburg Hbf' }
                    ]
                }
            });
            expect(res.table).toBe('co_passengers');
            expect(res.rows.map(r => r.username)).toEqual(['alice', 'bob']);
        });
    });

    describe('GROUP BY, HAVING, and JOIN Execution', () => {
        const richTrips = [
            { id: 1, line: 'ICE 720', category: 'nationalExpress', operator: 'DB Fernverkehr AG', distance_km: 300, delay_dep: 10, year: 2025, backend_trip_id: 9001 },
            { id: 2, line: 'ICE 722', category: 'nationalExpress', operator: 'DB Fernverkehr AG', distance_km: 500, delay_dep: 20, year: 2025, backend_trip_id: 9002 },
            { id: 3, line: 'RE 1', category: 'regional', operator: 'DB Regio', distance_km: 40, delay_dep: 2, year: 2025, backend_trip_id: 9003 },
            { id: 4, line: 'RE 2', category: 'regional', operator: 'DB Regio', distance_km: 60, delay_dep: 4, year: 2026, backend_trip_id: 9004 },
            { id: 5, line: 'S 1', category: 'suburban', operator: 'S-Bahn Berlin', distance_km: 15, delay_dep: 0, year: 2026, backend_trip_id: 9005 }
        ];

        it('groups rows with GROUP BY and computes COUNT, SUM, AVG, MIN, MAX', () => {
            const sql = 'SELECT category, COUNT(*) AS trips, SUM(distance_km) AS total_km, AVG(delay_dep) AS avg_delay FROM trips GROUP BY category ORDER BY total_km DESC';
            const res = executeTripQuery(sql, richTrips);

            expect(res.isAggregate).toBe(true);
            expect(res.columns).toEqual(['category', 'trips', 'total_km', 'avg_delay']);
            expect(res.rows).toHaveLength(3);
            expect(res.rows[0]).toMatchObject({ category: 'nationalExpress', trips: 2, total_km: 800, avg_delay: 15 });
            expect(res.rows[1]).toMatchObject({ category: 'regional', trips: 2, total_km: 100, avg_delay: 3 });
            expect(res.rows[2]).toMatchObject({ category: 'suburban', trips: 1, total_km: 15, avg_delay: 0 });
        });

        it('filters grouped results using HAVING with aliases or aggregate expressions', () => {
            const sql1 = 'SELECT category, COUNT(*) AS cnt, AVG(delay_dep) AS avg_d FROM trips GROUP BY category HAVING COUNT(*) >= 2 ORDER BY avg_d DESC';
            const res1 = executeTripQuery(sql1, richTrips);
            expect(res1.rows.map(r => r.category)).toEqual(['nationalExpress', 'regional']);

            const sql2 = 'SELECT category, SUM(distance_km) AS total_km FROM trips GROUP BY category HAVING total_km > 500';
            const res2 = executeTripQuery(sql2, richTrips);
            expect(res2.rows).toHaveLength(1);
            expect(res2.rows[0].category).toBe('nationalExpress');
        });

        it('supports COUNT(DISTINCT col) with GROUP BY', () => {
            const sql = 'SELECT year, COUNT(DISTINCT category) AS unique_modes FROM trips GROUP BY year ORDER BY year ASC';
            const res = executeTripQuery(sql, richTrips);
            expect(res.rows).toEqual([
                expect.objectContaining({ year: 2025, unique_modes: 2 }),
                expect.objectContaining({ year: 2026, unique_modes: 2 })
            ]);
        });

        it('performs INNER JOIN with table aliases and qualified columns', () => {
            const sql = 'SELECT s.id, r.line_name, r.operator_name, s.departure_delay FROM statuses s INNER JOIN routes r ON s.trip_id = r.id ORDER BY s.departure_delay DESC';
            const res = executeTripQuery(sql, [], { tables: mockDatasets });

            expect(res.totalRows).toBe(2);
            expect(res.columns).toEqual(['s.id', 'r.line_name', 'r.operator_name', 's.departure_delay']);
            expect(res.rows[0]['s.id']).toBe(101);
            expect(res.rows[0]['r.line_name']).toBe('ICE 720');
            expect(res.rows[0]['r.operator_name']).toBe('DB Fernverkehr AG');
        });

        it('performs LEFT JOIN preserving unmatched left rows with null right columns', () => {
            const tables = {
                ...mockDatasets,
                statuses: [
                    ...mockDatasets.statuses,
                    { id: 103, username: 'testuser', trip_id: 'MISSING_ROUTE', origin_id: 8000261, destination_id: 8000105, departure_delay: 5, distance_km: 10 }
                ]
            };
            const sql = 'SELECT s.id, r.line_name AS line FROM statuses s LEFT JOIN routes r ON s.trip_id = r.id ORDER BY s.id ASC';
            const res = executeTripQuery(sql, [], { tables });

            expect(res.totalRows).toBe(3);
            expect(res.rows[2]['s.id']).toBe(103);
            expect(res.rows[2].line).toBeNull();
        });

        it('combines JOIN + GROUP BY + ORDER BY across trips and co_passengers', () => {
            const tables = {
                trips: richTrips,
                co_passengers: [
                    { trip_id: 9001, username: 'alice', origin: 'München Hbf' },
                    { trip_id: 9002, username: 'alice', origin: 'Nürnberg Hbf' },
                    { trip_id: 9002, username: 'bob', origin: 'Nürnberg Hbf' }
                ]
            };
            const sql = 'SELECT c.username AS buddy, COUNT(*) AS shared_trips, SUM(t.distance_km) AS shared_km FROM trips t INNER JOIN co_passengers c ON t.backend_trip_id = c.trip_id GROUP BY c.username ORDER BY shared_trips DESC';
            const res = executeTripQuery(sql, richTrips, { tables });

            expect(res.rows).toHaveLength(2);
            expect(res.rows[0]).toMatchObject({ buddy: 'alice', shared_trips: 2, shared_km: 800 });
            expect(res.rows[1]).toMatchObject({ buddy: 'bob', shared_trips: 1, shared_km: 500 });
        });

        it('suggests tables after JOIN and columns after GROUP BY in autocomplete', () => {
            const joinComp = getSQLCompletions('SELECT * FROM statuses s INNER JOIN ', 36);
            expect(joinComp.items.map(i => i.label)).toContain('routes');
            expect(joinComp.items.map(i => i.label)).toContain('stations');

            const groupComp = getSQLCompletions('SELECT category, COUNT(*) FROM trips GROUP BY ', 46);
            expect(groupComp.items.map(i => i.label)).toContain('category');
        });
    });
});

