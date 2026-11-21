import { describe, it, expect, vi } from 'vitest';
import { applyAllFilters } from '../../js/filters/filterManager.js';
import { sortTrips } from '../../js/trips/sorting.js';
import { executeTripQuery } from '../../js/trips/sqlEngine.js';
import { processTripsToGeoJSON, syncGeometryGroupsToState } from '../../js/data/processing.js';
import { resolveFeatureForPopup, showPopup } from '../../js/map/interactions.js';
import { buildRouteDensityLines } from '../../js/map/heatmap.js';
import { store } from '../../js/state/store.js';

function generateSyntheticTrips(count = 5000) {
    const categories = ['nationalExpress', 'regionalExp', 'regional', 'suburban', 'bus', 'tram'];
    const operators = ['DB Fernverkehr AG', 'DB Regio', 'S-Bahn Berlin', 'ÖBB', 'SBB'];
    const stations = ['Berlin Hbf', 'München Hbf', 'Hamburg Hbf', 'Frankfurt(Main)Hbf', 'Köln Hbf', 'Stuttgart Hbf'];
    const baseMs = Date.UTC(2022, 0, 1, 6, 0, 0);

    const trips = new Array(count);
    for (let i = 0; i < count; i++) {
        const depMs = baseMs + i * 3600 * 1000 * 6;
        const arrMs = depMs + (25 + (i % 90)) * 60 * 1000;
        const cat = categories[i % categories.length];
        const origin = stations[i % stations.length];
        const dest = stations[(i + 2) % stations.length];
        const delaySec = (i % 15) * 120;

        trips[i] = {
            id: 100000 + i,
            createdAt: new Date(depMs).toISOString(),
            body: i % 10 === 0 ? `Ride with @buddy${i % 5}` : '',
            train: {
                trip: 500000 + i,
                category: cat,
                lineName: `${cat === 'nationalExpress' ? 'ICE' : 'RE'} ${100 + (i % 900)}`,
                operator: { name: operators[i % operators.length] },
                totalDistance: (15 + (i % 450)) * 1000,
                departureDelay: delaySec,
                arrivalDelay: delaySec,
                origin: {
                    name: origin,
                    departurePlanned: new Date(depMs).toISOString(),
                    departureReal: new Date(depMs + delaySec * 1000).toISOString()
                },
                destination: {
                    name: dest,
                    arrivalPlanned: new Date(arrMs).toISOString(),
                    arrivalReal: new Date(arrMs + delaySec * 1000).toISOString()
                },
                polyline: {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [13.3695, 52.5251],
                            [13.3710, 52.5240],
                            [13.3725, 52.5228],
                            [13.3740, 52.5215],
                            [13.3755, 52.5202],
                            [13.3770, 52.5190],
                            [13.3785, 52.5178],
                            [13.3800, 52.5165]
                        ]
                    }
                }
            }
        };
    }
    return trips;
}

describe('5,000+ Check-in Performance Benchmarks', () => {
    const trips5k = generateSyntheticTrips(5000);

    it('filters 5,000 trips in a single pass with cached polyline accuracy', () => {
        const t0 = performance.now();
        const firstPass = applyAllFilters(trips5k, {
            fromDate: '2023-01-01',
            toDate: '2026-01-01',
            business: { personal: true, work: true, commute: true },
            searchQuery: 'Berlin',
            filterLevel: 1
        });
        const firstMs = performance.now() - t0;

        const t1 = performance.now();
        const secondPass = applyAllFilters(trips5k, {
            fromDate: '2023-01-01',
            toDate: '2026-01-01',
            business: { personal: true, work: true, commute: true },
            searchQuery: 'München',
            filterLevel: 1
        });
        const secondMs = performance.now() - t1;

        expect(firstPass.length).toBeGreaterThan(0);
        expect(secondPass.length).toBeGreaterThan(0);
        expect(firstMs).toBeLessThan(500);
        expect(secondMs).toBeLessThan(250);
    });

    it('sorts 5,000 trips via O(N) Schwartzian transform quickly', () => {
        const copy = trips5k.slice();
        const t0 = performance.now();
        sortTrips(copy, 'date-desc');
        const dateSortMs = performance.now() - t0;

        const t1 = performance.now();
        sortTrips(copy, 'delay-desc');
        const delaySortMs = performance.now() - t1;

        expect(copy).toHaveLength(5000);
        expect(dateSortMs).toBeLessThan(250);
        expect(delaySortMs).toBeLessThan(250);
    });

    it('executes SQL GROUP BY and hash INNER JOIN over 5,000 rows quickly', () => {
        const flat = trips5k.map((t, idx) => ({
            id: t.id,
            line: t.train.lineName,
            category: t.train.category,
            operator: t.train.operator.name,
            distance_km: Math.round(t.train.totalDistance / 1000),
            delay_dep: Math.round(t.train.departureDelay / 60),
            backend_trip_id: t.train.trip,
            year: 2022 + (idx % 4)
        }));
        const coPassengers = Array.from({ length: 1000 }, (_, i) => ({
            trip_id: 500000 + i * 5,
            username: `buddy_${i % 20}`,
            origin: 'Berlin Hbf'
        }));

        const resGroup = executeTripQuery(
            'SELECT category, COUNT(*) AS cnt, SUM(distance_km) AS total_km, AVG(delay_dep) AS avg_delay FROM trips GROUP BY category ORDER BY total_km DESC',
            flat
        );
        expect(resGroup.rows).toHaveLength(6);
        expect(resGroup.executionTimeMs).toBeLessThan(250);

        const resJoin = executeTripQuery(
            'SELECT c.username, COUNT(*) AS shared FROM trips t INNER JOIN co_passengers c ON t.backend_trip_id = c.trip_id GROUP BY c.username ORDER BY shared DESC LIMIT 5',
            flat,
            { tables: { trips: flat, co_passengers: coPassengers } }
        );
        expect(resJoin.rows).toHaveLength(5);
        expect(resJoin.executionTimeMs).toBeLessThan(250);
    });
});

