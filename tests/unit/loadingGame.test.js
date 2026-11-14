import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoadingGame, CheckinRandomizer } from '../../js/ui/loadingGame/index.js';

// Minimal mock DOM element for Node unit testing
class MockDOMElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this._innerHTML = '';
        this.className = '';
        this.id = '';
        this.style = {};
        this.parentElement = null;
        this.classList = {
            _classes: new Set(),
            add: (c) => this.classList._classes.add(c),
            remove: (c) => this.classList._classes.delete(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (this.classList._classes.has(c)) this.classList._classes.delete(c);
                    else this.classList._classes.add(c);
                } else if (force) {
                    this.classList._classes.add(c);
                } else {
                    this.classList._classes.delete(c);
                }
            },
            contains: (c) => this.classList._classes.has(c)
        };
        this.attributes = {};
        this.listeners = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
    }

    setAttribute(k, v) {
        this.attributes[k] = String(v);
    }

    getAttribute(k) {
        return this.attributes[k] || null;
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    dispatchEvent(event) {
        const fns = this.listeners[event.type || event] || [];
        fns.forEach(fn => fn(event));
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx !== -1) this.parentElement.children.splice(idx, 1);
        }
    }

    querySelector(selector) {
        return new MockDOMElement();
    }

    querySelectorAll(selector) {
        return [new MockDOMElement(), new MockDOMElement()];
    }
}

// Global document mock setup
if (typeof globalThis.document === 'undefined') {
    const mockBody = new MockDOMElement('body');
    const mockFetchScreen = new MockDOMElement('div');
    mockFetchScreen.id = 'fetchScreen';
    mockBody.appendChild(mockFetchScreen);

    globalThis.document = {
        body: mockBody,
        getElementById: (id) => {
            if (id === 'fetchScreen') return mockFetchScreen;
            return new MockDOMElement();
        },
        createElement: (tag) => new MockDOMElement(tag),
        querySelector: () => new MockDOMElement(),
        querySelectorAll: () => []
    };
}

