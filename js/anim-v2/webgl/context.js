/**
 * WebGL2 Context & Lifecycle Management
 * Robust context acquisition, capability detection, and context loss recovery.
 */

export function isWebGL2Supported() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }
    try {
        const canvas = document.createElement('canvas');
        return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
    } catch {
        return false;
    }
}

export function createWebGL2Context(canvas, customOptions = {}) {
    if (!canvas) {
        return { gl: null, isSupported: false, error: 'Canvas element is required.' };
    }

    const defaultAttributes = {
        alpha: true,
        antialias: true,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true, // Required for frame capture during video export
        powerPreference: 'high-performance',
        desynchronized: true
    };

    const options = { ...defaultAttributes, ...customOptions };

    let gl = null;
    try {
        gl = canvas.getContext('webgl2', options);
    } catch (err) {
        return { gl: null, isSupported: false, error: err.message };
    }

    if (!gl) {
        return { gl: null, isSupported: false, error: 'WebGL2 context not available.' };
    }

    // Enable standard standard alpha blending
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    return { gl, isSupported: true, error: null };
}

