import { describe, it, expect } from 'vitest';
import {
    lonToWorldX,
    latToWorldY,
    computePolylineHaversineKm,
    resampleCoordinatesByDistance,
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
    computeHaversineKm
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
        expect(coords.length).toBe(181);
        expect(coords[0][0]).toBeCloseTo(13.359059, 4);
        expect(coords[coords.length - 1][0]).toBeCloseTo(13.387608, 4);
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

        const timing = computeAllModeTiming(sorted.length);
        expect(timing.framesPerTrip).toBe(48);
        expect(timing.totalFrames).toBeGreaterThanOrEqual(240);

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
                createdAt: '2026-10-02T10:00:00Z',
                checkin: {
                    distance: 4000,
                    origin: { station: { longitude: 11.558, latitude: 48.140 } },
                    destination: { station: { longitude: 11.590, latitude: 48.155 } }
                }
            }
        ];

        const scene = buildAllTripsScene(berlinTrips, 960, 960);
        expect(scene.rides).toHaveLength(4);

        // The 3rd Berlin trip has streak >= 3 and should have higher zoom than the isolated Munich trip
        const ride3Zoom = scene.rides[2].rideZoom;
        const ride4Zoom = scene.rides[3].rideZoom;
        expect(ride3Zoom).toBeGreaterThan(ride4Zoom);

        // Detail tiles should be generated covering the city rides at higher zoom than base scene
        expect(Array.isArray(scene.detailTiles)).toBe(true);
        expect(scene.detailTiles.length).toBeGreaterThan(0);
        expect(scene.detailTiles[0].z).toBeGreaterThan(scene.z);
    });
});

