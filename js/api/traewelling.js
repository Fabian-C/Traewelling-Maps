// Rate-limited API client for Träwelling

const CONFIG = {
    API_BASE_URL: 'https://traewelling.de/api/v1',
    RATE_LIMIT: 55,
    RATE_WINDOW: 60000,
};

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

    async request(endpoint, requireAuth = false) {
        await this.waitForRateLimit();
        const headers = { 'Accept': 'application/json' };
        if (this.token || requireAuth) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, { headers });
        if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
        return response.json();
    }

    getUserStatuses(username, page = 1) { return this.request(`/user/${username}/statuses?page=${page}`); }
    getPolyline(statusId) { return this.request(`/polyline/${statusId}`).catch(() => null); }
    getPolylines(statusIds) { return this.request(`/polyline/${statusIds.join(',')}`).catch(() => null); }
    getAuthenticatedUser() { return this.request('/auth/user', true); }
    getPublicUser(username) { return this.request(`/user/${username}`); }
}
