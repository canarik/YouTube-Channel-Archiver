/**
 * Watch Page Content Script - Direct Injection Approach
 * Injects page-script.js into page context and relays messages
 */


console.log('[YCA Content] ==================== WATCH PAGE SCRIPT LOADED ====================');
console.log('[YCA Content] URL:', window.location.href);
console.log('[YCA Content] Time:', new Date().toISOString());

// Track page script state
let pageScriptInjected = false;
let pageScriptReady = false;

// Inject page script into the page's main context
function injectPageScript() {
    try {
        // Check if already injected using our flag (more reliable than DOM check)
        if (pageScriptInjected) {
            console.log('[YCA Content] Page script already injected (flag)');
            return;
        }

        // Also check DOM for cases where script ran before this code
        if (document.querySelector('script[data-yca-injected]')) {
            console.log('[YCA Content] Page script already injected (DOM)');
            pageScriptInjected = true;
            return;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/page-script.js');
        script.setAttribute('data-yca-injected', 'true');

        script.onload = () => {
            console.log('[YCA Content] Page script injected successfully');
            // Don't remove the script tag - keep it for detection
        };

        script.onerror = () => {
            console.error('[YCA Content] Failed to inject page script');
            pageScriptInjected = false; // Reset flag on failure
        };

        (document.head || document.documentElement).appendChild(script);
        pageScriptInjected = true;
        console.log('[YCA Content] Injecting page script...');
    } catch (e) {
        console.error('[YCA Content] Injection error:', e);
    }
}

// Listen for messages from the injected page script
window.addEventListener('message', (event) => {
    // Only accept messages from same origin
    if (event.source !== window || event.origin !== window.location.origin) {
        return;
    }

    const message = event.data;
    if (!message || message.source !== 'YCA_PAGE_SCRIPT') {
        return;
    }

    console.log('[YCA Content] Received from page script:', message.type);

    // Handle ready signal from page script
    if (message.type === 'YCA_PAGE_SCRIPT_READY') {
        console.log('[YCA Content] Page script is ready!');
        pageScriptReady = true;
        return;
    }

    if (message.type === 'YCA_DATA_EXTRACTED') {
        const { videoId, title, transcript, comments, chatReplay, options, duration } = message.data;

        console.log('[YCA Content] Data received:');
        console.log('[YCA Content] - Video ID:', videoId);
        console.log('[YCA Content] - Title:', title);
        console.log('[YCA Content] - Duration:', duration, 'seconds');
        console.log('[YCA Content] - Transcript:', transcript ? (typeof transcript === 'object' ? `${transcript.segments.length} segments` : `${transcript.length} chars`) : 'NULL');
        console.log('[YCA Content] - Comments:', comments ? comments.length : 'NULL');
        console.log('[YCA Content] - Chat:', chatReplay ? chatReplay.length : 'NULL');
        console.log('[YCA Content] - Options:', JSON.stringify(options || {}));

        // Send to background worker
        try {
            console.log('[YCA Content] Preparing to send data...');
            console.log('[YCA Content] Comments type:', typeof comments);
            console.log('[YCA Content] Comments is array:', Array.isArray(comments));
            console.log('[YCA Content] Comments value:', comments);

            // Serialize comments more robustly - preserve ALL fields including structure
            let serializedComments = null;
            if (comments && Array.isArray(comments)) {
                console.log('[YCA Content] Serializing', comments.length, 'comments...');
                try {
                    // Recursive function to serialize comment and its replies
                    const serializeComment = (c) => {
                        const serialized = {
                            id: String(c.id || ''),
                            author: String(c.author || ''),
                            text: String(c.text || ''),
                            time: String(c.time || ''),
                            likes: String(c.likes || '0'),
                            isReply: Boolean(c.isReply),
                            parentId: c.parentId ? String(c.parentId) : null
                        };

                        // Recursively serialize replies
                        if (c.replies && Array.isArray(c.replies) && c.replies.length > 0) {
                            serialized.replies = c.replies.map(serializeComment);
                        }

                        return serialized;
                    };

                    serializedComments = comments.map(serializeComment);
                    console.log('[YCA Content] Serialization successful:', serializedComments.length, 'comments');
                } catch (mapError) {
                    console.error('[YCA Content] Serialization error:', mapError);
                    serializedComments = [];
                }
            } else {
                console.log('[YCA Content] Comments is null or not an array, sending null');
            }

            console.log('[YCA Content] Sending message to background...');
            chrome.runtime.sendMessage({
                type: 'YCA_VIDEO_DATA_READY',
                payload: {
                    videoId,
                    title,
                    channelName: message.data.channelName, // Pass channel name from page script
                    duration, // Pass duration
                    transcript,
                    comments: serializedComments,
                    chatReplay,
                    options // Pass options to background
                }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    // Suppress benign "message port closed" errors - these happen when tab/background closes
                    // and don't affect functionality
                    if (!chrome.runtime.lastError.message?.includes('message port closed')) {
                        console.error('[YCA Content] Message error:', chrome.runtime.lastError);
                    }
                } else {
                    console.log('[YCA Content] Message sent to background successfully');
                }
            });
        } catch (e) {
            console.error('[YCA Content] Send error:', e);
            console.error('[YCA Content] Error stack:', e.stack);
        }
    }
});

