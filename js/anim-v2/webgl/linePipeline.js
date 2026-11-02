/**
 * WebGL2 Screen-Space Line Extrusion Pipeline
 * Handles VAO setup, attribute binding, uniform uploads, and multi-pass track rendering.
 */

import { ROUTE_VS, ROUTE_FS } from './shaders.js';
import { createProgram, getUniformLocations } from './shaderUtils.js';
import { BYTES_PER_VERTEX } from './scenePacker.js';

export class WebGLLinePipeline {
    constructor(gl) {
        this.gl = gl;
        this.program = createProgram(gl, ROUTE_VS, ROUTE_FS);

        this.uniforms = getUniformLocations(gl, this.program, [
            'u_cameraMatrix',
            'u_resolution',
            'u_lineWidth',
            'u_outlineWidth',
            'u_passType',
            'u_outlineColor',
            'u_currentTime'
        ]);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.vertexCount = 0;

        this._setupAttributes();
    }

    _setupAttributes() {
        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

        const stride = BYTES_PER_VERTEX; // 52 bytes

        // layout 0: a_currPoint (vec2)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);

        // layout 1: a_prevPoint (vec2)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);

        // layout 2: a_nextPoint (vec2)
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);

        // layout 3: a_extrusionSide (float)
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);

        // layout 4: a_timeProgress (float)
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 28);

        // layout 5: a_timeWindow (vec2)
        gl.enableVertexAttribArray(5);
        gl.vertexAttribPointer(5, 2, gl.FLOAT, false, stride, 32);

        // layout 6: a_categoryColor (vec4)
        gl.enableVertexAttribArray(6);
        gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 40);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    uploadData(packedData) {
        const gl = this.gl;
        this.vertexCount = packedData.vertexCount;
        if (this.vertexCount === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, packedData.buffer, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    render({
        cameraMatrix,
        width,
        height,
        currentFrame,
        lineWidth = 4.2,
        outlineWidth = 2.0,
        isDark = true
    }) {
        if (this.vertexCount === 0) return;

        const gl = this.gl;
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        // Upload camera & viewport uniforms
        gl.uniformMatrix3fv(this.uniforms.u_cameraMatrix, false, cameraMatrix);
        gl.uniform2f(this.uniforms.u_resolution, width, height);
        gl.uniform1f(this.uniforms.u_lineWidth, lineWidth);
        gl.uniform1f(this.uniforms.u_outlineWidth, outlineWidth);
        gl.uniform1f(this.uniforms.u_currentTime, currentFrame);

        // Pass 1: Under-track outline
        const outlineAlpha = isDark ? 0.55 : 0.40;
        const outlineRgb = isDark ? 1.0 : 0.08;
        gl.uniform4f(this.uniforms.u_outlineColor, outlineRgb, outlineRgb, outlineRgb, outlineAlpha);
        gl.uniform1i(this.uniforms.u_passType, 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

        // Pass 2: Transit category colors
        gl.uniform1i(this.uniforms.u_passType, 1);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

        gl.bindVertexArray(null);
        gl.useProgram(null);
    }

    destroy() {
        const gl = this.gl;
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.program) gl.deleteProgram(this.program);
    }
}

