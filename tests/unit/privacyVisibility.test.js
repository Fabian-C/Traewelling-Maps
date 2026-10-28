import { describe, it, expect } from 'vitest';
import {
    getTripVisibilityValue,
    getVisibilityMeta,
    isVisibilityLocked,
    summarizeVisibilityCounts,
    filterTripsForPrivacy
} from '../../js/privacy/visibility.js';

describe('privacy/visibility', () => {
    const sampleTrips = [
        {
            id: 1001,
            visibility: 3, // Private
            body: 'Old private commute',
            checkin: {
                lineName: 'U6',
                origin: { name: 'U Leopoldplatz', departurePlanned: '2025-03-10T08:15:00+01:00' },
                destination: { name: 'U Friedrichstraße' }
            }
        },
        {
            id: 1002,
            visibility: 0, // Public
            body: 'Public ICE trip',
            checkin: {
                lineName: 'ICE 612',
                origin: { name: 'München Hbf', departurePlanned: '2025-06-15T12:00:00+02:00' },
                destination: { name: 'Hamburg-Altona' }
            }
        },
        {
            id: 1003,
            visibility: 2, // Followers only
            lock_visibility: true,
            body: 'Followers check-in',
            checkin: {
                lineName: 'S5',
                origin: { name: 'Berlin Ostkreuz', departurePlanned: '2025-09-01T17:30:00+02:00' },
                destination: { name: 'Berlin Westkreuz' }
            }
        }
    ];

    it('extracts normalized visibility values and metadata', () => {
        expect(getTripVisibilityValue(sampleTrips[0])).toBe(3);
        expect(getTripVisibilityValue(sampleTrips[1])).toBe(0);
        expect(getTripVisibilityValue({ visibility: 99 })).toBe(0);
        expect(getVisibilityMeta(3).label).toBe('Private');
        expect(getVisibilityMeta(0).label).toBe('Public');
    });

    it('detects locked visibility flags', () => {
        expect(isVisibilityLocked(sampleTrips[0])).toBe(false);
        expect(isVisibilityLocked(sampleTrips[2])).toBe(true);
    });

    it('summarizes visibility counts across check-ins', () => {
        const summary = summarizeVisibilityCounts(sampleTrips);
        expect(summary.total).toBe(3);
        expect(summary[0]).toBe(1);
        expect(summary[2]).toBe(1);
        expect(summary[3]).toBe(1);
        expect(summary.locked).toBe(1);
    });

    it('filters check-ins by non-public, private-only, date range, and search query', () => {
        const nonPublic = filterTripsForPrivacy(sampleTrips, { visibilityFilter: 'non-public' });
        expect(nonPublic.map((t) => t.id)).toEqual([1001, 1003]);

        const privateOnly = filterTripsForPrivacy(sampleTrips, { visibilityFilter: 'private-only' });
        expect(privateOnly.map((t) => t.id)).toEqual([1001]);

        const byDate = filterTripsForPrivacy(sampleTrips, {
            visibilityFilter: 'all',
            fromDate: '2025-05-01',
            toDate: '2025-07-01'
        });
        expect(byDate.map((t) => t.id)).toEqual([1002]);

        const bySearch = filterTripsForPrivacy(sampleTrips, {
            visibilityFilter: 'all',
            searchQuery: 'leopoldplatz'
        });
        expect(bySearch.map((t) => t.id)).toEqual([1001]);
    });
});
