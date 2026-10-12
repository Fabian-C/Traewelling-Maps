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

## Architecture

### Modular Directory Structure

```
js/
├── analytics/
│   └── statistics.js     # Travel metrics, operator stats, buddy rankings
├── api/
│   └── traewelling.js    # Rate-limited API client (statuses, polylines, stopovers)
├── cache/
│   └── session.js        # IndexedDB v2 storage (sessions, stopovers, fast meta cache)
├── config/
│   └── config.js         # API base URLs, layer colors, rate limits, OAuth config
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
├── session/
│   ├── manager.js        # Session persistence, auto-validation, account switcher
│   └── oauth.js          # PKCE code challenge and token exchange
├── state/
│   ├── state.js          # Central state shape initialization
│   └── store.js          # Reactive store with subscription callbacks
├── ui/
│   ├── funFacts.js       # Dynamic travel milestones and fun facts
│   ├── rateLimit.js      # Live rate-limit gauge and quota meter
│   └── ui.js             # Setup modal, cargo depot animation, status banners
└── utils/
    ├── color.js          # Hex/RGB conversions and color blending
    ├── data.js           # Empty statistics factories and normalization
    ├── format.js         # Date, duration, and delay formatting
    ├── geometry.js       # Distance, bearing, and bounding box math
    ├── math.js           # Numeric helpers
    └── time.js           # Timestamp parsing and scheduled vs real delay math
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

GitLab CI/CD pipeline configured for:
- Linting
- Testing
- Building (optional)
- Deployment to Netlify/GitHub Pages

See [`.gitlab-ci.yml`](.gitlab-ci.yml) for configuration.

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

## License

See LICENSE file for details.

## Contributing

1. Follow the existing code style
2. Add error handling for new features
3. Include validation for user inputs
4. Update documentation

