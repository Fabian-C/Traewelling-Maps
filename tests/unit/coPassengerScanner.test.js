import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getScanWatermark,
    setScanWatermark,
    clearScanWatermark,
    getTripBackendId,
    getUnscannedTrips,
    startIncrementalScan
} from '../../js/trips/coPassengerScanner.js';
import { SessionDB } from '../../js/cache/session.js';

describe('Incremental Co-Passenger Batch Scanner', () => {
    beforeEach(() => {
        clearScanWatermark('alice');
        clearScanWatermark('bob');
    });

    afterEach(() => {
        clearScanWatermark('alice');
        clearScanWatermark('bob');
    });

    describe('Watermark persistence', () => {
        it('saves, retrieves, and clears watermark per user', () => {
            expect(getScanWatermark('alice')).toBeNull();
            setScanWatermark('alice', 9577959);
            expect(getScanWatermark('alice')).toBe(9577959);
            expect(getScanWatermark('bob')).toBeNull();

            clearScanWatermark('alice');
            expect(getScanWatermark('alice')).toBeNull();
        });
    });

    describe('getTripBackendId', () => {
        it('extracts ID from diverse trip shapes', () => {
            expect(getTripBackendId({ checkin: { trip: 9289803 } })).toBe(9289803);
            expect(getTripBackendId({ train: { trip: 9289803 } })).toBe(9289803);
            expect(getTripBackendId({ backend_trip_id: 9289803 })).toBe(9289803);
            expect(getTripBackendId({ trip: 9289803 })).toBe(9289803);
            expect(getTripBackendId({ checkin: {} })).toBeNull();
            expect(getTripBackendId(null)).toBeNull();
        });
    });

    describe('getUnscannedTrips (Incremental Watermark Filtering)', () => {
        const trips = [
            { id: 105, createdAt: '2026-11-10T10:00:00Z', checkin: { trip: 1005 } },
            { id: 104, createdAt: '2026-11-09T10:00:00Z', checkin: { trip: 1004 } },
            { id: 103, createdAt: '2026-11-08T10:00:00Z', checkin: { trip: 1003 } }, // Watermark here
            { id: 102, createdAt: '2026-11-07T10:00:00Z', checkin: { trip: 1002 } },
            { id: 101, createdAt: '2026-11-06T10:00:00Z', checkin: { trip: 1001 } }
        ];

        it('returns all eligible trips when no watermark exists', () => {
            const result = getUnscannedTrips(trips, 'alice');
            expect(result.watermark).toBeNull();
            expect(result.unscannedTrips.length).toBe(5);
            expect(result.unscannedTrips[0].id).toBe(105);
            expect(result.unscannedTrips[4].id).toBe(101);
        });

        it('returns ONLY trips newer than the watermark and stops at the last scan result', () => {
            setScanWatermark('alice', 103);
            const result = getUnscannedTrips(trips, 'alice');

            expect(result.watermark).toBe(103);
            // Only 105 and 104 are newer than 103!
            expect(result.unscannedTrips.length).toBe(2);
            expect(result.unscannedTrips.map(t => t.id)).toEqual([105, 104]);
        });

        it('returns empty array when already up to date with the latest check-in', () => {
            setScanWatermark('alice', 105);
            const result = getUnscannedTrips(trips, 'alice');

            expect(result.watermark).toBe(105);
            expect(result.unscannedTrips.length).toBe(0);
        });

        it('returns all eligible trips when forceFullRescan is true despite watermark', () => {
            setScanWatermark('alice', 105);
            const result = getUnscannedTrips(trips, 'alice', { forceFullRescan: true });

            expect(result.unscannedTrips.length).toBe(5);
            expect(result.isFullRescan).toBe(true);
        });
    });

    describe('startIncrementalScan execution', () => {
        let originalFetch;

        beforeEach(() => {
            originalFetch = globalThis.fetch;
            SessionDB._db = null;
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it('scans only new check-ins and updates the watermark to the newest trip', async () => {
            const trips = [
                { id: 202, checkin: { trip: 9002, lineName: 'RE 1' } },
                { id: 201, checkin: { trip: 9001, lineName: 'S 5' } },
                { id: 200, checkin: { trip: 9000, lineName: 'U 6' } }
            ];

            // Set watermark at 200
            setScanWatermark('alice', 200);

            // Mock fetch to simulate Traewelling API response
            const mockApiResponses = {
                9002: { data: [{ id: 8002, user: { username: 'Bob' }, checkin: { origin: {}, destination: {} } }] },
                9001: { data: [] }
            };

            globalThis.fetch = vi.fn().mockImplementation((url) => {
                const tripMatch = url.match(/\/trips\/(\d+)\/statuses/);
                const tripId = tripMatch ? Number(tripMatch[1]) : 0;
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponses[tripId] || { data: [] }
                });
            });

            // Mock SessionDB
            vi.spyOn(SessionDB, 'getTripCoPassengers').mockResolvedValue([]);
            const saveSpy = vi.spyOn(SessionDB, 'saveTripCoPassengers').mockResolvedValue();

            let completeResult = null;
            await new Promise((resolve) => {
                startIncrementalScan({
                    trips,
                    username: 'alice',
                    onProgress: () => {},
                    onComplete: (res) => {
                        completeResult = res;
                        resolve();
                    }
                });
            });

            // Only trips 202 and 201 were scanned (2 calls)
            expect(completeResult).not.toBeNull();
            expect(completeResult.scannedCount).toBe(2);
            expect(completeResult.foundBuddiesCount).toBe(1);

            // Watermark updated to 202 (newest trip)
            expect(getScanWatermark('alice')).toBe(202);
            expect(saveSpy).toHaveBeenCalledTimes(2);
        });

        it('completes immediately with alreadyUpToDate if no new check-ins exist', async () => {
            const trips = [{ id: 50, checkin: { trip: 500 } }];
            setScanWatermark('alice', 50);

            globalThis.fetch = vi.fn();

            let completeResult = null;
            await new Promise((resolve) => {
                startIncrementalScan({
                    trips,
                    username: 'alice',
                    onComplete: (res) => {
                        completeResult = res;
                        resolve();
                    }
                });
            });

            expect(completeResult.alreadyUpToDate).toBe(true);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('re-scans all trips when forceFullRescan is true even if already up to date', async () => {
            const trips = [
                { id: 50, checkin: { trip: 500, lineName: 'ICE 1' } },
                { id: 49, checkin: { trip: 490, lineName: 'RE 2' } }
            ];
            setScanWatermark('alice', 50);

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: [] })
            });
            vi.spyOn(SessionDB, 'saveTripCoPassengers').mockResolvedValue();

            let completeResult = null;
            await new Promise((resolve) => {
                startIncrementalScan({
                    trips,
                    username: 'alice',
                    forceFullRescan: true,
                    onComplete: (res) => {
                        completeResult = res;
                        resolve();
                    }
                });
            });

            expect(completeResult.alreadyUpToDate).toBeFalsy();
            expect(completeResult.scannedCount).toBe(2);
            expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        });

        it('executes in concurrent batches of up to 5 trips', async () => {
            const trips = [
                { id: 10, checkin: { trip: 1010 } },
                { id: 9, checkin: { trip: 1009 } },
                { id: 8, checkin: { trip: 1008 } },
                { id: 7, checkin: { trip: 1007 } },
                { id: 6, checkin: { trip: 1006 } },
                { id: 5, checkin: { trip: 1005 } },
                { id: 4, checkin: { trip: 1004 } }
            ];

            let maxConcurrent = 0;
            let currentRunning = 0;

            globalThis.fetch = vi.fn().mockImplementation(async () => {
                currentRunning++;
                if (currentRunning > maxConcurrent) maxConcurrent = currentRunning;
                await new Promise(r => setTimeout(r, 20));
                currentRunning--;
                return {
                    ok: true,
                    json: async () => ({ data: [] })
                };
            });
            vi.spyOn(SessionDB, 'saveTripCoPassengers').mockResolvedValue();

            let completeResult = null;
            await new Promise((resolve) => {
                startIncrementalScan({
                    trips,
                    username: 'alice',
                    onComplete: (res) => {
                        completeResult = res;
                        resolve();
                    }
                });
            });

            expect(completeResult.scannedCount).toBe(7);
            expect(globalThis.fetch).toHaveBeenCalledTimes(7);
            // Parallel batch size is 5, so peak concurrency should be > 1 and <= 5
            expect(maxConcurrent).toBeGreaterThanOrEqual(2);
            expect(maxConcurrent).toBeLessThanOrEqual(5);
        });
    });
});
