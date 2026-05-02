// Route Animation module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { hexToRgbArray } from '../utils/color.js';
import { clamp } from '../utils/math.js';
import { buildEndpointKey } from '../utils/format.js';
import { computeRouteLengthKm } from '../utils/geometry.js';
import { computeTripDurationMinutes } from '../utils/time.js';
import { getRouteParticleCount } from '../utils/math.js';

const colorCache = new Map();

function isDensityActive() {
    const state = store.get();
    return !!(state.heatmap.enabled && state.heatmap.overlayFeatureCollection?.features?.length);
}

export { isDensityActive };

export const RouteAnimation = {
    // Configuration
    config: {
        maxRoutes: 80,
        mobileMaxRoutes: 60,
        densityMaxRoutesCap: 260,
        pointsPerRoute: 300,        // Fixed points per route for consistent speed
        updateInterval: 16,         // ~60fps
        lastUpdate: 0,
        colors: {
            nationalExpress: [0, 115, 255],
            national: [0, 238, 255],
            regionalExp: [209, 2, 78],
            regional: [166, 2, 108],
            suburban: [252, 0, 0],
            bus: [35, 132, 67],
            tram: [47, 197, 204],
            subway: [246, 154, 0],
            plane: [80, 80, 80],
            ship: [0, 85, 170],
            unknown: [136, 136, 136],
            default: [255, 255, 255]
        },
        speeds: {
            plane: 2.0, nationalExpress: 1.6, national: 1.4, regionalExp: 1.2,
            regional: 1.0, suburban: 0.9, bus: 0.8, tram: 0.7, subway: 0.6, ship: 0.5, unknown: 1.0
        }
    },
    
    // Pre-computed animation data (computed once when routes change)
    data: {
        routes: null,           // Array of pre-computed route positions
        key: null,              // Cache invalidation key
        routeCount: 0
    },
    
    getDensityRouteCap(isMobileOverride = null) {
        const state = store.get();
        const base = 80;
        const maxCap = this.config.densityMaxRoutesCap || 200;
        const tripCount = state.activeTrips?.length || state.fetchedTrips?.length || 0;
        let scaled = base;
        if (tripCount > 0) {
            const growth = Math.log10(tripCount + 10);
            scaled += Math.floor(growth * 35);
        }
        const isMobile = typeof isMobileOverride === 'boolean' ? isMobileOverride : this.isMobile();
        if (isMobile) {
            scaled = Math.floor(scaled * 0.6);
        }
        return clamp(scaled, base, maxCap);
    },
    
    isMobile() {
        return window.innerWidth <= 768 || 'ontouchstart' in window;
    },
    
    getColor(category) {
        return this.config.colors[category] || this.config.colors.default;
    },
    
    // Interpolate route to exactly N evenly-spaced points
    interpolateToFixedPoints(coords, numPoints) {
        if (coords.length < 2) return null;
        
        // Calculate cumulative distances
        const distances = [0];
        for (let i = 1; i < coords.length; i++) {
            const dx = (coords[i][0] - coords[i-1][0]) * 111320;
            const dy = (coords[i][1] - coords[i-1][1]) * 110540;
            distances.push(distances[i-1] + Math.sqrt(dx*dx + dy*dy));
        }
        
        const totalDist = distances[distances.length - 1];
        if (totalDist < 100) return null; // Skip routes shorter than 100m
        
        // Create evenly spaced points
        const result = new Float32Array(numPoints * 2);
        const step = totalDist / (numPoints - 1);
        
        let coordIdx = 0;
        for (let i = 0; i < numPoints; i++) {
            const targetDist = i * step;
            
            // Find segment containing this distance
            while (coordIdx < distances.length - 2 && distances[coordIdx + 1] < targetDist) {
                coordIdx++;
            }
            
            // Interpolate within segment
            const segStart = distances[coordIdx];
            const segEnd = distances[coordIdx + 1];
            const t = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;
            
            result[i * 2] = coords[coordIdx][0] + (coords[coordIdx + 1][0] - coords[coordIdx][0]) * t;
            result[i * 2 + 1] = coords[coordIdx][1] + (coords[coordIdx + 1][1] - coords[coordIdx][1]) * t;
        }
        
        return result;
    },
    
    // Build all animation data once
    buildAnimationData() {
        const state = store.get();
        if (!isDensityActive()) {
            this.data.routes = [];
            this.data.routeCount = 0;
            this.data.key = null;
            return false;
        }

        const cacheKey = [
            'density-routes',
            state.datasetVersion,
            state.filters.filterLevel,
            state.filters.fromDate || 'null',
            state.filters.toDate || 'null',
            state.layers.order.filter(id => state.layers.data.get(id)?.visible).join('-'),
            state.heatmap.intensity
        ].join('|');
        
        if (this.data.routes && this.data.key === cacheKey) {
            return true;
        }
        
        const pointsPerRoute = this.config.pointsPerRoute;
        const maxRoutes = this.getDensityRouteCap();
        const routeMap = new Map();       // endpoint key -> aggregated route info
        const routeGroupMap = new Map();  // endpoint key -> Map(lineId -> route)
        const buildRouteKey = (feature, categoryId) => {
            const props = feature.properties || {};
            const train = props.train || {};
            const originName = train.origin?.name || train.origin?.station?.name || '';
            const destName = train.destination?.name || train.destination?.station?.name || '';
            const lineName = (train.lineName || train.number || props.statusId || categoryId || 'unknown').toString();
            if (lineName && (originName || destName)) {
                return `${lineName}|${originName}|${destName}`;
            }
            const coords = feature.geometry?.coordinates;
            if (coords?.length >= 2) {
                const start = coords[0];
                const end = coords[coords.length - 1];
                return `${lineName}|${start[0].toFixed(2)},${start[1].toFixed(2)}-${end[0].toFixed(2)},${end[1].toFixed(2)}`;
            }
            return `${lineName}|${props.statusId || Math.random()}`;
        };
        
        state.layers.data.forEach((layer, categoryId) => {
            if (!layer.visible) return;
            const layerColor = hexToRgbArray(layer.color || '#ffffff');
            const categorySpeed = this.config.speeds[categoryId] || 0.9;
            layer.data.features.forEach(feature => {
                const coords = feature.geometry?.coordinates;
                if (!coords || coords.length < 2) return;
                
                const endpointKey = buildEndpointKey(coords);
                if (!endpointKey) return;
                const routeKey = buildRouteKey(feature, categoryId);
                const [lineId] = routeKey.split('|');
                
                const lengthKm = computeRouteLengthKm(coords);
                const train = feature.properties?.train || {};
                const durationMinutes = computeTripDurationMinutes(train);
                const baseCategorySpeed = this.config.speeds[categoryId] || 0.9;
                const lengthFactor = lengthKm ? clamp(250 / lengthKm, 0.4, 1.2) : 1;
                const adjustedSpeed = baseCategorySpeed * lengthFactor;
                
                let endpointGroup = routeGroupMap.get(endpointKey);
                if (!endpointGroup) {
                    endpointGroup = new Map();
                    routeGroupMap.set(endpointKey, endpointGroup);
                }
                
                let existing = endpointGroup.get(lineId);
                if (!existing) {
                    const positions = this.interpolateToFixedPoints(coords, pointsPerRoute);
                    if (!positions) return;
                    existing = {
                        positions,
                        color: layerColor,
                        speed: adjustedSpeed,
                        category: categoryId,
                        usageCount: 0,
                        lineId: lineId || categoryId || 'unknown',
                        endpointKey,
                        lengthKm,
                        particleCount: getRouteParticleCount(lengthKm),
                        durationMinutes
                    };
                    endpointGroup.set(lineId, existing);
                }
                existing.usageCount++;
                if (durationMinutes) {
                    existing.durationMinutes = durationMinutes;
                }
                existing.speed = ((existing.speed || adjustedSpeed) * (existing.usageCount - 1) + adjustedSpeed) / existing.usageCount;
                
                // Track the highest-usage route per endpoint to represent that corridor overall
                const current = routeMap.get(endpointKey);
                if (!current || existing.usageCount > current.usageCount) {
                    routeMap.set(endpointKey, existing);
                }
            });
        });
        
        let routes = Array.from(routeMap.values())
            .filter(route => route.usageCount > 0);
        
        if (!routes.length) {
            this.data.routes = [];
            this.data.routeCount = 0;
            this.data.key = cacheKey;
            return false;
        }
        
        routes.sort((a, b) => b.usageCount - a.usageCount);
        const selectedRoutes = [];
        const perLineLimit = Math.max(2, Math.floor(maxRoutes * 0.2));
        const categoryQuota = Math.max(1, Math.floor(maxRoutes / 6));
        const lineSelections = new Map();
        const categorySelections = new Map();
        const usedRoutes = new Set();
        
        // First pass: enforce per-line limit for fairness
        for (const route of routes) {
            if (selectedRoutes.length >= maxRoutes) break;
            const lineId = route.lineId || route.category || 'unknown';
            const count = lineSelections.get(lineId) || 0;
            if (count >= perLineLimit) continue;
            selectedRoutes.push(route);
            lineSelections.set(lineId, count + 1);
            categorySelections.set(route.category, (categorySelections.get(route.category) || 0) + 1);
            usedRoutes.add(route);
        }
        
        // Second pass: ensure minimum per-category coverage
        for (const route of routes) {
            if (selectedRoutes.length >= maxRoutes) break;
            if (usedRoutes.has(route)) continue;
            const catCount = categorySelections.get(route.category) || 0;
            if (catCount >= categoryQuota) continue;
            selectedRoutes.push(route);
            categorySelections.set(route.category, catCount + 1);
            usedRoutes.add(route);
        }
        
        // Second pass: fill remaining slots (if any) without the per-line cap
        if (selectedRoutes.length < Math.min(maxRoutes, routes.length)) {
            for (const route of routes) {
                if (selectedRoutes.length >= maxRoutes) break;
                if (usedRoutes.has(route)) continue;
                selectedRoutes.push(route);
            }
        }
        
        this.data.routes = selectedRoutes;
        this.data.key = cacheKey;
        this.data.routeCount = selectedRoutes.length;
        
        return selectedRoutes.length > 0;
    },
    
    // Ultra-fast layer creation - just pick positions at current time
    createLayer() {
        if (!this.buildAnimationData() || this.data.routeCount === 0) return null;
        
        const state = store.get();
        const routes = this.data.routes;
        const time = performance.now() / 1000;
        const pointsPerRoute = this.config.pointsPerRoute;
        const zoom = state.map?.getZoom() || 12;
        const isMobile = this.isMobile();
        
        // Size based on zoom
        const baseSize = isMobile ? 20 : 28;
        const sizeMultiplier = Math.pow(1.12, zoom - 12);
        const dotSize = baseSize * Math.min(1.8, Math.max(0.4, sizeMultiplier));
        
        // Pre-allocate particle array (2 particles per route: glow + core)
        const totalParticles = routes.reduce((sum, route) => sum + (route.particleCount || 1), 0);
        const particles = new Array(totalParticles * 2);
        
        let particleIndex = 0;
        for (let i = 0; i < routes.length; i++) {
            const route = routes[i];
            const positions = route.positions;
            const segments = Math.max(1, route.particleCount || 1);
            let color = route.color;
            if (!color) {
                const cKey = route.category || 'default';
                if (colorCache.has(cKey)) {
                    color = colorCache.get(cKey);
                } else {
                    color = hexToRgbArray(state.layers.data.get(route.category)?.color || '#ffffff');
                    colorCache.set(cKey, color);
                }
            }
            
            for (let segment = 0; segment < segments; segment++) {
                const segmentPhase = (segment / segments) * 0.5;
                const speed = route.speed * 0.3;
                const phase = i * 0.1 + segmentPhase;
                const rawT = ((time * speed + phase) % 2);
                const t = rawT <= 1 ? rawT : 2 - rawT;
                
                const idx = Math.min(Math.floor(t * (pointsPerRoute - 1)), pointsPerRoute - 2);
                const frac = (t * (pointsPerRoute - 1)) - idx;
                const idx2 = idx * 2;
                const x = positions[idx2] + (positions[idx2 + 2] - positions[idx2]) * frac;
                const y = positions[idx2 + 1] + (positions[idx2 + 3] - positions[idx2 + 1]) * frac;
                
                particles[particleIndex * 2] = {
                    position: [x, y],
                    radius: dotSize * 1.8,
                    color: [color[0], color[1], color[2], 50]
                };
                
                particles[particleIndex * 2 + 1] = {
                    position: [x, y],
                    radius: dotSize,
                    color: [color[0], color[1], color[2], 255]
                };
                
                particleIndex++;
            }
        }
        
        return [new deck.ScatterplotLayer({
            id: 'animated-routes',
            data: particles,
            getPosition: d => d.position,
            getRadius: d => d.radius,
            getFillColor: d => d.color,
            opacity: 1,
            radiusMinPixels: 2,
            radiusMaxPixels: 25,
            pickable: false,
            updateTriggers: { getPosition: time },
            parameters: { depthTest: false }
        })];
    },
    
    start() {
        const state = store.get();
        if (!isDensityActive()) {
            this.stop();
            return;
        }
        if (state.heatmap.animationFrameId) return;
        this.animate();
    },
    
    stop() {
        const state = store.get();
        if (state.heatmap.animationFrameId) {
            cancelAnimationFrame(state.heatmap.animationFrameId);
            state.heatmap.animationFrameId = null;
        }
        state.deckLayers = state.deckLayers.filter(l => !l.id.startsWith('animated-routes'));
        if (state.deck?.setProps) {
            state.deck.setProps({ layers: state.deckLayers });
        }
    },
    
    animate() {
        const state = store.get();
        if (!state.heatmap.enabled || !state.heatmap.animate || !isDensityActive()) {
            this.stop();
            return;
        }
        
        if (document.hidden) {
            state.heatmap.animationFrameId = requestAnimationFrame(() => this.animate());
            return;
        }
        
        const now = performance.now();
        if (now - this.config.lastUpdate < this.config.updateInterval) {
            state.heatmap.animationFrameId = requestAnimationFrame(() => this.animate());
            return;
        }
        this.config.lastUpdate = now;
        
        const layers = this.createLayer();
        if (layers) {
            state.deckLayers = state.deckLayers.filter(l => !l.id.startsWith('animated-routes'));
            state.deckLayers.push(...layers);
            if (state.deck?.setProps) {
                state.deck.setProps({ layers: state.deckLayers });
            }
        }
        
        state.heatmap.animationFrameId = requestAnimationFrame(() => this.animate());
    },
    
    invalidateCache() {
        this.data.routes = null;
        this.data.key = null;
    }
};
