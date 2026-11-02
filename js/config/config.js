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
        ['nationalExpress', '#ff2e55'],
        ['regionalExp', '#e11d48'],
        ['national', '#00c8ff'],
        ['regional', '#db2777'],
        ['suburban', '#16a34a'],
        ['bus', '#22c55e'],
        ['tram', '#06b6d4'],
        ['subway', '#8c6dab'],
        ['taxi', '#eab308'],
        ['plane', '#6366f1'],
        ['ferry', '#0284c7'],
        ['unknown', '#38bdf8']
    ]
};
