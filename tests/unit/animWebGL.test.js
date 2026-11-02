import { describe, it, expect, vi } from 'vitest';
import { isWebGL2Supported } from '../../js/anim-v2/webgl/context.js';
import { parseHexColor, packRidesIntoVBO, FLOATS_PER_VERTEX, BYTES_PER_VERTEX } from '../../js/anim-v2/webgl/scenePacker.js';
import { createCameraMatrix } from '../../js/anim-v2/webgl/matrix.js';

describe('WebGL2 Transit Animation Engine', () => {
    describe('Color Parsing & Layout Constants', () => {
        it('parses 6-digit hex color into normalized float components [0..1]', () => {
            const [r, g, b, a] = parseHexColor('#ff0000');
            expect(r).toBeCloseTo(1.0);
            expect(g).toBeCloseTo(0.0);
            expect(b).toBeCloseTo(0.0);
            expect(a).toBeCloseTo(1.0);
        });

        it('parses 3-digit shorthand hex color', () => {
            const [r, g, b, a] = parseHexColor('#0f0');
            expect(r).toBeCloseTo(0.0);
            expect(g).toBeCloseTo(1.0);
            expect(b).toBeCloseTo(0.0);
            expect(a).toBeCloseTo(1.0);
        });

        it('has correct vertex attribute stride (52 bytes)', () => {
            expect(FLOATS_PER_VERTEX).toBe(13);
            expect(BYTES_PER_VERTEX).toBe(52);
        });
    });

    describe('Camera Matrix Math', () => {
        it('creates a 3x3 column-major translation and scale matrix', () => {
            const camX = 100;
            const camY = 200;
            const camZoom = 2.0;
            const width = 800;
            const height = 600;

            const mat = createCameraMatrix(camX, camY, camZoom, width, height);
            expect(mat).toBeInstanceOf(Float32Array);
            expect(mat.length).toBe(9);

            // Scale on diagonal
            expect(mat[0]).toBe(2.0); // m00
            expect(mat[4]).toBe(2.0); // m11
            expect(mat[8]).toBe(1.0); // m22

            // Translation in last column (indices 6 and 7)
            // tx = width/2 - camX*camZoom = 400 - 200 = 200
            // ty = height/2 - camY*camZoom = 300 - 400 = -100
            expect(mat[6]).toBe(200);
            expect(mat[7]).toBe(-100);
        });
    });

    describe('Scene VBO Packer', () => {
        it('returns an empty buffer when rides list is empty', () => {
            const packed = packRidesIntoVBO([]);
            expect(packed.vertexCount).toBe(0);
            expect(packed.segmentCount).toBe(0);
            expect(packed.buffer.length).toBe(0);
        });

        it('packs a 2-point single line segment into 6 vertices (2 triangles)', () => {
            const rides = [
                {
                    startFrame: 0,
                    endFrame: 60,
                    points: [
                        { x: 10, y: 20 },
                        { x: 30, y: 40 }
                    ],
                    trip: {
                        checkin: {
                            category: 'nationalExpress',
                            routeColor: 'ff2e55'
                        }
                    }
                }
            ];

            const packed = packRidesIntoVBO(rides, 120);
            expect(packed.segmentCount).toBe(1);
            expect(packed.vertexCount).toBe(6);
            expect(packed.buffer.length).toBe(6 * 13); // 78 floats

            // Check vertex 0 attributes
            expect(packed.buffer[0]).toBe(10); // curr.x
            expect(packed.buffer[1]).toBe(20); // curr.y
            expect(packed.buffer[6]).toBe(-1.0); // extrusion side: -1
            expect(packed.buffer[7]).toBe(0.0); // progress: 0
            expect(packed.buffer[8]).toBe(0); // tStart
            expect(packed.buffer[9]).toBe(60); // tEnd

            // Color ff2e55 parsed
            expect(packed.buffer[10]).toBeCloseTo(1.0, 1); // R
        });

        it('packs multiple rides with independent temporal windows for 4000-line scalability', () => {
            const rides = [];
            // Simulate 50 rides with 10 points each
            for (let r = 0; r < 50; r++) {
                const points = [];
                for (let p = 0; p < 10; p++) {
                    points.push({ x: r * 10 + p, y: r * 5 + p });
                }
                rides.push({
                    startFrame: r * 20,
                    endFrame: (r + 1) * 20,
                    points,
                    trip: { checkin: { category: 'regional' } }
                });
            }

            const startTime = performance.now();
            const packed = packRidesIntoVBO(rides, 1000);
            const durationMs = performance.now() - startTime;

            expect(packed.segmentCount).toBe(50 * 9); // 450 segments
            expect(packed.vertexCount).toBe(450 * 6); // 2700 vertices
            expect(packed.buffer.length).toBe(2700 * 13);
            expect(durationMs).toBeLessThan(50); // High-speed packing (<50ms)
        });
    });

    describe('WebGL2 Capability Detection', () => {
        it('safely handles non-browser environments without throwing', () => {
            expect(typeof isWebGL2Supported()).toBe('boolean');
        });
    });
});
