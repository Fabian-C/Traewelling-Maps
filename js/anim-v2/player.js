/**
 * Native Trip Clip Micro-Player (Zero Dependencies)
 * High-performance, frame-accurate animation player with silky smooth scrubbing,
 * keyboard shortcuts, speed control, and responsive High-DPI canvas scaling.
 */

import { renderV2Frame } from './renderer.js';

export class NativeTripPlayer {
    constructor(containerEl, options = {}) {
        if (!containerEl) {
            throw new Error('Container element is required to initialize NativeTripPlayer.');
        }

        this.container = containerEl;
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

        this._buildDOM();
        this._bindEvents();
    }

    _buildDOM() {
        this.container.innerHTML = `
            <div class="v2-player-container" tabindex="0" role="region" aria-label="Animated Journey Video Player">
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
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
            fullscreenBtn: this.container.querySelector('#v2FullscreenBtn')
        };

        this.ctx = this.dom.canvas.getContext('2d');
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

        // Scrubber drag / click
        const updateFromPointer = (e) => {
            const rect = this.dom.scrubberWrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
            const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const targetFrame = Math.round(progress * (this.totalFrames - 1));
            this.seekTo(targetFrame);
        };

        this.dom.scrubberWrap.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.isDraggingScrubber = true;
            this.dom.scrubberWrap.classList.add('dragging');
            updateFromPointer(e);

            const onPointerMove = (moveEvent) => {
                if (!this.isDraggingScrubber) return;
                updateFromPointer(moveEvent);
            };

            const onPointerUp = () => {
                this.isDraggingScrubber = false;
                this.dom.scrubberWrap.classList.remove('dragging');
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        });

        // Hover tooltip on scrubber
        this.dom.scrubberWrap.addEventListener('pointermove', (e) => {
            const rect = this.dom.scrubberWrap.getBoundingClientRect();
            if (rect.width <= 0) return;
            const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const hoverFrame = Math.round(progress * (this.totalFrames - 1));
            const hoverSecs = hoverFrame / this.fps;
            const mm = String(Math.floor(hoverSecs / 60)).padStart(2, '0');
            const ss = String(Math.floor(hoverSecs % 60)).padStart(2, '0');

            this.dom.scrubberTooltip.textContent = `${mm}:${ss} (F${hoverFrame})`;
            this.dom.scrubberTooltip.style.left = `${progress * 100}%`;
        });

        // Keyboard navigation
        this.dom.wrapper.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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
            }
        });
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

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.dom.wrapper.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
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

    _updateUI() {
        const progress = (this.totalFrames > 1) ? this.currentFrame / (this.totalFrames - 1) : 0;
        const pctStr = `${(progress * 100).toFixed(2)}%`;
        this.dom.scrubberFill.style.inlineSize = pctStr;
        this.dom.scrubberThumb.style.insetInlineStart = pctStr;
        this.dom.scrubberWrap.setAttribute('aria-valuenow', String(this.currentFrame));

        const curSecs = this.currentFrame / this.fps;
        const mm = String(Math.floor(curSecs / 60)).padStart(2, '0');
        const ss = String(Math.floor(curSecs % 60)).padStart(2, '0');
        this.dom.timeCur.textContent = `${mm}:${ss}`;
        this.dom.timeFrame.textContent = `${this.currentFrame}/${this.totalFrames}`;
    }

    destroy() {
        this.pause();
        this.container.innerHTML = '';
    }
}
