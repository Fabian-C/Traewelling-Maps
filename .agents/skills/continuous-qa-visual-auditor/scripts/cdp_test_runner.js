import fs from 'fs';
import { spawn, execSync } from 'child_process';

/**
 * Reusable CDP Test Runner for Autonomous Visual Auditing & Gesture Testing
 */
export class CdpTestRunner {
    constructor(options = {}) {
        this.port = options.port || 9227;
        this.userDataDir = options.userDataDir || '/tmp/chrome-test-cdp';
        this.screenshotDir = options.screenshotDir || './scratch';
        this.chrome = null;
        this.ws = null;
        this.msgId = 1;
        this.callbacks = new Map();
    }

    async start() {
        try { execSync(`pkill -9 -f chrome-test-cdp`); } catch (e) {}

        this.chrome = spawn('chromium-browser', [
            '--headless=new',
            '--no-sandbox',
            '--disable-gpu',
            `--remote-debugging-port=${this.port}`,
            `--user-data-dir=${this.userDataDir}`,
            'about:blank'
        ]);

        let tabs = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const listRes = await fetch(`http://127.0.0.1:${this.port}/json`);
                tabs = await listRes.json();
                if (tabs && tabs.length > 0 && tabs[0].webSocketDebuggerUrl) break;
            } catch (e) {}
        }

        if (!tabs || !tabs[0].webSocketDebuggerUrl) {
            throw new Error(`Failed to connect to Chromium debug port ${this.port}`);
        }

        this.ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && this.callbacks.has(msg.id)) {
                this.callbacks.get(msg.id)(msg);
                this.callbacks.delete(msg.id);
            }
        };

        await new Promise(resolve => this.ws.onopen = resolve);

        await this.send('Page.enable');
        await this.send('Runtime.enable');
    }

    send(method, params = {}) {
        return new Promise((resolve) => {
            const id = this.msgId++;
            this.callbacks.set(id, resolve);
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const res = await this.send('Runtime.evaluate', { expression, returnByValue: true });
        if (res?.result?.exceptionDetails) {
            throw new Error(`CDP Eval Error: ${JSON.stringify(res.result.exceptionDetails)}`);
        }
        return res?.result?.result?.value;
    }

    async setViewport(name = 'desktop') {
        const viewports = {
            desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
            tablet: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false },
            mobile_portrait: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
            mobile_landscape: { width: 844, height: 390, deviceScaleFactor: 2, mobile: true }
        };
        const config = viewports[name] || viewports.desktop;
        await this.send('Emulation.setDeviceMetricsOverride', config);
    }

    async navigate(url) {
        await this.send('Page.navigate', { url });
    }

    async waitFor(predicateFn, maxPolls = 30, intervalMs = 200) {
        for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, intervalMs));
            const passed = await predicateFn();
            if (passed) return true;
        }
        throw new Error('Timeout waiting for predicate condition');
    }

    async captureScreenshot(filename) {
        const res = await this.send('Page.captureScreenshot', { format: 'png' });
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }
        const filepath = `${this.screenshotDir}/${filename}`;
        fs.writeFileSync(filepath, Buffer.from(res.result.data, 'base64'));
        return filepath;
    }

    async close() {
        if (this.ws) {
            try { this.ws.close(); } catch (e) {}
        }
        if (this.chrome) {
            try { this.chrome.kill('SIGTERM'); } catch (e) {}
        }
    }
}
