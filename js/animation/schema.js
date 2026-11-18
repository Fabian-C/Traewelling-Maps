// @ts-check
/**
 * Declarative ClipSettings Schema for Trip Clip Animation Studio
 * Single source of truth for aspect ratios, camera modes, tile magnification, and overlays.
 */

/**
 * @typedef {'1:1' | '9:16' | '16:9'} AspectRatioId
 * @typedef {'cinematic' | 'overview' | 'follow'} CameraModeId
 * @typedef {'3d' | '2d'} VehicleStyleId
 *
 * @typedef {Object} ClipSettings
 * @property {AspectRatioId} aspectRatio
 * @property {CameraModeId} cameraMode
 * @property {number} tileScale
 * @property {number} clipDurationSec
 * @property {number} routeWidthScale
 * @property {number} vehicleScale
 * @property {VehicleStyleId} vehicleStyle
 * @property {boolean} showHud
 * @property {boolean} showScheduleTimes
 * @property {boolean} showStationPills
 * @property {boolean} showStopDots
 * @property {boolean} showStopNames
 * @property {boolean} showVignette
 * @property {boolean} showWatermark
 */

/** @type {Record<AspectRatioId, { id: AspectRatioId, label: string, width: number, height: number, cssAspect: string }>} */
export const ASPECT_RATIOS = {
    '1:1': { id: '1:1', label: '1:1 Square', width: 960, height: 960, cssAspect: '1 / 1' },
    '9:16': { id: '9:16', label: '9:16 Vertical', width: 720, height: 1280, cssAspect: '9 / 16' },
    '16:9': { id: '16:9', label: '16:9 Wide', width: 1280, height: 720, cssAspect: '16 / 9' }
};

/** @type {Record<CameraModeId, { id: CameraModeId, label: string }>} */
export const CAMERA_MODES = {
    cinematic: { id: 'cinematic', label: 'Cinematic Chase' },
    overview: { id: 'overview', label: 'Static Overview' },
    follow: { id: 'follow', label: 'Tight Follow' }
};

export const TILE_SCALE_OPTIONS = [1.0, 2.0, 3.0];
export const CLIP_DURATION_OPTIONS = [5, 8, 12, 16];
export const ROUTE_WIDTH_OPTIONS = [0.75, 1.0, 1.4];
export const VEHICLE_SCALE_OPTIONS = [0.8, 1.0, 1.35, 0];
export const VEHICLE_STYLES = {
    '3d': { id: '3d', label: '3D Isometric' },
    '2d': { id: '2d', label: 'Classic 2D' }
};

/**
 * Creates a fresh default ClipSettings object.
 * @returns {ClipSettings}
 */
export function createDefaultClipSettings() {
    return {
        aspectRatio: '1:1',
        cameraMode: 'cinematic',
        tileScale: 2.0,
        clipDurationSec: 8,
        routeWidthScale: 1.0,
        vehicleScale: 1.0,
        vehicleStyle: '3d',
        showHud: true,
        showScheduleTimes: true,
        showStationPills: true,
        showStopDots: true,
        showStopNames: false,
        showVignette: true,
        showWatermark: true
    };
}

/**
 * Resolves canvas dimensions and CSS aspect ratio for a given aspectRatio ID.
 * Falls back to 1:1 (960x960) for unknown values.
 * @param {string} aspectRatio
 * @returns {{ id: AspectRatioId, label: string, width: number, height: number, cssAspect: string }}
 */
export function resolveAspectDimensions(aspectRatio) {
    if (aspectRatio && Object.hasOwn(ASPECT_RATIOS, aspectRatio)) {
        return ASPECT_RATIOS[/** @type {AspectRatioId} */ (aspectRatio)];
    }
    return ASPECT_RATIOS['1:1'];
}

/**
 * Merges and validates partial ClipSettings updates against defaults.
 * @param {Partial<ClipSettings>} [partial]
 * @param {ClipSettings} [base]
 * @returns {ClipSettings}
 */
export function normalizeClipSettings(partial = {}, base = createDefaultClipSettings()) {
    const next = { ...base, ...(partial || {}) };
    if (!Object.hasOwn(ASPECT_RATIOS, next.aspectRatio)) {
        next.aspectRatio = '1:1';
    }
    if (!Object.hasOwn(CAMERA_MODES, next.cameraMode)) {
        next.cameraMode = 'cinematic';
    }
    const numScale = Number(next.tileScale);
    next.tileScale = Number.isFinite(numScale) && numScale >= 0.5 && numScale <= 8.0 ? numScale : 2.0;

    const numDuration = Number(next.clipDurationSec);
    next.clipDurationSec = Number.isFinite(numDuration) && numDuration >= 3 && numDuration <= 60 ? numDuration : 8;

    const numRouteWidth = Number(next.routeWidthScale);
    next.routeWidthScale = Number.isFinite(numRouteWidth) && numRouteWidth >= 0.4 && numRouteWidth <= 3.0 ? numRouteWidth : 1.0;

    const numVehicleScale = Number(next.vehicleScale);
    next.vehicleScale = Number.isFinite(numVehicleScale) && numVehicleScale >= 0 && numVehicleScale <= 3.0 ? numVehicleScale : 1.0;

    if (!Object.hasOwn(VEHICLE_STYLES, next.vehicleStyle)) {
        next.vehicleStyle = '3d';
    }

    next.showHud = Boolean(next.showHud);
    next.showScheduleTimes = Boolean(next.showScheduleTimes);
    next.showStationPills = Boolean(next.showStationPills);
    next.showStopDots = Boolean(next.showStopDots);
    next.showStopNames = Boolean(next.showStopNames);
    next.showVignette = Boolean(next.showVignette);
    next.showWatermark = Boolean(next.showWatermark);
    return next;
}
