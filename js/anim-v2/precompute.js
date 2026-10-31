/**
 * High-Performance Spatial Precomputations & Physics Kernels (V2 Engine)
 * Pre-calculates uniform trajectory tables, cumulative distances, and camera targets
 * to enable O(1) coordinate lookups and eliminate per-frame math during playback.
 */

import {
    extractRouteCoordinates,
    buildMapScene,
    buildAllTripsScene,
    computeAllModeTiming,
    shortenStationName,
    samplePointAlongRoute,
    sampleSmoothedCameraTarget,
    computeCameraZoomMultiplier
} from '../animation/geometry.js';

export {
    extractRouteCoordinates,
    buildMapScene,
    buildAllTripsScene,
    computeAllModeTiming,
    shortenStationName,
    computeCameraZoomMultiplier
};

/**
 * Analytical damped harmonic oscillator (exact math equivalent of Remotion spring)
 */
export function computeSpring({ frame, fps = 30, config = { damping: 18, stiffness: 90, mass: 1 } }) {
    if (frame <= 0) return 0;
    const m = config.mass || 1;
    const k = config.stiffness || 90;
    const c = config.damping || 18;
    const t = frame / fps;
    const omega0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(m * k));
    if (zeta < 1) {
        const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
        const decay = Math.exp(-zeta * omega0 * t);
        return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
    }
    return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
}

const LUT_SAMPLES = 1000;

/**
 * Builds high-speed O(1) lookup table for a single journey
 */
export function buildFastTripPrecompute(trip, width = 960, height = 960) {
    const coords = extractRouteCoordinates(trip);
    const scene = buildMapScene(coords, width, height);

    // Pre-calculate 1000 uniform trajectory samples
    const posLUT = new Float32Array(LUT_SAMPLES * 2);      // [x0, y0, x1, y1, ...]
    const angleLUT = new Float32Array(LUT_SAMPLES);        // [angle0, angle1, ...]
    const camTargetLUT = new Float32Array(LUT_SAMPLES * 2); // [camX0, camY0, ...]

    for (let i = 0; i < LUT_SAMPLES; i++) {
        const progress = i / (LUT_SAMPLES - 1);
        const pos = samplePointAlongRoute(scene, progress);
        posLUT[i * 2] = pos.x;
        posLUT[i * 2 + 1] = pos.y;
        angleLUT[i] = pos.angleRad;

        const camTarget = sampleSmoothedCameraTarget(scene, progress);
        camTargetLUT[i * 2] = camTarget.x;
        camTargetLUT[i * 2 + 1] = camTarget.y;
    }

    return {
        coords,
        scene,
        posLUT,
        angleLUT,
        camTargetLUT,
        sampleCount: LUT_SAMPLES,

        /**
         * O(1) evaluation of vehicle position & angle at normalized progress [0..1]
         */
        sampleVehicle(progress) {
            const p = Math.max(0, Math.min(1, progress));
            const idxFloat = p * (LUT_SAMPLES - 1);
            const idx = Math.floor(idxFloat);
            const frac = idxFloat - idx;

            if (idx >= LUT_SAMPLES - 1) {
                const last = (LUT_SAMPLES - 1) * 2;
                return {
                    x: posLUT[last],
                    y: posLUT[last + 1],
                    angleRad: angleLUT[LUT_SAMPLES - 1]
                };
            }

            const i0 = idx * 2;
            const i1 = (idx + 1) * 2;
            const x = posLUT[i0] + (posLUT[i1] - posLUT[i0]) * frac;
            const y = posLUT[i0 + 1] + (posLUT[i1 + 1] - posLUT[i0 + 1]) * frac;

            const angleRad = angleLUT[idx];
            return { x, y, angleRad };
        },

        /**
         * O(1) evaluation of smoothed camera target at normalized progress [0..1]
         */
        sampleCamera(progress) {
            const p = Math.max(0, Math.min(1, progress));
            const idxFloat = p * (LUT_SAMPLES - 1);
            const idx = Math.floor(idxFloat);
            const frac = idxFloat - idx;

            if (idx >= LUT_SAMPLES - 1) {
                const last = (LUT_SAMPLES - 1) * 2;
                return { x: camTargetLUT[last], y: camTargetLUT[last + 1] };
            }

            const i0 = idx * 2;
            const i1 = (idx + 1) * 2;
            const x = camTargetLUT[i0] + (camTargetLUT[i1] - camTargetLUT[i0]) * frac;
            const y = camTargetLUT[i0 + 1] + (camTargetLUT[i1 + 1] - camTargetLUT[i0 + 1]) * frac;
            return { x, y };
        }
    };
}

/**
 * Builds high-speed scene and timing precomputations for All-Rides mode
 */
export function buildFastAllTripsPrecompute(trips, width = 960, height = 960, fps = 30) {
    const allScene = buildAllTripsScene(trips, width, height, fps);
    const timing = computeAllModeTiming(trips, fps);
    return { allScene, timing };
}
