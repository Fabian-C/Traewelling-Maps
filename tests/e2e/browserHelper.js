import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync } from 'child_process';

/**
 * Resolve default artifact output directory for E2E screenshots and logs.
 */
export function getArtifactDir() {
    const dir = process.env.TEST_ARTIFACT_DIR || path.resolve('tests/e2e/screenshots');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Find an available Chromium/Chrome executable on PATH.
 */
function findBrowserBinary() {
    const candidates = [
        process.env.CHROME_BIN,
        'chromium-browser',
        'chromium',
        'google-chrome'
    ].filter(Boolean);

    for (const bin of candidates) {
        try {
            execSync(`command -v ${bin}`, { stdio: 'ignore' });
            return bin;
        } catch {
            // try next candidate
        }
    }
    return 'chromium-browser';
}

/**
 * Launch (or attach to) a headless Chromium instance over Chrome DevTools Protocol.
 * Set `CDP_PORT` in env to reuse a running browser across multiple E2E scripts.
 *
 * @param {object} [options]
 * @param {number} [options.port=9228]
 * @param {string} [options.profileTag='e2e']
 * @param {boolean} [options.useSwiftShader=false]
 * @param {number} [options.commandTimeoutMs=15000]
 */
export async function launchCdpBrowser(options = {}) {
    const {
        port = Number(process.env.CDP_PORT || 9228),
        profileTag = 'e2e',
        useSwiftShader = false,
        commandTimeoutMs = 15000
    } = options;

    const attachOnly = Boolean(process.env.CDP_PORT);
    let chrome = null;
    const userDataDir = path.join(os.tmpdir(), `traewelling-chrome-${profileTag}-${port}`);

    if (!attachOnly) {
        try {
            execSync(`pkill -9 -f "${userDataDir}"`, { stdio: 'ignore' });
        } catch {
            // no prior instance
        }

        const args = [
            '--headless=new',
            '--no-sandbox',
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${userDataDir}`,
            ...(useSwiftShader ? ['--use-gl=angle', '--use-angle=swiftshader'] : ['--disable-gpu']),
            'about:blank'
        ];

        chrome = spawn(findBrowserBinary(), args, { stdio: 'ignore' });
    }

    let targetTab = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json`);
            const tabs = await res.json();
            targetTab = tabs?.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
            if (targetTab) break;
        } catch {
            // retry until CDP port is ready
        }
    }

    if (!targetTab) {
        if (chrome) chrome.kill('SIGKILL');
        throw new Error(`Chromium debug port ${port} connection failed.`);
    }

    const ws = new WebSocket(targetTab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && pending.has(msg.id)) {
            const entry = pending.get(msg.id);
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            entry.resolve(msg);
        }
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP timeout waiting for ${method}`));
        }, commandTimeoutMs);
        pending.set(id, { resolve, timer });
        ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expression) => {
        const res = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (res?.result?.exceptionDetails) {
            const detail = res.result.exceptionDetails;
            throw new Error(detail.exception?.description || detail.text || 'CDP eval error');
        }
        return res?.result?.result?.value;
    };

    const close = async () => {
        try { ws.close(); } catch { /* ignore */ }
        if (chrome) {
            try { chrome.kill('SIGTERM'); } catch { /* ignore */ }
        }
    };

    return { send, evalJs, close, port };
}
