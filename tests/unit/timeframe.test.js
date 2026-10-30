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

    it('filters trips by custom date and optional time range', () => {
        // Trip 1 was at 2026-10-29T10:00:00Z.
        // Convert to local date and time string to ensure robust cross-timezone testing:
        const d1 = new Date('2026-10-29T10:00:00Z');
        const yyyy = d1.getFullYear();
        const mm = String(d1.getMonth() + 1).padStart(2, '0');
        const dd = String(d1.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        const hh = d1.getHours();
        const startH = String(Math.max(0, hh - 1)).padStart(2, '0');
        const endH = String(Math.min(23, hh + 1)).padStart(2, '0');
        const afterH = String(Math.min(23, hh + 2)).padStart(2, '0');

        // Including Trip 1: [hh-1:00, hh+1:00]
        const resWithin = filterTripsByTimeframe(
            sampleTrips,
            'custom',
            dateStr,
            dateStr,
            mockRefDate,
            `${startH}:00`,
            `${endH}:00`
        );
        expect(resWithin.map(t => t.id)).toContain(1);

        // Excluding Trip 1: window after Trip 1 departure [hh+2:00, hh+3:00]
        const resAfter = filterTripsByTimeframe(
            sampleTrips,
            'custom',
            dateStr,
            dateStr,
            mockRefDate,
            `${afterH}:00`,
            '23:59'
        );
        expect(resAfter.map(t => t.id)).not.toContain(1);
    });

    it('supports custom date and time via options object and ISO datetime strings', () => {
        // Options object
        const resOpts = filterTripsByTimeframe(sampleTrips, 'custom', {
            from: '2026-10-01',
            to: '2026-10-22',
            fromTime: '00:00',
            toTime: '23:59'
        }, '', mockRefDate);
        expect(resOpts.map(t => t.id)).toEqual([3, 4]);

        // Embedded ISO strings
        const resIso = filterTripsByTimeframe(
            sampleTrips,
            'custom',
            '2026-10-01T00:00',
            '2026-10-22T23:59',
            mockRefDate
        );
        expect(resIso.map(t => t.id)).toEqual([3, 4]);
    });

    it('returns human readable labels for presets and custom ranges', () => {
        expect(getTimeframeLabel('all')).toBe('All Time');
        expect(getTimeframeLabel('this-week')).toBe('This Week');
        expect(getTimeframeLabel('custom', '2026-10-01', '2026-10-15')).toBe('2026-10-01 → 2026-10-15');
        expect(getTimeframeLabel('custom', '2026-10-01', '2026-10-15', '08:30', '17:45')).toBe('2026-10-01 08:30 → 2026-10-15 17:45');
        expect(getTimeframeLabel('custom', { from: '2026-10-01', to: '2026-10-01', fromTime: '09:00', toTime: '18:00' }))
            .toBe('2026-10-01 09:00 → 2026-10-01 18:00');
    });
});
