import { describe, it, expect } from 'vitest';
import { getTripBuddies, renderLinkedComment } from '../../js/trips/formatters.js';

describe('trips/formatters', () => {
    describe('renderLinkedComment', () => {
        it('renders plaintext without mentions cleanly', () => {
            expect(renderLinkedComment('Trip from Berlin to Hamburg')).toBe('Trip from Berlin to Hamburg');
        });

        it('escapes malicious HTML tags before linking mentions', () => {
            const raw = '<script>alert(1)</script> with @alice & @bob';
            const rendered = renderLinkedComment(raw);
            expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
            expect(rendered).toContain('https://traewelling.de/profile/alice');
            expect(rendered).toContain('https://traewelling.de/profile/bob');
            expect(rendered).not.toContain('<script>');
        });

        it('handles null and non-string inputs safely', () => {
            expect(renderLinkedComment(null)).toBe('');
            expect(renderLinkedComment(undefined)).toBe('');
            expect(renderLinkedComment(12345)).toBe('');
        });
    });

    describe('getTripBuddies', () => {
        it('extracts companions and mentions while excluding currentUser', () => {
            const trip = {
                bodyMentions: [{ username: 'alice', displayName: 'Alice' }, 'bob'],
                companions: [{ username: 'charlie' }, { username: 'currentUser' }],
                body: 'Great ride with @dave and @alice!'
            };
            const buddies = getTripBuddies(trip, 'currentUser');
            const usernames = buddies.map(b => b.username);

            expect(usernames).toContain('alice');
            expect(usernames).toContain('bob');
            expect(usernames).toContain('charlie');
            expect(usernames).toContain('dave');
            expect(usernames).not.toContain('currentUser');
        });

        it('handles missing or null trip properties safely', () => {
            expect(getTripBuddies(null)).toEqual([]);
            expect(getTripBuddies({})).toEqual([]);
        });
    });
});
