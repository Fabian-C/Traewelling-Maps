import { describe, it, expect } from 'vitest';
import {
    extractTripDetails,
    formatDelayBadge,
    formatTimeShort,
    formatDateShort,
    renderTagsBadgesHTML,
    renderBuddiesBadgesHTML,
    renderSeatAndVehicleDetailsHTML,
    renderScheduleDetailsHTML
} from '../../js/ui/tripDetails.js';

describe('ui/tripDetails shared component', () => {
    describe('extractTripDetails', () => {
        it('normalizes raw trip object with delays, buddies, tags, and vehicle details', () => {
            const rawTrip = {
                id: 42,
                body: 'Scenic trip with @Bob and @Alice #relax',
                bodyMentions: [{ username: 'Alice' }],
                train: {
                    lineName: 'ICE 702',
                    category: 'nationalExpress',
                    totalDistance: 284500,
                    plannedDeparture: '2026-06-01T10:00:00Z',
                    departure: '2026-06-01T10:05:00Z',
                    departureDelay: 300,
                    plannedArrival: '2026-06-01T11:30:00Z',
                    arrival: '2026-06-01T11:40:00Z',
                    arrivalDelay: 600,
                    origin: { name: 'Berlin Hbf', platform: '7' },
                    destination: { name: 'Hamburg Hbf', platform: '12' },
                    operator: { name: 'DB Fernverkehr' },
                    tags: [
                        { key: 'trwl:seat', value: '45' },
                        { key: 'trwl:wagon', value: '23' },
                        { key: 'trwl:ticket', value: 'Bahncard 50' },
                        { key: 'vibe', value: 'cozy' }
                    ]
                }
            };

            const details = extractTripDetails(rawTrip, 'Bob');
            expect(details).toBeDefined();
            expect(details.statusId).toBe('42');
            expect(details.lineName).toBe('ICE 702');
            expect(details.category).toBe('nationalExpress');
            expect(details.origin).toBe('Berlin Hbf');
            expect(details.destination).toBe('Hamburg Hbf');
            expect(details.platform).toBe('7');
            expect(details.distanceKm).toBe(284.5);
            expect(details.durationDisplay).toBe('1h 35m');
            expect(details.departureDelay).toBe(300);
            expect(details.arrivalDelay).toBe(600);
            expect(details.seat).toBe('45');
            expect(details.wagon).toBe('23');
            expect(details.ticketName).toBe('Bahncard 50');
            expect(details.operator).toBe('DB Fernverkehr');

            // Travel buddies excludes currentUser 'Bob'
            const buddyNames = details.buddies.map(b => b.username);
            expect(buddyNames).toContain('Alice');
            expect(buddyNames).not.toContain('Bob');

            // Custom tags
            expect(details.customTags).toContainEqual({ key: 'vibe', value: 'cozy' });
        });

        it('handles null and empty input safely', () => {
            expect(extractTripDetails(null)).toBeNull();
            const emptyDetails = extractTripDetails({});
            expect(emptyDetails.lineName).toBe('Train');
            expect(emptyDetails.origin).toBe('Unknown');
            expect(emptyDetails.destination).toBe('Unknown');
            expect(emptyDetails.distanceKm).toBe(0);
            expect(emptyDetails.durationDisplay).toBe('—');
        });
    });

    describe('formatDelayBadge', () => {
        it('formats positive, negative, on-time, and null delays properly', () => {
            expect(formatDelayBadge(null)).toBe('—');
            expect(formatDelayBadge(undefined)).toBe('—');
            expect(formatDelayBadge(0)).toBe('On time');
            expect(formatDelayBadge(300)).toBe('+5 min');
            expect(formatDelayBadge(-120)).toBe('-2 min');
        });
    });

    describe('formatTimeShort and formatDateShort', () => {
        it('formats valid Date instances and fallbacks for null', () => {
            expect(formatTimeShort(null)).toBe('—');
            expect(formatDateShort(null)).toBe('');
            const d = new Date('2026-06-01T12:30:00Z');
            expect(formatTimeShort(d)).toBeTruthy();
            expect(formatDateShort(d)).toBeTruthy();
        });
    });

    describe('renderTagsBadgesHTML & renderBuddiesBadgesHTML', () => {
        it('renders custom tags badges', () => {
            const tags = [{ key: 'scenic', value: '' }, { key: 'class', value: 'first' }];
            const html = renderTagsBadgesHTML(tags);
            expect(html).toContain('#scenic');
            expect(html).toContain('<strong>class:</strong> first');
        });

        it('renders travel buddies badges with safe profile links', () => {
            const buddies = [{ username: 'train_lover<script>' }];
            const html = renderBuddiesBadgesHTML(buddies);
            expect(html).toContain('https://traewelling.de/profile/train_lover%3Cscript%3E');
            expect(html).toContain('@train_lover&lt;script&gt;');
            expect(html).not.toContain('<script>');
        });
    });

    describe('renderSeatAndVehicleDetailsHTML & renderScheduleDetailsHTML', () => {
        it('renders seat details collapsible when information is present', () => {
            const html = renderSeatAndVehicleDetailsHTML({
                seat: '24',
                wagon: '11',
                ticketName: 'Deutschlandticket'
            });
            expect(html).toContain('Seat, ticket & coach info');
            expect(html).toContain('Deutschlandticket');
            expect(html).toContain('Wagon');
        });

        it('returns empty string when no seat or vehicle details are present', () => {
            const html = renderSeatAndVehicleDetailsHTML({});
            expect(html).toBe('');
        });

        it('renders schedule & delays details block', () => {
            const html = renderScheduleDetailsHTML({
                departureDelay: 180,
                arrivalDelay: 0,
                plannedDeparture: new Date('2026-06-01T10:00:00Z'),
                actualDeparture: new Date('2026-06-01T10:03:00Z'),
                plannedArrival: new Date('2026-06-01T11:00:00Z'),
                actualArrival: new Date('2026-06-01T11:00:00Z')
            });
            expect(html).toContain('Schedule & Delays');
            expect(html).toContain('Dep +3 min');
            expect(html).toContain('Arr On time');
        });
    });
});
