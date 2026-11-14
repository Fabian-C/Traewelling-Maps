# Träwelling Map Explorer

Live demo: https://fabian-c.github.io/Traewelling-Maps/

## Overview

A modular, production-ready web application for visualizing Träwelling travel data on an interactive map. Built with vanilla JavaScript using ES6 modules - no build tools required.

## Features

- **Streamlined Setup & Zero-Auth Exploration**: Explore any public Träwelling user immediately with just their username — no login or token required.
- **Instant Local Session Switching**: Synchronous 0ms local metadata cache and 90-day IndexedDB session store with multi-account switching and account pruning.
- **Flexible Auth (OAuth 2.0 PKCE & Tokens)**: Connect securely with 1-click Träwelling OAuth using PKCE, or use Personal Access Tokens with 1-tap clipboard pasting.
- **Interactive Map & Layers**: Powered by Mapbox GL JS and Deck.gl. Color-coded categories across all transit modes: ICE/High-Speed, IC/EC, RE, RB, S-Bahn, Bus, Tram, Subway, Taxi/Rideshare, Ferry, and Plane.
- **Intermediate Stations & Stopovers**: On-demand batch retrieval of underway station stopovers (`GET /v1/stopovers/{ids}`) cached in IndexedDB.
- **Rich GeoJSON Export**: Export filtered or complete journeys as standardized GeoJSON, with optional inclusion of intermediate stations (scheduled vs. actual times, platforms, coordinates, and cancellation status).
- **Photo & Video Media Gallery**: Inline previews and immersive full-screen media lightbox supporting swipe gestures, loop/mute controls, and debounced loading.
- **Travel Buddies Ranking**: Automatic companion recognition from mentions (`@username`) and `createdBy` metadata, with 1-click buddy trip filtering.
- **Route Heatmap & Route Animation**: Dynamic heatmap density overlay with customizable color gradients and real-time trip playback animation.
- **Delay Tracker & Railway Tracks Overlay**: Pinpoint worst delays and overlay detailed OpenRailwayMap infrastructure over base vector tiles.
- **Trip Notes & Comment Search**: User notes and status text displayed safely in route popups, with instant client-side full-text search across lines, stations, buddies, and notes.
- **Trip Database & SQL Studio (`trips.html`)**: Full-text searchable trip table, co-passenger scanning, and an in-browser SQL engine supporting `SELECT DISTINCT`, `AVG`/`SUM`/`MIN`/`MAX`/`COUNT`, `AS` aliases, `NOT IN`, and the `co_passengers` table.
- **Route Animation Studio (`animation.html`)**: High-resolution canvas route animation with camera follow, 3D tilt, vector/tile map styles, and client-side WebM/MP4 export (`js/anim-v2/`).
- **Rail Wrapped (`wrapped.html`)**: Annual travel analytics, transit habits heatmap, records, and downloadable social summary cards.
- **Self-Hosting Tile Support**: Configurable basemap provider (`mapbox`, tokenless `carto-dark`, `osm`, or `custom` tile URL) via `CONFIG.MAP_TILES`, `localStorage`, or `?tiles=` query parameter.

## Architecture

### Modular Directory Structure

