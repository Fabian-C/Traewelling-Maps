/**
 * Animated Journey Video Clip Composition (960x960 1:1 Square)
 * Connects Remotion lifecycle hooks to the modular tile preloader,
 * Web Mercator geometry engine, and Canvas 2D renderer.
 */

import React from 'https://esm.sh/react@18.3.1';
import htm from 'https://esm.sh/htm@3.1.1';
import {
    useCurrentFrame,
    useVideoConfig,
    spring,
    AbsoluteFill,
    delayRender,
    continueRender
} from 'https://esm.sh/remotion@4.0.539?deps=react@18.3.1';

import { CATEGORY_META, MAP_STYLES, preloadTripTiles } from './tiles.js';
import { extractRouteCoordinates, buildMapScene, shortenStationName } from './geometry.js';
import { renderTripFrame } from './renderer.js';

const html = htm.bind(React.createElement);

export { CATEGORY_META, MAP_STYLES, preloadTripTiles, extractRouteCoordinates, buildMapScene };

export function TripStoryComposition({
    trip,
    username = 'Traveler',
    mapStyle = 'traewelling-dark'
}) {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const canvasRef = React.useRef(null);
    const [tilesReadyCount, setTilesReadyCount] = React.useState(0);

    const coords = React.useMemo(() => (trip ? extractRouteCoordinates(trip) : []), [trip]);
    const scene = React.useMemo(() => buildMapScene(coords, width, height), [coords, width, height]);
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

    // Silently preload 100% of scene tiles before rendering/recording starts
    React.useEffect(() => {
        if (!trip || !scene.tiles.length) return;
        let cancelled = false;
        const handle = delayRender(`Preloading ${scene.tiles.length} map tiles`);

        const safetyTimer = setTimeout(() => {
            if (!cancelled) {
                try { continueRender(handle); } catch { /* ignore */ }
            }
        }, 6500);

        preloadTripTiles(trip, mapStyle, width, height, ({ loaded }) => {
            if (!cancelled) {
                setTilesReadyCount(loaded);
            }
        }).then(() => {
            clearTimeout(safetyTimer);
            if (!cancelled) {
                try { continueRender(handle); } catch { /* ignore */ }
            }
        });

        return () => {
            cancelled = true;
            clearTimeout(safetyTimer);
            try { continueRender(handle); } catch { /* ignore */ }
        };
    }, [trip, mapStyle, width, height, scene]);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !trip) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const introSpring = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
        renderTripFrame({
            ctx,
            frame,
            fps,
            width,
            height,
            trip,
            username,
            coords,
            scene,
            styleConfig,
            introSpring
        });
    }, [frame, fps, width, height, trip, username, mapStyle, coords, scene, styleConfig, tilesReadyCount]);

    const checkin = trip?.checkin || trip?.train || {};
    const lineName = checkin.lineName || checkin.number || 'Train';
    const orig = shortenStationName(checkin.origin?.name || checkin.origin?.station?.name || trip?.origin || 'Origin');
    const dest = shortenStationName(checkin.destination?.name || checkin.destination?.station?.name || trip?.destination || 'Destination');

    return html`
        <${AbsoluteFill} style=${{ backgroundColor: styleConfig.bg }}>
            <canvas
                id="tripClipCanvas"
                ref=${canvasRef}
                width=${width}
                height=${height}
                role="img"
                aria-label=${`Animated trip map for ${lineName} from ${orig} to ${dest}`}
                style=${{ inlineSize: '100%', blockSize: '100%', display: 'block' }}
            />
        <//>
    `;
}
