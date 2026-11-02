/**
 * Native Trip Clip Micro-Player (Zero Dependencies)
 * High-performance, frame-accurate animation player with silky smooth scrubbing,
 * keyboard shortcuts, speed control, and responsive High-DPI canvas scaling.
 */

import { renderV2Frame } from './renderer.js';
import { WebGLAnimEngine } from './webgl/engine.js';
import { MAP_STYLES } from '../animation/tiles.js';

export class NativeTripPlayer {
    constructor(containerEl, options = {}) {
        if (!containerEl) {
            throw new Error('Container element is required to initialize NativeTripPlayer.');
        }

        this.container = containerEl;
        this.options = options || {};
        this.width = options.width || 960;
        this.height = options.height || 960;
        this.fps = options.fps || 30;
        this.totalFrames = options.totalFrames || 240;
        this.currentFrame = 0;
        this.isPlaying = false;
        this.isLooping = true;
        this.speed = 1.0;

        // Current scene props
        this.trip = null;
        this.trips = [];
        this.mode = 'single';
        this.username = 'Traveler';
        this.mapStyle = 'traewelling-dark';
        this.precompute = null;

        // Animation timing
        this.rafId = null;
        this.lastTimestamp = null;
        this.accumulatedMs = 0;
        this.isDraggingScrubber = false;

        // UI decoupling & performance caching
        this._pendingSeekFrame = null;
        this._seekRafId = null;
        this._lastCurSecs = -1;
        this._lastFrameNum = -1;
        this._lastProgressPct = '';
        this._onFullscreenChange = () => this._syncFullscreenUI();
        this._onKeyDown = (e) => this._handleKeyDown(e);

        this._buildDOM();
        this._bindEvents();
        this._updateUI();
    }