```
js/
├── anim-v2/              # Unified animation studio engine (camera, renderer, WebM/MP4 export)
├── animation/            # Shared animation geometry, tile preloader, vector map renderer
├── analytics/
│   └── statistics.js     # Travel metrics, operator stats, buddy rankings
├── api/
│   └── traewelling.js    # Rate-limited API client (statuses, polylines, stopovers)
├── cache/
│   ├── normalizer.js     # Canonical trip normalization
│   └── session.js        # IndexedDB v2/v3 storage (sessions, polylines, stopovers, co-passengers)
├── config/
│   └── config.js         # API base URLs, layer colors, rate limits, OAuth & map tile config
├── data/
│   └── processing.js     # GeoJSON feature normalization, coordinate validation
├── events/
│   └── listeners.js      # Global UI events, filters, debounced handlers
├── export/
│   └── geojson.js        # GeoJSON serialization, stopovers enrichment, file downloads
├── fetch/
│   └── orchestrator.js   # Multi-page status fetching, cargo progress animation
├── filters/
│   └── filterManager.js  # Date range, transport mode, buddy, and business filtering
├── map/
│   ├── delayOverlay.js   # Deck.gl delay highlights and summary metrics
│   ├── heatmap.js        # Density heatmap layer with color stops
│   ├── interactions.js   # Map click/hover handlers, popups, media viewer
│   ├── layers.js         # Category layer sources, ordering, and toggles
│   └── routeAnimation.js # Animated trip playback along route polylines
├── privacy/              # StatusVisibility filtering & privacy manager
├── session/
│   ├── manager.js        # Session persistence, auto-validation, account switcher
│   └── oauth.js          # PKCE code challenge and token exchange
├── state/
│   ├── state.js          # Central state shape initialization
│   └── store.js          # Reactive store with subscription callbacks
├── trips/                # Trip database UI, SQL engine & autocomplete, co-passenger scanner
├── ui/
│   ├── funFacts.js       # Dynamic travel milestones and fun facts
│   ├── loadingGame/      # Modular loading widget (Check-in Ticker)
│   ├── rateLimit.js      # Live rate-limit gauge and quota meter
│   └── ui.js             # Setup modal, cargo depot animation, status banners
├── utils/                # Color, data, format, geometry, logger, math, storage, time helpers
└── wrapped/              # Rail Wrapped analytics & social card generator
```

### Key Modules

- **API Client ([js/api/traewelling.js](js/api/traewelling.js))**: Auto-throttling Träwelling API client respecting 55 req/60s rate limit with visual headroom meter.
- **Persistent Cache ([js/cache/session.js](js/cache/session.js))**: IndexedDB v2 storing full trip sets, multi-account credentials, and batch stopovers, paired with synchronous `localStorage` metadata for instantaneous startup.
- **GeoJSON Exporter ([js/export/geojson.js](js/export/geojson.js))**: Converts check-ins to valid GeoJSON FeatureCollections, optionally batch-fetching intermediate stations for full route telemetry.

## Quick Start

### Development

1. Clone the repository
2. Open `index.html` in a browser
3. No build step required

### Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

### Security

See [SECURITY.md](SECURITY.md) for security audit and recommendations.

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
MAPBOX_TOKEN=your_mapbox_token
API_BASE_URL=https://traewelling.de/api/v1
RATE_LIMIT=55
RATE_WINDOW=60000
SESSION_MAX_AGE_DAYS=30
MAX_SESSIONS=15
```

## Development

### Running Locally

Simply open `index.html` in a browser. No server required, but for CORS and security features, use a local server:

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

### Code Style

- ES6 modules with `import`/`export`
- Snake_case for variables and functions
- PascalCase for classes
- UPPER_SNAKE_CASE for constants
- No build tools or bundlers required

## Testing

### Manual Testing Checklist

- [ ] Load application successfully
- [ ] Fetch user data with valid username
- [ ] Handle invalid username validation
- [ ] Load saved sessions from IndexedDB
- [ ] Delete sessions
- [ ] Clear all sessions
- [ ] Rate limiting UI feedback
- [ ] Error handling for network failures
- [ ] Error handling for API errors
- [ ] Mobile responsive design

## CI/CD

GitHub Actions (`.github/workflows`): `ci.yml` runs lint + tests on every push/PR; `pages.yml` deploys the repository root to GitHub Pages (no build step).

## Performance

- Lazy loading of map layers
- Efficient IndexedDB caching
- Rate limiting to prevent API abuse
- Optimized rendering with Deck.gl

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## AI Usage Disclosure

Parts of this codebase—including architectural modularization, automated unit and end-to-end test suites, UI/UX refinements, and documentation—have been developed with the assistance of AI pair programming agents (such as Google DeepMind's Antigravity and Gemini models). All AI-assisted contributions are subject to human review, linting, and automated continuous integration verification.

## License

No license has been chosen yet.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
