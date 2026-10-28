/**
 * Map Tile Styles, Category Metadata, and Silent Decoded Tile Cache
 */

import { CONFIG } from '../config/config.js';
import { extractRouteCoordinates, buildMapScene } from './geometry.js';

export const CATEGORY_META = {
    nationalExpress: { label: 'High-Speed Rail', color: '#ff2e55', accent: '#ffffff', vehicle: 'ice' },
    national: { label: 'InterCity', color: '#00c8ff', accent: '#ffffff', vehicle: 'ice' },
    regionalExp: { label: 'Regional Express', color: '#e11d48', accent: '#fecdd3', vehicle: 'train' },
    regional: { label: 'Regional Train', color: '#db2777', accent: '#fbcfe8', vehicle: 'train' },
    suburban: { label: 'S-Bahn', color: '#16a34a', accent: '#bbf7d0', vehicle: 'sbahn' },
    subway: { label: 'U-Bahn', color: '#8c6dab', accent: '#e9d5ff', vehicle: 'ubahn' },
    tram: { label: 'Tram / Streetcar', color: '#06b6d4', accent: '#cffafe', vehicle: 'tram' },
    bus: { label: 'Bus', color: '#22c55e', accent: '#dcfce7', vehicle: 'bus' },
    ferry: { label: 'Ferry', color: '#0284c7', accent: '#e0f2fe', vehicle: 'ferry' },
    plane: { label: 'Flight', color: '#6366f1', accent: '#e0e7ff', vehicle: 'plane' },
    taxi: { label: 'Taxi', color: '#eab308', accent: '#fef9c3', vehicle: 'bus' },
    unknown: { label: 'Transit Journey', color: '#38bdf8', accent: '#e0f2fe', vehicle: 'train' }
};

const SUBDOMAINS = ['a', 'b', 'c'];

/**
 * 7 Curated Map Tile Sets (CORS-enabled for WebM canvas recording)
 */
export const MAP_STYLES = {
    'traewelling-dark': {
        name: 'Träwelling Dark',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v10/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        bg: '#11141a',
        isDark: true
    },
    'traewelling-light': {
        name: 'Träwelling Light',
        getTileUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`;
        },
        getFallbackUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        bg: '#f5f4f0',
        isDark: false
    },
    'db-light': {
        name: 'Modern Light',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        bg: '#eef2f6',
        isDark: false
    },
    'db-dark': {
        name: 'Modern Night',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#0c1322',
        isDark: true
    },
    voyager: {
        name: 'Classic Streets',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        bg: '#cad2d3',
        isDark: false
    },
    topo: {
        name: 'Rail & Topo',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`;
        },
        bg: '#e6e4dd',
        isDark: false
    },
    'osm-de': {
        name: 'Free OSM Rail',
        getTileUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        getFallbackUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png`;
        },
        bg: '#ebe9e1',
        isDark: false
    }
};

export const TILE_IMAGE_CACHE = new Map();
const TILE_PROMISE_CACHE = new Map();

export function loadSingleTileImage(primaryUrl, fallbackUrl) {
    if (TILE_IMAGE_CACHE.has(primaryUrl)) {
        return Promise.resolve(TILE_IMAGE_CACHE.get(primaryUrl));
    }
    if (TILE_PROMISE_CACHE.has(primaryUrl)) {
        return TILE_PROMISE_CACHE.get(primaryUrl);
    }

    const promise = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        const finalize = async (loadedImg) => {
            try {
                if (loadedImg && typeof loadedImg.decode === 'function') {
                    await loadedImg.decode();
                }
            } catch {
                // Ignore decode warnings
            }
            if (loadedImg) {
                TILE_IMAGE_CACHE.set(primaryUrl, loadedImg);
            } else {
                TILE_PROMISE_CACHE.delete(primaryUrl);
            }
            resolve(loadedImg);
        };

        img.onload = () => finalize(img);
        img.onerror = () => {
            if (fallbackUrl && fallbackUrl !== primaryUrl) {
                const fbImg = new Image();
                fbImg.crossOrigin = 'anonymous';
                fbImg.onload = () => finalize(fbImg);
                fbImg.onerror = () => finalize(null);
                fbImg.src = fallbackUrl;
            } else {
                finalize(null);
            }
        };
        img.src = primaryUrl;
    });

    TILE_PROMISE_CACHE.set(primaryUrl, promise);
    return promise;
}

export async function preloadSceneTiles(scene, mapStyle = 'traewelling-dark', onProgress = null) {
    if (!scene || !Array.isArray(scene.tiles) || !scene.tiles.length) {
        return { total: 0, loaded: 0 };
    }
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];
    const total = scene.tiles.length;
    let loaded = 0;
    if (onProgress) onProgress({ loaded, total });

    await Promise.all(
        scene.tiles.map(async (tile) => {
            const primaryUrl = styleConfig.getTileUrl(scene.z, tile.x, tile.y);
            const fallbackUrl = styleConfig.getFallbackUrl ? styleConfig.getFallbackUrl(scene.z, tile.x, tile.y) : null;
            await loadSingleTileImage(primaryUrl, fallbackUrl);
            loaded += 1;
            if (onProgress) onProgress({ loaded, total });
        })
    );

    return { total, loaded };
}

export async function preloadTripTiles(trip, mapStyle = 'traewelling-dark', width = 960, height = 960, onProgress = null) {
    if (!trip) return { total: 0, loaded: 0 };
    const coords = extractRouteCoordinates(trip);
    const scene = buildMapScene(coords, width, height);
    return preloadSceneTiles(scene, mapStyle, onProgress);
}


