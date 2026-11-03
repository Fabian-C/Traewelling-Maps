import { describe, it, expect } from 'vitest';
import { calculateWrappedInsights, sanitizeTripDistanceKm } from '../../js/wrapped/analytics.js';

describe('Rail Wrapped Distance & Analytics Accuracy', () => {
    it('sanitizes upstream HAFAS loop glitches where raw distance exceeds 3x straight line distance', () => {
        // Example: Mannheim Hbf to Berlin Gesundbrunnen
        // Real distance ~605 km, but upstream returned 5,383 km
        const originLat = 49.479181;
        const originLon = 8.469268;
        const destLat = 52.548656;
        const destLon = 13.39106;
        const rawKm = 5383.65;

        const sanitized = sanitizeTripDistanceKm(rawKm, originLat, originLon, destLat, destLon, 'nationalExpress');
        // Sanitized to ~1.25x haversine distance (~605.8 km), not 5383 km
        expect(sanitized).toBeLessThan(700);
        expect(sanitized).toBeGreaterThan(500);
    });

    it('retains realistic railway trip distances intact', () => {
        // Berlin to Hamburg ICE: ~280 km
        const originLat = 52.524924;
        const originLon = 13.369629;
        const destLat = 53.553533;
        const destLon = 10.00636;
        const rawKm = 286.4;

        const sanitized = sanitizeTripDistanceKm(rawKm, originLat, originLon, destLat, destLon, 'nationalExpress');
        expect(sanitized).toBe(286.4);
    });

    it('calculates wrapped insights total km correctly from raw and rehydrated trips', () => {
        const trips = [
            {
                id: 1,
                train: {
                    lineName: 'ICE 1',
                    category: 'nationalExpress',
                    totalDistance: 280000, // 280 km in meters
                    origin: { name: 'Berlin Hbf', latitude: 52.525, longitude: 13.37 },
                    destination: { name: 'Hamburg Hbf', latitude: 53.553, longitude: 10.006 }
                }
            },
            {
                id: 2,
                train: {
                    lineName: 'RE 1',
                    category: 'regionalExp',
                    distance: 75000, // 75 km in meters
                    origin: { name: 'Berlin Hbf', latitude: 52.525, longitude: 13.37 },
                    destination: { name: 'Potsdam Hbf', latitude: 52.391, longitude: 13.067 }
                }
            }
        ];

        const insights = calculateWrappedInsights(trips, 'testuser');
        expect(insights.totalTrips).toBe(2);
        // 280 km + 75 km = 355 km
        expect(insights.totalKm).toBe(355);
    });
});

