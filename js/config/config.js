// Configuration module

export const CONFIG = {
    MAPBOX_TOKEN: 'pk.eyJ1IjoiaGFzaGVyMTEiLCJhIjoiY2xhbzFubnJ2MHYyeDNvbGJ0N2E4ZGtmcCJ9.Y85sMCOsQLFIyxA7RTO7WA',
    API_BASE_URL: 'https://traewelling.de/api/v1',
    RATE_LIMIT: 55,
    RATE_WINDOW: 60000,
    SESSION_MAX_AGE_MS: 1000 * 60 * 60 * 24 * 90, // 90 days
    LAYER_CONFIG: [
        ['nationalExpress', '#0073ff'],
        ['national', '#00eeff'],
        ['regionalExp', '#d1024e'],
        ['regional', '#a6026c'],
        ['suburban', '#fc0000'],
        ['bus', '#238443'],
        ['tram', '#2FC5CC'],
        ['subway', '#F69A00'],
        ['plane', '#111111'],
        ['ship', '#0055aa'],
        ['unknown', '#888888']
    ]
};