describe('Approach A: Slim & Direction-Agnostic Deduplicated GeoJSON', () => {
    function makeRouteTrip({ id, createdAt, category = 'regional', lineName = 'RE 1', coords, body = '', isApproximated }) {
        return {
            id,
            createdAt,
            body,
            tags: [{ key: 'trwl:seat', value: '42' }],
            train: {
                category,
                lineName,
                totalDistance: 25000,
                operator: { name: 'DB Regio' },
                origin: { name: 'Berlin Hbf', departureReal: createdAt },
                destination: { name: 'Potsdam Hbf', arrivalReal: createdAt },
                polyline: {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: coords },
                    properties: isApproximated !== undefined ? { statusId: id, isApproximated } : { statusId: id }
                }
            }
        };
    }

    it('collapses forward and exact reversed polylines in the same category and orders newest-first', () => {
        const forwardCoords = [[13.3695, 52.5251], [13.28, 52.50], [13.066, 52.391]];
        const reverseCoords = [...forwardCoords].reverse();

        const older = makeRouteTrip({ id: 101, createdAt: '2026-01-01T08:00:00Z', coords: forwardCoords });
        const newer = makeRouteTrip({ id: 202, createdAt: '2026-02-01T18:00:00Z', coords: reverseCoords });

        const categories = processTripsToGeoJSON([older, newer]);
        const features = categories.regional.features;

        expect(features).toHaveLength(1);
        expect(features[0].properties.statusId).toBe(202);
        expect(features[0].properties.tripCount).toBe(2);
        expect(features[0].properties.geomKey).toBeTruthy();
        expect(categories._geomTripIds[features[0].properties.geomKey]).toEqual([202, 101]);

        // Slim property contract: bulky nested payloads are not serialized into GeoJSON features
        expect(features[0].properties.train).toBeUndefined();
        expect(features[0].properties.body).toBeUndefined();
        expect(features[0].properties.tags).toBeUndefined();
    });

    it('isolates identical polylines across different categories and approximation flags', () => {
        const coords = [[13.3695, 52.5251], [13.28, 52.50], [13.066, 52.391]];

        const reTrip = makeRouteTrip({ id: 1, createdAt: '2026-01-01T08:00:00Z', category: 'regional', coords, isApproximated: false });
        const iceTrip = makeRouteTrip({ id: 2, createdAt: '2026-01-02T08:00:00Z', category: 'nationalExpress', coords, isApproximated: false });
        const approxReTrip = makeRouteTrip({ id: 3, createdAt: '2026-01-03T08:00:00Z', category: 'regional', coords, isApproximated: true });

        const categories = processTripsToGeoJSON([reTrip, iceTrip, approxReTrip]);
        expect(categories.regional.features).toHaveLength(2);
        expect(categories.nationalExpress.features).toHaveLength(1);
    });

    it('reduces 5,000 commuter check-ins across 500 routes to 500 slim features quickly', () => {
        const commuterTrips = [];
        const baseMs = Date.UTC(2025, 0, 1, 7, 0, 0);
        for (let i = 0; i < 5000; i++) {
            const routeIdx = i % 500;
            const offset = routeIdx * 0.002;
            const baseCoords = [
                [13.30 + offset, 52.50],
                [13.32 + offset, 52.51],
                [13.34 + offset, 52.52],
                [13.36 + offset, 52.53],
                [13.38 + offset, 52.54],
                [13.40 + offset, 52.55]
            ];
            const coords = i % 2 === 0 ? baseCoords : [...baseCoords].reverse();
            commuterTrips.push(makeRouteTrip({
                id: 50000 + i,
                createdAt: new Date(baseMs + i * 3600000).toISOString(),
                category: routeIdx % 2 === 0 ? 'suburban' : 'regional',
                lineName: `S ${1 + (routeIdx % 9)}`,
                coords,
                body: `Commute #${i} with @buddy${i % 3}`
            }));
        }

        const t0 = performance.now();
        const categories = processTripsToGeoJSON(commuterTrips);
        const elapsedMs = performance.now() - t0;

        const totalFeatures = Object.values(categories).reduce((acc, fc) => acc + fc.features.length, 0);
        expect(totalFeatures).toBe(500);
        expect(elapsedMs).toBeLessThan(500);

        const serializedBytes = JSON.stringify(categories).length;
        expect(serializedBytes).toBeLessThan(350 * 1024);
    });

    it('hydrates slim features via state.tripsById for showPopup and falls back cleanly for standalone mock features', () => {
        store.initialize();
        const coords = [[13.3695, 52.5251], [13.28, 52.50], [13.066, 52.391]];
        const trip = makeRouteTrip({
            id: 777,
            createdAt: '2026-03-10T10:15:00Z',
            category: 'regional',
            lineName: 'RE 1',
            coords,
            body: 'Window seat coffee'
        });

        const categories = processTripsToGeoJSON([trip]);
        const slimFeature = categories.regional.features[0];
        const state = store.get();
        state.fetchedTrips = [trip];
        state.activeTrips = [trip];
        state.tripsById = new Map([['777', trip]]);
        syncGeometryGroupsToState(state, categories._geomTripIds);

        const hydrated = resolveFeatureForPopup(slimFeature, state);
        expect(hydrated.properties.train.lineName).toBe('RE 1');
        expect(hydrated.properties.body).toBe('Window seat coffee');

        let capturedHtml = '';
        globalThis.document = {
            createElement: () => ({ style: {}, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} }),
            activeElement: null
        };
        globalThis.mapboxgl = {
            Popup: vi.fn(() => ({
                setLngLat: vi.fn().mockReturnThis(),
                setHTML: vi.fn(function (html) { capturedHtml = html; return this; }),
                addTo: vi.fn().mockReturnThis(),
                getElement: vi.fn(() => null),
                on: vi.fn(),
                once: vi.fn(),
                remove: vi.fn()
            }))
        };
        state.map = {
            getLayer: vi.fn(() => false),
            getSource: vi.fn(() => null),
            addSource: vi.fn(),
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
            removeSource: vi.fn(),
            getStyle: vi.fn(() => ({ layers: [] }))
        };

        showPopup({ lng: 13.28, lat: 52.50 }, slimFeature);
        expect(capturedHtml).toContain('RE 1');
        expect(capturedHtml).toContain('Berlin Hbf');
        expect(capturedHtml).toContain('Potsdam Hbf');
        expect(capturedHtml).toContain('Window seat coffee');

        // Standalone mock feature without matching entry in tripsById stays untouched
        const mockOnly = {
            type: 'Feature',
            properties: { statusId: '999999', lineName: 'MockLine' },
            geometry: { type: 'LineString', coordinates: coords }
        };
        expect(resolveFeatureForPopup(mockOnly, state)).toBe(mockOnly);
    });

    it('computes identical heatmap segment densities with weighted geometry dedup', () => {
        store.initialize();
        const state = store.get();
        state.useDeckGL = true;
        state.heatmap.enabled = true;
        state.layers.data = new Map([['regional', { visible: true, color: '#a6026c', data: { type: 'FeatureCollection', features: [] } }]]);

        const forwardCoords = [[13.3695, 52.5251], [13.28, 52.50], [13.066, 52.391]];
        const reverseCoords = [...forwardCoords].reverse();
        state.activeTrips = [
            makeRouteTrip({ id: 1, createdAt: '2026-01-01T08:00:00Z', coords: forwardCoords }),
            makeRouteTrip({ id: 2, createdAt: '2026-01-02T08:00:00Z', coords: reverseCoords }),
            makeRouteTrip({ id: 3, createdAt: '2026-01-03T08:00:00Z', coords: forwardCoords })
        ];

        const lines = buildRouteDensityLines(state, true);
        expect(lines).toHaveLength(2);
        expect(lines[0].density).toBe(3);
        expect(lines[1].density).toBe(3);
    });
});
