/**
 * Canvas 2D Rendering Pipeline (V2 Native Architecture)
 * High-performance, zero-dependency frame rendering decoupled from React/Remotion.
 */

import { MAP_STYLES, CATEGORY_META, preloadTripTiles, preloadSceneTiles } from '../animation/tiles.js';
import { renderTripFrame, renderAllTripsFrame } from '../animation/renderer.js';
import { computeSpring } from './precompute.js';

export { MAP_STYLES, CATEGORY_META, preloadTripTiles, preloadSceneTiles };

/**
 * Renders a single animation frame to any HTML5 Canvas 2D context
 */
export function renderV2Frame({
    ctx,
    frame,
    fps = 30,
    width = 960,
    height = 960,
    trip = null,
    trips = [],
    mode = 'single',
    username = 'Traveler',
    mapStyle = 'traewelling-dark',
    precompute = null
}) {
    if (!ctx) return;
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

    if (mode === 'all') {
        if (!precompute?.allScene) return;
        renderAllTripsFrame({
            ctx,
            frame,
            fps,
            width,
            height,
            username,
            allScene: precompute.allScene,
            timing: precompute.timing,
            styleConfig
        });
        return;
    }

    if (!trip || !precompute) return;

    const introSpring = computeSpring({ frame, fps, config: { damping: 18, stiffness: 90 } });
    renderTripFrame({
        ctx,
        frame,
        fps,
        width,
        height,
        trip,
        username,
        coords: precompute.coords,
        scene: precompute.scene,
        styleConfig,
        introSpring
    });
}

