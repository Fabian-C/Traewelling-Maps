# Contributing

The app is a **static, no-build** site (ES modules, deployed on GitHub Pages). Tooling is dev-only.

## Setup
```bash
npm install
npm run dev        # static server on http://localhost:8000
npm run lint       # ESLint (js/)
npm run lint:css   # Stylelint (css/)
npm run typecheck  # TypeScript JSDoc/@ts-check verification
npm run format     # Prettier check
npm test           # Vitest unit tests (tests/unit)
```

## Layout
| Path | Purpose |
|---|---|
| `index.html` + `js/app.js` | Map (core product) |
| `trips.html` + `js/trips/` | Trip database & SQL studio |
| `animation.html` + `js/anim-v2/` | Route animation & video export |
| `wrapped.html` + `js/wrapped/` | Rail Wrapped |
| `privacy.html` + `js/privacy/` | Visibility & privacy manager |
| `docs.html` + `js/docs.js` | Documentation |
| `js/{api,session,cache,state}` | Shared data layer |
| `css/` | Styles per page; `tokens.css` & `base.css` hold shared tokens |

## Conventions
- Reuse design tokens (CSS variables); no hard-coded brand colors.
- No inline `style=""`; no new `window.*` globals - import instead.
- Escape any API-provided text before putting it in `innerHTML`.
- Prefer real icons (SVG) over emoji for UI chrome.
- One commit per logical change; small PRs.
