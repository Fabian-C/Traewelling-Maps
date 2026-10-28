import { describe, it, expect, beforeEach } from 'vitest';
import { syncNavigationLinks } from '../../js/ui/navigation.js';

class MockElement {
    constructor(id, href, className = '') {
        this.id = id;
        this.attributes = { id, href, class: className };
    }
    getAttribute(attr) {
        return this.attributes[attr] || null;
    }
    setAttribute(attr, val) {
        this.attributes[attr] = val;
    }
}

describe('syncNavigationLinks', () => {
    let mockLinks = [];
    let mockDoc = null;

    beforeEach(() => {
        mockLinks = [
            new MockElement('navMapLink', 'index.html', 'nav-link-btn'),
            new MockElement('navTripsLink', 'trips.html', 'nav-link-btn'),
            new MockElement('navWrappedLink', 'wrapped.html', 'nav-link-btn'),
            new MockElement('navDocsLink', 'docs.html', 'docs-nav-btn'),
            new MockElement('githubLink', 'https://github.com/fabian-c/Traewelling-Maps', 'nav-link-btn'),
            new MockElement('deepTripLink', 'index.html?user=alice&trip=999', 'btn-trip'),
            new MockElement('menuTripsBtn', 'trips.html', 'menu-item'),
            new MockElement('menuWrappedBtn', 'wrapped.html', 'menu-item'),
            new MockElement('menuDocsBtn', 'docs.html', 'menu-item')
        ];

        mockDoc = {
            querySelectorAll: () => mockLinks
        };
    });

    it('updates cross-page navigation links with active user parameter', () => {
        syncNavigationLinks('hash', mockDoc);

        const find = id => mockLinks.find(l => l.id === id);
        expect(find('navMapLink').getAttribute('href')).toBe('index.html?user=hash');
        expect(find('navTripsLink').getAttribute('href')).toBe('trips.html?user=hash');
        expect(find('navWrappedLink').getAttribute('href')).toBe('wrapped.html?user=hash');
        expect(find('navDocsLink').getAttribute('href')).toBe('docs.html?user=hash');
        expect(find('menuTripsBtn').getAttribute('href')).toBe('trips.html?user=hash');
        expect(find('menuWrappedBtn').getAttribute('href')).toBe('wrapped.html?user=hash');
        expect(find('menuDocsBtn').getAttribute('href')).toBe('docs.html?user=hash');
    });

    it('does not alter external links or deep trip links', () => {
        syncNavigationLinks('hash', mockDoc);

        const find = id => mockLinks.find(l => l.id === id);
        expect(find('githubLink').getAttribute('href')).toBe('https://github.com/fabian-c/Traewelling-Maps');
        expect(find('deepTripLink').getAttribute('href')).toBe('index.html?user=alice&trip=999');
    });

    it('clears query parameter when user is null or empty', () => {
        syncNavigationLinks('hash', mockDoc);
        const find = id => mockLinks.find(l => l.id === id);
        expect(find('navMapLink').getAttribute('href')).toBe('index.html?user=hash');

        syncNavigationLinks('', mockDoc);
        expect(find('navMapLink').getAttribute('href')).toBe('index.html');
        expect(find('navTripsLink').getAttribute('href')).toBe('trips.html');
    });
});