    _buildDOM() {
        this.container.innerHTML = `
            <div class="v2-player-container" tabindex="0" role="region" aria-label="Animated Journey Video Player">
                <button type="button" class="v2-fullscreen-close-btn" id="v2FullscreenCloseBtn" title="Exit Fullscreen (Esc)" aria-label="Exit Fullscreen">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                <div class="v2-player-stage" id="v2Stage">
                    <canvas class="v2-player-canvas" width="${this.width}" height="${this.height}"></canvas>
                    <div class="v2-center-play-overlay paused" id="v2CenterOverlay" aria-hidden="true">
                        <div class="v2-play-icon-bubble">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="6 4 20 12 6 20 6 4"></polygon>
                            </svg>
                        </div>
                    </div>
                </div>

                <div class="v2-player-controls" role="toolbar" aria-label="Playback Controls">
                    <!-- Scrubber Timeline -->
                    <div class="v2-scrubber-wrap" id="v2ScrubberWrap" role="slider" aria-label="Timeline Scrubber" aria-valuemin="0" aria-valuemax="${this.totalFrames - 1}" aria-valuenow="0">
                        <div class="v2-scrubber-track">
                            <div class="v2-scrubber-fill" id="v2ScrubberFill"></div>
                        </div>
                        <div class="v2-scrubber-thumb" id="v2ScrubberThumb"></div>
                        <div class="v2-scrubber-tooltip" id="v2ScrubberTooltip">00:00</div>
                    </div>

                    <!-- Button Bar -->
                    <div class="v2-controls-row">
                        <div class="v2-controls-left">
                            <button type="button" class="v2-ctrl-btn" id="v2PlayBtn" title="Play / Pause (Space)" aria-label="Play">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" id="v2PlayIcon">
                                    <polygon points="6 4 20 12 6 20 6 4"></polygon>
                                </svg>
                            </button>

                            <button type="button" class="v2-ctrl-btn" id="v2StepBackBtn" title="Previous Frame (←)" aria-label="Previous Frame">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="15 18 9 12 15 6"></polyline>
                                </svg>
                            </button>

                            <button type="button" class="v2-ctrl-btn" id="v2StepFwdBtn" title="Next Frame (→)" aria-label="Next Frame">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </button>

                            <div class="v2-timecode">
                                <span class="v2-timecode-cur" id="v2TimeCur">00:00</span>
                                <span>/</span>
                                <span class="v2-timecode-tot" id="v2TimeTot">00:08</span>
                                <span class="v2-timecode-frame" id="v2TimeFrame">0/240</span>
                            </div>
                        </div>

                        <div class="v2-controls-right">
                            <button type="button" class="v2-ctrl-btn v2-speed-btn" id="v2SpeedBtn" title="Playback Speed" aria-label="Playback Speed">1.0x</button>

                            <button type="button" class="v2-ctrl-btn active" id="v2LoopBtn" title="Toggle Loop" aria-label="Toggle Loop">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="17 1 21 5 17 9"></polyline>
                                    <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                                    <polyline points="7 23 3 19 7 15"></polyline>
                                    <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                                </svg>
                            </button>

                            <button type="button" class="v2-ctrl-btn" id="v2FullscreenBtn" title="Fullscreen (F)" aria-label="Fullscreen">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="v2FullscreenIcon">
                                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.dom = {
            wrapper: this.container.querySelector('.v2-player-container'),
            fullscreenCloseBtn: this.container.querySelector('#v2FullscreenCloseBtn'),
            stage: this.container.querySelector('#v2Stage'),
            canvas: this.container.querySelector('.v2-player-canvas'),
            centerOverlay: this.container.querySelector('#v2CenterOverlay'),
            scrubberWrap: this.container.querySelector('#v2ScrubberWrap'),
            scrubberFill: this.container.querySelector('#v2ScrubberFill'),
            scrubberThumb: this.container.querySelector('#v2ScrubberThumb'),
            scrubberTooltip: this.container.querySelector('#v2ScrubberTooltip'),
            playBtn: this.container.querySelector('#v2PlayBtn'),
            playIcon: this.container.querySelector('#v2PlayIcon'),
            stepBackBtn: this.container.querySelector('#v2StepBackBtn'),
            stepFwdBtn: this.container.querySelector('#v2StepFwdBtn'),
            timeCur: this.container.querySelector('#v2TimeCur'),
            timeTot: this.container.querySelector('#v2TimeTot'),
            timeFrame: this.container.querySelector('#v2TimeFrame'),
            speedBtn: this.container.querySelector('#v2SpeedBtn'),
            loopBtn: this.container.querySelector('#v2LoopBtn'),
            fullscreenBtn: this.container.querySelector('#v2FullscreenBtn'),
            fullscreenIcon: this.container.querySelector('#v2FullscreenIcon')
        };

        this.rendererType = this.options.renderer || 'auto';
        this.webglEngine = null;
        this.ctx = null;

        if (this.rendererType !== '2d') {
            try {
                this.webglEngine = new WebGLAnimEngine(this.dom.canvas);
                this.rendererType = 'webgl';
            } catch {
                this.webglEngine = null;
            }
        }

        if (!this.webglEngine) {
            try {
                this.ctx = this.dom.canvas.getContext('2d');
            } catch {}
            this.rendererType = '2d';
        }
    }

    _bindEvents() {
        // Stage click = play/pause toggle
        this.dom.stage.addEventListener('click', () => this.togglePlay());

        // Buttons
        this.dom.playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePlay();
        });

        this.dom.stepBackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pause();
            this.seekTo(this.currentFrame - 1);
        });

        this.dom.stepFwdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pause();
            this.seekTo(this.currentFrame + 1);
        });

        this.dom.speedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const speeds = [0.5, 1.0, 1.5, 2.0];
            const nextIdx = (speeds.indexOf(this.speed) + 1) % speeds.length;
            this.setSpeed(speeds[nextIdx]);
        });

        this.dom.loopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLoop();
        });

        this.dom.fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFullscreen();
        });

        if (this.dom.fullscreenCloseBtn) {
            this.dom.fullscreenCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exitFullscreen();
            });
        }

        // Fullscreen sync listeners
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('fullscreenchange', this._onFullscreenChange);
            document.addEventListener('webkitfullscreenchange', this._onFullscreenChange);
        }

        // Global keyboard listener
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('keydown', this._onKeyDown);
        }

        // Decoupled, coalesced scrubber drag handling
        const updateFromPointer = (e) => {
            const rect = this.dom.scrubberWrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
            const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const targetFrame = Math.round(progress * (this.totalFrames - 1));

            // Instant low-overhead visual feedback on thumb position without waiting for canvas
            const pctStr = `${(progress * 100).toFixed(2)}%`;
            this.dom.scrubberFill.style.inlineSize = pctStr;
            this.dom.scrubberThumb.style.insetInlineStart = pctStr;
            if (typeof this.dom.wrapper?.style?.setProperty === 'function') {
                this.dom.wrapper.style.setProperty('--v2-progress', `${progress}`);
            }

            // Coalesce frame seek to the next animation frame to prevent blocking high-frequency pointer streams
            this._pendingSeekFrame = targetFrame;
            if (this._seekRafId === null && typeof requestAnimationFrame === 'function') {
                this._seekRafId = requestAnimationFrame(() => {
                    this._seekRafId = null;
                    if (this._pendingSeekFrame !== null) {
                        const f = this._pendingSeekFrame;
                        this._pendingSeekFrame = null;
                        this.seekTo(f);
                    }
                });
            } else if (typeof requestAnimationFrame !== 'function') {
                this.seekTo(targetFrame);
            }
        };

        const updateTooltip = (e) => {
            const rect = this.dom.scrubberWrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const hoverFrame = Math.round(progress * (this.totalFrames - 1));
            const hoverSecs = hoverFrame / this.fps;
            const mm = String(Math.floor(hoverSecs / 60)).padStart(2, '0');
            const ss = String(Math.floor(hoverSecs % 60)).padStart(2, '0');

            this.dom.scrubberTooltip.textContent = `${mm}:${ss} (F${hoverFrame})`;
            this.dom.scrubberTooltip.style.left = `${progress * 100}%`;
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            this.isDraggingScrubber = true;
            this.dom.scrubberWrap.classList.add('dragging');
            try {
                if (typeof this.dom.scrubberWrap.setPointerCapture === 'function') {
                    this.dom.scrubberWrap.setPointerCapture(e.pointerId);
                }
            } catch {}
            updateFromPointer(e);
        };

        const onPointerMove = (e) => {
            if (this.isDraggingScrubber) {
                updateFromPointer(e);
            } else {
                updateTooltip(e);
            }
        };

        const onPointerUp = (e) => {
            if (!this.isDraggingScrubber) return;
            this.isDraggingScrubber = false;
            this.dom.scrubberWrap.classList.remove('dragging');
            try {
                if (e && e.pointerId && typeof this.dom.scrubberWrap.releasePointerCapture === 'function') {
                    this.dom.scrubberWrap.releasePointerCapture(e.pointerId);
                }
            } catch {}

            // Flush any remaining pending seek immediately
            if (this._pendingSeekFrame !== null) {
                const f = this._pendingSeekFrame;
                this._pendingSeekFrame = null;
                if (this._seekRafId !== null && typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(this._seekRafId);
                    this._seekRafId = null;
                }
                this.seekTo(f);
            }
            this.dom.scrubberWrap.setAttribute('aria-valuenow', String(this.currentFrame));
        };

        this.dom.scrubberWrap.addEventListener('pointerdown', onPointerDown);
        this.dom.scrubberWrap.addEventListener('pointermove', onPointerMove);
        this.dom.scrubberWrap.addEventListener('pointerup', onPointerUp);
        this.dom.scrubberWrap.addEventListener('pointercancel', onPointerUp);
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('pointerup', onPointerUp);
        }
    }

    _handleKeyDown(e) {
        if (!e) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;

        if (e.code === 'Space') {
            e.preventDefault();
            this.togglePlay();
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            this.pause();
            this.seekTo(this.currentFrame - 1);
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            this.pause();
            this.seekTo(this.currentFrame + 1);
        } else if (e.code === 'KeyJ') {
            e.preventDefault();
            this.seekTo(this.currentFrame - this.fps);
        } else if (e.code === 'KeyL') {
            e.preventDefault();
            this.seekTo(this.currentFrame + this.fps);
        } else if (e.code === 'KeyF') {
            e.preventDefault();
            this.toggleFullscreen();
        } else if (e.code === 'Escape') {
            if (this.isFullscreen()) {
                e.preventDefault();
                this.exitFullscreen();
            }
        }
    }

    load({
        trip = null,
        trips = [],
        mode = 'single',
        username = 'Traveler',
        mapStyle = 'traewelling-dark',
        totalFrames = 240,
        fps = 30,
        precompute = null,
        autoPlay = true
    }) {
        this.trip = trip;
        this.trips = trips;
        this.mode = mode;
        this.username = username;
        this.mapStyle = mapStyle;
        this.totalFrames = Math.max(1, totalFrames);
        this.fps = fps || 30;
        this.precompute = precompute;
        this.currentFrame = 0;
        this.accumulatedMs = 0;

        // Update UI max labels
        const totalSecs = this.totalFrames / this.fps;
        const mm = String(Math.floor(totalSecs / 60)).padStart(2, '0');
        const ss = String(Math.floor(totalSecs % 60)).padStart(2, '0');
        this.dom.timeTot.textContent = `${mm}:${ss}`;
        this.dom.scrubberWrap.setAttribute('aria-valuemax', String(this.totalFrames - 1));

        this._renderCurrentFrame();
        this._updateUI();

        if (autoPlay) {
            this.play();
        } else {
            this.pause();
        }
    }

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.lastTimestamp = performance.now();
        this.dom.centerOverlay.classList.remove('paused');
        this.dom.playBtn.setAttribute('aria-label', 'Pause');
        this.dom.playIcon.innerHTML = `
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
        `;

        const tick = (now) => {
            if (!this.isPlaying) return;
            const delta = Math.min(100, now - (this.lastTimestamp || now));
            this.lastTimestamp = now;
            this.accumulatedMs += delta * this.speed;

            const frameDurationMs = 1000 / this.fps;
            const framesToAdvance = Math.floor(this.accumulatedMs / frameDurationMs);

            if (framesToAdvance > 0) {
                this.accumulatedMs -= framesToAdvance * frameDurationMs;
                let nextFrame = this.currentFrame + framesToAdvance;

                if (nextFrame >= this.totalFrames) {
                    if (this.isLooping) {
                        nextFrame = nextFrame % this.totalFrames;
                    } else {
                        nextFrame = this.totalFrames - 1;
                        this.pause();
                    }
                }

                this.currentFrame = nextFrame;
                this._renderCurrentFrame();
                this._updateUI();
            }

            if (this.isPlaying) {
                this.rafId = requestAnimationFrame(tick);
            }
        };

        this.rafId = requestAnimationFrame(tick);
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.lastTimestamp = null;
        this.accumulatedMs = 0;
        this.dom.centerOverlay.classList.add('paused');
        this.dom.playBtn.setAttribute('aria-label', 'Play');
        this.dom.playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"></polygon>';
    }

    togglePlay() {
        if (this.isPlaying) this.pause();
        else this.play();
    }

    seekTo(frame) {
        const clamped = Math.max(0, Math.min(this.totalFrames - 1, frame));
        this.currentFrame = clamped;
        this.accumulatedMs = 0;
        this._renderCurrentFrame();
        this._updateUI();
    }

    setSpeed(mult) {
        this.speed = mult;
        this.dom.speedBtn.textContent = `${mult.toFixed(1)}x`;
    }

    toggleLoop() {
        this.isLooping = !this.isLooping;
        this.dom.loopBtn.classList.toggle('active', this.isLooping);
    }

    isFullscreen() {
        return !!(
            (typeof document !== 'undefined' && (document.fullscreenElement || document.webkitFullscreenElement)) ||
            (this.dom.wrapper?.classList?.contains('is-fullscreen'))
        );
    }

    toggleFullscreen() {
        if (this.isFullscreen()) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    enterFullscreen() {
        const wrapper = this.dom.wrapper;
        if (!wrapper) return;

        if (typeof wrapper.requestFullscreen === 'function') {
            wrapper.requestFullscreen().catch(() => this._fallbackFullscreen(true));
        } else if (typeof wrapper.webkitRequestFullscreen === 'function') {
            try {
                wrapper.webkitRequestFullscreen();
            } catch {
                this._fallbackFullscreen(true);
            }
        } else {
            this._fallbackFullscreen(true);
        }
    }

    exitFullscreen() {
        if (typeof document !== 'undefined' && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
            document.exitFullscreen().catch(() => this._fallbackFullscreen(false));
        } else if (typeof document !== 'undefined' && document.webkitFullscreenElement && typeof document.webkitExitFullscreen === 'function') {
            try {
                document.webkitExitFullscreen();
            } catch {
                this._fallbackFullscreen(false);
            }
        } else {
            this._fallbackFullscreen(false);
        }
    }

    _fallbackFullscreen(enable) {
        if (this.dom.wrapper?.classList) {
            this.dom.wrapper.classList.toggle('is-fullscreen', enable);
        }
        if (typeof document !== 'undefined' && document.body?.classList) {
            document.body.classList.toggle('v2-fullscreen-active', enable);
        }
        this._syncFullscreenUI(enable);
    }

    _syncFullscreenUI(overrideState) {
        const isFs = (overrideState !== undefined) ? overrideState : this.isFullscreen();
        if (this.dom.fullscreenBtn?.classList) {
            this.dom.fullscreenBtn.classList.toggle('active', isFs);
        }
        if (this.dom.fullscreenBtn) {
            this.dom.fullscreenBtn.setAttribute('title', isFs ? 'Exit Fullscreen (F / Esc)' : 'Fullscreen (F)');
            this.dom.fullscreenBtn.setAttribute('aria-label', isFs ? 'Exit Fullscreen' : 'Fullscreen');
        }
        if (this.dom.fullscreenIcon) {
            if (isFs) {
                this.dom.fullscreenIcon.innerHTML = `
                    <path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 10V4m0 6H4m6 0L3 3m10 7h6m-6 0V4m0 6l7-7"></path>
                `;
            } else {
                this.dom.fullscreenIcon.innerHTML = `
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                `;
            }
        }
    }

    getCurrentFrame() {
        return this.currentFrame;
    }

    getTotalFrames() {
        return this.totalFrames;
    }

    getCanvas() {
        return this.dom.canvas;
    }

    _renderCurrentFrame() {
        if (this.webglEngine && this.mode === 'all' && this.precompute?.allScene) {
            const styleConfig = MAP_STYLES[this.mapStyle] || MAP_STYLES['traewelling-dark'];
            this.webglEngine.render({
                frame: this.currentFrame,
                fps: this.fps,
                width: this.width,
                height: this.height,
                allScene: this.precompute.allScene,
                timing: this.precompute.timing,
                styleConfig
            });
            return;
        }

        if (this.ctx) {
            renderV2Frame({
                ctx: this.ctx,
                frame: this.currentFrame,
                fps: this.fps,
                width: this.width,
                height: this.height,
                trip: this.trip,
                trips: this.trips,
                mode: this.mode,
                username: this.username,
                mapStyle: this.mapStyle,
                precompute: this.precompute
            });
        }
    }

    _updateUI() {
        const progress = (this.totalFrames > 1) ? this.currentFrame / (this.totalFrames - 1) : 0;
        const pctStr = `${(progress * 100).toFixed(2)}%`;

        if (pctStr !== this._lastProgressPct) {
            this._lastProgressPct = pctStr;
            this.dom.scrubberFill.style.inlineSize = pctStr;
            this.dom.scrubberThumb.style.insetInlineStart = pctStr;
            if (typeof this.dom.wrapper?.style?.setProperty === 'function') {
                this.dom.wrapper.style.setProperty('--v2-progress', `${progress}`);
            }
        }

        // Only update aria attribute when dragging stops or throttled (every 10 frames)
        if (!this.isDraggingScrubber || this.currentFrame % 10 === 0) {
            this.dom.scrubberWrap.setAttribute('aria-valuenow', String(this.currentFrame));
        }

        // Throttle DOM text nodes: only update when the displayed seconds actually change
        const curSecs = Math.floor(this.currentFrame / this.fps);
        if (curSecs !== this._lastCurSecs) {
            this._lastCurSecs = curSecs;
            const mm = String(Math.floor(curSecs / 60)).padStart(2, '0');
            const ss = String(curSecs % 60).padStart(2, '0');
            this.dom.timeCur.textContent = `${mm}:${ss}`;
        }

        if (this.dom.timeFrame && this.currentFrame !== this._lastFrameNum) {
            this._lastFrameNum = this.currentFrame;
            this.dom.timeFrame.textContent = `${this.currentFrame}/${this.totalFrames}`;
        }
    }

    destroy() {
        this.pause();
        if (this.webglEngine) {
            try {
                this.webglEngine.destroy();
            } catch {}
            this.webglEngine = null;
        }
        if (this._seekRafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._seekRafId);
            this._seekRafId = null;
        }
        if (typeof document !== 'undefined') {
            if (typeof document.removeEventListener === 'function') {
                document.removeEventListener('fullscreenchange', this._onFullscreenChange);
                document.removeEventListener('webkitfullscreenchange', this._onFullscreenChange);
            }
            if (document.body?.classList) {
                document.body.classList.remove('v2-fullscreen-active');
            }
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('keydown', this._onKeyDown);
        }
        this.container.innerHTML = '';
    }
}