/**
 * Wait for page script to be ready before triggering extraction
 * @param {string} videoId - The video ID to extract
 * @param {number} maxWait - Maximum time to wait in ms (default 15s)
 */
async function waitForPageScriptAndExtract(videoId, maxWait = 15000) {
    const startTime = Date.now();
    const checkInterval = 500;

    console.log('[YCA Content] Waiting for page script to be ready...');

    // Wait for page script ready signal
    while (!pageScriptReady && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        console.log('[YCA Content] Still waiting... pageScriptReady:', pageScriptReady);
    }

    if (!pageScriptReady) {
        console.error('[YCA Content] Page script not ready after', maxWait, 'ms - attempting extraction anyway');
    } else {
        console.log('[YCA Content] Page script ready after', Date.now() - startTime, 'ms');
    }

    // Page script ready signal confirms YouTube data is loaded - no additional wait needed

    console.log('[YCA Content] ========== TRIGGERING AUTOMATED EXTRACTION ==========');

    // Prevent double extraction (from both URL param and Background message)
    if (window.hasTriggeredExtraction) {
        console.log('[YCA Content] Extraction already triggered, skipping duplicate request');
        return;
    }
    window.hasTriggeredExtraction = true;

    console.log('[YCA Content] Sending extraction message to page script...');

    // Send message to page script to start extraction
    window.postMessage({
        source: 'YCA_CONTENT_SCRIPT',
        type: 'YCA_EXTRACT_DATA',
        videoId: videoId
    }, window.location.origin);

    console.log('[YCA Content] Extraction message sent');
}

// Wait for page to be ready and ytInitialData to be available
function waitForPageReady() {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) {
        console.log('[YCA Content] No video ID found');
        return;
    }

    console.log('[YCA Content] Video ID:', videoId);

    // Inject the page script first
    injectPageScript();

    // Check if this is an automated download from channel page
    const urlParams = new URLSearchParams(window.location.search);
    const isAutomatedDownload = urlParams.get('yca') === '1';

    console.log('[YCA Content] URL params:', window.location.search);
    console.log('[YCA Content] Is automated download:', isAutomatedDownload);

    if (isAutomatedDownload) {
        console.log('[YCA Content] Automated download mode - waiting for page script ready signal');
        // Use the new handshake-based approach
        waitForPageScriptAndExtract(videoId);
    }
    // Note: Manual download mode (non-automated) doesn't need logging - user knows they're on a single video page
}

// Start the process when script loads
waitForPageReady();

console.log('[YCA Content] Content script initialized');
