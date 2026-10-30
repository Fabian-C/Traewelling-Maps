import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UI } from '../../js/ui/ui.js';
import { renderAccountItems } from '../../js/session/manager.js';

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this._innerHTML = '';
        this.className = '';
        this.id = '';
        this.style = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
        // Parse simple child spans/divs if needed or clear children
        if (val === '') {
            this.children = [];
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelectorAll(selector) {
        if (selector === '.solari-row') {
            return this.children.filter(c => c.className === 'solari-row');
        }
        return [];
    }

    querySelector(selector) {
        const matches = this.querySelectorAll(selector);
        return matches.length > 0 ? matches[0] : null;
    }
}

describe('Incremental Fetch and Setup Screen Improvements', () => {
    let mockSolariRows;
    let mockTicker;
    let elementsMap;

    beforeEach(() => {
        elementsMap = {
            solariTicker: new MockElement('div'),
            solariRows: new MockElement('div'),
            savedAccountsList: new MockElement('div'),
            sessionsList: new MockElement('div'),
            savedSessions: new MockElement('div'),
            usernameInput: new MockElement('input')
        };

        globalThis.document = {
            getElementById: (id) => elementsMap[id] || null,
            createElement: (tag) => new MockElement(tag)
        };

        mockSolariRows = elementsMap.solariRows;
        mockTicker = elementsMap.solariTicker;

        UI.refs = {
            solariRows: mockSolariRows,
            solariTicker: mockTicker
        };
    });

    afterEach(() => {
        if (UI._solariTimer) {
            clearInterval(UI._solariTimer);
            UI._solariTimer = null;
        }
    });

    it('populateSolariBoard always pads up to 5 rows even when only 2 trips are fetched', () => {
        const twoTrips = [
            { train: { lineName: 'ICE 501', origin: { name: 'Berlin Hbf' }, destination: { name: 'Leipzig Hbf' } } },
            { train: { lineName: 'RE 5', origin: { name: 'Köln Hbf' }, destination: { name: 'Koblenz Hbf' } } }
        ];

        UI.populateSolariBoard(twoTrips);

        expect(mockSolariRows.children.length).toBe(5);
        expect(mockSolariRows.children[0].innerHTML).toContain('ICE 501');
        expect(mockSolariRows.children[1].innerHTML).toContain('RE 5');
        // Padded default rows
        expect(mockSolariRows.children[2].innerHTML).toContain('IC 2020');
        expect(mockSolariRows.children[3].innerHTML).toContain('TGV 9556');
        expect(mockSolariRows.children[4].innerHTML).toContain('FLX 10');
    });

    it('populateSolariBoard handles 0 trips by cleanly filling 5 default rows', () => {
        UI.populateSolariBoard([]);

        expect(mockSolariRows.children.length).toBe(5);
        expect(mockSolariRows.children[0].innerHTML).toContain('ICE 726');
    });

    it('startSolariShuffle pads trips pool with defaults if only 1 trip is supplied so shuffle never stalls', () => {
        const oneTrip = [
            { train: { lineName: 'ICE 123', origin: { name: 'Berlin' }, destination: { name: 'Hamburg' } } }
        ];

        UI.startSolariShuffle(oneTrip);

        expect(UI._solariTimer).not.toBeNull();
        expect(UI._solariTrips.length).toBeGreaterThanOrEqual(2);
    });

    it('renderAccountItems renders sync buttons for quick incremental fetch on saved sessions', () => {
        const sessions = [
            {
                username: 'traeweller1',
                displayName: 'Traeweller One',
                tripCount: 42,
                timestamp: Date.now()
            }
        ];

        renderAccountItems(sessions);

        const menuList = elementsMap.savedAccountsList;
        const setupList = elementsMap.sessionsList;

        expect(menuList.innerHTML).toContain('saved-account-sync');
        expect(menuList.innerHTML).toContain('syncSessionByUsername(\'traeweller1\')');

        expect(setupList.innerHTML).toContain('saved-account-sync');
        expect(setupList.innerHTML).toContain('syncSessionByUsername(\'traeweller1\')');
    });
});
