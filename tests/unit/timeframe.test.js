import { describe, it, expect } from 'vitest';
import {
    TIMEFRAME_PRESETS,
    getTripTimestamp,
    filterTripsByTimeframe,
    getTimeframeLabel
} from '../../js/animation/timeframe.js';

describe('Timeframe Presets & Date Filtering', () => {
    const mockRefDate = new Date('2026-10-29T12:00:00Z');

    it('exposes defined timeframe preset IDs', () => {
        expect(Array.isArray(TIMEFRAME_PRESETS)).toBe(true);
        const ids = TIMEFRAME_PRESETS.map(p => p.id);
        expect(ids).toContain('all');
        expect(ids).toContain('today');
        expect(ids).toContain('last-7-days');
        expect(ids).toContain('this-week');
        expect(ids).toContain('last-week');
        expect(ids).toContain('this-month');
        expect(ids).toContain('custom');
    });

    const sampleTrips = [
        {
            id: 1,
            checkin: { origin: { departureReal: '2026-10-29T10:00:00Z' } } // Today (2h ago)
        },
        {
            id: 2,
            checkin: { origin: { departurePlanned: '2026-10-27T08:00:00Z' } } // 2 days ago (this week & last 7 days)
        },
        {
            id: 3,
            createdAt: '2026-10-21T14:00:00Z' // 8 days ago (last week & this month)
        },
        {
            id: 4,
            checkin: { origin: { departureReal: '2026-10-05T09:00:00Z' } } // 24 days ago (this month & last 30 days)
        },
        {
            id: 5,
            checkin: { origin: { departureReal: '2026-05-15T12:00:00Z' } } // 5 months ago (this year)
        },
        {
            id: 6,
            checkin: { origin: { departureReal: '2025-11-20T16:00:00Z' } } // Last year
        }
    ];

    it('extracts trip timestamps reliably', () => {
        expect(getTripTimestamp(sampleTrips[0])).toBe(new Date('2026-10-29T10:00:00Z').getTime());
        expect(getTripTimestamp(sampleTrips[1])).toBe(new Date('2026-10-27T08:00:00Z').getTime());
        expect(getTripTimestamp(sampleTrips[2])).toBe(new Date('2026-10-21T14:00:00Z').getTime());
        expect(getTripTimestamp({})).toBe(0);
    });

    it('filters trips by preset: all', () => {
        const res = filterTripsByTimeframe(sampleTrips, 'all', '', '', mockRefDate);
        expect(res).toHaveLength(6);
    });

    it('filters trips by preset: today / last 24h', () => {
        const res = filterTripsByTimeframe(sampleTrips, 'today', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([1]);
    });

    it('filters trips by preset: last-7-days', () => {
        const res = filterTripsByTimeframe(sampleTrips, 'last-7-days', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([1, 2]);
    });

    it('filters trips by preset: this-week', () => {
        // Oct 29, 2026 is a Thursday. Monday was Oct 26.
        const res = filterTripsByTimeframe(sampleTrips, 'this-week', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([1, 2]);
    });

    it('filters trips by preset: last-week', () => {
        // Last week was Mon Oct 19 to Sun Oct 25
        const res = filterTripsByTimeframe(sampleTrips, 'last-week', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([3]);
    });

    it('filters trips by preset: this-month', () => {
        // Oct 1 to Oct 29
        const res = filterTripsByTimeframe(sampleTrips, 'this-month', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([1, 2, 3, 4]);
    });

    it('filters trips by preset: last-30-days', () => {
        const res = filterTripsByTimeframe(sampleTrips, 'last-30-days', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([1, 2, 3, 4]);
    });

    it('filters trips by preset: this-year', () => {
        const res = filterTripsByTimeframe(sampleTrips, 'this-year', '', '', mockRefDate);
        expect(res.map(t => t.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it('filters trips by custom date range', () => {
        const res = filterTripsByTimeframe(sampleTrips, 'custom', '2026-10-01', '2026-10-22', mockRefDate);
        expect(res.map(t => t.id)).toEqual([3, 4]);
    });

    it('returns human readable labels for presets and custom ranges', () => {
        expect(getTimeframeLabel('all')).toBe('All Time');
        expect(getTimeframeLabel('this-week')).toBe('This Week');
        expect(getTimeframeLabel('custom', '2026-10-01', '2026-10-15')).toBe('2026-10-01 → 2026-10-15');
    });
});
