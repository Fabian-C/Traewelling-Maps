// Layer management module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { refreshActiveTrips } from '../fetch/orchestrator.js';
import * as dataProcessing from '../data/processing.js';
import * as heatmap from '../map/heatmap.js';
import { updateRouteDensity } from '../map/heatmap.js';
import { updateAllStatistics as updateAllStats } from '../analytics/statistics.js';
import { invalidateDelayOverlayCache, updateDelayOverlay, updateDelayOverlaySummary } from '../map/delayOverlay.js';

export function loadLayers() {
    const state = store.get();
    const layerList = document.getElementById('layerList');
    if (!layerList) {
        console.warn('Layer list not found in DOM, retrying...');
        setTimeout(() => {
            const retryList = document.getElementById('layerList');
            if (retryList) {
                console.log('Layer list found on retry, loading layers...');
                loadLayers();
            }
        }, 200);
        return;
    }
    
    // Clear existing layer items and their event listeners
    layerList.innerHTML = '';
    
    // Shared dragged item variable for all layer items
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
    
    // Create layer items in the order defined in state (bottom to top)
    state.layers.order.forEach((layerId) => {
        const layer = state.layers.data.get(layerId);
        if (!layer) return;
        
        // Create layer UI
        const layerItem = document.createElement('div');
        layerItem.className = 'layer-item' + (layer.visible ? ' active' : '');
        layerItem.draggable = true;
        layerItem.dataset.layerId = layerId;
        layerItem.innerHTML = `
            <span class="layer-name">${layerId}</span>
            <span class="layer-status">${layer.visible ? 'ON' : 'OFF'}</span>
        `;
        
        // Add click handler
        layerItem.addEventListener('click', (e) => {
            if (layerItem.classList.contains('dragging')) {
                return;
            }
                window.toggleLayer(layerId);
        });
        
        // Add drag and drop handlers
        layerItem.addEventListener('dragstart', (e) => {
            draggedItem = layerItem;
            layerItem.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', layerItem.innerHTML);
        });
        
        layerItem.addEventListener('dragend', (e) => {
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
                
                // Get current positions
                const draggedIndex = state.layers.order.indexOf(draggedLayerId);
                const targetIndex = state.layers.order.indexOf(targetLayerId);
                let insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;
                
                // Remove from old position
                state.layers.order.splice(draggedIndex, 1);
                if (draggedIndex < insertIndex) insertIndex--;
                if (insertIndex < 0) insertIndex = 0;
                if (insertIndex > state.layers.order.length) insertIndex = state.layers.order.length;
                // Insert at new position
                state.layers.order.splice(insertIndex, 0, draggedLayerId);
                
                // Reload layers to reflect new order
        reloadAllLayers();
            }
        });
        
        layerList.appendChild(layerItem);
    });
}

export function toggleLayer(layerId) {
    const state = store.get();
    const layer = state.layers.data.get(layerId);
    if (!layer) return;
    layer.visible = !layer.visible;
    
    // Only update visibility if heatmap is not enabled
    if (!state.heatmap.enabled) {
        state.map.setLayoutProperty(layerId, 'visibility', layer.visible ? 'visible' : 'none');
    }
    
    loadLayers();
    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);
    invalidateDelayOverlayCache();
    reloadAllLayers();
    if (state.delays.enabled) {
        updateDelayOverlay(true);
    } else {
        updateDelayOverlaySummary();
    }
}

export function reloadAllLayers() {
    const state = store.get();
    // Store current visibility states
    const visibilityStates = new Map();
    state.layers.data.forEach((layer, id) => { visibilityStates.set(id, layer.visible); });
    
    // Clear and recreate all layers with current filters
    state.layers.data.clear();
    CONFIG.LAYER_CONFIG.forEach(([id]) => {
        if (state.map?.getLayer(id)) state.map.removeLayer(id);
        if (state.map?.getSource(id)) state.map.removeSource(id);
    });
    
    const sourceTrips = state.activeTrips?.length ? state.activeTrips : refreshActiveTrips();
    const categories = dataProcessing.processTripsToGeoJSON(sourceTrips);
    const baseOpacity = heatmap.getCurrentBaseOpacity(state);
    state.layers.order.forEach((id, index) => {
        let data = categories[id] || { type: 'FeatureCollection', features: [] };
        
        // Add layer to map
        state.map.addSource(id, { type: 'geojson', data: data });
        state.map.addLayer({
            id: id,
            type: 'line',
            source: id,
            layout: { 
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': CONFIG.LAYER_CONFIG.find(([layerId]) => layerId === id)?.[1] || '#888888',
                'line-width': 2,
                'line-opacity': baseOpacity
            }
        });
        state.layers.data.set(id, { data, visible: visibilityStates.get(id) ?? true });
    });
    
    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);
    
    // Update the layer menu
    loadLayers();
    heatmap.applyBaseLayerOpacity(baseOpacity);
}
