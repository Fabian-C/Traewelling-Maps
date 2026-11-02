import fs from 'fs';
import { spawn, execSync } from 'child_process';

const ARTIFACT_DIR = process.env.TEST_ARTIFACT_DIR || '/home/ubuntu/.gemini/antigravity/brain/5ebee223-a91a-4d93-9303-bad75ea1010d';

async function runTimeframeE2ETest() {
    console.log('====================================================');
    console.log('🚀 TESTING ANIMATION V2 ALL-TRIPS 7-DAY DEFAULT TIMEFRAME');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-anim-tf'); } catch (e) {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9229',
        '--user-data-dir=/tmp/chrome-test-anim-tf',
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9229/json');
            const tabs = await res.json();
            targetTab = tabs?.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
            if (targetTab) break;
        } catch (e) {}
    }

    if (!targetTab) {
        throw new Error('Chromium debug port connection failed.');
    }

    const ws = new WebSocket(targetTab.webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
        }
    };
    await new Promise(r => ws.onopen = r);

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
        fs.writeFileSync(`${ARTIFACT_DIR}/${name}`, Buffer.from(res.result.data, 'base64'));
        console.log(`📸 Screenshot saved: ${name}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    // 1. Navigate to animation-v2 with mode=all
    console.log('1. Navigating to animation-v2.html?user=resu&mode=all ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation-v2.html?user=resu&mode=all' });

    // Wait for ready
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        const ready = await evalJs(`Boolean(document.getElementById('timeframeSelect')) && document.querySelectorAll('#tripSelect option').length > 0`);
        if (ready) break;
    }

    const state = await evalJs(`(() => {
        const tfSelect = document.getElementById('timeframeSelect');
        const tripSelect = document.getElementById('tripSelect');
        const timeframeGroup = document.getElementById('timeframeGroup');
        return {
            timeframeValue: tfSelect ? tfSelect.value : null,
            tripSelectValue: tripSelect ? tripSelect.value : null,
            timeframeGroupDisplay: timeframeGroup ? timeframeGroup.style.display : null,
            selectedOptionText: tfSelect?.selectedOptions?.[0]?.text
        };
    })()`);

    console.log('All-Trips timeframe default check:', state);

    if (state.timeframeValue !== 'last-7-days') {
        throw new Error(`Expected timeframe to default to 'last-7-days', got '${state.timeframeValue}'!`);
    }

    await capture('screenshot_anim_v2_all_7days_default.png');

    // 2. Test Share Animation Button
    console.log('2. Testing Share Animation Clip Link button...');
    const shareBtnStateBefore = await evalJs(`(() => {
        const btn = document.getElementById('shareAnimationBtn');
        return { exists: Boolean(btn), text: btn?.textContent.trim() };
    })()`);
    console.log('Share button before click:', shareBtnStateBefore);

    if (!shareBtnStateBefore.exists) {
        throw new Error('Share animation button (#shareAnimationBtn) not found in DOM!');
    }

    // Click share button and verify feedback state
    await evalJs(`document.getElementById('shareAnimationBtn').click()`);
    await new Promise(r => setTimeout(r, 400));

    const shareBtnStateAfter = await evalJs(`(() => {
        const btn = document.getElementById('shareAnimationBtn');
        return {
            hasCopiedClass: btn?.classList.contains('copied'),
            btnText: btn?.textContent.trim()
        };
    })()`);
    console.log('Share button after click:', shareBtnStateAfter);

    if (!shareBtnStateAfter.btnText.includes('Copied')) {
        throw new Error(`Expected button text to show 'Link Copied', got '${shareBtnStateAfter.btnText}'`);
    }

    await capture('screenshot_anim_share_button_feedback.png');

    // Close chrome
    try {
        ws.close();
        chrome.kill();
    } catch (e) {}

    console.log('====================================================');
    console.log('🎉 ALL-TRIPS 7-DAY DEFAULT TIMEFRAME TEST PASSED!');
    console.log('====================================================');
}

runTimeframeE2ETest().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});

