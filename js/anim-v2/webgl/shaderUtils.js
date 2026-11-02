/**
 * WebGL2 Shader Compilation & Program Linking Utilities
 * Zero dependencies, diagnostic logging, and fast uniform lookup caching.
 */

export function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source.trim());
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        const shaderTypeStr = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
        throw new Error(`[WebGL2 ${shaderTypeStr} Shader Compilation Failed]: ${info}`);
    }

    return shader;
}

export function createProgram(gl, vertexSource, fragmentSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Clean up intermediate shader objects once linked
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`[WebGL2 Program Link Error]: ${info}`);
    }

    return program;
}

export function getUniformLocations(gl, program, uniformNames = []) {
    const locations = {};
    for (const name of uniformNames) {
        locations[name] = gl.getUniformLocation(program, name);
    }
    return locations;
}