describe('Loading Screen Game: Check-in Ticker & Modular Architecture', () => {
    beforeEach(() => {
        LoadingGame.setActiveGame(CheckinRandomizer);
    });

    describe('LoadingGame Modular Facade Architecture', () => {
        it('delegates lifecycle methods to active game engine', () => {
            LoadingGame.start({ username: 'modular_tester' });
            expect(CheckinRandomizer.activeUsername).toBe('modular_tester');

            LoadingGame.stop();
        });

        it('allows cleanly swapping out the active game for a custom implementation', () => {
            let customGameStarted = false;
            let customBatchCount = 0;

            const mockGame = {
                start: () => { customGameStarted = true; },
                stop: () => {},
                onTripBatch: (trips) => { customBatchCount += trips.length; },
                destroy: () => {}
            };

            LoadingGame.setActiveGame(mockGame);
            LoadingGame.start({ username: 'custom_user' });
            expect(customGameStarted).toBe(true);

            LoadingGame.onTripBatch([{}, {}, {}]);
            expect(customBatchCount).toBe(3);

            // Restore CheckinRandomizer
            LoadingGame.setActiveGame(CheckinRandomizer);
        });

        it('handles null activeGame gracefully without throwing errors', () => {
            LoadingGame.setActiveGame(null);

            expect(() => {
                LoadingGame.init();
                LoadingGame.start();
                LoadingGame.onTripBatch([{}]);
                LoadingGame.reset();
                LoadingGame.stop();
                LoadingGame.destroy();
            }).not.toThrow();

            LoadingGame.setActiveGame(CheckinRandomizer);
        });
    });

    describe('Check-in Text Randomizer Loading Feature', () => {
        afterEach(() => {
            CheckinRandomizer.destroy();
            delete globalThis.window;
        });

        it('is configured as the default active game in LoadingGame', () => {
            LoadingGame.setActiveGame(CheckinRandomizer);
            expect(LoadingGame.activeGame).toBe(CheckinRandomizer);
        });

        it('collects check-ins and categorizes trips with text notes', () => {
            CheckinRandomizer.start({ username: 'hash' });

            const trips = [
                {
                    id: 101,
                    body: 'Im ICE 920 nach Hamburg mit @alice ☕',
                    createdAt: '2024-05-01T12:00:00Z',
                    train: { lineName: 'ICE 920', category: 'nationalExpress' }
                },
                {
                    id: 102,
                    body: '   ', // whitespace only
                    train: { lineName: 'RE 1', category: 'regional' }
                },
                {
                    id: 103,
                    body: 'Pünktlich angekommen! #bahnliebe',
                    train: { lineName: 'S 3', category: 'suburban' }
                }
            ];

            CheckinRandomizer.onTripBatch(trips);

            expect(CheckinRandomizer.allCheckins.length).toBe(3);
            expect(CheckinRandomizer.checkinsWithText.length).toBe(2);
            expect(CheckinRandomizer.currentTrip).toBeDefined();
            expect(['Im ICE 920 nach Hamburg mit @alice ☕', 'Pünktlich angekommen! #bahnliebe']).toContain(CheckinRandomizer.currentTrip.body);
        });

        it('picks random check-ins without crashing and avoids duplicates if multiple available', () => {
            CheckinRandomizer.start({ username: 'hash' });

            const trips = [
                { id: 201, body: 'Note A', train: { lineName: 'ICE 1' } },
                { id: 202, body: 'Note B', train: { lineName: 'ICE 2' } }
            ];

            CheckinRandomizer.onTripBatch(trips);
            const firstTrip = CheckinRandomizer.currentTrip;
            expect(firstTrip).toBeDefined();

            CheckinRandomizer.nextRandom();
            const secondTrip = CheckinRandomizer.currentTrip;
            expect(secondTrip).toBeDefined();
            expect(secondTrip.id).not.toBe(firstTrip.id);
        });

        it('safely escapes HTML in check-in body text to prevent XSS injection', () => {
            CheckinRandomizer.start({ username: 'hash' });

            const maliciousTrip = {
                id: 999,
                body: '<img src=x onerror=alert(1)> & "quotes"',
                train: { lineName: 'RE 5', origin: { name: 'Berlin <Hbf>' }, destination: { name: 'Potsdam & Co' } }
            };

            CheckinRandomizer.onTripBatch([maliciousTrip]);
            const html = CheckinRandomizer.generateCardHtml();

            expect(html).not.toContain('<img src=x onerror=alert(1)>');
            expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
            expect(html).toContain('&amp; &quot;quotes&quot;');
            expect(html).toContain('Berlin &lt;Hbf&gt;');
        });

        it('toggles pause and minimize states cleanly', () => {
            CheckinRandomizer.start({ username: 'hash' });

            expect(CheckinRandomizer.isPaused).toBe(false);
            CheckinRandomizer.togglePause();
            expect(CheckinRandomizer.isPaused).toBe(true);
            CheckinRandomizer.togglePause();
            expect(CheckinRandomizer.isPaused).toBe(false);

            expect(CheckinRandomizer.isMinimized).toBe(false);
            CheckinRandomizer.toggleMinimize();
            expect(CheckinRandomizer.isMinimized).toBe(true);
            CheckinRandomizer.toggleMinimize();
            expect(CheckinRandomizer.isMinimized).toBe(false);
        });

        it('launches minimized by default on small screens (<= 768px)', () => {
            globalThis.window = {
                innerWidth: 390,
                matchMedia: () => ({ matches: true })
            };

            CheckinRandomizer.start({ username: 'mobile_user' });
            expect(CheckinRandomizer.isMinimized).toBe(true);
            expect(CheckinRandomizer.container.classList.contains('minimized')).toBe(true);
        });
    });
});
