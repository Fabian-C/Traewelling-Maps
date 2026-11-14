// @ts-check
// Configuration module

export const CONFIG = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoiaGFzaGVyMTEiLCJhIjoiY2xhbzFubnJ2MHYyeDNvbGJ0N2E4ZGtmcCJ9.Y85sMCOsQLFIyxA7RTO7WA',
    MAP_TILES: {
        DEFAULT_PROVIDER: 'mapbox', // 'mapbox' | 'carto-dark' | 'osm' | 'custom'
        CUSTOM_TILE_URL: '',        // e.g. 'https://your-tile-server.example/{z}/{x}/{y}.png'
        ATTRIBUTION: '© OpenStreetMap contributors © CARTO'
    },
    API_BASE_URL: 'https://traewelling.de/api/v1',
    RATE_LIMIT: 55,
    RATE_WINDOW: 60000,
    SESSION_MAX_AGE_MS: 1000 * 60 * 60 * 24 * 90, // 90 days
    OAUTH: {
        CLIENT_ID: '419',
        AUTHORIZE_URL: 'https://traewelling.de/oauth/authorize',
        TOKEN_URL: 'https://traewelling.de/oauth/token',
        SCOPES: 'read-statuses read-statistics',
        getRedirectUri: () => {
            const loc = window.location;
            let path = loc.pathname;
            if (path.endsWith('index.html')) {
                path = path.slice(0, -10);
            }
            if (!path.endsWith('/')) {
                path += '/';
            }
            return `${loc.origin}${path}`;
        }
    },
    LAYER_CONFIG: [
        ['nationalExpress', '#0073ff'],
        ['regionalExp', '#d1024e'],
        ['national', '#00eeff'],
        ['regional', '#a6026c'],
        ['suburban', '#fc0000'],
        ['bus', '#238443'],
        ['tram', '#2FC5CC'],
        ['subway', '#F69A00'],
        ['taxi', '#f1c40f'],
        ['plane', '#111111'],
        ['ferry', '#0055aa'],
        ['unknown', '#888888']
    ]
};

/**
 * Resolves the Mapbox GL style (either a Mapbox hosted style URL or a tokenless
 * self-hostable raster tile style spec) based on runtime overrides or config.
 * @param {object} [overrides]
 * @param {string} [overrides.provider] - 'mapbox' | 'carto-dark' | 'osm' | 'custom'
 * @param {string} [overrides.mapboxToken] - Mapbox token override
 * @param {string} [overrides.customTileUrl] - Custom `{z}/{x}/{y}` tile URL template
 * @returns {string | object}
 */
export function resolveMapStyle(overrides = {}) {
    let urlProvider = '';
    let storedProvider = '';
    let storedCustomUrl = '';
    let storedToken = '';

    if (typeof window !== 'undefined') {
        try {
            const params = new URLSearchParams(window.location?.search || '');
            urlProvider = params.get('tiles') || '';
        } catch (_) { /* ignore */ }
        try {
            storedProvider = window.localStorage?.getItem('tw_map_provider') || '';
            storedCustomUrl = window.localStorage?.getItem('tw_custom_tile_url') || '';
            storedToken = window.localStorage?.getItem('tw_mapbox_token') || '';
        } catch (_) { /* ignore */ }
    }

    const token = overrides.mapboxToken !== undefined
        ? overrides.mapboxToken
        : (storedToken || CONFIG.MAPBOX_TOKEN);
    const customTileUrl = overrides.customTileUrl || storedCustomUrl || CONFIG.MAP_TILES.CUSTOM_TILE_URL;
    let provider = (overrides.provider || urlProvider || storedProvider || CONFIG.MAP_TILES.DEFAULT_PROVIDER || 'mapbox').toLowerCase();

    if (provider === 'mapbox' && !token) {
        provider = customTileUrl ? 'custom' : 'carto-dark';
    }

    if (provider === 'mapbox') {
        return 'mapbox://styles/mapbox/dark-v10';
    }

    let tiles;
    let attribution = CONFIG.MAP_TILES.ATTRIBUTION;
    if (provider === 'custom' && customTileUrl) {
        tiles = [customTileUrl];
        attribution = '© Custom Tile Server';
    } else if (provider === 'osm') {
        tiles = [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ];
        attribution = '© OpenStreetMap contributors';
    } else {
        // Default tokenless dark basemap ('carto-dark' / 'carto')
        tiles = [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
        ];
    }

    return {
        version: 8,
        sources: {
            'selfhosted-raster-tiles': {
                type: 'raster',
                tiles,
                tileSize: 256,
                attribution
            }
        },
        layers: [
            {
                id: 'selfhosted-raster-layer',
                type: 'raster',
                source: 'selfhosted-raster-tiles',
                minzoom: 0,
                maxzoom: 20
            }
        ]
    };
}
