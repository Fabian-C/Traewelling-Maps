// Layer management module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { refreshActiveTrips } from '../fetch/orchestrator.js';
import * as dataProcessing from '../data/processing.js';
import { normalizeCategory } from '../data/processing.js';
import * as heatmap from '../map/heatmap.js';
import { updateRouteDensity } from '../map/heatmap.js';
import { updateAllStatistics as updateAllStats } from '../analytics/statistics.js';
import { invalidateDelayOverlayCache, updateDelayOverlay, updateDelayOverlaySummary } from '../map/delayOverlay.js';

export const CATEGORY_NAMES = {
    nationalExpress: 'ICE / TGV',
    national: 'IC / EC',
    regionalExp: 'RE',
    regional: 'RB',
    suburban: 'S-Bahn',
    bus: 'Bus',
    tram: 'Tram',
    subway: 'U-Bahn',
    taxi: 'Taxi',
    plane: 'Flight',
    ferry: 'Ferry',
    ship: 'Ferry',
    unknown: 'Other'
};

export const CATEGORY_FULL_NAMES = {
    nationalExpress: 'High Speed (ICE / TGV)',
    national: 'Intercity (IC / EC)',
    regionalExp: 'Regional-Express (RE)',
    regional: 'Regionalbahn (RB)',
    suburban: 'Suburban Rail (S-Bahn)',
    bus: 'Bus Services',
    tram: 'Tram / Streetcar',
    subway: 'Subway / Metro (U-Bahn)',
    taxi: 'Taxi / Rideshare',
    plane: 'Flight / Aviation',
    ferry: 'Ferry / Ship',
    ship: 'Ferry / Ship',
    unknown: 'Other / Unknown'
};

/**
 * Populate and render the transport layers in the menu
 */
