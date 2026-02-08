/**
 * Content Script
 * 1. Injects the Main World script (which contains Innertube/Scanner logic).
 * 2. Injects a UI Button on Channel pages.
 * 3. Listens for messages from Main World (progress) and Background (downloads).
 */

const SCRIPT_ID = 'yca-main-world';

// Inject logic into Main World
function injectMainWorldScript() {
    if (document.getElementById(SCRIPT_ID)) return;
    if (!document.body) return; // Wait for body

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('content/injected-bundle.js');
    script.type = 'text/javascript'; // Explicit type
    document.body.appendChild(script); // Inject into page context
    console.log('[YCA] Injected bundle script');
}

// Try injection immediately and on DOMContentLoaded
injectMainWorldScript();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMainWorldScript);
}


// UI Logic
function injectUI() {
    if (document.getElementById('yca-scan-btn')) return;

    // Stable containers for channel headers (before "next to subscribe" attempts)
    const container = document.querySelector('#buttons.ytd-c4-tabbed-header-renderer') ||
        document.querySelector('#channel-header-container #buttons') ||
        document.querySelector('#header #buttons') ||
        document.querySelector('#buttons');

    if (!container) return;

    const btn = document.createElement('button');
    btn.id = 'yca-scan-btn';
    btn.innerText = 'YCA Scan Channel';

    // Standard styling with "no-shrink" fix
    btn.style.cssText = `
        background: #cc0000;
        color: white;
        border: none;
        padding: 0 16px;
        margin-left: 8px;
        cursor: pointer;
        font-weight: 500;
        border-radius: 18px;
        font-size: 14px;
        font-family: "Roboto","Arial",sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 36px;
        z-index: 2147483647;
        min-width: 140px; /* Wider for "YCA Scan Channel" */
        transform: none !important;
    `;

    btn.onmouseenter = () => btn.style.backgroundColor = '#ff0000';
    btn.onmouseleave = () => btn.style.backgroundColor = '#cc0000';

    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[YCA] Button clicked: YCA Scan Channel');
        window.postMessage({ type: 'YCA_START_SCAN' }, '*');
    };

    container.appendChild(btn);
    console.log('[YCA] Injected button into', container);
}

// Reliable injection mechanism
setInterval(injectUI, 1000);
if (document.body) {
    const observer = new MutationObserver(() => injectUI());
    observer.observe(document.body, { childList: true, subtree: true });
}
injectUI();

// Message Listeners

// 1. window.message (Main World -> Content Script)
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const { type, payload } = event.data;

    switch (type) {
        case 'YCA_SCAN_PROGRESS':
            const statusProgress = document.getElementById('yca-status');
            if (statusProgress) statusProgress.innerText = `Scanned: ${payload.count} videos`;
            break;

        case 'YCA_SCAN_COMPLETE':
            const statusComplete = document.getElementById('yca-status');
            if (statusComplete) statusComplete.innerText = `Done! Found ${payload.videos.length} videos. Sending to background...`;
            chrome.runtime.sendMessage({
                type: 'YCA_PROCESS_VIDEOS',
                videos: payload.videos,
                channelId: payload.channelId
            });
            break;

        case 'YCA_START_DOWNLOAD_REQUEST':
            console.log('[YCA Content] Forwarding download request to background');
            chrome.runtime.sendMessage({
                type: 'YCA_START_DOWNLOAD',
                payload: payload
            });
            break;

        case 'YCA_SAVE_VIDEO_DATA':
            console.log('[YCA Content] Forwarding save request to background');
            chrome.runtime.sendMessage(event.data);
            break;

        case 'YCA_FETCH_VIDEO_DETAILS':
            chrome.runtime.sendMessage({ type: 'YCA_FETCH_VIDEO_DETAILS', payload: payload });
            break;
    }
});

// 2. chrome.runtime.onMessage (Background -> Content Script)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[YCA Content] Message from background:', message.type);

    if (message.type === 'YCA_FETCH_VIDEO_DETAILS') {
        window.postMessage({ type: 'YCA_FETCH_VIDEO_DETAILS', payload: message }, '*');
    } else if (message.type === 'YCA_QUEUE_COMPLETE') {
        const status = document.getElementById('yca-status');
        if (status) status.innerText = 'All downloads complete!';
        showCustomAlert('All downloads complete!');
    } else if (message.type === 'YCA_TRIGGER_EXTRACTION') {
        console.log('[YCA Content] Received TRIGGER_EXTRACTION from background');
        // Use the centralized function which handles waiting and idempotency
        waitForPageScriptAndExtract(message.videoId, message.options);
    }
});

