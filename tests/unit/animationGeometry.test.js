import { describe, it, expect } from 'vitest';
import { syncNetworkCompositePaths } from '../../js/animation/renderer.js';
import {
    lonToWorldX,
    latToWorldY,
    computePolylineHaversineKm,
    resampleCoordinatesByDistance,
    extractCoordinatesFromGeoJSON,
    extractRouteCoordinates,
    buildMapScene,
    smootherstep,
    samplePointAlongRoute,
    sampleSmoothedCameraTarget,
    computeCameraZoomMultiplier,
    shortenStationName,
    getContrastingTextColor,
    sortTripsChronologically,
    computeAllModeTiming,
    buildAllTripsScene,
    computeHaversineKm,
    getVisibleTilesForViewport
} from '../../js/animation/geometry.js';

describe('Animation Geometry & Camera Smoothing', () => {
    it('projects Web Mercator coordinates consistently', () => {
        const x1 = lonToWorldX(13.359, 12);
        const x2 = lonToWorldX(13.387, 12);
        const y1 = latToWorldY(52.546, 12);
        const y2 = latToWorldY(52.524, 12);
        expect(x2).toBeGreaterThan(x1);
        expect(y2).toBeGreaterThan(y1);
    });

    it('computes Haversine distance along a polyline in km', () => {
        const coords = [
            [13.359059, 52.546448],
            [13.387608, 52.524410]
        ];
        const distKm = computePolylineHaversineKm(coords);
        expect(distKm).toBeGreaterThan(2.9);
        expect(distKm).toBeLessThan(3.5);
    });

    it('resamples coordinates uniformly by arc length', () => {
        const raw = [
            [10.0, 53.5],
            [10.001, 53.501],
            [10.002, 53.502],
            [13.0, 52.5]
        ];
        const resampled = resampleCoordinatesByDistance(raw, 50);
        expect(resampled).toHaveLength(51);
        expect(resampled[0][0]).toBeCloseTo(10.0, 4);
        expect(resampled[50][0]).toBeCloseTo(13.0, 4);
    });

    it('extracts coordinates from Träwelling v1 checkin polyline', () => {
        const trip = {
            id: 9245926,
            checkin: {
                polyline: {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [13.359059, 52.546448],
                            [13.375200, 52.534900],
                            [13.387608, 52.524410]
                        ]
                    }
                }
            }
        };
        const coords = extractRouteCoordinates(trip);
        // Preserves full resolution coordinates without downsampling
        expect(coords).toHaveLength(3);
        expect(coords[0][0]).toBeCloseTo(13.359059, 6);
        expect(coords[1][0]).toBeCloseTo(13.375200, 6);
        expect(coords[2][0]).toBeCloseTo(13.387608, 6);
    });

    it('always preserves full resolution coordinates on polyline to ensure connecting rides line up exactly', () => {
        // High-density polyline with 240 vertices
        const originalCoords = [];
        for (let i = 0; i < 240; i++) {
            originalCoords.push([13.35 + i * 0.0005, 52.52 + (i % 5) * 0.0001]);
        }
        const trip = {
            id: 12345,
            checkin: {
                polyline: {
                    coordinates: originalCoords
                }
            }
        };

        const extracted = extractRouteCoordinates(trip);
        expect(extracted).toHaveLength(240);
        expect(extracted[0]).toEqual(originalCoords[0]);
        expect(extracted[239]).toEqual(originalCoords[239]);
    });

    it('builds a valid map scene for a 960x960 square viewport', () => {
        const coords = [
            [13.359059, 52.546448],
            [13.375200, 52.534900],
            [13.387608, 52.524410]
        ];
        const scene = buildMapScene(coords, 960, 960);
        expect(scene.z).toBeGreaterThanOrEqual(4);
        expect(scene.z).toBeLessThanOrEqual(15);
        expect(scene.tiles.length).toBeGreaterThan(0);
        expect(scene.points).toHaveLength(3);
        expect(scene.totalPathPx).toBeGreaterThan(10);
    });

    it('evaluates C2-continuous smootherstep with zero-derivative endpoints', () => {
        expect(smootherstep(10, 100, 5)).toBe(0);
        expect(smootherstep(10, 100, 10)).toBe(0);
        expect(smootherstep(10, 100, 55)).toBeCloseTo(0.5, 5);
        expect(smootherstep(10, 100, 100)).toBe(1);
        expect(smootherstep(10, 100, 120)).toBe(1);
    });

    it('samples smooth vehicle pose and low-pass camera target along route', () => {
        const coords = resampleCoordinatesByDistance([
            [13.359059, 52.546448],
            [13.375200, 52.534900],
            [13.387608, 52.524410]
        ], 40);
        const scene = buildMapScene(coords, 960, 960);
        const poseStart = samplePointAlongRoute(scene, 0);
        const poseMid = samplePointAlongRoute(scene, 0.5);
        const poseEnd = samplePointAlongRoute(scene, 1);

        expect(poseStart.x).toBeCloseTo(scene.points[0].x, 2);
        expect(poseEnd.x).toBeCloseTo(scene.points[scene.points.length - 1].x, 2);
        expect(Number.isFinite(poseMid.angleRad)).toBe(true);

        const camMid = sampleSmoothedCameraTarget(scene, 0.5);
        expect(Number.isFinite(camMid.x)).toBe(true);
        expect(Number.isFinite(camMid.y)).toBe(true);
    });

    it('accurately rotates vehicle on short city rides with turns without freezing angle', () => {
        // Short city ride: East (0 rad) -> South (PI/2 rad)
        const scene = {
            points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 }
            ],
            cumDist: [0, 4, 8],
            totalPathPx: 8
        };

        const poseLeg1 = samplePointAlongRoute(scene, 0.2);
        const poseLeg2 = samplePointAlongRoute(scene, 0.8);

        // Leg 1 should be heading East (0 radians / 0 degrees)
        expect(poseLeg1.angleRad).toBeCloseTo(0, 1);
        // Leg 2 should be heading South (PI/2 radians / 90 degrees)
        expect(poseLeg2.angleRad).toBeCloseTo(Math.PI / 2, 1);
    });

    it('shortens station names and computes contrasting text color', () => {
        expect(shortenStationName('U Leopoldplatz (Berlin)')).toBe('U Leopoldplatz');
        expect(shortenStationName('Berlin Ostbahnhof Bhf')).toBe('Berlin Ostbahnhof');
        expect(getContrastingTextColor('#8c6dab', '000000')).toBe('#ffffff');
        expect(getContrastingTextColor('#fef08a', '')).toBe('#0f172a');
    });

    it('zooms in on departure, holds close chase zoom during travel, and zooms out for finale', () => {
        const zStart = computeCameraZoomMultiplier(0);
        const zDepartPeak = computeCameraZoomMultiplier(48);
        const zMidCruise = computeCameraZoomMultiplier(100);
        const zPreFinale = computeCameraZoomMultiplier(152);
        const zFinale = computeCameraZoomMultiplier(220);

        expect(zDepartPeak).toBeGreaterThan(zStart + 1.0);
        expect(zMidCruise).toBeGreaterThan(2.0);
        expect(zPreFinale).toBeCloseTo(2.0, 2);
        expect(zFinale).toBeLessThan(1.0);
    });

    it('sorts trips chronologically and builds unified mode=all historical scene', () => {
        const trips = [
            {
                id: 20,
                createdAt: '2026-10-12T10:00:00Z',
                checkin: {
                    distance: 284000,
                    origin: { name: 'Hamburg Hbf', station: { longitude: 10.0069, latitude: 53.5533 } },
                    destination: { name: 'Berlin Hbf', station: { longitude: 13.3695, latitude: 52.5255 } }
                }
            },
            {
                id: 10,
                createdAt: '2026-10-05T08:00:00Z',
                checkin: {
                    distance: 3100,
                    origin: { name: 'U Leopoldplatz', station: { longitude: 13.359, latitude: 52.546 } },
                    destination: { name: 'U Oranienburger Tor', station: { longitude: 13.387, latitude: 52.524 } }
                }
            }
        ];

        const sorted = sortTripsChronologically(trips);
        expect(sorted.map(t => t.id)).toEqual([10, 20]);

        const timing = computeAllModeTiming(sorted.length, 30);
        expect(timing.framesPerTrip).toBe(96);
        expect(timing.finaleStaticHoldFrames).toBe(90); // 3 seconds static hold at 30fps
        expect(timing.finaleFrames).toBe(135);
        expect(timing.totalFrames).toBeGreaterThanOrEqual(300);

        const allScene = buildAllTripsScene(sorted, 960, 960);
        expect(allScene.rides).toHaveLength(2);
        expect(allScene.rides[0].trip.id).toBe(10);
        expect(allScene.rides[1].trip.id).toBe(20);
        expect(allScene.totalDistanceKm).toBeCloseTo(287.1, 1);
    });

    it('computes point-to-point Haversine distance correctly', () => {
        // Berlin Hbf (13.3695, 52.5255) to Hamburg Hbf (10.0069, 53.5533) ~ 255.5 km
        const d = computeHaversineKm(13.3695, 52.5255, 10.0069, 53.5533);
        expect(d).toBeGreaterThan(250);
        expect(d).toBeLessThan(260);

        // Same point distance is 0
        expect(computeHaversineKm(13.4, 52.5, 13.4, 52.5)).toBeCloseTo(0, 5);
    });

    it('scales zoom progressively only when multiple rides streak in the same metropolitan area', () => {
        // 3 consecutive Berlin rides followed by 1 isolated Munich ride
        const berlinTrips = [
            {
                id: 1,
                createdAt: '2026-10-01T08:00:00Z',
                checkin: {
                    distance: 2500,
                    origin: { station: { longitude: 13.359, latitude: 52.546 } },
                    destination: { station: { longitude: 13.387, latitude: 52.524 } }
                }
            },
            {
                id: 2,
                createdAt: '2026-10-01T12:00:00Z',
                checkin: {
                    distance: 3000,
                    origin: { station: { longitude: 13.387, latitude: 52.524 } },
                    destination: { station: { longitude: 13.411, latitude: 52.521 } }
                }
            },
            {
                id: 3,
                createdAt: '2026-10-01T16:00:00Z',
                checkin: {
                    distance: 1800,
                    origin: { station: { longitude: 13.411, latitude: 52.521 } },
                    destination: { station: { longitude: 13.435, latitude: 52.505 } }
                }
            },
            {
                id: 4,
                createdAt: '2026-10-02T06:00:00Z',
                checkin: {
                    distance: 585000,
                    origin: { station: { longitude: 13.369, latitude: 52.525 } },
                    destination: { station: { longitude: 11.558, latitude: 48.140 } }
                }
            },
            {
                id: 5,
                createdAt: '2026-10-02T12:00:00Z',
                checkin: {
                    distance: 4000,
                    origin: { station: { longitude: 11.558, latitude: 48.140 } },
                    destination: { station: { longitude: 11.590, latitude: 48.155 } }
                }
            }
        ];

        const scene = buildAllTripsScene(berlinTrips, 960, 960);
        expect(scene.rides).toHaveLength(5);

        // Continuous zoom across ride boundaries:
        // 1. Zoom is continuous across ride boundaries (ride[i].startZoom === ride[i-1].endZoom)
        expect(scene.rides[1].startZoom).toBeCloseTo(scene.rides[0].endZoom, 5);
        expect(scene.rides[2].startZoom).toBeCloseTo(scene.rides[1].endZoom, 5);
        expect(scene.rides[3].startZoom).toBeCloseTo(scene.rides[2].endZoom, 5);

        // 2. City rides zoom in deeply so stations, streets, and routes are clearly visible
        expect(scene.rides[0].rideZoom).toBeGreaterThan(scene.fitScale * 3);
        expect(scene.rides[1].rideZoom).toBeGreaterThan(scene.fitScale * 3);

        // 3. Long-distance ICE (ride 3) has wide landscape zoom compared to tight city rides
        expect(scene.rides[1].rideZoom).toBeGreaterThan(scene.rides[3].rideZoom * 2);

        // 3b. City ride following long-distance ICE (ride 4) zooms deeply back into city scale
        expect(scene.rides[4].rideZoom).toBeGreaterThan(scene.fitScale * 10);
        expect(scene.rides[4].rideZoom).toBeGreaterThan(scene.rides[3].rideZoom * 10);
        expect(scene.rides[4].endZoom).toBeGreaterThan(50);

        // 4. Adaptive timing: long-distance ICE and large zoom transitions receive extra duration frames
        expect(scene.rides[3].durationFrames).toBeGreaterThan(60);
        expect(scene.travelTotalFrames).toBeGreaterThanOrEqual(240);

        // Detail tiles should be generated covering the city rides at higher zoom than base scene
        expect(Array.isArray(scene.detailTiles)).toBe(true);
        expect(scene.detailTiles.length).toBeGreaterThan(0);
        expect(scene.detailTiles[0].z).toBeGreaterThan(scene.z);
    });

    describe('Batched Composite Path2D Accumulator (syncNetworkCompositePaths)', () => {
        class MockPath2D {
            constructor() {
                this.paths = [];
            }
            addPath(path) {
                this.paths.push(path);
            }
        }

        it('returns null safely when Path2D is undefined or completedCount is 0', () => {
            const originalPath2D = globalThis.Path2D;
            try {
                delete globalThis.Path2D;
                const result = syncNetworkCompositePaths({ rides: [] }, 5);
                expect(result).toBeNull();

                globalThis.Path2D = MockPath2D;
                expect(syncNetworkCompositePaths(null, 5)).toBeNull();
                expect(syncNetworkCompositePaths({ rides: [] }, 0)).toBeNull();
                expect(syncNetworkCompositePaths({ rides: [] }, -1)).toBeNull();
            } finally {
                if (originalPath2D) {
                    globalThis.Path2D = originalPath2D;
                } else {
                    delete globalThis.Path2D;
                }
            }
        });

        it('progressively accumulates ride paths into color-bucketed layers', () => {
            const originalPath2D = globalThis.Path2D;
            try {
                globalThis.Path2D = MockPath2D;

                const dummyRide1 = {
                    path2D: new MockPath2D(),
                    trip: { checkin: { category: 'nationalExpress', routeColor: '#ff0000' } }
                };
                const dummyRide2 = {
                    path2D: new MockPath2D(),
                    trip: { checkin: { category: 'regional', routeColor: '#00ff00' } }
                };
                const dummyRide3 = {
                    path2D: new MockPath2D(),
                    trip: { checkin: { category: 'nationalExpress', routeColor: '#ff0000' } }
                };
                const dummyRide4 = {
                    path2D: new MockPath2D(),
                    trip: { checkin: { category: 'suburban' } }
                };

                const allScene = {
                    rides: [dummyRide1, dummyRide2, dummyRide3, dummyRide4]
                };

                // Step 1: Accumulate first 2 rides
                const cache1 = syncNetworkCompositePaths(allScene, 2);
                expect(cache1).toBeDefined();
                expect(cache1.committedCount).toBe(2);
                expect(cache1.colorPaths.size).toBe(2);
                expect(cache1.colorPaths.get('#ff0000').paths.length).toBe(1);
                expect(cache1.colorPaths.get('#00ff00').paths.length).toBe(1);

                // Step 2: Progressively advance to 3 rides (ride 3 is also red)
                const cache2 = syncNetworkCompositePaths(allScene, 3);
                expect(cache2.committedCount).toBe(3);
                expect(cache2.colorPaths.size).toBe(2); // Still 2 color buckets (#ff0000 and #00ff00)
                expect(cache2.colorPaths.get('#ff0000').paths.length).toBe(2);

                // Step 3: Scrub backwards to 1 ride - should reset and re-accumulate
                const cacheRewound = syncNetworkCompositePaths(allScene, 1);
                expect(cacheRewound.committedCount).toBe(1);
                expect(cacheRewound.colorPaths.size).toBe(1);
                expect(cacheRewound.colorPaths.get('#ff0000').paths.length).toBe(1);
            } finally {
                if (originalPath2D) {
                    globalThis.Path2D = originalPath2D;
                } else {
                    delete globalThis.Path2D;
                }
            }
        });

        it('lazily constructs and caches ride.path2D on-the-fly from ride.points when missing', () => {
            const originalPath2D = globalThis.Path2D;
            try {
                class MockPathWithDraw {
                    constructor() {
                        this.paths = [];
                        this.ops = [];
                    }
                    moveTo(x, y) { this.ops.push(['moveTo', x, y]); }
                    lineTo(x, y) { this.ops.push(['lineTo', x, y]); }
                    addPath(p) { this.paths.push(p); }
                }
                globalThis.Path2D = MockPathWithDraw;

                const rideWithoutPath2D = {
                    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
                    trip: { checkin: { category: 'suburban' } }
                };
                const scene = { rides: [rideWithoutPath2D] };

                const cache = syncNetworkCompositePaths(scene, 1);
                expect(cache).not.toBeNull();
                expect(rideWithoutPath2D.path2D).toBeDefined();
                expect(rideWithoutPath2D.path2D.ops.length).toBe(2);
                expect(cache.colorPaths.get('#16a34a').paths.length).toBe(1);
            } finally {
                if (originalPath2D) globalThis.Path2D = originalPath2D;
                else delete globalThis.Path2D;
            }
        });

        it('deduplicates overlapping line segments across commuter trips to eliminate redundant overdraw', () => {
            const originalPath2D = globalThis.Path2D;
            try {
                class MockPathWithDraw {
                    constructor() {
                        this.paths = [];
                        this.ops = [];
                    }
                    moveTo(x, y) { this.ops.push(['moveTo', x, y]); }
                    lineTo(x, y) { this.ops.push(['lineTo', x, y]); }
                    addPath(p) { this.paths.push(p); }
                }
                globalThis.Path2D = MockPathWithDraw;

                const sharedRoute = [
                    { x: 100, y: 200, lon: 13.38, lat: 52.52 },
                    { x: 150, y: 250, lon: 13.39, lat: 52.53 },
                    { x: 200, y: 300, lon: 13.40, lat: 52.54 }
                ];
                const commuterTrip1 = {
                    points: sharedRoute,
                    trip: { checkin: { category: 'suburban', routeColor: '#008800' } }
                };
                const commuterTrip2 = {
                    points: sharedRoute,
                    trip: { checkin: { category: 'suburban', routeColor: '#008800' } }
                };

                const scene = { rides: [commuterTrip1, commuterTrip2] };

                // Accumulate first trip
                const cache1 = syncNetworkCompositePaths(scene, 1);
                expect(cache1.colorPaths.get('#008800').paths.length).toBe(1);
                expect(cache1.seenRouteSignatures.size).toBe(1);

                // Accumulate duplicate commuter trip on same corridor
                const cache2 = syncNetworkCompositePaths(scene, 2);
                expect(cache2.colorPaths.get('#008800').paths.length).toBe(1); // Did not add a redundant duplicate path!
                expect(cache2.seenRouteSignatures.size).toBe(1); // Total unique routes remains 1
            } finally {
                if (originalPath2D) globalThis.Path2D = originalPath2D;
                else delete globalThis.Path2D;
            }
        });
    });

    it('dynamically computes visible Web Mercator tiles for viewport matching camera zoom', () => {
        const baseScene = {
            z: 6,
            originWX: 7424,
            originWY: 4352
        };

        // 1. Overview camera (camZoom ~ 1.0): should select base zoom z=6
        const overview = getVisibleTilesForViewport({
            baseScene,
            camTargetX: 500,
            camTargetY: 400,
            camZoom: 1.0,
            width: 960,
            height: 960
        });
        expect(overview.tileZ).toBe(6);
        expect(overview.tiles.length).toBeGreaterThan(12);
        expect(overview.tiles.length).toBeLessThan(40);
        expect(overview.tiles[0].z).toBe(6);

        // 2. City deep zoom (camZoom ~ 64.0 = 2^6): effective zoom = 6 + 6 = 12
        const cityZoom = getVisibleTilesForViewport({
            baseScene,
            camTargetX: 500,
            camTargetY: 400,
            camZoom: 64.0,
            width: 960,
            height: 960
        });
        expect(cityZoom.tileZ).toBe(12);
        expect(cityZoom.tiles.length).toBeGreaterThan(12);
        expect(cityZoom.tiles.length).toBeLessThan(45);
        expect(cityZoom.tiles[0].z).toBe(12);

        // 3. Coordinate bounds check: all tile Y coordinates must be within [0, 2^tileZ - 1]
        const maxY = Math.pow(2, cityZoom.tileZ) - 1;
        cityZoom.tiles.forEach(tile => {
            expect(tile.y).toBeGreaterThanOrEqual(0);
            expect(tile.y).toBeLessThanOrEqual(maxY);
            expect(Number.isFinite(tile.left)).toBe(true);
            expect(Number.isFinite(tile.top)).toBe(true);
            expect(tile.size).toBeCloseTo(256 / Math.pow(2, 12 - 6), 5);
        });
    });

    describe('GeoJSON Coordinate Extraction & Shared Link Geodata (extractCoordinatesFromGeoJSON & extractRouteCoordinates)', () => {
        it('extracts real coordinates from FeatureCollection (Träwelling API polyline structure)', () => {
            const featColl = {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { statusId: 9501851 },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [13.19713, 52.53455],
                            [13.20041, 52.53393],
                            [13.36963, 52.52492]
                        ]
                    }
                }]
            };

            const coords = extractCoordinatesFromGeoJSON(featColl);
            expect(coords.length).toBe(3);
            expect(coords[0]).toEqual([13.19713, 52.53455]);
            expect(coords[2]).toEqual([13.36963, 52.52492]);

            // When attached to a trip's checkin.polyline:
            const trip = {
                id: 9501851,
                checkin: {
                    polyline: featColl,
                    origin: { latitude: 52.53, longitude: 13.19 },
                    destination: { latitude: 52.52, longitude: 13.36 }
                }
            };
            const routeCoords = extractRouteCoordinates(trip);
            expect(routeCoords.length).toBe(3);
            expect(routeCoords).toEqual([
                [13.19713, 52.53455],
                [13.20041, 52.53393],
                [13.36963, 52.52492]
            ]);
        });

        it('extracts coordinates from wrapped API responses, MultiLineStrings, and arrays of features', () => {
            // Wrapped API response { data: { type: 'FeatureCollection', ... } }
            const wrappedApi = {
                data: {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [[10.0, 50.0], [10.5, 50.5]]
                        }
                    }]
                }
            };
            expect(extractCoordinatesFromGeoJSON(wrappedApi)).toEqual([[10.0, 50.0], [10.5, 50.5]]);

            // MultiLineString
            const multiLine = {
                type: 'MultiLineString',
                coordinates: [
                    [[11.0, 51.0], [11.5, 51.5]],
                    [[11.5, 51.5], [12.0, 52.0]]
                ]
            };
            expect(extractCoordinatesFromGeoJSON(multiLine)).toEqual([
                [11.0, 51.0], [11.5, 51.5], [11.5, 51.5], [12.0, 52.0]
            ]);

            // Array of Features
            const featArray = [
                { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1.0, 2.0], [3.0, 4.0]] } },
                { type: 'Feature', geometry: { type: 'LineString', coordinates: [[5.0, 6.0], [7.0, 8.0]] } }
            ];
            expect(extractCoordinatesFromGeoJSON(featArray).length).toBe(4);
        });

        it('uses authentic intermediate stopover coordinates when shape polyline is unavailable', () => {
            const tripWithStops = {
                id: 12345,
                checkin: {
                    origin: { station: { name: 'Hamburg Hbf', longitude: 10.0069, latitude: 53.5533 } },
                    stopovers: [
                        { station: { name: 'Hannover Hbf', longitude: 9.7416, latitude: 52.3768 } },
                        { station: { name: 'Kassel-Wilhelmshöhe', longitude: 9.4471, latitude: 51.3130 } }
                    ],
                    destination: { station: { name: 'Frankfurt(Main)Hbf', longitude: 8.6638, latitude: 50.1071 } }
                }
            };

            const routeCoords = extractRouteCoordinates(tripWithStops);
            // Should connect Hamburg -> Hannover -> Kassel -> Frankfurt
            expect(routeCoords.length).toBe(4);
            expect(routeCoords[0]).toEqual([10.0069, 53.5533]);
            expect(routeCoords[1]).toEqual([9.7416, 52.3768]);
            expect(routeCoords[2]).toEqual([9.4471, 51.3130]);
            expect(routeCoords[3]).toEqual([8.6638, 50.1071]);
        });
    });
});

