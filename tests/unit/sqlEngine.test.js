import { describe, it, expect } from 'vitest';
import { executeTripQuery, TRIP_COLUMNS } from '../../js/trips/sqlEngine.js';

describe('sqlEngine', () => {
    it('exposes the documented trips columns', () => {
        expect(TRIP_COLUMNS.length).toBeGreaterThan(0);
    });

    it('rejects queries on unknown tables', () => {
        expect(() => executeTripQuery('SELECT * FROM nope', [])).toThrow(/trips/);
    });
});