// Helper: Custom Modal to replace window.alert
function showCustomAlert(message) {
    // Remove existing if any
    const existing = document.getElementById('yca-custom-alert');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'yca-custom-alert';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2147483647;
        font-family: Roboto, Arial, sans-serif;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        padding: 24px;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1), 0 10px 15px rgba(0,0,0,0.1);
        min-width: 320px;
        max-width: 90%;
        text-align: center;
    `;

    // Modern Dark Mode Support
    if (document.documentElement.getAttribute('dark') === 'true' ||
        document.body.classList.contains('dark-theme')) {
        modal.style.backgroundColor = '#212121';
        modal.style.color = 'white';
    }

    const title = document.createElement('h3');
    title.innerText = 'YouTube Channel Archiver says:';
    title.style.cssText = `
        margin: 0 0 16px 0;
        font-size: 18px;
        font-weight: 500;
        color: #065fd4; /* YouTube Blue */
    `;

    const text = document.createElement('p');
    text.innerText = message;
    text.style.cssText = `
        margin: 0 0 24px 0;
        font-size: 16px;
        line-height: 1.5;
    `;

    const btn = document.createElement('button');
    btn.innerText = 'OK';
    btn.style.cssText = `
        background-color: #065fd4;
        color: white;
        border: none;
        padding: 10px 24px;
        border-radius: 18px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s;
        text-transform: uppercase;
    `;

    btn.onmouseenter = () => btn.style.backgroundColor = '#003eb8';
    btn.onmouseleave = () => btn.style.backgroundColor = '#065fd4';

    btn.onclick = () => {
        overlay.remove();
    };

    modal.appendChild(title);
    modal.appendChild(text);
    modal.appendChild(btn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

console.log('[YCA] Content script initialized with stable logic.');


// Watch Page Logic

console.log('[YCA Content] Watch Page Logic Loaded');

// Track page script state
let pageScriptInjected = false;
let pageScriptReady = false;

// Inject page script into the page's main context
function injectPageScript() {
    try {
        if (pageScriptInjected) return;
        if (document.querySelector('script[data-yca-injected]')) {
            pageScriptInjected = true;
            return;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/page-script.js');
        script.setAttribute('data-yca-injected', 'true');

        script.onload = () => {
            console.log('[YCA Content] Page script injected successfully');
        };

        (document.head || document.documentElement).appendChild(script);
        pageScriptInjected = true;
        console.log('[YCA Content] Injecting page script...');
    } catch (e) {
        console.error('[YCA Content] Injection error:', e);
    }
}

// Ensure page script is available (lazy inject or on load)
injectPageScript();

// Handle messages specifically for Watch Page logic
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;

    // Page Script Handshake
    if (message.type === 'YCA_PAGE_SCRIPT_READY') {
        console.log('[YCA Content] Page script is ready!');
        pageScriptReady = true;
    }

    // Data Extraction Result
    if (message.type === 'YCA_DATA_EXTRACTED') {
        const { videoId, title, transcript, comments, chatReplay, options, channelName, duration } = message.data;

        console.log('[YCA Content] Data received for', videoId);
        console.log('[YCA Content] Duration:', duration, 'seconds');

        // Serialize comments
        let serializedComments = null;
        if (comments && Array.isArray(comments)) {
            const serializeComment = (c) => ({
                id: String(c.id || ''),
                author: String(c.author || ''),
                text: String(c.text || ''),
                time: String(c.time || ''),
                likes: String(c.likes || '0'),
                authorUrl: String(c.authorUrl || ''),
                isChannelOwner: Boolean(c.isChannelOwner),
                isMember: Boolean(c.isMember),
                member: String(c.member || ''),
                isReply: Boolean(c.isReply),
                parentId: c.parentId ? String(c.parentId) : null,
                replies: (c.replies || []).map(serializeComment)
            });
            serializedComments = comments.map(serializeComment);
        }

        // Inject export options from storage (default to true for replacement)
        chrome.storage.local.get(['exportXlsx'], (result) => {
            const exportXlsx = result.exportXlsx === true; // Default false

            // Merge into options (prioritize existing option from modal if set)
            const finalOptions = { exportXlsx, ...(options || {}) };

            chrome.runtime.sendMessage({
                type: 'YCA_VIDEO_DATA_READY',
                payload: {
                    videoId,
                    title,
                    duration, // Include duration
                    transcript,
                    comments: serializedComments,
                    chatReplay,
                    options: finalOptions,
                    channelName
                }
            });
        });
    }
});

// Wait for page script and extract
async function waitForPageScriptAndExtract(videoId, options = {}, maxWait = 15000) {
    injectPageScript(); // Ensure it's there

    const startTime = Date.now();
    console.log('[YCA Content] Waiting for page script...');

    while (!pageScriptReady && (Date.now() - startTime) < maxWait) {
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('[YCA Content] Triggering extraction for', videoId);

    // Prevent duplicate triggers in short window
    if (window.lastTriggeredVideo === videoId && (Date.now() - window.lastTriggerTime) < 5000) {
        console.log('[YCA Content] Skipping duplicate extraction request');
        return;
    }
    window.lastTriggeredVideo = videoId;
    window.lastTriggerTime = Date.now();

    window.postMessage({
        source: 'YCA_CONTENT_SCRIPT',
        type: 'YCA_EXTRACT_DATA',
        videoId: videoId,
        options: options // Pass options (ncapture, channelName, etc.)
    }, window.location.origin);
}

// Auto-run for automated downloads (URL param)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('yca') === '1') {
    const videoId = urlParams.get('v');

    if (videoId) {
        // Fetch session state from storage (more robust than URL params)
        chrome.storage.local.get('yca_session', (result) => {
            const session = result.yca_session || {};

            const options = {
                channelName: session.channelName || 'Unknown Channel',
                ncapture: session.options ? session.options.ncapture : false,
                exportXlsx: session.options ? session.options.exportXlsx : false
            };

            console.log('[YCA Content] Automated download detected. Session:', session);
            console.log('[YCA Content] Using options:', options);

            waitForPageScriptAndExtract(videoId, options);
        });
    }
}
