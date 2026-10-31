import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    computeSpring,
    buildFastTripPrecompute,
    buildFastAllTripsPrecompute
} from '../../js/anim-v2/precompute.js';
import { NativeTripPlayer } from '../../js/anim-v2/player.js';
import { VideoClipExporterV2 } from '../../js/anim-v2/export.js';

class MockDOMElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this._innerHTML = '';
        this.className = '';
        this.id = '';
        this.style = {};
        this.classList = {
            _classes: new Set(),
            add: (c) => this.classList._classes.add(c),
            remove: (c) => this.classList._classes.delete(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (this.classList._classes.has(c)) this.classList._classes.delete(c);
                    else this.classList._classes.add(c);
                } else if (force) {
                    this.classList._classes.add(c);
                } else {
                    this.classList._classes.delete(c);
                }
            },
            contains: (c) => this.classList._classes.has(c)
        };
        this.attributes = {};
        this.listeners = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
    }

    setAttribute(k, v) {
        this.attributes[k] = String(v);
    }

    getAttribute(k) {
        return this.attributes[k] || null;
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    dispatchEvent(event) {
        const fns = this.listeners[event.type] || [];
        fns.forEach(fn => fn(event));
    }

    getContext() {
        return {
            fillRect: vi.fn(),
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            beginPath: vi.fn(),
            arc: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            save: vi.fn(),
            restore: vi.fn()
        };
    }

    querySelector(selector) {
        // Simple mock lookup by id or class
        const el = new MockDOMElement();
        if (selector.startsWith('#')) el.id = selector.slice(1);
        else if (selector.startsWith('.')) el.className = selector.slice(1);
        return el;
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, width: 200, height: 20 };
    }
}

