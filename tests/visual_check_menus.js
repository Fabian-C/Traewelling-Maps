import fs from 'fs';
import { spawn, execSync } from 'child_process';

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity/brain/5ebee223-a91a-4d93-9303-bad75ea1010d/scratch';
if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function runMenuVisualCheck() {
    console.log('🚀 Starting Comprehensive Visual Checks on ALL Menus...');
    try { execSync('pkill -9 -f chrome-menu-audit'); } catch (e) {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9229',
        '--user-data-dir=/tmp/chrome-menu-audit',
        'about:blank'
    ]);

    let tabs = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9229/json');
            tabs = await res.json();
            const pageTab = tabs && tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (pageTab) {
                tabs = [pageTab];
                break;
            }
        } catch (e) {}
    }

    if (!tabs || !tabs[0] || !tabs[0].webSocketDebuggerUrl) throw new Error('Chromium debug port connection failed.');

    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
        }
    };
    await new Promise(r => { ws.onopen = r; });

    const send = (method, params = {}) => new Promise((resolve) => {
        const id = msgId++;
        callbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expr) => {
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
        if (res?.result?.exceptionDetails) {
            throw new Error(`Eval exception: ${JSON.stringify(res.result.exceptionDetails)}`);
        }
        return res?.result?.result?.value;
    };

    const capture = async (name) => {
        const res = await send('Page.captureScreenshot', { format: 'png' });
        if (res?.result?.data) {
            fs.writeFileSync(`${ARTIFACT_DIR}/${name}`, Buffer.from(res.result.data, 'base64'));
            console.log(`📸 Screenshot saved: ${name}`);
        }
    };

    await send('Page.enable');
    await send('Runtime.enable');

    const waitFor = async (expr, timeoutMs = 4000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const val = await evalJs(expr);
            if (val) return val;
            await new Promise(r => setTimeout(r, 150));
        }
        return null;
    };

    const menuDiagnostics = [];

    // =========================================================================
    // 1. MAP EXPLORER MENUS (Desktop 1440x900)
    // =========================================================================
    console.log('\n--- 1. Desktop Map Explorer Menus ---');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html?preview=search' });
    await waitFor(`document.getElementById('mainMenu')?.style.display !== 'none'`);
    await new Promise(r => setTimeout(r, 300));

    // In preview=search, mainMenu is open and searchSubmenu is open
    await capture('menu_desktop_map_search_open.png');

    const searchMetricsDesktop = await evalJs(`(() => {
        const menu = document.getElementById('mainMenu');
        const searchSubmenu = document.getElementById('searchTripsSubmenu');
        const summary = searchSubmenu?.querySelector('summary');
        const input = document.getElementById('tripSearchInput');
        return {
            menuWidth: menu?.offsetWidth,
            menuHeight: menu?.offsetHeight,
            searchSubmenuHeight: searchSubmenu?.offsetHeight,
            summaryText: summary?.textContent.trim(),
            inputWidth: input?.offsetWidth,
            inputHeight: input?.offsetHeight,
            placeholder: input?.placeholder
        };
    })()`);
    console.log('Search Menu Metrics (Desktop):', searchMetricsDesktop);
    menuDiagnostics.push({ name: 'Search Menu Desktop', ...searchMetricsDesktop });

    // Open ALL submenus in desktop slide menu to check stacking, scrolling & height
    await evalJs(`(() => {
        document.querySelectorAll('.menu-submenu').forEach(el => el.open = true);
    })()`);
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_desktop_map_all_submenus_open.png');

    // Open Stats panel on desktop
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html?preview=stats' });
    await new Promise(r => setTimeout(r, 600));
    await capture('menu_desktop_map_stats_panel.png');

    // =========================================================================
    // 2. MAP EXPLORER MENUS (Mobile 390x844)
    // =========================================================================
    console.log('\n--- 2. Mobile Map Explorer Menus ---');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html?preview=search' });
    await waitFor(`document.getElementById('mainMenu')?.style.display !== 'none'`);
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_mobile_map_search_open.png');

    const searchMetricsMobile = await evalJs(`(() => {
        const menu = document.getElementById('mainMenu');
        const searchSubmenu = document.getElementById('searchTripsSubmenu');
        const summary = searchSubmenu?.querySelector('summary');
        const input = document.getElementById('tripSearchInput');
        return {
            windowWidth: window.innerWidth,
            menuWidth: menu?.offsetWidth,
            menuHeight: menu?.offsetHeight,
            searchSubmenuHeight: searchSubmenu?.offsetHeight,
            summaryText: summary?.textContent.trim(),
            inputWidth: input?.offsetWidth,
            inputHeight: input?.offsetHeight,
            hasHorizontalScroll: document.body.scrollWidth > window.innerWidth
        };
    })()`);
    console.log('Search Menu Metrics (Mobile 390):', searchMetricsMobile);
    menuDiagnostics.push({ name: 'Search Menu Mobile', ...searchMetricsMobile });

    // Mobile stats panel
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html?preview=stats' });
    await new Promise(r => setTimeout(r, 600));
    await capture('menu_mobile_map_stats_panel.png');

    // =========================================================================
    // 3. STUDIO & TABLE WORKBENCH MENUS (Desktop & Mobile)
    // =========================================================================
    console.log('\n--- 3. Studio & Table Workbench Menus ---');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/trips.html?preview=resu' });
    await new Promise(r => setTimeout(r, 600));

    // Studio Visual Builder
    await evalJs(`document.getElementById('modeStudioBtn')?.click()`);
    await new Promise(r => setTimeout(r, 200));
    await evalJs(`document.getElementById('studioTabVisual')?.click()`);
    await new Promise(r => setTimeout(r, 200));
    await capture('menu_desktop_studio_visual_builder.png');

    // Studio SQL Console
    await evalJs(`document.getElementById('studioTabSql')?.click()`);
    await new Promise(r => setTimeout(r, 200));
    await capture('menu_desktop_studio_sql_console.png');

    // Inspector Modal
    await evalJs(`document.querySelector('.inspect-trip-btn')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_desktop_trips_inspector_modal.png');
    await evalJs(`document.getElementById('closeModalBtn')?.click()`);

    // Mobile Trips Studio & Modal
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_mobile_trips_studio.png');

    await evalJs(`document.querySelector('.inspect-trip-btn')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_mobile_trips_modal.png');
    await evalJs(`document.getElementById('closeModalBtn')?.click()`);

    // =========================================================================
    // 4. WRAPPED MENUS & MODALS
    // =========================================================================
    console.log('\n--- 4. Wrapped Menus & Modals ---');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/wrapped.html?preview=resu' });
    await new Promise(r => setTimeout(r, 600));

    // Duel Modal
    await evalJs(`document.getElementById('duelBtn')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_desktop_wrapped_duel_modal.png');
    await evalJs(`document.getElementById('duelModalCloseBtn')?.click()`);
    await new Promise(r => setTimeout(r, 200));

    // Share Modal
    await evalJs(`document.getElementById('shareModalBtn')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    await capture('menu_desktop_wrapped_share_modal.png');
    await evalJs(`document.getElementById('closeShareModalBtn')?.click()`);

    ws.close();
    chrome.kill('SIGTERM');

    console.log('\n====================================================');
    console.log('✅ ALL MENU VISUAL AUDITS FINISHED SUCCESSFULLY!');
    console.log('====================================================');
    console.log(JSON.stringify(menuDiagnostics, null, 2));
}

runMenuVisualCheck().catch(err => {
    console.error('Menu visual check failed:', err);
    process.exit(1);
});
