import { describe, it, expect } from 'vitest';
import { escapeHtml, formatHumanDuration, formatDelayMinutes, buildEndpointKey } from '../../js/utils/format.js';

describe('format utilities', () => {
    describe('escapeHtml', () => {
        it('escapes &, <, >, ", and single quotes', () => {
            const raw = `<script>alert("xss & 'pwned'")</script>`;
            const escaped = escapeHtml(raw);
            expect(escaped).toBe('&lt;script&gt;alert(&quot;xss &amp; &#039;pwned&#039;&quot;)&lt;/script&gt;');
        });

        it('handles null, undefined, and non-string inputs safely', () => {
            expect(escapeHtml(null)).toBe('');
            expect(escapeHtml(undefined)).toBe('');
            expect(escapeHtml(123)).toBe('123');
        });
    });

    describe('formatHumanDuration', () => {
        it('formats minutes into compact human strings', () => {
            expect(formatHumanDuration(0)).toBe('0m');
            expect(formatHumanDuration(45)).toBe('45m');
            expect(formatHumanDuration(60)).toBe('1h');
            expect(formatHumanDuration(75)).toBe('1h 15m');
            expect(formatHumanDuration(1500)).toBe('1d 1h');
        });

        it('handles null and invalid values with dash', () => {
            expect(formatHumanDuration(null)).toBe('—');
            expect(formatHumanDuration(NaN)).toBe('—');
            expect(formatHumanDuration(-10)).toBe('—');
        });
    });

    describe('formatDelayMinutes', () => {
        it('converts seconds to rounded minutes', () => {
            expect(formatDelayMinutes(120)).toBe(2);
            expect(formatDelayMinutes(89)).toBe(1);
            expect(formatDelayMinutes(95)).toBe(2);
            expect(formatDelayMinutes(null)).toBeNull();
        });
    });

    describe('buildEndpointKey', () => {
        it('generates consistent coordinate endpoint key', () => {
            const coords = [[9.99368, 53.55108], [10.0, 53.5], [13.40495, 52.52001]];
            const key = buildEndpointKey(coords);
            expect(key).toBe('9.994,53.551-13.405,52.520');
        });

        it('returns null for missing or single-point coords', () => {
            expect(buildEndpointKey([])).toBeNull();
            expect(buildEndpointKey([[1, 2]])).toBeNull();
            expect(buildEndpointKey(null)).toBeNull();
        });
    });
});
