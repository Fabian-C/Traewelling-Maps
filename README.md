# Träwelling Map Explorer

Live demo: https://fabian-c.github.io/Traewelling-Maps/

## Overview

A modular, production-ready web application for visualizing Träwelling travel data on an interactive map. Built with vanilla JavaScript using ES6 modules - no build tools required.

## Features

- **Interactive Map**: Powered by Mapbox GL JS and Deck.gl
- **Data Visualization**: Route polylines, heatmap overlays, delay indicators
- **Session Management**: Cached sessions via IndexedDB
- **Rate Limiting**: Built-in API rate limiting with visual feedback
- **Error Handling**: Comprehensive error handling and validation
- **Responsive Design**: Mobile-friendly interface

## Architecture

### Modular Structure

```
js/
├── api/           # API client (Traewelling)
├── cache/         # IndexedDB session storage
├── map/           # Map initialization and layer management
├── analytics/     # Statistics and filters
├── utils/         # Validation, error handling, loading states
├── ui/            # UI modules (setup, fetch, menu, popup)
├── data/          # Data fetching logic
├── config.js      # Configuration constants
├── state.js       # Global state management
└── main.js        # Application entry point
```

### Key Modules

- **API Client**: Rate-limited Träwelling API client
- **IndexedDB**: Session caching with automatic pruning
- **Error Handler**: Centralized error handling with user-friendly messages
- **Validation**: Input validation for usernames, tokens, dates
- **Loading Manager**: Loading state management with progress tracking

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

