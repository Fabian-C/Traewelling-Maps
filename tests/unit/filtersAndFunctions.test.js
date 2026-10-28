import { describe, it, expect, beforeEach } from 'vitest';
import {
    applyAllFilters,
    filterTripsByDateRange,
    registerFilter,
    getRegisteredFilters
} from '../../js/filters/filterManager.js';
import {
    extractTripTags,
    buildTripSearchCorpus,
    matchesTripSearch,
    getTripSearchMatchReason,
    getTripBusinessType,
    normalizeCategory,
    isAccuratePolyline,
    indexTrips
} from '../../js/data/processing.js';
import {
    formatHumanDuration,
    formatTotalTime,
    calculateCO2Saved,
    formatSpeed,
    formatDelayMinutes,
    buildEndpointKey,
    escapeHtml
} from '../../js/utils/format.js';
import {
    computeRouteLengthKm,
    snapLngLatToLine,
    getTapTolerancePx
} from '../../js/utils/geometry.js';
import {
    computeTripDurationMinutes,
    deriveDelaySeconds,
    getDelayDate
} from '../../js/utils/time.js';
import {
    clamp,
    getRouteParticleCount,
    getDelayWidth
} from '../../js/utils/math.js';
import {
    hexToRgbArray,
    getDelayColor
} from '../../js/utils/color.js';
import {
    extractAvailableYears,
    filterTripsByYear,
    calculateHaversineKm,
    sanitizeTripDistanceKm,
    calculateWrappedInsights,
    compareUsers
} from '../../js/wrapped/analytics.js';
import { executeTripQuery, flattenTripRecord } from '../../js/trips/sqlEngine.js';

// Comprehensive Mock Trips Dataset
const testTrips = [
    {
        id: 101,
        body: 'Heading home with @Alice and @Bob! #commute #friday',
        bodyMentions: [{ id: 1, username: 'Alice' }, { id: 2, username: 'Bob' }],
        business: 2, // commute
        createdAt: '2026-05-15T17:30:00Z',
        train: {
            category: 'suburban',
            lineName: 'S1',
            totalDistance: 18500, // 18.5 km
            departureDelay: 0,
            arrivalDelay: 60, // 1 min delay
            origin: { name: 'Hamburg Hbf' },
            destination: { name: 'Wedel' },
            departure: '2026-05-15T17:30:00Z',
            arrival: '2026-05-15T18:15:00Z',
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [[9.993, 53.551], [9.850, 53.560], [9.700, 53.580]]
                }
            }
        }
    },
    {
        id: 102,
        body: 'Business client meeting in Munich #work',
        bodyMentions: [],
        business: 1, // work
        createdAt: '2026-06-10T08:00:00Z',
        train: {
            category: 'highspeed',
            lineName: 'ICE 772',
            totalDistance: 780000, // 780 km
            departureDelay: 900, // 15 min delay
            arrivalDelay: 1200, // 20 min delay
            origin: { name: 'Berlin Hbf' },
            destination: { name: 'München Hbf' },
            departure: '2026-06-10T08:00:00Z',
            arrival: '2026-06-10T12:00:00Z',
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [[13.369, 52.525], [12.000, 50.000], [11.558, 48.140]]
                }
            }
        }
    },
    {
        id: 103,
        body: 'Weekend holiday trip with @Alice #vacation',
        bodyMentions: [{ id: 1, username: 'Alice' }],
        business: 0, // personal
        createdAt: '2022-08-20T11:00:00Z',
        train: {
            category: 'regional',
            lineName: 'RE 5',
            totalDistance: 95000, // 95 km
            departureDelay: 2400, // 40 min delay (severe)
            arrivalDelay: 3000,
            origin: { name: 'Köln Hbf' },
            destination: { name: 'Koblenz Hbf' },
            departure: '2022-08-20T11:00:00Z',
            arrival: '2022-08-20T12:15:00Z',
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [[6.958, 50.943], [7.589, 50.356]]
                }
            }
        }
    }
];

