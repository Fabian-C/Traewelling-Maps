// RateLimitUI module
import { CONFIG } from '../config/config.js';

export const RateLimitUI = {
    init() {
        this.card = document.getElementById('rateLimitCard');
        this.label = document.getElementById('rateLimitLabel');
        this.usedBar = document.getElementById('rateLimitUsed');
        this.availableBar = document.getElementById('rateLimitAvailable');
        this.statusText = document.getElementById('rateLimitStatus');
        this.countdown = null;
        this.reset();
    },

    reset() {
        this.updateUsage(0);
        this.clearWaiting();
        this.setStatus('Ready');
    },

    updateUsage(usedCount) {
        if (!this.card) return;
        const clamped = Math.max(0, Math.min(CONFIG.RATE_LIMIT, usedCount));
        const available = Math.max(CONFIG.RATE_LIMIT - clamped, 0);
        const usedPercent = CONFIG.RATE_LIMIT ? Math.round((clamped / CONFIG.RATE_LIMIT) * 100) : 0;
        const availablePercent = CONFIG.RATE_LIMIT ? Math.round((available / CONFIG.RATE_LIMIT) * 100) : 0;

        if (this.usedBar) this.usedBar.style.width = `${usedPercent}%`;
        if (this.availableBar) this.availableBar.style.width = `${availablePercent}%`;
        if (this.label) this.label.textContent = `${clamped}/${CONFIG.RATE_LIMIT} requests used`;
    },

    showWaiting(waitMs) {
        if (!this.card) return;
        this.clearWaiting();
        this.card.classList.add('waiting');
        const end = Date.now() + waitMs;
        const tick = () => {
            const remaining = Math.max(0, end - Date.now());
            const seconds = (remaining / 1000).toFixed(1);
            this.setStatus(`Rate limit cooldown: ${seconds}s`);
            if (remaining <= 0) {
                this.clearWaiting();
            }
        };

        tick();
        this.countdown = setInterval(tick, 200);
    },

    clearWaiting() {
        if (!this.card) return;
        this.card.classList.remove('waiting');
        if (this.countdown) {
            clearInterval(this.countdown);
            this.countdown = null;
        }
    },

    setStatus(text) {
        if (this.statusText) this.statusText.textContent = text;
    }
};
