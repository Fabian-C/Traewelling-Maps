/**
 * WebGL2 Active Vehicle Marker & Pulse Halo Pipeline
 */

import { VEHICLE_VS, VEHICLE_FS } from './shaders.js';
import { createProgram, getUniformLocations } from './shaderUtils.js';

export class WebGLVehiclePipeline {
    constructor(gl) {
        this.gl = gl;
        this.program = createProgram(gl, VEHICLE_VS, VEHICLE_FS);

        this.uniforms = getUniformLocations(gl, this.program, [
            'u_cameraMatrix',
            'u_resolution'
        ]);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();

        this._setupAttributes();
    }

    _setupAttributes() {
        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

        // Stride: 2 (offset) + 2 (pos) + 4 (color) + 1 (radius) + 1 (pulse) = 10 floats = 40 bytes
        const stride = 40;

        // layout 0: a_quadOffset (vec2)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);

        // layout 1: a_centerPos (vec2)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);

        // layout 2: a_color (vec4)
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);

        // layout 3: a_radius (float)
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);

        // layout 4: a_pulseFactor (float)
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    renderVehicles(vehicles = [], cameraMatrix, width, height) {
        if (!vehicles || vehicles.length === 0) return;

        const gl = this.gl;
        // 6 vertices per vehicle quad (2 triangles)
        const vertexCount = vehicles.length * 6;
        const data = new Float32Array(vertexCount * 10);
        let ptr = 0;

        const quadOffsets = [
            [-1, -1], [1, -1], [-1, 1],
            [-1, 1], [1, -1], [1, 1]
        ];

        for (const v of vehicles) {
            const posX = v.x;
            const posY = v.y;
            const [cr, cg, cb, ca] = v.color || [1, 0.2, 0.3, 1];
            const radius = v.radius || 12.0;
            const pulse = v.pulse || 0.0;

            for (const [ox, oy] of quadOffsets) {
                data[ptr++] = ox;
                data[ptr++] = oy;
                data[ptr++] = posX;
                data[ptr++] = posY;
                data[ptr++] = cr;
                data[ptr++] = cg;
                data[ptr++] = cb;
                data[ptr++] = ca;
                data[ptr++] = radius;
                data[ptr++] = pulse;
            }
        }

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

        gl.uniformMatrix3fv(this.uniforms.u_cameraMatrix, false, cameraMatrix);
        gl.uniform2f(this.uniforms.u_resolution, width, height);

        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.useProgram(null);
    }

    destroy() {
        const gl = this.gl;
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.program) gl.deleteProgram(this.program);
    }
}

