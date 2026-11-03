import { describe, it, expect, beforeEach } from 'vitest';
import { LoadingGame, DelayBingo } from '../../js/ui/loadingGame/index.js';
import { BINGO_TILE_POOL, FREE_CENTER_TILE } from '../../js/ui/loadingGame/delayBingo.js';

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

describe('Loading Screen Game: DB Delay Bingo & Modular Architecture', () => {
    beforeEach(() => {
        LoadingGame.setActiveGame(DelayBingo);
    });

    describe('Bingo Tile Matchers & Pool Integrity', () => {
        it('contains at least 15 valid railway event tiles', () => {
            expect(BINGO_TILE_POOL.length).toBeGreaterThanOrEqual(15);
            for (const tile of BINGO_TILE_POOL) {
                expect(tile.id).toBeDefined();
                expect(tile.title).toBeDefined();
                expect(tile.icon).toBeDefined();
                expect(typeof tile.match).toBe('function');
            }
        });

        it('correctly matches delayed trips (> 15m and > 30m)', () => {
            const delay15Tile = BINGO_TILE_POOL.find(t => t.id === 'delay_15');
            const delay30Tile = BINGO_TILE_POOL.find(t => t.id === 'delay_30');

            const normalTrip = { train: { departureDelay: 120, arrivalDelay: 180 } };
            expect(delay15Tile.match(normalTrip).match).toBe(false);
            expect(delay30Tile.match(normalTrip).match).toBe(false);

            const trip16m = { train: { departureDelay: 960, arrivalDelay: 60 } };
            expect(delay15Tile.match(trip16m).match).toBe(true);
            expect(delay15Tile.match(trip16m).detail).toBe('+16m');
            expect(delay30Tile.match(trip16m).match).toBe(false);

            const trip35m = { train: { departureDelay: 0, arrivalDelay: 2100 } };
            expect(delay15Tile.match(trip35m).match).toBe(true);
            expect(delay30Tile.match(trip35m).match).toBe(true);
            expect(delay30Tile.match(trip35m).detail).toBe('+35m');
        });

        it('correctly matches on-time trips (±1m)', () => {
            const onTimeTile = BINGO_TILE_POOL.find(t => t.id === 'ontime');

            const onTime = { train: { departureDelay: 30, arrivalDelay: -20 } };
            expect(onTimeTile.match(onTime).match).toBe(true);

            const delayed = { train: { departureDelay: 180, arrivalDelay: 0 } };
            expect(onTimeTile.match(delayed).match).toBe(false);
        });

        it('correctly matches ICE and regional trains', () => {
            const iceTile = BINGO_TILE_POOL.find(t => t.id === 'highspeed');
            const regionalTile = BINGO_TILE_POOL.find(t => t.id === 'regional');

            const iceTrip = { train: { category: 'nationalExpress', lineName: 'ICE 700' } };
            expect(iceTile.match(iceTrip).match).toBe(true);
            expect(regionalTile.match(iceTrip).match).toBe(false);

            const reTrip = { train: { category: 'regional', lineName: 'RE 1' } };
            expect(iceTile.match(reTrip).match).toBe(false);
            expect(regionalTile.match(reTrip).match).toBe(true);
        });

        it('correctly matches trips with buddies or comments', () => {
            const buddyTile = BINGO_TILE_POOL.find(t => t.id === 'buddy');
            const commentTile = BINGO_TILE_POOL.find(t => t.id === 'has_comment');

            const buddyTrip = {
                body: 'Traveling with @fabian to Berlin',
                bodyMentions: [{ id: 1, username: 'fabian' }]
            };
            expect(buddyTile.match(buddyTrip).match).toBe(true);
            expect(commentTile.match(buddyTrip).match).toBe(true);

            const emptyTrip = { body: '' };
            expect(buddyTile.match(emptyTrip).match).toBe(false);
            expect(commentTile.match(emptyTrip).match).toBe(false);
        });
    });

    describe('DelayBingo Card State & Gameplay', () => {
        it('initializes a 3x3 grid with index 4 as the Free Center square', () => {
            DelayBingo.start({ username: 'tester' });
            expect(DelayBingo.tiles.length).toBe(9);
            expect(DelayBingo.tiles[4].id).toBe(FREE_CENTER_TILE.id);
            expect(DelayBingo.tiles[4].stamped).toBe(true);
            expect(DelayBingo.hasBingo).toBe(false);
        });

        it('detects a horizontal Bingo line', () => {
            DelayBingo.start({ username: 'tester' });

            // Row 0: indices 0, 1, 2
            DelayBingo.stampTile(0, 'Test 0', 'manual');
            expect(DelayBingo.hasBingo).toBe(false);

            DelayBingo.stampTile(1, 'Test 1', 'manual');
            expect(DelayBingo.hasBingo).toBe(false);

            const won = DelayBingo.stampTile(2, 'Test 2', 'manual');
            expect(won).toBe(true);
            expect(DelayBingo.hasBingo).toBe(true);
            expect(DelayBingo.winningLines).toContainEqual([0, 1, 2]);
        });

        it('detects a diagonal Bingo through the free center square', () => {
            DelayBingo.start({ username: 'tester' });

            // Diagonal: 0, 4 (free center already stamped), 8
            DelayBingo.stampTile(0, 'Corner 1', 'manual');
            expect(DelayBingo.hasBingo).toBe(false);

            const won = DelayBingo.stampTile(8, 'Corner 2', 'manual');
            expect(won).toBe(true);
            expect(DelayBingo.hasBingo).toBe(true);
            expect(DelayBingo.winningLines).toContainEqual([0, 4, 8]);
        });

        it('auto-stamps matching tiles when a batch of trips arrives', () => {
            DelayBingo.start({ username: 'tester' });

            // Replace tile 0 with a highspeed tile for predictable test
            DelayBingo.tiles[0] = {
                ...BINGO_TILE_POOL.find(t => t.id === 'highspeed'),
                stamped: false
            };

            const incomingTrips = [
                {
                    train: { category: 'highspeed', lineName: 'ICE 999' }
                }
            ];

            DelayBingo.onTripBatch(incomingTrips);

            expect(DelayBingo.tiles[0].stamped).toBe(true);
            expect(DelayBingo.tiles[0].stampedBy).toBe('auto');
            expect(DelayBingo.tiles[0].matchedDetail).toBe('ICE 999');
        });

        it('toggles manual tile stamping when user clicks, protecting the free center', () => {
            DelayBingo.start({ username: 'tester' });

            // Free center tile (index 4) should remain stamped
            DelayBingo.toggleTileManual(4);
            expect(DelayBingo.tiles[4].stamped).toBe(true);

            // Tile 1 starts unstamped
            expect(DelayBingo.tiles[1].stamped).toBe(false);
            DelayBingo.toggleTileManual(1);
            expect(DelayBingo.tiles[1].stamped).toBe(true);
            expect(DelayBingo.tiles[1].stampedBy).toBe('manual');

            // Clicking again toggles off
            DelayBingo.toggleTileManual(1);
            expect(DelayBingo.tiles[1].stamped).toBe(false);
        });

        it('supports reshuffling for a fresh board', () => {
            DelayBingo.start({ username: 'tester' });
            DelayBingo.stampTile(0, 'X', 'manual');
            expect(DelayBingo.tiles[0].stamped).toBe(true);

            DelayBingo.reshuffleCard();
            expect(DelayBingo.tiles[0].stamped).toBe(false);
            expect(DelayBingo.tiles[4].stamped).toBe(true); // Center is always free
            expect(DelayBingo.hasBingo).toBe(false);
        });
    });

    describe('LoadingGame Modular Facade Architecture', () => {
        it('delegates lifecycle methods to active game engine', () => {
            LoadingGame.start({ username: 'modular_tester' });
            expect(DelayBingo.activeUsername).toBe('modular_tester');

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

            // Restore DelayBingo
            LoadingGame.setActiveGame(DelayBingo);
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

            LoadingGame.setActiveGame(DelayBingo);
        });
    });
});