describe('Comprehensive Filters & Functions Test Suite', () => {

    beforeEach(() => {
        indexTrips(testTrips, 'currentUser');
    });

    // =========================================================================
    // SECTION 1: FILTER SUITE
    // =========================================================================
    describe('1. Individual Filters', () => {

        describe('1.1 Date Range Filter', () => {
            it('filters trips strictly between fromDate and toDate', () => {
                const filtered = filterTripsByDateRange(testTrips, '2026-01-01', '2026-12-31');
                expect(filtered.map(t => t.id)).toEqual([101, 102]);
            });

            it('filters trips with only fromDate (lower bound)', () => {
                const filtered = filterTripsByDateRange(testTrips, '2026-06-01', null);
                expect(filtered.map(t => t.id)).toEqual([102]);
            });

            it('filters trips with only toDate (upper bound)', () => {
                const filtered = filterTripsByDateRange(testTrips, null, '2023-01-01');
                expect(filtered.map(t => t.id)).toEqual([103]);
            });

            it('returns an identical clone when no date bounds are specified', () => {
                const filtered = filterTripsByDateRange(testTrips, null, null);
                expect(filtered.length).toBe(3);
            });
        });

        describe('1.2 Business / Purpose Type Filter', () => {
            it('filters personal trips only', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    business: { personal: true, work: false, commute: false }
                });
                expect(filtered.map(t => t.id)).toEqual([103]);
            });

            it('filters work trips only', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    business: { personal: false, work: true, commute: false }
                });
                expect(filtered.map(t => t.id)).toEqual([102]);
            });

            it('filters commute trips only', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    business: { personal: false, work: false, commute: true }
                });
                expect(filtered.map(t => t.id)).toEqual([101]);
            });

            it('allows multiple business types simultaneously', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    business: { personal: true, work: true, commute: false }
                });
                expect(filtered.map(t => t.id)).toEqual([102, 103]);
            });
        });

        describe('1.3 Travel Buddies & Mentions Filter', () => {
            it('filters trips accompanied by a specific travel buddy (@Alice)', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    buddies: ['alice'],
                    includeNoteMentions: true
                });
                expect(filtered.map(t => t.id)).toEqual([101, 103]);
            });

            it('filters trips accompanied by @Bob', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    buddies: ['bob'],
                    includeNoteMentions: true
                });
                expect(filtered.map(t => t.id)).toEqual([101]);
            });

            it('returns empty when filtering for a buddy who was never on a trip', () => {
                const filtered = applyAllFilters(testTrips, {
                    filterLevel: 0,
                    buddies: ['nonexistent_user'],
                    includeNoteMentions: true
                });
                expect(filtered).toHaveLength(0);
            });
        });

        describe('1.4 Search Keyword & Corpus Filter', () => {
            it('matches station origin/destination names case-insensitively', () => {
                const filtered = applyAllFilters(testTrips, { filterLevel: 0, searchQuery: 'münchen' });
                expect(filtered.map(t => t.id)).toEqual([102]);
            });

            it('matches train line identifiers (e.g. ICE 772, S1)', () => {
                const filteredS1 = applyAllFilters(testTrips, { filterLevel: 0, searchQuery: 's1' });
                expect(filteredS1.map(t => t.id)).toEqual([101]);

                const filteredICE = applyAllFilters(testTrips, { filterLevel: 0, searchQuery: '772' });
                expect(filteredICE.map(t => t.id)).toEqual([102]);
            });

            it('matches hashtags in notes (#vacation)', () => {
                const filtered = applyAllFilters(testTrips, { filterLevel: 0, searchQuery: '#vacation' });
                expect(filtered.map(t => t.id)).toEqual([103]);
            });

            it('returns all trips when search query is empty or whitespace', () => {
                const filtered = applyAllFilters(testTrips, { filterLevel: 0, searchQuery: '   ' });
                expect(filtered.length).toBe(3);
            });
        });

        describe('1.5 Polyline Accuracy Filter', () => {
            it('preserves trips under level 0 (off)', () => {
                const filtered = applyAllFilters(testTrips, { filterLevel: 0 });
                expect(filtered.length).toBe(3);
            });

            it('evaluates line geometry accuracy for railway modes', () => {
                // Dense polyline with 15 segments represents an accurate track trace
                const denseCoords = Array.from({ length: 15 }, (_, i) => [9.99 + i * 0.002, 53.55 + i * 0.001]);
                expect(isAccuratePolyline(denseCoords, 'suburban', 1)).toBe(true);

                // Water and flight paths are always allowed
                expect(isAccuratePolyline([[9.9, 53.5], [10.0, 53.6]], 'ferry', 1)).toBe(true);

                // Low-density straight line across 700km should be flagged as inaccurate
                const straightCoords = [[13.369, 52.525], [12.000, 50.000], [11.558, 48.140]];
                expect(isAccuratePolyline(straightCoords, 'highspeed', 1)).toBe(false);
            });
        });

        describe('1.6 Custom Filter Registration Extensibility', () => {
            it('registers and retrieves custom filters dynamically', () => {
                registerFilter('testFilter', 'Test Filter Name', (trips) => trips.filter(t => t.id === 101));
                const registered = getRegisteredFilters();
                const found = registered.find(f => f.key === 'testFilter');
                expect(found).toBeDefined();
                expect(found?.name).toBe('Test Filter Name');
            });
        });
    });

    // =========================================================================
    // SECTION 2: CORE FUNCTIONS SUITE
    // =========================================================================
    describe('2. Core Functions', () => {

        describe('2.1 Data Processing Functions', () => {
            it('extractTripTags parses structured tags cleanly', () => {
                const tripWithTags = { tags: [{ key: 'purpose', value: 'vacation' }] };
                const tags = extractTripTags(tripWithTags);
                expect(tags).toHaveLength(1);
                expect(tags[0].value).toBe('vacation');
            });

            it('buildTripSearchCorpus combines all searchable metadata into a searchable text block', () => {
                const corpus = buildTripSearchCorpus(testTrips[0]);
                expect(corpus).toContain('hamburg hbf');
                expect(corpus).toContain('wedel');
                expect(corpus).toContain('s1');
                expect(corpus).toContain('alice');
            });

            it('matchesTripSearch accurately evaluates queries against corpus', () => {
                expect(matchesTripSearch(testTrips[0], 'wedel')).toBe(true);
                expect(matchesTripSearch(testTrips[0], 'frankfurt')).toBe(false);
            });

            it('getTripSearchMatchReason provides diagnostic match insights', () => {
                const reasons = getTripSearchMatchReason(testTrips[0], 'wedel');
                expect(Array.isArray(reasons)).toBe(true);
                expect(reasons.some(r => r.includes('Wedel'))).toBe(true);
            });

            it('normalizeCategory canonicalizes diverse vehicle categories', () => {
                expect(normalizeCategory('ship')).toBe('ferry');
                expect(normalizeCategory('cab')).toBe('taxi');
                expect(normalizeCategory('airplane')).toBe('plane');
                expect(normalizeCategory('nationalExpress')).toBe('nationalExpress');
                expect(normalizeCategory('unknown_xyz')).toBe('unknown');
            });

            it('getTripBusinessType extracts business type enum correctly', () => {
                expect(getTripBusinessType(testTrips[0])).toBe(2); // commute
                expect(getTripBusinessType(testTrips[1])).toBe(1); // work
                expect(getTripBusinessType(testTrips[2])).toBe(0); // personal
            });
        });

        describe('2.2 Format & Unit Conversion Functions', () => {
            it('formatHumanDuration converts minutes to compact notation', () => {
                expect(formatHumanDuration(25)).toBe('25m');
                expect(formatHumanDuration(60)).toBe('1h');
                expect(formatHumanDuration(125)).toBe('2h 5m');
                expect(formatHumanDuration(1440)).toBe('1d 0h');
            });

            it('formatTotalTime formats cumulative hours into days and hours', () => {
                expect(formatTotalTime(5).primary).toBe('5 hrs');
                expect(formatTotalTime(26).primary).toBe('1d 2h');
            });

            it('calculateCO2Saved estimates carbon savings relative to driving', () => {
                const res = calculateCO2Saved(100);
                expect(res.kg).toBeGreaterThan(10);
                expect(res.kg).toBeLessThan(20);
            });

            it('formatSpeed computes average km/h accurately', () => {
                expect(formatSpeed(100, 60)).toBe('100 km/h');
                expect(formatSpeed(200, 60)).toBe('200 km/h');
                expect(formatSpeed(0, 60)).toBe('—');
            });

            it('formatDelayMinutes converts seconds to rounded minutes', () => {
                expect(formatDelayMinutes(120)).toBe(2);
                expect(formatDelayMinutes(30)).toBe(1);
                expect(formatDelayMinutes(0)).toBe(0);
                expect(formatDelayMinutes(null)).toBeNull();
            });

            it('buildEndpointKey creates stable coordinate pairs', () => {
                const key = buildEndpointKey([[9.99, 53.55], [13.40, 52.52]]);
                expect(key).toBe('9.990,53.550-13.400,52.520');
            });

            it('escapeHtml secures against XSS payload injection', () => {
                expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
            });
        });

        describe('2.3 Geometry & Distance Calculation Functions', () => {
            it('computeRouteLengthKm calculates cumulative polyline distance', () => {
                const coords = [
                    [9.99368, 53.55108], // Hamburg
                    [13.40495, 52.52001] // Berlin
                ];
                const lengthKm = computeRouteLengthKm(coords);
                expect(lengthKm).toBeGreaterThan(300);
            });

            it('snapLngLatToLine safely handles execution context', () => {
                const feature = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [[10.0, 50.0], [10.0, 52.0]]
                    }
                };
                // In Node.js environment without window.turf, returns null safely
                const snapped = snapLngLatToLine([10.05, 51.0], feature);
                expect(snapped === null || Array.isArray(snapped)).toBe(true);
            });

            it('getTapTolerancePx adjusts tolerance based on zoom level', () => {
                expect(getTapTolerancePx(5)).toBe(6);
                expect(getTapTolerancePx(15)).toBe(20);
            });
        });

        describe('2.4 Time & Delay Derivation Functions', () => {
            it('computeTripDurationMinutes derives journey duration from timestamps', () => {
                const train = {
                    departure: '2026-05-15T10:00:00Z',
                    arrival: '2026-05-15T11:45:00Z'
                };
                expect(computeTripDurationMinutes(train)).toBe(105);
            });

            it('deriveDelaySeconds derives delay difference accurately', () => {
                const train = {
                    departureDelay: 420
                };
                expect(deriveDelaySeconds(train).departure).toBe(420);
            });

            it('getDelayDate parses delay date timestamps safely', () => {
                expect(getDelayDate('2026-05-15T10:00:00Z')).toBeInstanceOf(Date);
                expect(getDelayDate(null)).toBeNull();
            });
        });

        describe('2.5 Math & Color Utility Functions', () => {
            it('clamp bounds numerical values within min and max', () => {
                expect(clamp(15, 0, 10)).toBe(10);
                expect(clamp(-5, 0, 10)).toBe(0);
                expect(clamp(5, 0, 10)).toBe(5);
            });

            it('getRouteParticleCount generates particle density based on route length', () => {
                expect(getRouteParticleCount(10)).toBe(1);
                expect(getRouteParticleCount(500)).toBeGreaterThan(2);
            });

            it('getDelayWidth scales line stroke with delay severity', () => {
                expect(getDelayWidth(0)).toBeLessThan(getDelayWidth(45));
            });

            it('hexToRgbArray converts hex color strings to RGB triplets', () => {
                expect(hexToRgbArray('#ff0000')).toEqual([255, 0, 0]);
                expect(hexToRgbArray('#00ff00')).toEqual([0, 255, 0]);
                expect(hexToRgbArray('#0000ff')).toEqual([0, 0, 255]);
            });

            it('getDelayColor maps delay tiers to semantic color scales', () => {
                const col0 = getDelayColor(0);
                expect(Array.isArray(col0)).toBe(true);
                expect(col0.length).toBe(4);

                const col30 = getDelayColor(30);
                expect(Array.isArray(col30)).toBe(true);
                expect(col30[0]).toBeGreaterThan(col0[0]);
            });
        });

        describe('2.6 Wrapped Insights & Year Aggregation Functions', () => {
            it('extractAvailableYears collects unique years from trips', () => {
                const years = extractAvailableYears(testTrips);
                expect(years).toContain(2026);
                expect(years).toContain(2022);
            });

            it('filterTripsByYear filters trips by calendar year', () => {
                const trips2026 = filterTripsByYear(testTrips, '2026');
                expect(trips2026).toHaveLength(2);

                const allTrips = filterTripsByYear(testTrips, 'all');
                expect(allTrips).toHaveLength(3);
            });

            it('calculateHaversineKm measures great-circle distance accurately', () => {
                const dist = calculateHaversineKm(53.551, 9.993, 52.520, 13.405);
                expect(dist).toBeGreaterThan(250);
                expect(dist).toBeLessThan(260);
            });

            it('sanitizeTripDistanceKm cleans up erroneous distance anomalies', () => {
                const validKm = sanitizeTripDistanceKm(250, 53.551, 9.993, 52.520, 13.405, 'regional');
                expect(validKm).toBeCloseTo(250, 0);
            });

            it('calculateWrappedInsights computes complete summary statistics', () => {
                const insights = calculateWrappedInsights(testTrips, 'Resu');
                expect(insights.totalTrips).toBe(3);
                expect(insights.totalKm).toBeGreaterThan(800);
                expect(insights.punctuality.rate).toBeGreaterThanOrEqual(0);
            });

            it('compareUsers calculates duel metrics between two profiles', () => {
                const insightsA = calculateWrappedInsights(testTrips, 'UserA');
                const insightsB = calculateWrappedInsights([testTrips[0]], 'UserB');
                const duel = compareUsers(insightsA, insightsB, 'UserA', 'UserB');
                expect(duel.winners.km).toBe('userA');
                expect(duel.winners.trips).toBe('userA');
            });
        });

        describe('2.7 SQL Studio Engine Functions', () => {
            const flattenedRecords = testTrips.map(flattenTripRecord);

            it('executes simple SELECT queries with column projection', () => {
                const result = executeTripQuery('SELECT line, origin, destination FROM trips', flattenedRecords);
                expect(result.rows).toHaveLength(3);
                expect(result.columns).toEqual(['line', 'origin', 'destination']);
            });

            it('evaluates numerical WHERE predicates (> and <=)', () => {
                const result = executeTripQuery('SELECT id, distance_km FROM trips WHERE distance_km > 50', flattenedRecords);
                expect(result.rows.length).toBe(2);
            });

            it('evaluates equality and string pattern matching (LIKE)', () => {
                const result = executeTripQuery("SELECT line, destination FROM trips WHERE destination LIKE '%Hbf%'", flattenedRecords);
                expect(result.rows.length).toBe(2);
            });

            it('evaluates travel buddy predicates (buddies LIKE)', () => {
                const result = executeTripQuery("SELECT id, line, buddies FROM trips WHERE buddies LIKE '%Alice%'", flattenedRecords);
                expect(result.rows.length).toBe(2);
            });

            it('supports ORDER BY clause with ASC and DESC direction', () => {
                const result = executeTripQuery('SELECT id, distance_km FROM trips ORDER BY distance_km DESC', flattenedRecords);
                expect(result.rows[0].id).toBe(102); // 780km ICE
            });

            it('supports LIMIT clause', () => {
                const result = executeTripQuery('SELECT id FROM trips LIMIT 1', flattenedRecords);
                expect(result.rows).toHaveLength(1);
            });

            it('supports trailing semicolons and comments safely', () => {
                const result = executeTripQuery('SELECT id FROM trips WHERE distance_km > 0; -- trailing query comment', flattenedRecords);
                expect(result.rows.length).toBe(3);
            });

            it('rejects invalid target tables with clear error message', () => {
                expect(() => executeTripQuery('SELECT * FROM users', flattenedRecords)).toThrow("Target table must be 'trips'");
            });

            it('handles syntax errors gracefully', () => {
                expect(() => executeTripQuery("SELECT * FROM trips WHERE destination = 'unclosed string", flattenedRecords)).toThrow();
            });
        });
    });
});
