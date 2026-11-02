/**
 * WebGL 3x3 Camera & Viewport Transformation Matrix
 * Maps world Web Mercator coordinates directly to screen pixels.
 */

export function createCameraMatrix(camX, camY, camZoom, viewportWidth, viewportHeight) {
    const tx = (viewportWidth * 0.5) - (camX * camZoom);
    const ty = (viewportHeight * 0.5) - (camY * camZoom);

    // Column-major order for gl.uniformMatrix3fv
    return new Float32Array([
        camZoom, 0.0,     0.0,
        0.0,     camZoom, 0.0,
        tx,      ty,      1.0
    ]);
}

