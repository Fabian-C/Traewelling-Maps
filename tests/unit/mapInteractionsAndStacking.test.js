import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../../js/state/store.js';
import { measureFeatureDistance, showPopup } from '../../js/map/interactions.js';

describe('Map Hit Detection & Stacked Route Cycling', () => {
    beforeEach(() => {
        store.initialize();
        store.update({
            map: null,
            currentPopup: null,
            preserveHighlightOnPopupClose: false,
            layers: { order: ['nationalExpress', 'regional', 'bus'] }
        });

        globalThis.document = {
            createElement: () => ({
                style: {},
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener: () => {}
            }),
            activeElement: null
        };
    });

    describe('measureFeatureDistance', () => {
        it('calculates screen-space pixel distance when map.project and clickPoint are provided', () => {
            const mockMap = {
                project: vi.fn((coord) => {
                    // Coordinate [13.4, 52.5] -> { x: 100, y: 100 }
                    // Coordinate [13.5, 52.5] -> { x: 200, y: 100 }
                    if (coord[0] === 13.4) return { x: 100, y: 100 };
                    if (coord[0] === 13.5) return { x: 200, y: 100 };
                    return { x: 0, y: 0 };
                })
            };
            store.setProp('map', mockMap);

            const feature = {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [[13.4, 52.5], [13.5, 52.5]]
                }
            };

            // Click at (150, 108) which is 8px perpendicular from segment (100,100)-(200,100)
            const clickPoint = { x: 150, y: 108 };
            const distPx = measureFeatureDistance(feature, { lng: 13.45, lat: 52.5 }, clickPoint);

            expect(distPx).toBeCloseTo(8, 1);
            expect(mockMap.project).toHaveBeenCalled();
        });

        it('returns Infinity for invalid geometries or empty lines', () => {
            expect(measureFeatureDistance(null, { lng: 0, lat: 0 })).toBe(Infinity);
            expect(measureFeatureDistance({ geometry: null }, { lng: 0, lat: 0 })).toBe(Infinity);
        });
    });

    describe('showPopup and stacked cycling state management', () => {
        it('preserves route highlight when preserveHighlightOnPopupClose is true during cycling', () => {
            let currentPopupCloseHandler = null;

            const mockMap = {
                project: vi.fn(() => ({ x: 100, y: 100 })),
                getLayer: vi.fn(() => true),
                removeLayer: vi.fn(),
                addLayer: vi.fn(),
                addSource: vi.fn(),
                removeSource: vi.fn(),
                getSource: vi.fn(() => null)
            };

            const mockPopupInstance = {
                setLngLat: vi.fn().mockReturnThis(),
                setHTML: vi.fn().mockReturnThis(),
                addTo: vi.fn().mockReturnThis(),
                getElement: vi.fn(() => ({
                    style: {},
                    querySelector: vi.fn(() => null),
                    querySelectorAll: vi.fn(() => []),
                    addEventListener: vi.fn()
                })),
                remove: vi.fn(() => {
                    if (currentPopupCloseHandler) {
                        currentPopupCloseHandler();
                    }
                }),
                on: vi.fn((event, cb) => {
                    if (event === 'close') currentPopupCloseHandler = cb;
                }),
                once: vi.fn()
            };

            globalThis.mapboxgl = {
                Popup: vi.fn(() => mockPopupInstance)
            };

            store.setProp('map', mockMap);
            store.setProp('currentPopup', mockPopupInstance);
            store.setProp('preserveHighlightOnPopupClose', false);
            store.setProp('layers', { order: ['nationalExpress'] });

            const feature1 = {
                type: 'Feature',
                properties: { statusId: '101', lineName: 'ICE 1' },
                geometry: { type: 'LineString', coordinates: [[13, 52], [14, 52]] }
            };
            const feature2 = {
                type: 'Feature',
                properties: { statusId: '102', lineName: 'RE 2' },
                geometry: { type: 'LineString', coordinates: [[13, 52], [14, 52]] }
            };

            showPopup({ lng: 13.5, lat: 52 }, feature1, {
                stack: [feature1, feature2],
                stackIndex: 0
            });

            expect(globalThis.mapboxgl.Popup).toHaveBeenCalled();

            // When switching to stacked index 1, preserveHighlightOnPopupClose is set to true
            store.setProp('preserveHighlightOnPopupClose', true);
            mockPopupInstance.remove();

            // When preserveHighlightOnPopupClose is true, close handler should NOT clear highlight
            expect(store.get().preserveHighlightOnPopupClose).toBe(false);
        });
    });
});
