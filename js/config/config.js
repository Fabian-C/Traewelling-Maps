// Configuration module

export const CONFIG = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoiaGFzaGVyMTEiLCJhIjoiY2xhbzFubnJ2MHYyeDNvbGJ0N2E4ZGtmcCJ9.Y85sMCOsQLFIyxA7RTO7WA',
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
        ['plane', '#111111'],
        ['ferry', '#0055aa'],
        ['unknown', '#888888']
    ]
};
