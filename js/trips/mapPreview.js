/**
 * Lightweight, High-Performance Spatial Map Preview for Träwelling Trips Explorer & Database Studio
 * Zero external runtime dependencies, Retina/HiDPI responsive canvas, vector culling, pan & zoom.
 */

import { CONFIG } from '../config/config.js';
import { escapeHtml } from '../utils/format.js';
import { VECTOR_COUNTRIES } from '../animation/vectorData.js';
import { extractCoordinatesFromGeoJSON } from '../animation/geometry.js';

// Pre-index transport category colors from CONFIG for instant lookup
const CATEGORY_COLORS = new Map(CONFIG.LAYER_CONFIG || []);
const DEFAULT_ROUTE_COLOR = '#38bdf8';

// Pre-compute bounding boxes for European countries to cull offscreen vector polygons
const COUNTRY_BOUNDS = (VECTOR_COUNTRIES || []).map(country => {
    const geom = country.geometry;
    if (!geom) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : (geom.type === 'MultiPolygon' ? geom.coordinates : []);
    for (const rings of polys) {
        const ring = rings[0];
        if (!ring) continue;
        for (let i = 0; i < ring.length; i++) {
            const [x, y] = ring[i];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return {
        id: country.id,
        name: country.name,
        minX, maxX, minY, maxY,
        polys
    };
}).filter(Boolean);

const COUNTRY_CENTROIDS = [
    { name: 'GERMANY', lon: 10.45, lat: 51.16 },
    { name: 'AUSTRIA', lon: 14.30, lat: 47.60 },
    { name: 'SWITZERLAND', lon: 8.22, lat: 46.85 },
    { name: 'NETHERLANDS', lon: 5.29, lat: 52.13 },
    { name: 'BELGIUM', lon: 4.46, lat: 50.50 },
    { name: 'FRANCE', lon: 2.80, lat: 48.50 },
    { name: 'CZECHIA', lon: 15.47, lat: 49.81 },
    { name: 'DENMARK', lon: 9.50, lat: 55.67 },
    { name: 'POLAND', lon: 19.14, lat: 52.10 }
];

export class SpatialMapPreview {
    constructor(canvasId = 'spatialSqlCanvas', containerId = 'spatialSqlPanel') {
        this.canvasId = canvasId;
        this.containerId = containerId;

        this.canvas = null;
        this.ctx = null;
        this.wrap = null;
        this.badge = null;
        this.tooltip = null;
        this.openMapBtn = null;

        // View & Navigation State
        this.pan = { x: 0, y: 0 };
        this.zoom = 1.0;
        this.baseScale = 1.0;
        this.centerLon = 10.5;
        this.centerLat = 51.2;
        this.cosLat = 0.62;

        // Data & Spatial Feature State
        this.stations = [];
        this.routes = [];
        this.renderedPoints = [];
        this.renderedRoutes = [];
        this.hoveredFeature = null;

        // Station coordinate index (name -> {lat, lon, id})
        this.stationIndex = new Map();

        // Dragging & Interaction State
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.lastPan = { x: 0, y: 0 };
        this.listenersAttached = false;
        this.resizeObserver = null;
        this.activeUser = '';
    }

    /**
     * Bind DOM elements and attach responsive event listeners
     */
    init(activeUser = '') {
        this.activeUser = activeUser;
        this.canvas = document.getElementById(this.canvasId);
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.wrap = this.canvas.parentElement;
        this.badge = document.getElementById('spatialSqlBadge');
        this.tooltip = document.getElementById('spatialSqlTooltip');
        this.openMapBtn = document.getElementById('spatialOpenMapBtn');

        if (!this.listenersAttached) {
            this.attachEventListeners();
            this.listenersAttached = true;
        }

        if (window.ResizeObserver && this.wrap && !this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.isVisible()) {
                    this.resizeAndDraw();
                }
            });
            this.resizeObserver.observe(this.wrap);
        }
    }

    isVisible() {
        const panel = document.getElementById(this.containerId);
        return panel && panel.style.display !== 'none';
    }

    /**
     * Index station coordinates from SessionDB stations and raw trips for fast name-based lookup
     */
    indexStations(trips = [], stations = []) {
        this.stationIndex.clear();

        // 1. Relational stations store
        for (const s of stations) {
            const lat = Number(s.latitude);
            const lon = Number(s.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
                const entry = { id: String(s.id || ''), name: s.name || '', lat, lon };
                if (s.id) this.stationIndex.set(String(s.id).toLowerCase(), entry);
                if (s.name) this.stationIndex.set(String(s.name).toLowerCase().trim(), entry);
            }
        }

        // 2. Extracted station coordinates from trips
        for (const t of trips) {
            const train = t.train || t.checkin || t.properties?.train || t.properties?.checkin || {};
            const orig = train.origin?.station || train.origin || t.origin || {};
            const dest = train.destination?.station || train.destination || t.destination || {};

            const oLat = Number(orig.latitude ?? orig.lat);
            const oLon = Number(orig.longitude ?? orig.lng ?? orig.lon);
            if (Number.isFinite(oLat) && Number.isFinite(oLon) && (oLat !== 0 || oLon !== 0)) {
                const entry = { id: String(orig.id || ''), name: orig.name || '', lat: oLat, lon: oLon };
                if (orig.id) this.stationIndex.set(String(orig.id).toLowerCase(), entry);
                if (orig.name) this.stationIndex.set(String(orig.name).toLowerCase().trim(), entry);
            }

            const dLat = Number(dest.latitude ?? dest.lat);
            const dLon = Number(dest.longitude ?? dest.lng ?? dest.lon);
            if (Number.isFinite(dLat) && Number.isFinite(dLon) && (dLat !== 0 || dLon !== 0)) {
                const entry = { id: String(dest.id || ''), name: dest.name || '', lat: dLat, lon: dLon };
                if (dest.id) this.stationIndex.set(String(dest.id).toLowerCase(), entry);
                if (dest.name) this.stationIndex.set(String(dest.name).toLowerCase().trim(), entry);
            }

            const stopovers = train.stopovers || t.stopovers || [];
            if (Array.isArray(stopovers)) {
                for (const st of stopovers) {
                    const s = st.station || st;
                    const sLat = Number(s.latitude ?? s.lat);
                    const sLon = Number(s.longitude ?? s.lng ?? s.lon);
                    if (Number.isFinite(sLat) && Number.isFinite(sLon) && (sLat !== 0 || sLon !== 0)) {
                        const entry = { id: String(s.id || ''), name: s.name || '', lat: sLat, lon: sLon };
                        if (s.id) this.stationIndex.set(String(s.id).toLowerCase(), entry);
                        if (s.name) this.stationIndex.set(String(s.name).toLowerCase().trim(), entry);
                    }
                }
            }
        }
    }

    /**
     * Ingest either SQL query result or standard explorer filtered trips
     */
    updateData({ sqlQueryResult = null, trips = [], activeUser = '' } = {}) {
        if (activeUser) this.activeUser = activeUser;
        this.stations = [];
        this.routes = [];

        const rows = sqlQueryResult?.rows || [];
        const isStationsQuery = sqlQueryResult?.table === 'stations' || (rows.length > 0 && rows.some(r => r.latitude !== undefined && r.longitude !== undefined));
        const rawTrips = sqlQueryResult?.rawTrips?.length ? sqlQueryResult.rawTrips : (sqlQueryResult ? [] : trips);

        if (isStationsQuery) {
            rows.forEach((r, idx) => {
                const lat = Number(r.latitude);
                const lon = Number(r.longitude);
                if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
                    this.stations.push({
                        id: String(r.id || ''),
                        name: String(r.name || r.id || `Station #${idx + 1}`),
                        lat,
                        lon,
                        countryCode: r.country_code || '',
                        rowIdx: idx
                    });
                }
            });
        } else if (sqlQueryResult?.table === 'routes') {
            rows.forEach((r, idx) => {
                const origStn = this.stationIndex.get(String(r.origin_station_id || r.origin_station || '').toLowerCase());
                const destStn = this.stationIndex.get(String(r.destination_station_id || r.destination_station || '').toLowerCase());
                const cat = r.category || 'unknown';
                const color = CATEGORY_COLORS.get(cat) || DEFAULT_ROUTE_COLOR;

                if (origStn && destStn) {
                    this.routes.push({
                        coords: [[origStn.lon, origStn.lat], [destStn.lon, destStn.lat]],
                        label: `${r.line_name || 'Route'}: ${origStn.name} → ${destStn.name}`,
                        line: r.line_name || 'Route',
                        category: cat,
                        color,
                        rowIdx: idx
                    });
                    this.stations.push({ ...origStn, rowIdx: idx });
                    this.stations.push({ ...destStn, rowIdx: idx });
                }
            });
        } else if (sqlQueryResult?.table === 'statuses') {
            rows.forEach((r, idx) => {
                const origStn = this.stationIndex.get(String(r.origin_id || '').toLowerCase());
                const destStn = this.stationIndex.get(String(r.destination_id || '').toLowerCase());
                const delay = Number(r.departure_delay || 0);

                if (origStn && destStn) {
                    this.routes.push({
                        coords: [[origStn.lon, origStn.lat], [destStn.lon, destStn.lat]],
                        label: `Status #${r.id}: ${origStn.name} → ${destStn.name} (+${delay} min)`,
                        line: `Check-in #${r.id}`,
                        category: 'unknown',
                        color: delay > 15 ? '#ef4444' : '#38bdf8',
                        rowIdx: idx
                    });
                    this.stations.push({ ...origStn, rowIdx: idx });
                    this.stations.push({ ...destStn, rowIdx: idx });
                }
            });
        } else {
            // General Trips (from sqlQueryResult trips table or standard explorer filtered trips)
            const targetList = (rows.length > 0 && sqlQueryResult?.table === 'trips') ? rows : rawTrips;

            targetList.forEach((t, idx) => {
                const raw = t._rawTrip || t;
                const train = raw.train || raw.checkin || raw.properties?.train || raw.properties?.checkin || {};
                const origObj = train.origin?.station || train.origin || raw.origin || {};
                const destObj = train.destination?.station || train.destination || raw.destination || {};

                // Look up station coordinates directly or fall back to station index
                let oLat = Number(origObj.latitude ?? origObj.lat);
                let oLon = Number(origObj.longitude ?? origObj.lng ?? origObj.lon);
                let oName = origObj.name || t.origin || 'Origin';
                if (!Number.isFinite(oLat) || !Number.isFinite(oLon)) {
                    const found = this.stationIndex.get(String(oName).toLowerCase().trim());
                    if (found) { oLat = found.lat; oLon = found.lon; oName = found.name; }
                }

                let dLat = Number(destObj.latitude ?? destObj.lat);
                let dLon = Number(destObj.longitude ?? destObj.lng ?? destObj.lon);
                let dName = destObj.name || t.destination || 'Destination';
                if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) {
                    const found = this.stationIndex.get(String(dName).toLowerCase().trim());
                    if (found) { dLat = found.lat; dLon = found.lon; dName = found.name; }
                }

                const cat = t.category || raw.category || train.category || 'unknown';
                const color = CATEGORY_COLORS.get(cat) || DEFAULT_ROUTE_COLOR;
                const lineName = t.line || train.lineName || train.number || train.name || 'Trip';

                // Polyline extraction
                const poly = train.polyline || raw.polyline || raw.geometry;
                const extracted = extractCoordinatesFromGeoJSON(poly);

                if (extracted.length >= 2) {
                    this.routes.push({
                        coords: extracted,
                        label: `${lineName}: ${oName} → ${dName}`,
                        line: lineName,
                        category: cat,
                        color,
                        distanceKm: t.distance_km || train.distance,
                        rowIdx: idx
                    });
                } else if (Number.isFinite(oLat) && Number.isFinite(oLon) && Number.isFinite(dLat) && Number.isFinite(dLon)) {
                    this.routes.push({
                        coords: [[oLon, oLat], [dLon, dLat]],
                        label: `${lineName}: ${oName} → ${dName}`,
                        line: lineName,
                        category: cat,
                        color,
                        distanceKm: t.distance_km || train.distance,
                        rowIdx: idx
                    });
                }

                if (Number.isFinite(oLat) && Number.isFinite(oLon)) {
                    this.stations.push({ id: String(origObj.id || ''), name: oName, lat: oLat, lon: oLon, rowIdx: idx });
                }
                if (Number.isFinite(dLat) && Number.isFinite(dLon)) {
                    this.stations.push({ id: String(destObj.id || ''), name: dName, lat: dLat, lon: dLon, rowIdx: idx });
                }
            });
        }

        // Deduplicate stations for drawing
        const seenStations = new Set();
        this.stations = this.stations.filter(s => {
            const key = `${s.name}_${s.lat.toFixed(3)}_${s.lon.toFixed(3)}`;
            if (seenStations.has(key)) return false;
            seenStations.add(key);
            return true;
        });

        // Reset pan & zoom to fit new data
        this.resetView();
        this.resizeAndDraw();
    }

    /**
     * Compute bounding box and center coordinates to automatically fit all features
     */
    resetView() {
        this.pan = { x: 0, y: 0 };
        this.zoom = 1.0;

        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;

        for (const s of this.stations) {
            if (s.lon < minLon) minLon = s.lon;
            if (s.lon > maxLon) maxLon = s.lon;
            if (s.lat < minLat) minLat = s.lat;
            if (s.lat > maxLat) maxLat = s.lat;
        }

        for (const r of this.routes) {
            for (const [lon, lat] of r.coords) {
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }
        }

        const hasData = Number.isFinite(minLon) && Number.isFinite(minLat);

        if (!hasData) {
            // Default European geographic view
            minLon = 6.0; maxLon = 15.0; minLat = 47.0; maxLat = 55.0;
        } else {
            // Ensure minimum bounding span so single stations don't zoom to infinity
            if (maxLon - minLon < 0.25) { minLon -= 0.35; maxLon += 0.35; }
            if (maxLat - minLat < 0.25) { minLat -= 0.25; maxLat += 0.25; }
        }

        this.bounds = { minLon, maxLon, minLat, maxLat };
        this.centerLon = (minLon + maxLon) / 2;
        this.centerLat = (minLat + maxLat) / 2;
        this.cosLat = Math.max(0.2, Math.cos((this.centerLat * Math.PI) / 180));

        this.updateBadgeAndLinks();
    }

    updateBadgeAndLinks() {
        const count = this.stations.length ? this.stations.length : this.routes.length;
        const type = this.stations.length ? 'stations' : 'routes';

        if (this.badge) {
            if (count > 0 && this.bounds) {
                this.badge.textContent = `${count} spatial ${type} • ${this.bounds.minLat.toFixed(1)}°N–${this.bounds.maxLat.toFixed(1)}°N, ${this.bounds.minLon.toFixed(1)}°E–${this.bounds.maxLon.toFixed(1)}°E`;
            } else {
                this.badge.textContent = `0 spatial features`;
            }
        }

        if (this.openMapBtn) {
            const user = this.activeUser ? `user=${encodeURIComponent(this.activeUser)}` : '';
            const zoomEst = Math.max(4, Math.min(12, Math.round(9 - Math.log2(Math.max(0.1, (this.bounds?.maxLat || 52) - (this.bounds?.minLat || 50))))));
            const hash = `#map=${zoomEst}/${this.centerLat.toFixed(4)}/${this.centerLon.toFixed(4)}`;
            this.openMapBtn.href = `index.html${user ? '?' + user : ''}${hash}`;
        }
    }

    /**
     * Crisp Retina/HiDPI display scaling
     */
    resizeAndDraw() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const w = Math.round(rect.width) || 900;
        const h = Math.round(rect.height) || 260;

        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
        }

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw(w, h);
    }

    /**
     * Render spatial canvas scene
     */
    draw(w, h) {
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.clearRect(0, 0, w, h);

        const hasFeatures = this.stations.length > 0 || this.routes.length > 0;
        if (!hasFeatures) {
            ctx.fillStyle = '#64748b';
            ctx.font = '13px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('No geographic coordinates found in current view.', w / 2, h / 2 - 10);
            ctx.fillStyle = '#475569';
            ctx.font = '11px system-ui, -apple-system, sans-serif';
            ctx.fillText('Select a query recipe above or run a query returning stations or routes.', w / 2, h / 2 + 12);
            return;
        }

        const padX = 36;
        const padY = 24;
        const drawW = w - 2 * padX;
        const drawH = h - 2 * padY;

        const spanLon = (this.bounds.maxLon - this.bounds.minLon) * this.cosLat;
        const spanLat = (this.bounds.maxLat - this.bounds.minLat);
        this.baseScale = Math.min(drawW / Math.max(0.0001, spanLon), drawH / Math.max(0.0001, spanLat));

        const effectiveScale = this.baseScale * this.zoom;
        const projectX = (lon) => (w / 2) + this.pan.x + (lon - this.centerLon) * this.cosLat * effectiveScale;
        const projectY = (lat) => (h / 2) + this.pan.y - (lat - this.centerLat) * effectiveScale;

        // Viewport bounds in geographic degrees for culling
        const viewMinLon = this.centerLon + (-w / 2 - this.pan.x) / (this.cosLat * effectiveScale);
        const viewMaxLon = this.centerLon + (w / 2 - this.pan.x) / (this.cosLat * effectiveScale);
        const viewMinLat = this.centerLat - (h / 2 - this.pan.y) / effectiveScale;
        const viewMaxLat = this.centerLat - (-h / 2 - this.pan.y) / effectiveScale;

        // 1. Subtle Cartographic Graticule Grid
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;

        // Round grid steps (1°, 2°, or 5°)
        const gridStep = Math.max(1, Math.round(5 / this.zoom));
        const startLon = Math.floor(viewMinLon / gridStep) * gridStep;
        const startLat = Math.floor(viewMinLat / gridStep) * gridStep;

        ctx.font = '9px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.textAlign = 'left';

        for (let gLon = startLon; gLon <= viewMaxLon; gLon += gridStep) {
            const gx = projectX(gLon);
            if (gx >= 0 && gx <= w) {
                ctx.beginPath();
                ctx.moveTo(gx, 0);
                ctx.lineTo(gx, h);
                ctx.stroke();
                ctx.fillText(`${gLon.toFixed(0)}°E`, gx + 4, h - 8);
            }
        }

        for (let gLat = startLat; gLat <= viewMaxLat; gLat += gridStep) {
            const gy = projectY(gLat);
            if (gy >= 0 && gy <= h) {
                ctx.beginPath();
                ctx.moveTo(0, gy);
                ctx.lineTo(w, gy);
                ctx.stroke();
                ctx.fillText(`${gLat.toFixed(0)}°N`, 6, gy - 4);
            }
        }
        ctx.restore();

        // 2. High-Performance European Vector Borders (Culled)
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 1;

        for (const country of COUNTRY_BOUNDS) {
            // Skip country if its bounding box does not intersect visible viewport
            if (country.maxX < viewMinLon || country.minX > viewMaxLon || country.maxY < viewMinLat || country.minY > viewMaxLat) {
                continue;
            }

            for (const rings of country.polys) {
                const ring = rings[0];
                if (!ring || ring.length < 3) continue;

                ctx.beginPath();
                for (let i = 0; i < ring.length; i++) {
                    const cx = projectX(ring[i][0]);
                    const cy = projectY(ring[i][1]);
                    if (i === 0) ctx.moveTo(cx, cy);
                    else ctx.lineTo(cx, cy);
                }
                ctx.stroke();
            }
        }

        // Subtle Country Watermarks
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const c of COUNTRY_CENTROIDS) {
            const cx = projectX(c.lon);
            const cy = projectY(c.lat);
            if (cx >= 30 && cx <= w - 30 && cy >= 20 && cy <= h - 20) {
                ctx.fillText(c.name, cx, cy);
            }
        }
        ctx.restore();

        // 3. Render Transit Routes
        this.renderedRoutes = [];
        this.routes.forEach((route, idx) => {
            if (!route.coords.length) return;

            const isHovered = this.hoveredFeature?.type === 'route' && this.hoveredFeature.idx === idx;
            const routeColor = route.color || DEFAULT_ROUTE_COLOR;

            // Outer glow
            ctx.beginPath();
            ctx.strokeStyle = isHovered ? '#ffffff' : routeColor;
            ctx.globalAlpha = isHovered ? 0.6 : 0.28;
            ctx.lineWidth = isHovered ? 6 : 3.6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            route.coords.forEach(([lon, lat], i) => {
                const px = projectX(lon);
                const py = projectY(lat);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();

            // Core line
            ctx.beginPath();
            ctx.strokeStyle = routeColor;
            ctx.globalAlpha = isHovered ? 1.0 : 0.85;
            ctx.lineWidth = isHovered ? 2.8 : 1.8;
            route.coords.forEach(([lon, lat], i) => {
                const px = projectX(lon);
                const py = projectY(lat);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            this.renderedRoutes.push({
                ...route,
                idx,
                screenCoords: route.coords.map(([lon, lat]) => [projectX(lon), projectY(lat)])
            });
        });

        // 4. Render Station Points
        this.renderedPoints = [];
        this.stations.forEach((station, idx) => {
            const px = projectX(station.lon);
            const py = projectY(station.lat);

            // Skip drawing off-canvas stations
            if (px < -20 || px > w + 20 || py < -20 || py > h + 20) return;

            const isHovered = this.hoveredFeature?.type === 'station' && this.hoveredFeature.idx === idx;
            this.renderedPoints.push({ x: px, y: py, ...station, idx });

            // Outer soft aura
            ctx.beginPath();
            ctx.arc(px, py, isHovered ? 9 : 5.5, 0, Math.PI * 2);
            ctx.fillStyle = isHovered ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.22)';
            ctx.fill();

            // Inner core dot
            ctx.beginPath();
            ctx.arc(px, py, isHovered ? 4.5 : 2.8, 0, Math.PI * 2);
            ctx.fillStyle = '#38bdf8';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // 5. Smart Station Labels (When stations <= 20 or hovered)
        if (this.renderedPoints.length > 0 && (this.renderedPoints.length <= 20 || this.hoveredFeature?.type === 'station')) {
            ctx.save();
            ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.textBaseline = 'middle';

            const toLabel = (this.renderedPoints.length <= 20)
                ? this.renderedPoints
                : this.renderedPoints.filter(p => this.hoveredFeature?.type === 'station' && p.idx === this.hoveredFeature.idx);

            toLabel.forEach(p => {
                const text = p.name || 'Station';
                const truncated = text.length > 18 ? text.slice(0, 17) + '…' : text;
                const metrics = ctx.measureText(truncated);
                const pillW = metrics.width + 10;
                const pillH = 16;
                const pillX = p.x + 8;
                const pillY = p.y - 8;

                ctx.fillStyle = 'rgba(10, 14, 26, 0.90)';
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
                ctx.lineWidth = 1;

                if (typeof ctx.roundRect === 'function') {
                    ctx.beginPath();
                    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
                    ctx.fill();
                    ctx.stroke();
                } else {
                    ctx.fillRect(pillX, pillY, pillW, pillH);
                    ctx.strokeRect(pillX, pillY, pillW, pillH);
                }

                ctx.fillStyle = '#f8fafc';
                ctx.fillText(truncated, pillX + 5, p.y);
            });
            ctx.restore();
        }
    }

    /**
     * Mouse, wheel, and touch event handling for seamless pan & zoom navigation
     */
    attachEventListeners() {
        const canvas = this.canvas;
        if (!canvas) return;

        // Zoom via mouse wheel
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const effectiveScale = this.baseScale * this.zoom;
            const cursorLon = this.centerLon + (mx - w / 2 - this.pan.x) / (this.cosLat * effectiveScale);
            const cursorLat = this.centerLat - (my - h / 2 - this.pan.y) / effectiveScale;

            const factor = e.deltaY < 0 ? 1.18 : 0.85;
            const nextZoom = Math.max(0.5, Math.min(30, this.zoom * factor));

            const nextEffectiveScale = this.baseScale * nextZoom;
            this.pan.x = mx - w / 2 - (cursorLon - this.centerLon) * this.cosLat * nextEffectiveScale;
            this.pan.y = my - h / 2 + (cursorLat - this.centerLat) * nextEffectiveScale;
            this.zoom = nextZoom;

            this.draw(w, h);
        }, { passive: false });

        // Pan via drag
        canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.lastPan = { ...this.pan };
            canvas.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.pan.x = this.lastPan.x + (e.clientX - this.dragStart.x);
                this.pan.y = this.lastPan.y + (e.clientY - this.dragStart.y);
                const rect = canvas.getBoundingClientRect();
                this.draw(rect.width, rect.height);
                return;
            }

            if (!this.isVisible()) return;

            // Hover hit detection
            const rect = canvas.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                if (this.tooltip) this.tooltip.style.display = 'none';
                if (this.hoveredFeature) {
                    this.hoveredFeature = null;
                    this.draw(rect.width, rect.height);
                }
                return;
            }

            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // 1. Check station points
            const hitStation = this.renderedPoints.find(p => Math.hypot(p.x - mx, p.y - my) <= 10);
            if (hitStation) {
                canvas.style.cursor = 'pointer';
                if (this.hoveredFeature?.idx !== hitStation.idx || this.hoveredFeature?.type !== 'station') {
                    this.hoveredFeature = { type: 'station', idx: hitStation.idx };
                    this.draw(rect.width, rect.height);
                }
                this.showTooltip(hitStation.x, hitStation.y, `<strong>${escapeHtml(hitStation.name)}</strong><br><span style="color:#94a3b8;font-size:10px;">${hitStation.lat.toFixed(4)}°N, ${hitStation.lon.toFixed(4)}°E</span>`);
                return;
            }

            // 2. Check route segments
            let hitRoute = null;
            for (const r of this.renderedRoutes) {
                for (let i = 1; i < r.screenCoords.length; i++) {
                    const [x1, y1] = r.screenCoords[i - 1];
                    const [x2, y2] = r.screenCoords[i];
                    if (distToSegment(mx, my, x1, y1, x2, y2) <= 6) {
                        hitRoute = r;
                        break;
                    }
                }
                if (hitRoute) break;
            }

            if (hitRoute) {
                canvas.style.cursor = 'pointer';
                if (this.hoveredFeature?.idx !== hitRoute.idx || this.hoveredFeature?.type !== 'route') {
                    this.hoveredFeature = { type: 'route', idx: hitRoute.idx };
                    this.draw(rect.width, rect.height);
                }
                const distText = hitRoute.distanceKm ? ` • ${Math.round(hitRoute.distanceKm)} km` : '';
                this.showTooltip(mx, my, `<strong>${escapeHtml(hitRoute.label)}</strong><br><span style="color:#38bdf8;font-size:10px;">${escapeHtml(hitRoute.category)}${distText}</span>`);
                return;
            }

            canvas.style.cursor = 'crosshair';
            if (this.tooltip) this.tooltip.style.display = 'none';
            if (this.hoveredFeature) {
                this.hoveredFeature = null;
                this.draw(rect.width, rect.height);
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                canvas.style.cursor = 'crosshair';
            }
        });

        // Double click to reset
        canvas.addEventListener('dblclick', () => {
            this.resetView();
            const rect = canvas.getBoundingClientRect();
            this.draw(rect.width, rect.height);
        });

        // Click on feature scrolls matching row into view
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const hitStation = this.renderedPoints.find(p => Math.hypot(p.x - mx, p.y - my) <= 12);
            const rowIdx = hitStation ? hitStation.rowIdx : (this.hoveredFeature?.type === 'route' ? this.renderedRoutes[this.hoveredFeature.idx]?.rowIdx : null);

            if (rowIdx !== null && rowIdx !== undefined) {
                const targetRow = document.querySelector(`#tripsTableBody tr:nth-child(${rowIdx + 1})`);
                if (targetRow) {
                    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetRow.style.outline = '2px solid #38bdf8';
                    targetRow.style.backgroundColor = 'rgba(56, 189, 248, 0.15)';
                    setTimeout(() => {
                        targetRow.style.outline = '';
                        targetRow.style.backgroundColor = '';
                    }, 2000);
                }
            }
        });

        // Floating zoom control buttons
        const zoomInBtn = document.getElementById('spatialZoomInBtn');
        const zoomOutBtn = document.getElementById('spatialZoomOutBtn');
        const zoomResetBtn = document.getElementById('spatialResetBtn');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.zoom = Math.min(30, this.zoom * 1.35);
                const rect = canvas.getBoundingClientRect();
                this.draw(rect.width, rect.height);
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.zoom = Math.max(0.4, this.zoom / 1.35);
                const rect = canvas.getBoundingClientRect();
                this.draw(rect.width, rect.height);
            });
        }

        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.resetView();
                const rect = canvas.getBoundingClientRect();
                this.draw(rect.width, rect.height);
            });
        }
    }

    showTooltip(x, y, html) {
        if (!this.tooltip || !this.wrap) return;
        this.tooltip.style.display = 'block';
        this.tooltip.innerHTML = html;

        const wrapRect = this.wrap.getBoundingClientRect();
        const tipRect = this.tooltip.getBoundingClientRect();

        let posX = x + 12;
        let posY = y - tipRect.height - 8;

        if (posX + tipRect.width > wrapRect.width - 10) {
            posX = x - tipRect.width - 12;
        }
        if (posY < 8) {
            posY = y + 16;
        }

        this.tooltip.style.left = `${Math.round(posX)}px`;
        this.tooltip.style.top = `${Math.round(posY)}px`;
    }
}

// Distance from point to line segment
function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Global singleton instance for database explorer
export const spatialPreviewEngine = new SpatialMapPreview();

