// Layer management module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { refreshActiveTrips } from '../fetch/orchestrator.js';
import * as dataProcessing from '../data/processing.js';
import * as heatmap from '../map/heatmap.js';
import { updateRouteDensity } from '../map/heatmap.js';
import { updateAllStatistics as updateAllStats } from '../analytics/statistics.js';
import { invalidateDelayOverlayCache, updateDelayOverlay, updateDelayOverlaySummary } from '../map/delayOverlay.js';

export const CATEGORY_NAMES = {
    nationalExpress: 'High Speed (ICE/TGV)',
    national: 'Intercity (IC/EC)',
    regionalExp: 'Regional Express (RE)',
    regional: 'Regional (RB)',
    suburban: 'Suburban (S-Bahn)',
    bus: 'Bus',
    tram: 'Tram',
    subway: 'Subway (U-Bahn)',
    plane: 'Flight',
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

    const computeDropPosition = (event, item) => {
        const rect = item.getBoundingClientRect();
        const offset = event.clientY - rect.top;
        return offset < rect.height / 2 ? 'before' : 'after';
    };

    // Render layers in defined order (bottom to top)
    state.layers.order.forEach((layerId) => {
        const layer = state.layers.data.get(layerId);
        if (!layer) return;

        const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
        const color = layer.color || config?.[1] || '#888888';
        const routeCount = layer.data?.features?.length || 0;
        const displayName = CATEGORY_NAMES[layerId] || layerId;
        const countBadge = routeCount > 0 ? ` <span class="layer-count" style="opacity: 0.6; font-size: 11px;">(${routeCount})</span>` : '';

        // Create layer item element
        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item' + (layer.visible ? ' active' : '');
        layerItem.draggable = true;
        layerItem.dataset.layerId = layerId;
        layerItem.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                <span class="layer-color-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${color};flex-shrink:0;"></span>
                <span class="layer-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayName}${countBadge}</span>
            </div>
            <span class="layer-status">${layer.visible ? 'ON' : 'OFF'}</span>
        `;

        // Click handler to toggle visibility
        layerItem.addEventListener('click', (e) => {
            if (layerItem.classList.contains('dragging')) return;
            toggleLayer(layerId);
        });

        // Drag and drop handlers
        layerItem.addEventListener('dragstart', (e) => {
            draggedItem = layerItem;
            layerItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', layerId);
        });

        layerItem.addEventListener('dragend', () => {
            layerItem.classList.remove('dragging');
            draggedItem = null;
            clearDropIndicators();
        });

        layerItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedItem && draggedItem !== layerItem) {
                const position = computeDropPosition(e, layerItem);
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
            const dropPosition = layerItem.dataset.dropPosition || computeDropPosition(e, layerItem);
            clearDropIndicators();

            if (draggedItem && draggedItem !== layerItem) {
                const draggedLayerId = draggedItem.dataset.layerId;
                const targetLayerId = layerItem.dataset.layerId;

                const draggedIndex = state.layers.order.indexOf(draggedLayerId);
                const targetIndex = state.layers.order.indexOf(targetLayerId);
                let insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;

                state.layers.order.splice(draggedIndex, 1);
                if (draggedIndex < insertIndex) insertIndex--;
                if (insertIndex < 0) insertIndex = 0;
                if (insertIndex > state.layers.order.length) insertIndex = state.layers.order.length;

                state.layers.order.splice(insertIndex, 0, draggedLayerId);

                // Reload layers with new order
                reloadAllLayers();
            }
        });

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
    state.layers.order.forEach((id, index) => {
        const config = CONFIG.LAYER_CONFIG.find(([layerId]) => layerId === id);
        const color = config ? config[1] : '#888888';
        const data = categories[id] || { type: 'FeatureCollection', features: [] };
        const isVisible = visibilityStates.get(id) ?? true;

        state.layers.data.set(id, { data, color, visible: isVisible });

        // Update map if available and loaded
        if (state.map && typeof state.map.isStyleLoaded === 'function' && state.map.isStyleLoaded()) {
            try {
                if (state.map.getLayer(id)) state.map.removeLayer(id);
                if (state.map.getSource(id)) state.map.removeSource(id);

                state.map.addSource(id, { type: 'geojson', data: data });

                let beforeLayer = null;
                if (index > 0) {
                    const prevLayerId = state.layers.order[index - 1];
                    if (state.map.getLayer(prevLayerId)) {
                        beforeLayer = prevLayerId;
                    }
                } else if (state.map.getLayer('open-railway-map')) {
                    beforeLayer = 'open-railway-map';
                }

                state.map.addLayer({
                    id: id,
                    type: 'line',
                    source: id,
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
                }, beforeLayer);
            } catch (e) {
                console.warn(`Failed to reload map layer ${id}:`, e);
            }
        }
    });

    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);

    // Update UI layer menu list
    loadLayers();
    if (state.map && typeof heatmap.applyBaseLayerOpacity === 'function') {
        heatmap.applyBaseLayerOpacity(baseOpacity);
    }
}