export function loadLayers() {
    const state = store.get();
    const layerList = document.getElementById('layerList');
    if (!layerList) {
        console.warn('Layer list not found in DOM, retrying...');
        setTimeout(loadLayers, 150);
        return;
    }

    // Restore persisted layer order from localStorage if available
    try {
        const savedOrderJson = localStorage.getItem('tw_layer_order');
        if (savedOrderJson) {
            const parsedOrder = JSON.parse(savedOrderJson);
            if (Array.isArray(parsedOrder) && parsedOrder.length > 0) {
                // Ensure unique values and valid format
                const uniqueSaved = [...new Set(parsedOrder.filter(id => typeof id === 'string'))];
                if (uniqueSaved.length > 0) {
                    state.layers.order = uniqueSaved;
                }
            }
        }
    } catch (e) {
        console.warn('Failed to parse tw_layer_order from localStorage:', e);
    }

    // Migrate legacy 'ship' layer to 'ferry' if present
    if (state.layers.order.includes('ship')) {
        state.layers.order = state.layers.order.map(id => id === 'ship' ? 'ferry' : id);
    }

    // Ensure all layers from CONFIG.LAYER_CONFIG exist in state.layers.order
    CONFIG.LAYER_CONFIG.forEach(([id]) => {
        if (!state.layers.order.includes(id)) {
            const unknownIdx = state.layers.order.indexOf('unknown');
            if (unknownIdx !== -1) {
                state.layers.order.splice(unknownIdx + 1, 0, id);
            } else {
                state.layers.order.push(id);
            }
        }
    });

    // Ensure state.layers.data has entries for all categories in state.layers.order
    state.layers.order.forEach((layerId) => {
        if (!state.layers.data.has(layerId)) {
            const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
            const color = config ? config[1] : '#888888';
            state.layers.data.set(layerId, {
                data: { type: 'FeatureCollection', features: [] },
                color: color,
                visible: true
            });
        }
    });

    // Clear existing layer items
    layerList.innerHTML = '';

    // Drag-and-drop state
    let draggedItem = null;
    let suppressClickUntil = 0;

    const clearDropIndicators = () => {
        layerList.querySelectorAll('.layer-item').forEach(item => {
            item.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
            delete item.dataset.dropPosition;
        });
    };

    const applyDropIndicator = (item, position) => {
        clearDropIndicators();
        item.classList.add('drag-over');
        if (position === 'before') {
            item.classList.add('drag-over-before');
            item.dataset.dropPosition = 'before';
        } else {
            item.classList.add('drag-over-after');
            item.dataset.dropPosition = 'after';
        }
    };

    const computeDropPosition = (clientY, item) => {
        const rect = item.getBoundingClientRect();
        const offset = clientY - rect.top;
        return offset < rect.height / 2 ? 'before' : 'after';
    };

    const performReorder = (draggedLayerId, targetLayerId, dropPosition) => {
        if (!draggedLayerId || !targetLayerId || draggedLayerId === targetLayerId) return;

        const draggedIndex = state.layers.order.indexOf(draggedLayerId);
        const targetIndex = state.layers.order.indexOf(targetLayerId);
        if (draggedIndex === -1 || targetIndex === -1) return;

        let insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;

        state.layers.order.splice(draggedIndex, 1);
        if (draggedIndex < insertIndex) insertIndex--;
        if (insertIndex < 0) insertIndex = 0;
        if (insertIndex > state.layers.order.length) insertIndex = state.layers.order.length;

        state.layers.order.splice(insertIndex, 0, draggedLayerId);

        // Persist new layer order to localStorage
        try {
            localStorage.setItem('tw_layer_order', JSON.stringify(state.layers.order));
        } catch (e) {
            console.warn('Failed to save tw_layer_order to localStorage:', e);
        }

        // Instantly sync visual map rendering order and reload UI
        syncMapLayerOrder();
        loadLayers();
    };

    // Render layers in defined order
    state.layers.order.forEach((layerId) => {
        const layer = state.layers.data.get(layerId);
        if (!layer) return;

        const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
        const color = layer.color || config?.[1] || '#888888';
        // Count from active trips in category (fallback to GeoJSON features length)
        let routeCount = 0;
        if (state.activeTrips && state.activeTrips.length) {
            routeCount = state.activeTrips.filter(t => normalizeCategory(t.train?.category) === layerId).length;
        } else if (state.statistics?.typeCounts?.[layerId] !== undefined) {
            routeCount = state.statistics.typeCounts[layerId];
        } else {
            routeCount = layer.data?.features?.length || 0;
        }
        const displayName = CATEGORY_NAMES[layerId] || layerId;
        const fullName = CATEGORY_FULL_NAMES[layerId] || displayName;
        const countBadge = ` <span class="layer-count" style="opacity: 0.65; font-size: 11px; margin-left: 4px;">(${routeCount})</span>`;

        // Create layer item element
        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item' + (layer.visible ? ' active' : '');
        layerItem.draggable = true;
        layerItem.dataset.layerId = layerId;
        layerItem.style.setProperty('--layer-color', color);
        layerItem.title = `${fullName} • ${layer.visible ? 'Active (Click to hide)' : 'Hidden (Click to show)'}`;
        layerItem.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
                <span class="layer-drag-handle" title="Drag to reorder" style="cursor:grab;display:inline-flex;align-items:center;opacity:0.35;padding:0 2px;font-size:11px;line-height:1;touch-action:none;user-select:none;">⋮⋮</span>
                <span class="layer-color-dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:${layer.visible ? color : 'transparent'};border:1.5px solid ${color};flex-shrink:0;${layer.visible ? `box-shadow:0 0 6px ${color}88;` : 'opacity:0.4;'}transition:all 0.18s ease;"></span>
                <span class="layer-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${displayName}${countBadge}</span>
            </div>
        `;

        // Click handler to toggle visibility (ignored right after drag)
        layerItem.addEventListener('click', (e) => {
            if (Date.now() < suppressClickUntil || layerItem.classList.contains('dragging')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            toggleLayer(layerId);
        });

        // HTML5 Drag and drop handlers (desktop)
        layerItem.addEventListener('dragstart', (e) => {
            draggedItem = layerItem;
            layerItem.classList.add('dragging');
            suppressClickUntil = Date.now() + 600;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', layerId);
        });

        layerItem.addEventListener('dragend', () => {
            layerItem.classList.remove('dragging');
            draggedItem = null;
            clearDropIndicators();
            suppressClickUntil = Date.now() + 400;
        });

        layerItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedItem && draggedItem !== layerItem) {
                const position = computeDropPosition(e.clientY, layerItem);
                applyDropIndicator(layerItem, position);
            }
        });

        layerItem.addEventListener('dragleave', (e) => {
            if (!layerItem.contains(e.relatedTarget)) {
                layerItem.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
                delete layerItem.dataset.dropPosition;
            }
        });

        layerItem.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropPosition = layerItem.dataset.dropPosition || computeDropPosition(e.clientY, layerItem);
            clearDropIndicators();
            suppressClickUntil = Date.now() + 400;

            if (draggedItem && draggedItem !== layerItem) {
                const draggedLayerId = draggedItem.dataset.layerId;
                const targetLayerId = layerItem.dataset.layerId;
                performReorder(draggedLayerId, targetLayerId, dropPosition);
            }
        });

        // Touch & pointer support for mobile devices
        const handle = layerItem.querySelector('.layer-drag-handle');
        if (handle) {
            handle.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                const targetHandle = e.currentTarget;
                const currentItem = layerItem;
                const pointerId = e.pointerId;
                
                let isDraggingPointer = false;
                let activeTargetItem = null;
                const startY = e.clientY;

                const onPointerMove = (ev) => {
                    if (ev.pointerId !== pointerId) return;
                    const deltaY = Math.abs(ev.clientY - startY);
                    if (!isDraggingPointer && deltaY > 6) {
                        isDraggingPointer = true;
                        draggedItem = currentItem;
                        currentItem.classList.add('dragging');
                        suppressClickUntil = Date.now() + 600;
                        try { targetHandle.setPointerCapture(pointerId); } catch (_) {}
                    }

                    if (isDraggingPointer) {
                        ev.preventDefault();
                        const elementBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                        const hoverItem = elementBelow?.closest('.layer-item');
                        if (hoverItem && hoverItem !== currentItem && layerList.contains(hoverItem)) {
                            activeTargetItem = hoverItem;
                            const pos = computeDropPosition(ev.clientY, hoverItem);
                            applyDropIndicator(hoverItem, pos);
                        } else if (!hoverItem || hoverItem === currentItem) {
                            clearDropIndicators();
                            activeTargetItem = null;
                        }
                    }
                };

                const onPointerUp = (ev) => {
                    if (ev.pointerId !== pointerId) return;
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                    window.removeEventListener('pointercancel', onPointerUp);
                    try { targetHandle.releasePointerCapture(pointerId); } catch (_) {}

                    if (isDraggingPointer) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        suppressClickUntil = Date.now() + 500;
                        currentItem.classList.remove('dragging');
                        draggedItem = null;

                        if (activeTargetItem && activeTargetItem !== currentItem) {
                            const dropPosition = activeTargetItem.dataset.dropPosition || computeDropPosition(ev.clientY, activeTargetItem);
                            clearDropIndicators();
                            const draggedLayerId = currentItem.dataset.layerId;
                            const targetLayerId = activeTargetItem.dataset.layerId;
                            performReorder(draggedLayerId, targetLayerId, dropPosition);
                        } else {
                            clearDropIndicators();
                        }
                    }
                };

                window.addEventListener('pointermove', onPointerMove, { passive: false });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
            });
        }

        layerList.appendChild(layerItem);
    });
}

/**
 * Toggle visibility of a specific transport layer
 */
export function toggleLayer(layerId) {
    const state = store.get();
    const layer = state.layers.data.get(layerId);
    if (!layer) return;

    layer.visible = !layer.visible;

    // Update layer visibility on map directly if available
    if (state.map && state.map.getLayer(layerId)) {
        try {
            state.map.setLayoutProperty(
                layerId,
                'visibility',
                (state.heatmap.enabled || !layer.visible) ? 'none' : 'visible'
            );
        } catch (e) {
            console.warn(`Failed to update visibility for layer ${layerId}:`, e);
        }
    }
    const approxId = `${layerId}-approximated`;
    if (state.map && state.map.getLayer(approxId)) {
        try {
            state.map.setLayoutProperty(
                approxId,
                'visibility',
                (state.heatmap.enabled || !layer.visible) ? 'none' : 'visible'
            );
        } catch (e) {
            console.warn(`Failed to update visibility for layer ${approxId}:`, e);
        }
    }

    // Refresh UI item states
    loadLayers();
    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);
    invalidateDelayOverlayCache();

    if (state.delays.enabled) {
        updateDelayOverlay(true);
    } else {
        updateDelayOverlaySummary();
    }
}

/**
 * Reorder route layers on the Mapbox map so that their rendering stack matches state.layers.order.
 * state.layers.order is rendered from top-to-bottom in the UI menu list (index 0 = top of menu).
 * The user expects the top item of the list to be rendered on top of the other routes.
 * Therefore, in Mapbox's bottom-to-top rendering stack, we move layers from bottom of menu (index N-1)
 * to top of menu (index 0), so index 0 is on top of all route layers.
 */
export function syncMapLayerOrder() {
    const state = store.get();
    if (!state.map || typeof state.map.getStyle !== 'function' || !state.map.getStyle()) {
        return;
    }

    try {
        const baseOpacity = heatmap.getCurrentBaseOpacity(state);

        // 1. Remove all route line layers from map (keeps GeoJSON sources intact)
        state.layers.order.forEach((layerId) => {
            if (state.map.getLayer(layerId)) {
                try {
                    state.map.removeLayer(layerId);
                } catch (_) {}
            }
            const approxLayerId = `${layerId}-approximated`;
            if (state.map.getLayer(approxLayerId)) {
                try {
                    state.map.removeLayer(approxLayerId);
                } catch (_) {}
            }
        });

        // 2. Base railway layer stays underneath all route lines if present
        if (state.map.getLayer('open-railway-map')) {
            try {
                state.map.moveLayer('open-railway-map');
            } catch (_) {}
        }

        // 3. Re-add route line layers in reverse menu order:
        // Bottom of menu (index N-1) is added first (bottom of stack)
        // ...
        // Top of menu (index 0) is added last (top of all route layers)
        for (let i = state.layers.order.length - 1; i >= 0; i--) {
            const layerId = state.layers.order[i];
            const layerData = state.layers.data.get(layerId);
            const isVisible = layerData?.visible ?? true;
            const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
            const color = layerData?.color || config?.[1] || '#888888';

            if (state.map.getSource(layerId)) {
                // Solid line layer (for accurate track polylines)
                try {
                    state.map.addLayer({
                        id: layerId,
                        type: 'line',
                        source: layerId,
                        filter: ['!=', ['get', 'isApproximated'], true],
                        layout: {
                            'line-join': 'round',
                            'line-cap': 'round',
                            'visibility': (state.heatmap?.enabled || !isVisible) ? 'none' : 'visible'
                        },
                        paint: {
                            'line-color': color,
                            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 16],
                            'line-opacity': baseOpacity
                        }
                    });
                } catch (e) {
                    console.warn(`Failed to re-add layer ${layerId}:`, e);
                }

                // Dashed line layer (for approximated straight-line routes)
                try {
                    const approxLayerId = `${layerId}-approximated`;
                    state.map.addLayer({
                        id: approxLayerId,
                        type: 'line',
                        source: layerId,
                        filter: ['==', ['get', 'isApproximated'], true],
                        layout: {
                            'line-join': 'round',
                            'line-cap': 'butt',
                            'visibility': (state.heatmap?.enabled || !isVisible) ? 'none' : 'visible'
                        },
                        paint: {
                            'line-color': color,
                            'line-dasharray': [2, 2],
                            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 16],
                            'line-opacity': baseOpacity * 0.85
                        }
                    });
                } catch (e) {
                    console.warn(`Failed to re-add approx layer ${layerId}:`, e);
                }
            }
        }

        // 4. Ensure highlight layers remain on the absolute top
        if (state.map.getLayer('route-highlight-glow')) {
            try { state.map.moveLayer('route-highlight-glow'); } catch (_) {}
        }
        if (state.map.getLayer('route-highlight')) {
            try { state.map.moveLayer('route-highlight'); } catch (_) {}
        }
    } catch (err) {
        console.warn('Failed to sync map layer order:', err);
    }
}

/**
 * Recreate and re-add all layers in current order
 */
export function reloadAllLayers() {
    const state = store.get();

    // Preserve current visibility states
    const visibilityStates = new Map();
    state.layers.data.forEach((layer, id) => {
        visibilityStates.set(id, layer.visible);
    });

    const sourceTrips = state.activeTrips?.length ? state.activeTrips : refreshActiveTrips();
    const categories = dataProcessing.processTripsToGeoJSON(sourceTrips);
    const baseOpacity = heatmap.getCurrentBaseOpacity(state);

    // Populate data for every layer in state.layers.order
    state.layers.order.forEach((id) => {
        const config = CONFIG.LAYER_CONFIG.find(([layerId]) => layerId === id);
        const color = config ? config[1] : '#888888';
        const data = categories[id] || { type: 'FeatureCollection', features: [] };
        const isVisible = visibilityStates.get(id) ?? true;

        state.layers.data.set(id, { data, color, visible: isVisible });

        // Update map source if available and loaded
        if (state.map && typeof state.map.isStyleLoaded === 'function' && state.map.isStyleLoaded()) {
            try {
                const existingSource = state.map.getSource(id);
                if (existingSource) {
                    existingSource.setData(data);
                } else {
                    state.map.addSource(id, { type: 'geojson', data: data });
                }
            } catch (e) {
                console.warn(`Failed to reload map source ${id}:`, e);
            }
        }
    });

    // Reorder layers on the map according to state.layers.order
    syncMapLayerOrder();

    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);

    // Update UI layer menu list
    loadLayers();
    if (state.map && typeof heatmap.applyBaseLayerOpacity === 'function') {
        heatmap.applyBaseLayerOpacity(baseOpacity);
    }
}
