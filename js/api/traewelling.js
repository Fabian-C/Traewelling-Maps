// Rate-limited API client for Träwelling
import { CONFIG } from '../config/config.js';

export class TraewellingAPI {
    constructor(token = null, options = {}) {
        this.token = token;
        this.requestTimes = [];
        this.onRateLimitUpdate = options.onRateLimitUpdate || null;
    }

    async waitForRateLimit() {
        const now = Date.now();
        this.requestTimes = this.requestTimes.filter(t => now - t < CONFIG.RATE_WINDOW);
        if (this.onRateLimitUpdate) {
            this.onRateLimitUpdate({ used: this.requestTimes.length });
        }

        if (this.requestTimes.length >= CONFIG.RATE_LIMIT) {
            const waitTime = CONFIG.RATE_WINDOW - (now - Math.min(...this.requestTimes)) + 100;
            console.log(`Rate limit: waiting ${waitTime}ms`);
            if (this.onRateLimitUpdate) {
                this.onRateLimitUpdate({ used: this.requestTimes.length, waitMs: waitTime });
            }
            await new Promise(r => setTimeout(r, waitTime));
            if (this.onRateLimitUpdate) {
                this.onRateLimitUpdate({ used: this.requestTimes.length });
            }
        }
        this.requestTimes.push(Date.now());
        if (this.onRateLimitUpdate) {
            this.onRateLimitUpdate({ used: this.requestTimes.length });
        }
    }

    async request(endpoint, requireAuth = false, maxRetries = 2) {
        if (requireAuth && !this.token) {
            throw new Error('API Error: Authentication token required');
        }

        let attempt = 0;
        while (true) {
            await this.waitForRateLimit();
            const headers = { 'Accept': 'application/json' };
            if (this.token) {
                headers['Authorization'] = `Bearer ${this.token}`;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
                const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
                    headers,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    if ((response.status >= 500 || response.status === 429) && attempt < maxRetries) {
                        attempt++;
                        console.warn(`Transient API error ${response.status}, retrying attempt ${attempt}...`);
                        await new Promise(r => setTimeout(r, 1500 * attempt));
                        continue;
                    }
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }
                return await response.json();
            } catch (err) {
                clearTimeout(timeoutId);
                const isNetworkOrAbort = err.name === 'AbortError' || err.message?.includes('Failed to fetch') || err.message?.includes('network');
                if (isNetworkOrAbort && attempt < maxRetries) {
                    attempt++;
                    console.warn(`Network sleep/disconnect detected on ${endpoint}, retrying attempt ${attempt}...`);
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                    continue;
                }
                throw err;
            }
        }
    }

    getUserStatuses(username, page = 1) { return this.request(`/user/${encodeURIComponent(username)}/statuses?page=${page}`); }
    getPolyline(statusId) { return this.request(`/polyline/${statusId}`).catch(() => null); }
    getPolylines(statusIds) { return this.request(`/polyline/${statusIds.join(',')}`).catch(() => null); }
    getStopovers(statusIds) {
        if (!statusIds || !statusIds.length) return Promise.resolve(null);
        return this.request(`/stopovers/${statusIds.join(',')}`).catch(() => null);
    }
    getAuthenticatedUser() { return this.request('/auth/user', true); }
    getPublicUser(username) { return this.request(`/user/${encodeURIComponent(username)}`); }
}
