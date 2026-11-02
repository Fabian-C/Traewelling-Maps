/**
 * WebGL2 Transit Animation Engine
 * High-performance, zero-dependency GPU renderer for 4,000+ transit rides.
 */

import { createWebGL2Context } from './context.js';
import { WebGLLinePipeline } from './linePipeline.js';
import { WebGLVehiclePipeline } from './vehiclePipeline.js';
import { packRidesIntoVBO, parseHexColor } from './scenePacker.js';
import { createCameraMatrix } from './matrix.js';
import { CATEGORY_META } from '../../animation/tiles.js';
import {
    smootherstep,
    samplePointAlongRoute,
    sampleSmoothedCameraTarget
} from '../../animation/geometry.js';

export class WebGLAnimEngine {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        const ctxResult = createWebGL2Context(canvas, options);
        if (!ctxResult.isSupported) {
            throw new Error(`WebGL2 initialization failed: ${ctxResult.error}`);
        }
        this.gl = ctxResult.gl;

        this.linePipeline = new WebGLLinePipeline(this.gl);
        this.vehiclePipeline = new WebGLVehiclePipeline(this.gl);

        this.lastSceneRef = null;
        this.isPacked = false;
    }

    /**
     * Uploads ride geometry to GPU VBO if scene changed
     */
    syncScene(rides = [], totalFrames = 240) {
        const packed = packRidesIntoVBO(rides, totalFrames);
        this.linePipeline.uploadData(packed);
        this.isPacked = true;
    }

    render({
        frame = 0,
        fps = 30,
        width = 960,
        height = 960,
        allScene = null,
        timing = null,
        styleConfig = null
    }) {
        const gl = this.gl;
        const rides = allScene?.rides || [];
        if (!rides.length) return;

        // Sync VBO if scene changed
        if (this.lastSceneRef !== allScene) {
            const travelTotalFrames = allScene?.travelTotalFrames ?? (timing?.travelTotalFrames || (rides.length * 20));
            this.syncScene(rides, travelTotalFrames);
            this.lastSceneRef = allScene;
        }

        // Camera trajectory computation (identical to 2D canvas)
        const travelTotalFrames = allScene?.travelTotalFrames ?? (timing?.travelTotalFrames || (rides.length * 20));
        const finaleTransitionFrames = timing?.finaleTransitionFrames || Math.round(fps * 1.5);
        const isFinale = frame >= travelTotalFrames;

        let activeIdx = 0;
        while (activeIdx < rides.length - 1 && frame >= (rides[activeIdx].endFrame ?? ((activeIdx + 1) * 20))) {
            activeIdx++;
        }

        const activeRide = rides[activeIdx];
        const rideStartFrame = activeRide.startFrame ?? (activeIdx * 20);
        const rideEndFrame = activeRide.endFrame ?? ((activeIdx + 1) * 20);
        const rideDuration = Math.max(1, rideEndFrame - rideStartFrame);
        const localFrame = isFinale ? rideDuration : Math.max(0, frame - rideStartFrame);
        const rideProgress = isFinale
            ? 1
            : smootherstep(0.04, 0.94, localFrame / rideDuration);

        // Zoom calculation
        const rideProgressT = Math.max(0, Math.min(1, localFrame / rideDuration));
        const zStart = typeof activeRide.startZoom === 'number' ? activeRide.startZoom : (activeRide.rideZoom || allScene.fitScale);
        const zEnd = typeof activeRide.endZoom === 'number' ? activeRide.endZoom : (activeRide.rideZoom || allScene.fitScale);
        const logZStart = Math.log(Math.max(0.1, zStart));
        const logZEnd = Math.log(Math.max(0.1, zEnd));

        let zoomT;
        if (zEnd > zStart * 1.35) {
            zoomT = smootherstep(0, 1, Math.min(1, rideProgressT / 0.50));
        } else {
            zoomT = smootherstep(0, 1, rideProgressT);
        }
        let camZoom = Math.exp(logZStart + (logZEnd - logZStart) * zoomT);

        const activeRideScene = {
            points: activeRide.points,
            cumDist: activeRide.cumDist,
            totalPathPx: activeRide.totalPathPx,
            centerSceneX: activeRide.rideCenterX,
            centerSceneY: activeRide.rideCenterY,
            fitScale: camZoom,
            camZoom
        };

        const vehiclePose = samplePointAlongRoute(activeRideScene, rideProgress);
        const currChaseTarget = sampleSmoothedCameraTarget(activeRideScene, rideProgress);

        let camTargetX = currChaseTarget.x;
        let camTargetY = currChaseTarget.y;

        // Smooth camera handoff between consecutive rides
        if (activeIdx > 0 && !isFinale) {
            const prevRide = rides[activeIdx - 1];
            const prevRideScene = {
                points: prevRide.points,
                cumDist: prevRide.cumDist,
                totalPathPx: prevRide.totalPathPx,
                centerSceneX: prevRide.rideCenterX,
                centerSceneY: prevRide.rideCenterY,
                fitScale: zStart,
                camZoom: zStart
            };
            const prevEndTarget = sampleSmoothedCameraTarget(prevRideScene, 1);
            const handoffDuration = Math.min(rideDuration * 0.70, Math.max(12, 40 * 0.40));
            const handoffT = smootherstep(0, handoffDuration, localFrame);
            camTargetX = prevEndTarget.x + (currChaseTarget.x - prevEndTarget.x) * handoffT;
            camTargetY = prevEndTarget.y + (currChaseTarget.y - prevEndTarget.y) * handoffT;
        }

        // Finale zoom-out blend
        const introDuration = Math.min(60, (rides[0]?.durationFrames || 40) * 0.85);
        const introBlend = 1 - smootherstep(0, introDuration, frame);
        const finaleBlend = isFinale
            ? smootherstep(travelTotalFrames, travelTotalFrames + finaleTransitionFrames, frame)
            : 0;

        const overviewBlend = Math.max(introBlend, finaleBlend);
        const overviewZoom = allScene.fitScale * 0.95;

        camTargetX = camTargetX + (allScene.centerSceneX - camTargetX) * overviewBlend;
        camTargetY = camTargetY + (allScene.centerSceneY - camTargetY) * overviewBlend;
        if (overviewBlend > 0.0001) {
            const logRide = Math.log(Math.max(0.1, camZoom));
            const logOver = Math.log(Math.max(0.1, overviewZoom));
            camZoom = Math.exp(logRide + (logOver - logRide) * overviewBlend);
        }

        // 1. Setup viewport and clear background
        gl.viewport(0, 0, width, height);

        const bgColor = styleConfig?.bg ? parseHexColor(styleConfig.bg) : [0.04, 0.06, 0.1, 1.0];
        gl.clearColor(bgColor[0], bgColor[1], bgColor[2], 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 2. Create 3x3 camera matrix
        const viewCenterY = (height * 0.5) + 42;
        const cameraMatrix = createCameraMatrix(camTargetX, camTargetY, camZoom, width, height);
        // Adjust for Y center offset in matrix
        cameraMatrix[7] = viewCenterY - (camTargetY * camZoom);

        // 3. Render all transit lines in 2 GPU passes (outline + category colors)
        const isDark = styleConfig?.isDark ?? true;
        const baseLineWidth = (4.2 / camZoom) * camZoom; // constant screen-space width: 4.2px
        this.linePipeline.render({
            cameraMatrix,
            width,
            height,
            currentFrame: frame,
            lineWidth: 4.2,
            outlineWidth: 2.2,
            isDark
        });

        // 4. Render active vehicle if still traveling
        if (!isFinale && vehiclePose) {
            const checkin = activeRide.trip?.checkin || activeRide.trip?.train || {};
            const catKey = checkin.category || 'regional';
            const catMeta = CATEGORY_META[catKey] || CATEGORY_META.unknown;
            const vehColor = parseHexColor(checkin.routeColor ? `#${String(checkin.routeColor).replace(/^#/, '')}` : catMeta.color);

            const pulseFactor = (frame % 30) / 30; // 1Hz pulse
            this.vehiclePipeline.renderVehicles([
                {
                    x: vehiclePose.x,
                    y: vehiclePose.y,
                    color: vehColor,
                    radius: 12.0,
                    pulse: pulseFactor
                }
            ], cameraMatrix, width, height);
        }
    }

    destroy() {
        if (this.linePipeline) this.linePipeline.destroy();
        if (this.vehiclePipeline) this.vehiclePipeline.destroy();
    }
}
