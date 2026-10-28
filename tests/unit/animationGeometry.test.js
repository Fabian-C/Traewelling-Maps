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
    shortenStationName,
    getContrastingTextColor
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
        expect(scene.z).toBeLessThanOrEqual(14);
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
});
