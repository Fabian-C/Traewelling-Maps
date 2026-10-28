import { describe, it, expect, vi } from 'vitest';
import { MAP_STYLES, preloadSceneTiles } from '../../js/animation/tiles.js';
import { drawVectorBaseMap } from '../../js/animation/vectorRenderer.js';
import { VECTOR_COUNTRIES, VECTOR_GERMAN_STATES } from '../../js/animation/vectorData.js';

describe('Map Styles & Vector Map Engine', () => {
    it('defines vector map styles with isVector flag', () => {
        expect(MAP_STYLES['vector-dark']).toBeDefined();
        expect(MAP_STYLES['vector-dark'].isVector).toBe(true);
        expect(MAP_STYLES['vector-dark'].isDark).toBe(true);

        expect(MAP_STYLES['vector-light']).toBeDefined();
        expect(MAP_STYLES['vector-light'].isVector).toBe(true);
        expect(MAP_STYLES['vector-light'].isDark).toBe(false);

        expect(MAP_STYLES['vector']).toBeDefined();
        expect(MAP_STYLES['vector'].isVector).toBe(true);
    });

    it('contains comprehensive European country and German state vector geometry', () => {
        expect(VECTOR_COUNTRIES.length).toBeGreaterThanOrEqual(15);
        const deu = VECTOR_COUNTRIES.find(c => c.id === 'DEU');
        expect(deu).toBeDefined();
        expect(deu.geometry.type).toMatch(/Polygon|MultiPolygon/);

        expect(VECTOR_GERMAN_STATES.length).toBe(16);
    });

    it('bypasses network tile preloading for vector map styles', async () => {
        const dummyScene = {
            tiles: [{ x: 10, y: 20, z: 6, left: 0, top: 0 }],
            detailTiles: [{ x: 100, y: 200, z: 12, left: 0, top: 0, size: 64 }]
        };

        const onProgress = vi.fn();
        const res = await preloadSceneTiles(dummyScene, 'vector-dark', onProgress);

        expect(res).toEqual({ total: 0, loaded: 0 });
        expect(onProgress).toHaveBeenCalledWith({ loaded: 1, total: 1 });
    });

    it('renders vector base map onto canvas context without throwing', () => {
        const drawCommands = [];
        const mockCtx = {
            save: vi.fn(() => drawCommands.push('save')),
            restore: vi.fn(() => drawCommands.push('restore')),
            beginPath: vi.fn(() => drawCommands.push('beginPath')),
            moveTo: vi.fn((x, y) => drawCommands.push(`moveTo(${Math.round(x)},${Math.round(y)})`)),
            lineTo: vi.fn((x, y) => drawCommands.push(`lineTo(${Math.round(x)},${Math.round(y)})`)),
            closePath: vi.fn(() => drawCommands.push('closePath')),
            fill: vi.fn(() => drawCommands.push('fill')),
            stroke: vi.fn(() => drawCommands.push('stroke')),
            arc: vi.fn(() => drawCommands.push('arc')),
            fillText: vi.fn((text) => drawCommands.push(`fillText(${text})`)),
            setLineDash: vi.fn()
        };

        const baseScene = {
            z: 6,
            originWX: 1000,
            originWY: 1000
        };

        expect(() => {
            drawVectorBaseMap({
                ctx: mockCtx,
                baseScene,
                camZoom: 2.5,
                styleConfig: MAP_STYLES['vector-dark']
            });
        }).not.toThrow();

        expect(mockCtx.beginPath).toHaveBeenCalled();
        expect(mockCtx.fill).toHaveBeenCalled();
        expect(mockCtx.stroke).toHaveBeenCalled();
        expect(mockCtx.fillText).toHaveBeenCalled();
    });
});