describe('Trip Clip V2 Native Engine', () => {
    describe('Physics & Precomputation Kernels', () => {
        it('computeSpring accurately models damped harmonic oscillation without external dependencies', () => {
            expect(computeSpring({ frame: 0 })).toBe(0);

            const mid = computeSpring({ frame: 15, fps: 30 });
            expect(mid).toBeGreaterThan(0.9);
            expect(mid).toBeLessThan(1.05);

            const end = computeSpring({ frame: 60, fps: 30 });
            expect(Math.abs(end - 1.0)).toBeLessThan(0.001);
        });

        it('buildFastTripPrecompute generates O(1) typed LUT arrays and fast interpolators', () => {
            const trip = {
                id: 101,
                checkin: {
                    lineName: 'RE 1',
                    category: 'regional',
                    origin: { name: 'Berlin Hbf' },
                    destination: { name: 'Frankfurt (Oder)' },
                    polyline: [
                        [13.3695, 52.5255],
                        [13.8, 52.4],
                        [14.55, 52.34]
                    ]
                }
            };

            const pre = buildFastTripPrecompute(trip, 960, 960);
            expect(pre.sampleCount).toBe(1000);
            expect(pre.posLUT).toBeInstanceOf(Float32Array);
            expect(pre.posLUT.length).toBe(2000); // 1000 * 2 (x, y)
            expect(pre.angleLUT.length).toBe(1000);
            expect(pre.camTargetLUT.length).toBe(2000);

            // Sample at start
            const startPos = pre.sampleVehicle(0);
            expect(Number.isFinite(startPos.x)).toBe(true);
            expect(Number.isFinite(startPos.y)).toBe(true);
            expect(Number.isFinite(startPos.angleRad)).toBe(true);

            // Sample mid-route
            const midPos = pre.sampleVehicle(0.5);
            expect(Number.isFinite(midPos.x)).toBe(true);
            expect(Number.isFinite(midPos.y)).toBe(true);

            // Sample camera
            const camTarget = pre.sampleCamera(0.5);
            expect(Number.isFinite(camTarget.x)).toBe(true);
            expect(Number.isFinite(camTarget.y)).toBe(true);
        });

        it('buildFastAllTripsPrecompute generates multi-ride timing and scene', () => {
            const trips = [
                { id: 1, checkin: { polyline: [[13.4, 52.5], [13.5, 52.5]] } },
                { id: 2, checkin: { polyline: [[13.5, 52.5], [13.6, 52.5]] } }
            ];

            const pre = buildFastAllTripsPrecompute(trips, 960, 960, 30);
            expect(pre.allScene).toBeDefined();
            expect(pre.timing).toBeDefined();
            expect(pre.timing.totalFrames).toBeGreaterThan(0);
        });
    });

    describe('NativeTripPlayer State Machine', () => {
        let container;

        beforeEach(() => {
            container = new MockDOMElement('div');
            globalThis.document = {
                createElement: (tag) => new MockDOMElement(tag),
                fullscreenElement: null,
                exitFullscreen: vi.fn()
            };
            globalThis.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16));
            globalThis.cancelAnimationFrame = vi.fn();
        });

        it('initializes DOM structure with stage, canvas, scrubber, and transport buttons', () => {
            const player = new NativeTripPlayer(container, {
                width: 960,
                height: 960,
                fps: 30,
                totalFrames: 240
            });

            expect(container.innerHTML).toContain('v2-player-container');
            expect(container.innerHTML).toContain('v2-player-canvas');
            expect(container.innerHTML).toContain('v2-scrubber-wrap');
            expect(player.getCurrentFrame()).toBe(0);
            expect(player.getTotalFrames()).toBe(240);

            player.destroy();
        });

        it('toggles play/pause state and updates UI classes', () => {
            const player = new NativeTripPlayer(container, {
                width: 400,
                height: 400,
                fps: 30,
                totalFrames: 120
            });

            expect(player.isPlaying).toBe(false);
            player.play();
            expect(player.isPlaying).toBe(true);

            player.pause();
            expect(player.isPlaying).toBe(false);

            player.togglePlay();
            expect(player.isPlaying).toBe(true);

            player.destroy();
        });

        it('seeks to target frame with boundary clamping', () => {
            const player = new NativeTripPlayer(container, {
                width: 400,
                height: 400,
                fps: 30,
                totalFrames: 120
            });

            player.seekTo(45);
            expect(player.getCurrentFrame()).toBe(45);

            // Underflow clamping
            player.seekTo(-10);
            expect(player.getCurrentFrame()).toBe(0);

            // Overflow clamping
            player.seekTo(999);
            expect(player.getCurrentFrame()).toBe(119);

            player.destroy();
        });

        it('adjusts playback speed multiplier', () => {
            const player = new NativeTripPlayer(container);
            expect(player.speed).toBe(1.0);

            player.setSpeed(2.0);
            expect(player.speed).toBe(2.0);
            expect(player.dom.speedBtn.textContent).toBe('2.0x');

            player.destroy();
        });

        it('toggles loop mode', () => {
            const player = new NativeTripPlayer(container);
            expect(player.isLooping).toBe(true);

            player.toggleLoop();
            expect(player.isLooping).toBe(false);

            player.toggleLoop();
            expect(player.isLooping).toBe(true);

            player.destroy();
        });
    });

    describe('VideoClipExporterV2', () => {
        const originalMediaRecorder = globalThis.MediaRecorder;

        afterEach(() => {
            globalThis.MediaRecorder = originalMediaRecorder;
        });

        it('detects MP4 vs WebM mime types with optimal prioritization', () => {
            globalThis.MediaRecorder = {
                isTypeSupported: vi.fn((m) => m.startsWith('video/mp4'))
            };

            const mime = VideoClipExporterV2.getOptimalMimeType();
            expect(mime).toContain('video/mp4');
        });

        it('falls back to WebM when MP4 is unsupported', () => {
            globalThis.MediaRecorder = {
                isTypeSupported: vi.fn((m) => m === 'video/webm;codecs=vp9')
            };

            const mime = VideoClipExporterV2.getOptimalMimeType();
            expect(mime).toBe('video/webm;codecs=vp9');
        });

        it('cancel() resets export state and stops active stream tracks', () => {
            const exporter = new VideoClipExporterV2();
            exporter.isExporting = true;
            const stopFn = vi.fn();
            exporter.activeStream = {
                getTracks: () => [{ stop: stopFn }]
            };
            exporter.mediaRecorder = {
                state: 'recording',
                stop: vi.fn()
            };

            exporter.cancel();
            expect(exporter.isCancelled).toBe(true);
            expect(exporter.isExporting).toBe(false);
            expect(stopFn).toHaveBeenCalled();
            expect(exporter.activeStream).toBeNull();
        });
    });
});
