/**
 * Page Script - Runs in page's main JavaScript context
 * Has access to window.ytInitialData, window.ytcfg, and other YouTube internals
 * Communicates with content script via window.postMessage
 */

console.log('[YCA Page] Script injected into page context');

(function () {
    'use strict';

    console.log('[YCA Page] Initializing...');

    // Send ready signal to content script
    window.postMessage({
        source: 'YCA_PAGE_SCRIPT',
        type: 'YCA_PAGE_SCRIPT_READY'
    }, window.location.origin);
    console.log('[YCA Page] Sent ready signal');

    /**
     * Simple Concurrency Queue
     * Allows parallel execution of async tasks with a concurrency limit
     * Used for parallel reply fetching for high performance
     */
    class SimpleQueue {
        constructor(concurrency = 4) {
            this.concurrency = concurrency;
            this.running = 0;
            this.queue = [];
        }

        add(fn) {
            return new Promise((resolve, reject) => {
                this.queue.push({ fn, resolve, reject });
                this.process();
            });
        }

        async process() {
            // Don't start new tasks if we're at capacity or queue is empty
            if (this.running >= this.concurrency || this.queue.length === 0) {
                return;
            }

            this.running++;
            const { fn, resolve, reject } = this.queue.shift();

            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                this.running--;
                this.process();  // Process next item in queue
            }
        }

        async onIdle() {
            // Wait until all tasks are complete
            while (this.running > 0 || this.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    /**
     * Wait for YouTube's ytInitialData and ytcfg to be available
     * Background tabs take longer to initialize these objects
     */
    async function waitForYouTubeData(maxWait = 30000) {
        const startTime = Date.now();
        const checkInterval = 200;

        console.log('[YCA Page] Waiting for YouTube data to load...');
        console.log('[YCA Page] Current URL:', window.location.href);

        let lastStatus = '';
        while ((Date.now() - startTime) < maxWait) {
            let status = [];

            // Check ytInitialData
            if (!window.ytInitialData) {
                status.push('ytInitialData: missing');
            } else {
                status.push('ytInitialData: OK');
            }

            // Check ytcfg
            if (!window.ytcfg || typeof window.ytcfg.get !== 'function') {
                status.push('ytcfg: missing');
            } else {
                const apiKey = window.ytcfg.get('INNERTUBE_API_KEY');
                const context = window.ytcfg.get('INNERTUBE_CONTEXT');

                if (!apiKey) {
                    status.push('apiKey: missing');
                } else {
                    status.push('apiKey: OK');
                }

                if (!context) {
                    status.push('context: missing');
                } else {
                    status.push('context: OK');
                }

                // If we have everything, we're ready
                if (apiKey && context && window.ytInitialData) {
                    console.log('[YCA Page] YouTube data ready after', Date.now() - startTime, 'ms');
                    console.log('[YCA Page] API Key:', apiKey.substring(0, 10) + '...');
                    console.log('[YCA Page] ytInitialData size:', JSON.stringify(window.ytInitialData).length, 'chars');

                    // Pause video immediately to prevent autoplay
                    try {
                        const video = document.querySelector('video');
                        if (video && !video.paused) {
                            video.pause();
                            console.log('[YCA Page] Video paused to prevent autoplay');
                        }
                    } catch (e) {
                        console.error('[YCA Page] Error pausing video:', e);
                    }

                    return true;
                }
            }

            // Log status changes
            const currentStatus = status.join(', ');
            if (currentStatus !== lastStatus) {
                console.log('[YCA Page] Status at', Date.now() - startTime, 'ms:', currentStatus);
                lastStatus = currentStatus;
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        console.error('[YCA Page] YouTube data not ready after', maxWait, 'ms');
        console.error('[YCA Page] Final status:', lastStatus);
        return false;
    }

    // Listen for extraction requests from content script
    window.addEventListener('message', async (event) => {
        console.log('[YCA Page] Message received:', event.data?.type, 'from:', event.data?.source);

        if (event.source !== window) {
            console.log('[YCA Page] Message ignored - not from window');
            return;
        }
        if (event.data.source !== 'YCA_CONTENT_SCRIPT') {
            console.log('[YCA Page] Message ignored - not from YCA content script');
            return;
        }
        if (event.data.type !== 'YCA_EXTRACT_DATA') {
            console.log('[YCA Page] Message ignored - not extraction request');
            return;
        }

        console.log('[YCA Page] Starting data extraction');
        console.log('[YCA Page] Video ID:', event.data.videoId);

        // Wait for YouTube data to be ready (critical for background tabs)
        const dataReady = await waitForYouTubeData();
        if (!dataReady) {
            console.warn('[YCA Page] Proceeding with extraction despite YouTube data not being fully ready');
        }

        const videoId = event.data.videoId;
        const options = event.data.options || {}; // Extract options (like ncapture)

        // Try multiple methods to get the title
        let title = null;

        // Method 1: From ytInitialData
        if (window.ytInitialData) {
            title = window.ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer?.title?.runs?.[0]?.text ||
                window.ytInitialData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.simpleText;
        }

        // Method 2: From DOM (h1 element)
        if (!title) {
            title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
                document.querySelector('h1.title yt-formatted-string')?.textContent?.trim() ||
                document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim();
        }

        // Method 3: From document title
        if (!title) {
            const docTitle = document.title;
            if (docTitle && docTitle !== 'YouTube') {
                title = docTitle.replace(' - YouTube', '').trim();
            }
        }

        // Fallback
        if (!title) {
            title = 'Unknown Title';
            console.warn('[YCA Page] Could not extract video title, using fallback');
        }

        console.log('[YCA Page] Title extracted:', title);

        // Extract Channel Name
        let channelName = 'Unknown Channel';
        if (window.ytInitialData) {
            channelName = window.ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer?.owner?.videoOwnerRenderer?.title?.runs?.[0]?.text;
        }
        if (!channelName || channelName === 'Unknown Channel') {
            channelName = document.querySelector('#owner-name a')?.textContent?.trim() ||
                document.querySelector('div#upload-info ytd-channel-name a')?.textContent?.trim() ||
                document.querySelector('div#owner #channel-name a')?.textContent?.trim();
        }
        channelName = channelName || 'Unknown Channel';

        // Prefer channel name from options if available (passed from bulk download context)
        if (options.channelName && options.channelName !== 'Unknown Channel') {
            channelName = options.channelName;
        }

        console.log('[YCA Page] Channel extracted:', channelName);

        // Extract video duration (in seconds) for NCapture
        // CRITICAL: NVivo validates against microformat.lengthSeconds, not videoDetails.lengthSeconds
        // These can differ by 1 second due to rounding, causing NVivo to reject the file
        let duration = 0;
        try {
            // Method A: From ytInitialPlayerResponse.microformat (NVivo's validation source)
            if (window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.lengthSeconds) {
                duration = parseInt(window.ytInitialPlayerResponse.microformat.playerMicroformatRenderer.lengthSeconds, 10);
                console.log('[YCA Page] Duration from microformat.lengthSeconds:', duration);
            }
            // Method B: From ytInitialPlayerResponse.videoDetails (fallback)
            else if (window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds) {
                duration = parseInt(window.ytInitialPlayerResponse.videoDetails.lengthSeconds, 10);
                console.log('[YCA Page] Duration from videoDetails.lengthSeconds:', duration);
            }
            // Method C: From video element (last resort)
            else {
                const videoElement = document.querySelector('video');
                if (videoElement && videoElement.duration && !isNaN(videoElement.duration)) {
                    duration = Math.ceil(videoElement.duration); // Use ceil to match microformat rounding
                    console.log('[YCA Page] Duration from video element (ceil):', duration);
                }
            }
        } catch (e) {
            console.error('[YCA Page] Error extracting duration:', e);
        }

        console.log('[YCA Page] Final duration:', duration, 'seconds');

        // Extract data
        const transcript = await extractTranscript(videoId, options);
        const comments = await extractComments(videoId);
        const chatReplay = null; // Not implemented yet

        console.log('[YCA Page] Transcript:', transcript ? transcript.length + ' chars' : 'NULL');
        console.log('[YCA Page] Comments:', comments ? comments.length + ' items' : 'NULL');
        console.log('[YCA Page] Chat replay:', chatReplay ? 'YES' : 'NULL');

        // Send data back to content script
        window.postMessage({
            source: 'YCA_PAGE_SCRIPT',
            type: 'YCA_DATA_EXTRACTED',
            data: {
                videoId,
                title,
                channelName, // Pass channel name
                duration, // Pass duration in seconds
                transcript,
                comments,
                chatReplay,
                options // Pass options back
            }
        }, window.location.origin);

        console.log('[YCA Page] Data extraction complete');
    });

    // Helper function to recursively search for transcriptCueGroupRenderer objects


    /**
     * Extract transcript using direct method - direct data access from ytInitialData
     * This is FAST and AUTOMATIC - no DOM clicking needed!
     */
    async function extractTranscript(videoId, options) {
        try {
            // DOM extraction is the most reliable method
            // API method consistently fails with "Precondition check failed" errors
            return await extractTranscriptFromDOM(options);
        } catch (error) {
            console.error('[YCA Page] Transcript extraction error:', error);
            return null;
        }
    }

    // New Helper: Extract from DOM by clicking button
    async function extractTranscriptFromDOM(options) {
        try {
            console.log('[YCA Page] Starting DOM-based transcript extraction...');

            // 1. Check if transcript is already open
            let segments = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segments.length > 0) {
                console.log('[YCA Page] Transcript panel already open!');
                return parseDomSegments(segments, options);
            }

            // 2. Find "Show transcript" button (with retry for slow-loading pages)
            let button = document.querySelector('ytd-video-description-transcript-section-renderer button');

            // Retry logic with Description Expansion
            let retries = 0;
            while (!button && retries < 3) {
                console.log('[YCA Page] Transcript button not found, checking if description needs expansion... (attempt', retries + 1, '/3)');

                // Try to expand description if collapsed
                const expandBtn = document.querySelector('#expand.ytd-text-inline-expander') ||
                    document.querySelector('#more.ytd-video-secondary-info-renderer') ||
                    document.querySelector('tp-yt-paper-button#expand');

                if (expandBtn && expandBtn.offsetParent !== null) { // Check visibility
                    console.log('[YCA Page] Found "More" button, clicking to expand description...');
                    expandBtn.click();
                    await new Promise(r => setTimeout(r, 800)); // Wait for expansion
                } else {
                    console.log('[YCA Page] No expandable description found or already expanded.');
                    await new Promise(r => setTimeout(r, 500)); // Just wait
                }

                button = document.querySelector('ytd-video-description-transcript-section-renderer button');
                retries++;
            }

            if (!button) {
                console.log('[YCA Page] "Show transcript" button not found in DOM after retries');
                // Try searching by aria-label or text just in case
                const allButtons = Array.from(document.querySelectorAll('button'));
                const showTranscriptBtn = allButtons.find(b => b.textContent.includes('Show transcript') || b.getAttribute('aria-label') === 'Show transcript');
                if (showTranscriptBtn) {
                    console.log('[YCA Page] Found button via text search, clicking...');
                    showTranscriptBtn.click();
                    await new Promise(r => setTimeout(r, 1500)); // Wait for panel
                    return parseDomSegments(document.querySelectorAll('ytd-transcript-segment-renderer'), options);
                }
                return null;
            }

            console.log('[YCA Page] Clicking "Show transcript" button...');
            button.click();

            // 3. Wait for segments to load
            await new Promise(r => setTimeout(r, 1500));

            // Query from specific panel to avoid duplicates
            const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
            if (panel) {
                segments = panel.querySelectorAll('ytd-transcript-segment-renderer');
                console.log('[YCA Page] Found transcript panel, querying segments from it');
            } else {
                segments = document.querySelectorAll('ytd-transcript-segment-renderer');
                console.log('[YCA Page] Panel not found, using global query');
            }

            if (segments.length === 0) {
                console.log('[YCA Page] No segments found in DOM after click');
                return null;
            }

            return parseDomSegments(segments, options);

        } catch (e) {
            console.error('[YCA Page] DOM extraction error:', e);
            return null;
        }
    }

    // Helper: Convert timestamp to seconds
    function timeToSeconds(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        } else if (parts.length === 3) {
            return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
        }
        return 0;
    }

    // Helper: Format seconds to NVivo timespan format (H:MM:SS,S or M:SS,S)
    function formatNVivoTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const decimal = Math.floor((secs % 1) * 10);

        const sSecs = String(Math.floor(secs)).padStart(2, '0');

        if (hours > 0) {
            const sMins = String(mins).padStart(2, '0');
            return `${hours}:${sMins}:${sSecs},${decimal}`;
        }

        return `${mins}:${sSecs},${decimal}`;
    }

    // Helper: Parse DOM segments and group into 10-second intervals
    function parseDomSegments(segments, options) {
        console.log('[YCA Page] Parsing', segments.length, 'DOM segments');
        const lines = [];
        const structured = [];

        // Check format option
        // User requested NVivo format (Grouped 10s, TSV) applies when XLSX (or NCapture) is selected
        const useNVivoFormat = options?.exportXlsx === true || options?.ncapture === true;
        console.log('[YCA Page] Formatting transcript with:', useNVivoFormat ? 'NVivo Format (Grouped)' : 'Classic Format (Line-by-Line)');

        if (useNVivoFormat) {
            // NVivo Logic (Grouped 10s)
            const nvivoLines = [];

            // Add NVivo header
            nvivoLines.push('\tTimespan\tContent\tSpeaker');

            // First pass: Extract all segments with timestamps and text
            const allSegments = [];
            segments.forEach((seg, index) => {
                const time = seg.querySelector('.segment-timestamp')?.textContent?.trim() || '';
                let text = seg.querySelector('.segment-text')?.textContent?.trim() || '';

                if (text) {
                    // Sanitize text: remove newlines, tabs, and carriage returns
                    text = text.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();

                    const startSeconds = timeToSeconds(time);
                    const nextTime = segments[index + 1]?.querySelector('.segment-timestamp')?.textContent?.trim();
                    const endSeconds = nextTime ? timeToSeconds(nextTime) : startSeconds + 3;

                    allSegments.push({
                        time: time,
                        text: text,
                        startSeconds: startSeconds,
                        endSeconds: endSeconds
                    });
                }
            });

            // Second pass: Group into ~10-second intervals
            const INTERVAL = 10; // seconds
            const grouped = [];
            let currentGroup = {
                startSeconds: 0,
                endSeconds: 0,
                texts: []
            };

            allSegments.forEach((seg) => {
                // If adding this segment would exceed 10 seconds AND we have content
                if (currentGroup.texts.length > 0 &&
                    seg.endSeconds - currentGroup.startSeconds > INTERVAL) {
                    // Save current group
                    grouped.push({ ...currentGroup });
                    // Start new group
                    currentGroup = {
                        startSeconds: seg.startSeconds,
                        endSeconds: seg.endSeconds,
                        texts: [seg.text]
                    };
                } else {
                    // Add to current group
                    if (currentGroup.texts.length === 0) {
                        currentGroup.startSeconds = seg.startSeconds;
                    }
                    currentGroup.endSeconds = seg.endSeconds;
                    currentGroup.texts.push(seg.text);
                }
            });

            // Don't forget the last group
            if (currentGroup.texts.length > 0) {
                grouped.push(currentGroup);
            }

            console.log('[YCA Page] Grouped', allSegments.length, 'segments into', grouped.length, 'intervals');

            // Third pass: Format for NVivo output
            let lineNumber = 1;
            grouped.forEach((group) => {
                const combinedText = group.texts.join(' ');
                const startFormatted = formatNVivoTime(group.startSeconds);
                const endFormatted = formatNVivoTime(group.endSeconds);
                const nvivoLine = `${lineNumber}\t${startFormatted} - ${endFormatted}\t${combinedText}\t`;
                nvivoLines.push(nvivoLine);

                // Keep old format for backward compatibility (optional, but requested logic is strict switch)
                // lines.push(`Time: ${formatNVivoTime(group.startSeconds)}\n${combinedText}\nstart offset: 0 | duration: 0`);

                structured.push({
                    time: formatNVivoTime(group.startSeconds),
                    text: combinedText,
                    startMs: group.startSeconds * 1000,
                    durationMs: (group.endSeconds - group.startSeconds) * 1000
                });

                lineNumber++;
            });

            console.log('[YCA Page] Processed', grouped.length, 'grouped segments');

            // Return NVivo-formatted text
            return nvivoLines.length > 1 ? { // > 1 because header is pushed
                text: nvivoLines.join('\r\n'),
                segments: structured
            } : null;

        } else {
            // Classic Logic (Line-by-Line)
            segments.forEach(seg => {
                const time = seg.querySelector('.segment-timestamp')?.textContent?.trim() || '';
                const text = seg.querySelector('.segment-text')?.textContent?.trim() || '';

                if (text) {
                    lines.push(`Time: ${time}\n${text}`);
                    structured.push({
                        time: time,
                        text: text,
                        startMs: 0,
                        durationMs: 0
                    });
                }
            });

            console.log('[YCA Page] Processed', structured.length, 'segments (Classic)');
            return lines.length > 0 ? { text: lines.join('\n\n'), segments: structured } : null;
        }
    }

    // Helper: Find getTranscriptEndpoint and sibling tracking params


    // Helper: Format segments into text
    function formatTranscriptSegments(segments) {
        const lines = [];
        const structured = [];
        for (const segment of segments) {
            try {
                const time = segment.formattedStartOffset?.simpleText || '';
                const text = segment.cues?.[0]?.transcriptCueRenderer?.cue?.simpleText || '';
                const startMs = segment.cues?.[0]?.transcriptCueRenderer?.startOffsetMs || 0;
                const durationMs = segment.cues?.[0]?.transcriptCueRenderer?.durationMs || 0;

                if (text) {
                    lines.push(`Time: ${time}\n${text}\nstart offset: ${startMs} | duration: ${durationMs}`);
                    structured.push({
                        time: time,
                        text: text,
                        startMs: startMs,
                        durationMs: durationMs
                    });
                }
            } catch (err) {
                console.warn('[YCA Page] Error processing segment:', err);
            }
        }
        console.log('[YCA Page] Extracted', lines.length, 'transcript lines');
        return lines.length > 0 ? { text: lines.join('\n\n'), segments: structured } : null;
    }

    // Fetch transcript from API
    async function fetchTranscript(endpointData, videoId) {
        try {
            console.log('[YCA Page] Calling get_transcript API...');
            const { endpoint, clickTrackingParams } = endpointData;

            console.log('[YCA Page] Endpoint Params:', endpoint.params);
            console.log('[YCA Page] Click Tracking Params:', clickTrackingParams);

            let apiKey = null;
            let context = null;

            if (typeof window.ytcfg?.get === 'function') {
                apiKey = window.ytcfg.get('INNERTUBE_API_KEY');
                const rawContext = window.ytcfg.get('INNERTUBE_CONTEXT');
                if (rawContext) {
                    context = JSON.parse(JSON.stringify(rawContext));
                }
            }

            if (!apiKey || !context) {
                console.log('[YCA Page] API key or context not available');
                return null;
            }

            // Update context with clickTrackingParams
            if (clickTrackingParams) {
                context.clickTracking = {
                    clickTrackingParams: clickTrackingParams
                };
            }

            const payload = {
                context: context,
                params: endpoint.params
            };

            // Note: Do NOT add clickTrackingParams to root if it is already in context.
            // Some versions might require it, but context is safer.
            // payload.videoId = videoId; 
            // payload.v = videoId;

            const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'include'
            });

            if (!response.ok) {
                console.error('[YCA Page] Transcript API failed:', response.status);
                try {
                    const errorText = await response.text();
                    console.error('[YCA Page] Error Body:', errorText);
                } catch (e) { }
                return null;
            }

            const data = await response.json();
            console.log('[YCA Page] Transcript API response received');

            // Parse the response for segments
            const segments = findTranscriptSegments(data);
            if (segments && segments.length > 0) {
                console.log('[YCA Page] Found', segments.length, 'segments in API response');
                return formatTranscriptSegments(segments);
            }

            console.log('[YCA Page] No segments found in API response');
            return null;

        } catch (e) {
            console.error('[YCA Page] Transcript fetch error:', e);
            return null;
        }
    }

    /**
     * Extract comments from ytInitialData (Deep Scan Version)
     */
    // --- IndexedDB Helpers ---
    const DB_NAME = 'YCA_DB';
    const STORE_NAME = 'comments';
    const DB_VERSION = 1;

    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (e) => reject(e.target.error);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    async function clearCommentStore(db) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveCommentBatch(db, comments) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => {
                console.error('[YCA DB] Save Error:', e.target.error);
                resolve(); // Don't crash
            };

            comments.forEach(c => {
                // Ensure ID exists
                if (!c.id) c.id = Math.random().toString(36).substr(2, 9);
                store.put(c);
            });
        });
    }

    async function getAllComments(db) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NAME], 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }
    // -------------------------

    let isExtracting = false;

    /**
     * Extract comments from ytInitialData (Deep Scan Version)
     */
    async function extractComments(videoId) {
        if (isExtracting) {
            console.warn('[YCA Page] Extraction already in progress. Ignoring request.');
            return null;
        }
        isExtracting = true;

        try {
            console.log('[YCA Page] Extracting comments (Deep Scan)...');

            // NEW: Switch to "Newest first" sort before extracting
            // Robustly find the first comment ID
            // NEW STRATEGY: API-Based Sort Switching (No UI Clicking)
            // We find the "Newest First" continuation token from the sort menu and use it directly.

            // 1. Robust Recursion Helper (Simulating wildcard matching)
            const deepFind = (obj, targetKey) => {
                const results = [];
                const visited = new Set();

                const search = (current) => {
                    if (!current || typeof current !== 'object') return;
                    if (visited.has(current)) return;
                    visited.add(current);

                    if (Array.isArray(current)) {
                        for (const item of current) {
                            search(item);
                        }
                        return;
                    }

                    for (const [key, value] of Object.entries(current)) {
                        if (key === targetKey) {
                            results.push(value);
                        }
                        search(value);
                    }
                };

                search(obj);
                return results;
            };

            // 2. Find "Newest First" Token using Deep Search
            let newestToken = null;

            // Search in ytInitialData first
            const dataSources = [
                window.ytInitialData,
                document.querySelector('ytd-comments ytd-item-section-renderer')?.data
            ].filter(Boolean);

            console.log(`[YCA Page] Searching for tokens via Deep Search in ${dataSources.length} sources...`);

            for (const source of dataSources) {
                // Find all 'sortFilterSubMenuRenderer' occurrences
                const sortMenus = deepFind(source, 'sortFilterSubMenuRenderer');

                for (const menu of sortMenus) {
                    if (menu.subMenuItems) {
                        for (const item of menu.subMenuItems) {
                            if (item.title && (item.title.includes('Newest') || item.title.includes('En yeni'))) {
                                newestToken = item.serviceEndpoint?.continuationCommand?.token ||
                                    item.command?.continuationCommand?.token;
                                if (newestToken) {
                                    console.log('[YCA Page] Found "Newest First" token via Deep Search:', newestToken);
                                    break;
                                }
                            }
                        }
                    }
                    if (newestToken) break;
                }
                if (newestToken) break;
            }

            if (!newestToken) {
                console.warn('[YCA Page] Could not find "Newest First" token via Deep Search.');
            }

            // Legacy Safety Bypass (we already found it)
            if (newestToken) {
                // console.log("Bypassing legacy search");
            } else {
                // proceed to legacy as fallback
            }

            // Legacy logic removed. Deep Search results propagate to 'continuationToken' below.

            // Parse Entity Store (Global)
            let entityStore = new Map();
            if (window.ytInitialData?.frameworkUpdates) {
                entityStore = parseEntityStore(window.ytInitialData.frameworkUpdates);
            }

            const comments = [];

            // If we found a generic "Newest First" token, we start the loop with THAT.
            // But we also need the *initial* comments that might be displayed? 
            // Actually, if we use the sort token, the API response will contain the first batch of sorted comments.
            // So we can skip scraping the *current* page DOM (which is Top Comments) and just go straight to fetching.

            let continuationToken = newestToken;

            // However, if we failed to find the token, we must fall back to the existing DOM method 
            // (scraping what's there and finding the "Load More" button).

            if (!continuationToken) {
                // Fallback: Scraping visible (Top) comments
                console.log('[YCA Page] No sort token. Scraping initial DOM comments...');
                // ... existing logic to scrape DOM ...
                // (This usually results in the 2800 limit, but it is a valid fallback)

                // Reuse existing DOM scraping logic only if we didn't find the token
                // ... [We need to preserve the logic below but conditionally] ...
            }

            // We will simplify: If we have the token, we jump straight to the loop. 
            // If not, we try to find the normal continuation token from the DOM.

            // If not, we try to find the normal continuation token from the DOM.

            if (!continuationToken) {
                // Try to find the DEFAULT continuation token from the DOM (Load More)
                const liveData = document.querySelector('ytd-comments ytd-item-section-renderer')?.data ||
                    window.ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.itemSectionRenderer; // fallback

                const contents = liveData?.contents;
                if (contents) {
                    // 1. Scrape initial visible comments (only if we are using default view)
                    // If we are switching sort via API, we ignore these because they are "Top"
                    // Actually, user wants "Newest", so if we are forced to use Top, we should warn?
                    // Let's just scrape them.

                    // ... extract logic ...
                    // To avoid duplicating code, I'll assume we proceed to finding the continuation item

                    const contItem = contents.find(i => i.continuationItemRenderer);
                    if (contItem) {
                        continuationToken = contItem.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token ||
                            contItem.continuationItemRenderer.button?.buttonRenderer?.command?.continuationCommand?.token;
                    }
                }
            } else {
                console.log('[YCA Page] Starting fetch loop using "Newest First" token...');
            }

            // Loop
            console.log('[YCA Page] Fetching comment batches...');
            let batchNumber = 1;

            // If we have a newestToken, the first call to fetchCommentsViaContinuation will get the first batch of newest comments.
            // If we don't have a newestToken, we've fallen back to the default "Top Comments" view.
            // In this fallback scenario, we need to process the *initially visible* comments from the DOM first,
            // then use the continuationToken found from the DOM to fetch more "Top Comments".
            let commentSection = null;
            if (!newestToken) { // Only process initial DOM comments if we are NOT using the "Newest First" token
                const liveData = document.querySelector('ytd-comments ytd-item-section-renderer')?.data;
                if (liveData) {
                    const contents = liveData?.contents;
                    if (contents && contents.some(i => i.commentThreadRenderer || i.continuationItemRenderer)) {
                        commentSection = { itemSectionRenderer: { contents: contents } };
                    } else {
                        for (const section of contents) {
                            if (section?.itemSectionRenderer?.contents) {
                                const items = section.itemSectionRenderer.contents;
                                if (items.some(i => i.commentThreadRenderer || i.continuationItemRenderer)) {
                                    commentSection = section; // Use this section
                                    break;
                                }
                            }
                        }
                    }
                }

                if (commentSection) {
                    // Extract initial comments
                    const items = commentSection.itemSectionRenderer.contents;
                    for (const item of items) {
                        if (item.commentThreadRenderer) {
                            const threadData = await processCommentThread(item.commentThreadRenderer, entityStore);
                            if (threadData) comments.push(...threadData);
                        }
                    }
                }
            }

            // IndexedDB Setup
            console.log('[YCA Page] Initializing DB transaction for batch loop...');
            const db = await initDB();
            await clearCommentStore(db);

            // Save any initial comments captured
            let totalFetched = 0;
            if (comments.length > 0) {
                await saveCommentBatch(db, comments);
                totalFetched += comments.length;
                comments.length = 0; // Clear memory
            }

            // PARALLEL REPLY QUEUE (High-speed reply fetching)
            // Create queue with concurrency 4 (maximizing throughput)
            const replyQueue = new SimpleQueue(4);
            let totalRepliesFetched = 0;
            const processedReplyTokens = new Set();  // Prevent duplicate reply fetches

            // NON-BLOCKING DB WRITES (Critical for speed)
            // Track all pending DB writes and wait for them at the end
            const pendingWrites = [];

            // PIPELINED FETCHING (Optimized for speed)
            // Start first fetch
            let currentPromise = fetchCommentsViaContinuation(continuationToken, entityStore);
            batchNumber = 1;  // Reset counter (already declared earlier)

            while (currentPromise) {
                // Wait for current batch to complete
                const result = await currentPromise;

                // CRITICAL: Immediately start NEXT fetch (pipelining!)
                // This runs in parallel while we process the current batch
                let nextPromise = null;
                if (result?.nextToken) {
                    nextPromise = fetchCommentsViaContinuation(result.nextToken, entityStore);
                }

                // Process current batch while next fetch is running in background
                // NON-BLOCKING DB WRITE - don't await! Let it run in background
                if (result && result.comments.length > 0) {
                    const writePromise = saveCommentBatch(db, result.comments);
                    pendingWrites.push(writePromise);
                    totalFetched += result.comments.length;
                    result.comments = null;  // Clear memory
                } else if (batchNumber === 1 && (!result || result.comments.length === 0)) {
                    console.warn('[YCA Page] Batch 1 via API returned 0 comments.');
                }

                // PARALLEL REPLY PROCESSING
                // Process reply tokens from this batch in parallel (concurrency 4)
                if (result?.replyTokens && result.replyTokens.length > 0) {
                    console.log(`[YCA] Processing ${result.replyTokens.length} reply tokens in parallel...`);

                    for (const replyToken of result.replyTokens) {
                        const tokenKey = replyToken.token?.continuationCommand?.token ||
                            replyToken.token?.token ||
                            JSON.stringify(replyToken.token);

                        // Skip duplicates
                        if (processedReplyTokens.has(tokenKey)) {
                            continue;
                        }
                        processedReplyTokens.add(tokenKey);

                        // Add to parallel queue
                        replyQueue.add(async () => {
                            try {
                                const replies = await fetchReplies(replyToken.token, entityStore, replyToken.parentId);
                                if (replies && replies.length > 0) {
                                    // NON-BLOCKING DB write for replies too
                                    const replyWritePromise = saveCommentBatch(db, replies);
                                    pendingWrites.push(replyWritePromise);
                                    totalRepliesFetched += replies.length;
                                }
                            } catch (error) {
                                console.error('[YCA] Error fetching replies:', error);
                            }
                        });
                    }
                }

                // Move to next batch
                currentPromise = nextPromise;
                batchNumber++;

                if (batchNumber % 20 === 0) {
                    console.log(`[YCA Page] Batch ${batchNumber}, Total Saved: ${totalFetched}`);
                }

                if (batchNumber > 100000) break; // Safety
            }

            console.log(`[YCA Page] Fetched ${batchNumber - 1} continuation batches`);

            // Wait for all parallel reply fetches to complete
            console.log('[YCA] Waiting for parallel reply queue to complete...');
            await replyQueue.onIdle();
            console.log(`[YCA] Reply queue complete. Total replies fetched: ${totalRepliesFetched}`);

            // CRITICAL: Wait for all pending DB writes to complete
            console.log(`[YCA] Waiting for ${pendingWrites.length} pending DB writes to complete...`);
            await Promise.all(pendingWrites);
            console.log('[YCA] All DB writes complete!');

            if (comments.length === 0) {
                console.log('[YCA Page] Specific comment section not found, scanning all...');
            }

            console.log(`[YCA Page] Loop Complete. Total Main Comments: ${totalFetched}, Total Replies: ${totalRepliesFetched}, Grand Total: ${totalFetched + totalRepliesFetched}`);

            console.log('[YCA Page] Reading all comments from DB for export...');
            const finalComments = await getAllComments(db);
            console.log(`[YCA Page] DB Read Success: ${finalComments.length} comments.`);

            // EMERGENCY DOM SCRAPE (If API failed completely)
            if (finalComments.length === 0) {
                console.warn('[YCA Page] API extraction returned 0 comments. Attempting Emergency DOM Scrape...');
                const domThreads = document.querySelectorAll('ytd-comment-thread-renderer');
                if (domThreads.length > 0) {
                    console.log(`[YCA Page] Found ${domThreads.length} visible threads in DOM.`);
                    for (const thread of domThreads) {
                        try {
                            // Manual textContent scrape (Last Resort)
                            const content = thread.querySelector('#content-text')?.textContent?.trim();
                            const author = thread.querySelector('#author-text')?.textContent?.trim();

                            if (content && author) {
                                finalComments.push({
                                    id: 'scraped-' + Math.random().toString(36).substr(2, 9),
                                    text: content,
                                    author: author,
                                    time: thread.querySelector('#published-time-text')?.textContent?.trim() || '',
                                    likes: thread.querySelector('#vote-count-middle')?.textContent?.trim() || '0',
                                    isReply: false,
                                    replies: [],
                                    authorUrl: thread.querySelector('#author-text')?.href || '',
                                    isChannelOwner: false, // Cannot determine easily from DOM
                                    isMember: false,
                                    authorImg: thread.querySelector('#author-thumbnail img')?.src || ''
                                });
                            }
                        } catch (e) {
                            console.error('[YCA Page] Emergency scrape error:', e);
                        }
                    }
                }
            }

            isExtracting = false;
            return finalComments.length > 0 ? finalComments : null;

        } catch (e) {
            console.error('[YCA Page] Comments error:', e);
            isExtracting = false;
            return null;
        }
    }

    // Helper: Parse '1.2K' etc.
    function parseCount(str) {
        const store = new Map();
        if (frameworkUpdates?.entityBatchUpdate?.mutations) {
            for (const mutation of frameworkUpdates.entityBatchUpdate.mutations) {
                if (mutation.payload && mutation.entityKey) {
                    store.set(mutation.entityKey, mutation.payload);
                }
            }
        }
        return store;
    }

    // Helper: Resolve Comment Data
    // Helper: Parse Entity Store
    function parseEntityStore(frameworkUpdates) {
        const store = new Map();
        if (frameworkUpdates?.entityBatchUpdate?.mutations) {
            for (const mutation of frameworkUpdates.entityBatchUpdate.mutations) {
                if (mutation.payload) {
                    // Store the payload by entityKey
                    // The payload usually contains 'commentEntityPayload' or similar
                    // We'll store the object itself or unwrapped payload
                    let payload = mutation.payload;

                    // Specific unwrapping for comments
                    if (payload.commentEntityPayload) {
                        store.set(mutation.entityKey, payload.commentEntityPayload);
                    } else {
                        store.set(mutation.entityKey, payload);
                    }
                }
            }
        }
        return store;
    }

    function resolveComment(viewModel, entityStore) {
        if (!viewModel) return null;

        let payload = null;
        let id = viewModel.commentKey || viewModel.commentId || '';

        // 1. Try Entity Store
        if (entityStore && id) {
            payload = entityStore.get(id);
        }

        // If no payload, use viewModel as fallback source
        const source = payload || viewModel;

        // DEBUG: If we can't find source, log it
        if (!source) {
            console.warn('[YCA Page] resolveComment: No source found for ID:', id);
        }

        const getVal = (path, obj) => {
            if (!obj) return undefined;
            return path.split('.').reduce((o, k) => (o || {})[k], obj);
        };

        // Helper to extract text from various structures
        const extractText = (obj) => {
            if (!obj) return '';

            // Direct simpleText
            if (obj.simpleText) return obj.simpleText;

            // Runs (Array)
            if (obj.runs && Array.isArray(obj.runs)) {
                return obj.runs.map(r => r.text || r.emoji?.image?.accessibility?.accessibilityData?.label || '').join('');
            }

            // Nested properties (common in entityStore payloads)
            const nestedContent = getVal('properties.content.content', obj) || getVal('commentEntityPayload.properties.content.content', obj);
            if (nestedContent) return nestedContent; // Usually simpleText string in payload

            return '';
        };

        // Content
        let text = extractText(getVal('contentText', source)) ||
            extractText(getVal('properties.content', source)) ||
            extractText(getVal('commentEntityPayload.properties.content', source)) ||
            extractText(source); // Try source root if it has runs/simpleText

        // Author
        let author = getVal('authorText.simpleText', source) ||
            getVal('author.displayName', source) ||
            getVal('commentEntityPayload.author.displayName', source) || 'Unknown';

        // Time
        let time = getVal('publishedTimeText.runs.0.text', source) ||
            getVal('properties.publishedTime', source) ||
            getVal('commentEntityPayload.properties.publishedTime', source) || '';

        // Likes
        let likes = getVal('voteCount.simpleText', source) ||
            getVal('toolbar.likeCount', source) || '0';

        // Author Image
        let authorImg = getVal('authorThumbnail.thumbnails.0.url', source);

        // Author URL (Channel)
        let authorUrl = getVal('authorEndpoint.browseEndpoint.canonicalBaseUrl', source) ||
            getVal('authorEndpoint.commandMetadata.webCommandMetadata.url', source) || '';
        if (authorUrl && !authorUrl.startsWith('http')) {
            authorUrl = 'https://www.youtube.com' + authorUrl;
        }

        // Channel Owner
        let isChannelOwner = getVal('authorIsChannelOwner', source) || false;

        // Member Status (Tooltip Text)
        let member = "";
        const badges = getVal('actionButtons.commentActionButtonsRenderer.protoCreation.contents.0.commentActionButtonRenderer.trackingParams', source) ? [] : // heuristic
            (getVal('authorBadges', source) || []);

        const sponsorBadge = getVal('sponsorCommentBadge', source);
        if (sponsorBadge) {
            member = sponsorBadge.sponsorCommentBadgeRenderer?.tooltip || "Member";
        }

        const memberBadge = badges.find(b => b.liveChatAuthorBadgeRenderer?.tooltip?.includes('Member'));
        if (memberBadge) {
            member = memberBadge.liveChatAuthorBadgeRenderer.tooltip || "Member";
        }
        let isMember = !!member; // Keep boolean for backward compat if needed, or just use member string existence logic

        // ID Fallback
        if (!id) {
            id = getVal('commentId', source);
        }

        // Filter out empty resolution if absolutely nothing found (unlikely if source exists)
        if (!text && !author && !id) return null;

        return { id, author, text, time, likes, authorUrl, isChannelOwner, isMember, member, authorImg };
    }

    // Helper: Process a single Comment Thread (Root + Replies)
    // replyTokenCollector: optional array to collect reply tokens for parallel processing
    async function processCommentThread(threadRenderer, entityStore, depth = 0, replyTokenCollector = null) {
        if (depth > 100) { // Increased from 20 to 100 for deep threads
            console.warn('[YCA Page] Max recursion depth 100 reached in processCommentThread');
            return [];
        }
        const results = [];

        // 1. Root Comment
        let rootComment = null;

        // Strategy 1: ViewModel
        if (threadRenderer.commentViewModel?.commentViewModel) {
            rootComment = resolveComment(threadRenderer.commentViewModel.commentViewModel, entityStore);
        }
        // Strategy 2: Legacy
        else if (threadRenderer.comment?.commentRenderer) {
            const cr = threadRenderer.comment.commentRenderer;
            rootComment = {
                id: cr.commentId || '',
                author: cr.authorText?.simpleText || 'Unknown',
                text: cr.contentText?.runs?.map(r => r.text).join('') || '',
                time: cr.publishedTimeText?.runs?.[0]?.text || '',
                likes: cr.voteCount?.simpleText || '0',
                authorUrl: cr.authorEndpoint?.browseEndpoint?.canonicalBaseUrl || cr.authorEndpoint?.commandMetadata?.webCommandMetadata?.url || '',
                isChannelOwner: cr.authorIsChannelOwner || false,
                isMember: cr.authorBadges?.some(b => b.liveChatAuthorBadgeRenderer?.tooltip?.includes('Member')) || false,
                member: cr.authorBadges?.find(b => b.liveChatAuthorBadgeRenderer?.tooltip?.includes('Member'))?.liveChatAuthorBadgeRenderer?.tooltip || "",
                authorImg: cr.authorThumbnail?.thumbnails?.[0]?.url || ''
            };
            if (rootComment.authorUrl && !rootComment.authorUrl.startsWith('http')) {
                rootComment.authorUrl = 'https://www.youtube.com' + rootComment.authorUrl;
            }
        }

        if (rootComment) {
            rootComment.isReply = false;
            results.push(rootComment);
        } else {
            // It's common for nested "subThreads" (continuations) to be just a list of replies without a new root.
            // We should NOT drop them. We should extract the replies and return them.
            // The caller will assign the correct parentId.
        }

        const currentRootId = rootComment?.id || 'BATCH';

        // 2. Replies (Visible)
        const repliesRenderer = threadRenderer.replies?.commentRepliesRenderer;

        if (repliesRenderer) {
            // console.log(`[YCA Page] Thread ${currentRootId} scanning repliesRenderer...`);

            // Merge sources: subThreads, contents, continuationItems
            const allSubThreads = [
                ...(repliesRenderer.contents || []),
                ...(repliesRenderer.subThreads || []),
                ...(repliesRenderer.viewReplies?.buttonRenderer?.subThreads || []),
            ];

            // Also check for 'continuationItems' directly in repliesRenderer (sometimes used instead of contents)
            if (repliesRenderer.continuationItems) {
                allSubThreads.push(...repliesRenderer.continuationItems);
            }

            if (allSubThreads.length > 0) {
                console.log(`[YCA Page] Thread ${currentRootId} has ${allSubThreads.length} items in replies (merged)`);
                for (const sub of allSubThreads) {
                    if (sub.commentRenderer) {
                        const r = sub.commentRenderer;
                        results.push({
                            id: r.commentId || '',
                            author: r.authorText?.simpleText || 'Unknown',
                            text: r.contentText?.runs?.map(x => x.text).join('') || '',
                            time: r.publishedTimeText?.runs?.[0]?.text || '',
                            likes: r.voteCount?.simpleText || '0',
                            isReply: true,
                            parentId: rootComment?.id
                        });
                    } else if (sub.commentViewModel?.commentViewModel) {
                        const r = resolveComment(sub.commentViewModel.commentViewModel, entityStore);
                        if (r) {
                            r.isReply = true;
                            r.parentId = rootComment?.id;
                            results.push(r);
                        }
                    } else if (sub.commentThreadRenderer) {
                        try {
                            // console.log(`[YCA Page] Thread ${currentRootId} found nested commentThreadRenderer in subThreads`);

                            const threads = await processCommentThread(sub.commentThreadRenderer, entityStore, depth + 1);
                            if (threads && threads.length > 0) {
                                // console.log(`[YCA Page] Nested thread yielded ${threads.length} comments`);
                                threads.forEach(t => {
                                    t.isReply = true;
                                    if (rootComment?.id) t.parentId = rootComment.id;
                                });
                                results.push(...threads);
                            }
                        } catch (err) {
                            console.error(`[YCA Page] Error processing nested subThread for ${currentRootId}:`, err);
                        }
                    } else if (sub.continuationItemRenderer) {
                        const cir = sub.continuationItemRenderer;
                        let token = cir.continuationEndpoint;

                        if (!token) {
                            const button = cir.button?.buttonRenderer;
                            if (button) {
                                token = button.command || button.navigationEndpoint || button.serviceEndpoint;
                            }
                        }

                        if (token) {
                            // Parallel mode: collect token for later processing
                            if (replyTokenCollector) {
                                replyTokenCollector.push({ token, parentId: rootComment?.id });
                            } else {
                                // Sequential mode: fetch immediately
                                const hiddenReplies = await fetchReplies(token, entityStore, rootComment?.id);
                                if (hiddenReplies) {
                                    results.push(...hiddenReplies);
                                }
                            }
                        } else {
                            // Valid case: sometimes just a spinner or empty continuation
                            // console.log(`[YCA Page] Thread ${currentRootId} found continuationItemRenderer but NO token.`);
                        }
                    }
                }

                // B. View Replies Button (Continuation) - Only if not already covered
                if (repliesRenderer.viewReplies) {
                    const button = repliesRenderer.viewReplies.buttonRenderer;
                    if (button) {
                        const text = button.text?.runs?.[0]?.text || 'Unknown';
                        // Check common command paths
                        const command = button.command || button.navigationEndpoint || button.serviceEndpoint;
                        const token = command?.continuationCommand?.token;

                        if (token) {
                            // Parallel mode: collect token for later processing
                            if (replyTokenCollector) {
                                replyTokenCollector.push({ token, parentId: rootComment?.id });
                            } else {
                                // Sequential mode: fetch immediately
                                const hidden = await fetchReplies(token, entityStore, rootComment?.id);
                                if (hidden) {
                                    results.push(...hidden);
                                }
                            }
                        }
                    }
                }

                // B2. Continuations Array (Common in some layouts)
                if (repliesRenderer.continuations) {
                    for (const cont of repliesRenderer.continuations) {
                        const token = cont.nextContinuationData?.continuation ||
                            cont.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
                            cont.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token;

                        if (token) {
                            // Parallel mode: collect token for later processing
                            if (replyTokenCollector) {
                                replyTokenCollector.push({ token, parentId: rootComment?.id });
                            } else {
                                // Sequential mode: fetch immediately
                                const more = await fetchReplies(token, entityStore, rootComment?.id);
                                if (more) results.push(...more);
                            }
                        }
                    }
                }

                // C. Legacy contents array (just in case)
                if (repliesRenderer.contents) {
                    for (const item of repliesRenderer.contents) {
                        if (item.commentRenderer) {
                            const r = resolveComment(item.commentRenderer, entityStore);
                            if (r) {
                                r.isReply = true;
                                r.parentId = rootComment?.id;
                                results.push(r);
                            }
                        } else if (item.commentViewModel?.commentViewModel) {
                            const r = resolveComment(item.commentViewModel.commentViewModel, entityStore);
                            if (r) {
                                r.isReply = true;
                                r.parentId = rootComment?.id;
                                results.push(r);
                            }
                        } else if (item.continuationItemRenderer) {
                            const token = item.continuationItemRenderer.continuationEndpoint;
                            if (token) {
                                const hidden = await fetchReplies(token, entityStore, rootComment?.id);
                                if (hidden) results.push(...hidden);
                            }
                        }
                    }
                }
            }
        }

        return results;
    }

    // Helper: Fetch Replies via API
    async function fetchReplies(endpoint, entityStore, parentId) {
        try {
            const apiKey = window.ytcfg?.get('INNERTUBE_API_KEY');
            const context = window.ytcfg?.get('INNERTUBE_CONTEXT');

            const continuation = endpoint?.continuationCommand?.token;
            const clickTrackingParams = endpoint?.continuationCommand?.clickTrackingParams || endpoint?.clickTrackingParams;

            if (!apiKey || !context || !continuation) return null;

            const body = { context, continuation };
            if (clickTrackingParams) {
                body.clickTracking = { clickTrackingParams };
            }

            const response = await fetchWithRetry(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'include'
            });

            if (!response.ok) return null;
            const data = await response.json();

            // Debug: Log top-level keys to verify structure for replies
            console.log('[YCA Page] API Reply Response Keys:', Object.keys(data));
            if (data.onResponseReceivedEndpoints) console.log('[YCA Page] - Has onResponseReceivedEndpoints');
            if (data.frameworkUpdates) console.log('[YCA Page] - Has frameworkUpdates');


            // Merge new updates into store
            if (data.frameworkUpdates) {
                const newStore = parseEntityStore(data.frameworkUpdates);
                newStore.forEach((v, k) => entityStore.set(k, v));
            }

            const collected = [];
            const actions = data.onResponseReceivedEndpoints;
            if (actions) {
                const allTargetItems = [];

                for (const action of actions) {
                    const items = action.reloadContinuationItemsCommand?.continuationItems ||
                        action.appendContinuationItemsAction?.continuationItems;
                    if (items && items.length > 0) {
                        allTargetItems.push(...items);
                    }
                }

                if (allTargetItems.length > 0) {
                    for (const item of allTargetItems) {
                        if (item.commentRenderer) {
                            const r = resolveComment(item.commentRenderer, entityStore);
                            if (r) {
                                r.isReply = true;
                                r.parentId = parentId;
                                collected.push(r);
                            }
                        } else if (item.commentViewModel?.commentViewModel) {
                            const r = resolveComment(item.commentViewModel.commentViewModel, entityStore);
                            if (r) {
                                r.isReply = true;
                                r.parentId = parentId;
                                collected.push(r);
                            }
                        } else if (item.commentThreadRenderer) {
                            try {
                                const threads = await processCommentThread(item.commentThreadRenderer, entityStore, 1);
                                if (threads && threads.length > 0) {
                                    threads.forEach(t => { t.isReply = true; t.parentId = parentId; });
                                    collected.push(...threads);
                                }
                            } catch (e) {
                                console.error('[YCA Page] Error in nested thread:', e);
                            }
                        } else if (item.continuationItemRenderer) {
                            const cir = item.continuationItemRenderer;
                            let nextToken = cir.continuationEndpoint;

                            if (!nextToken) {
                                const button = cir.button?.buttonRenderer;
                                if (button) {
                                    nextToken = button.command || button.navigationEndpoint || button.serviceEndpoint;
                                }
                            }

                            if (nextToken) {
                                // Note: This is inside fetchReplies itself, so we don't use replyTokenCollector here
                                // This handles nested reply pagination
                                const more = await fetchReplies(nextToken, entityStore, parentId);
                                if (more) collected.push(...more);
                            }
                        }
                    }
                }
            }
            return collected;

        } catch (e) { console.error(e); return null; }
    }


    /**
     * Extract next continuation token from API response
     * ROBUST IMPLEMENTATION - Critical for fetching ALL comments beyond 32K
     * Based on internal logic checks
     */
    function extractNextContinuation(responseData) {
        try {
            // Pattern: Check onResponseReceivedEndpoints in specific order

            // Option 1: reloadContinuationItemsCommand (index 1)
            // Used when sort order changes (e.g., switching to "Newest First")
            let continuationItems = responseData.onResponseReceivedEndpoints?.[1]
                ?.reloadContinuationItemsCommand?.continuationItems || [];

            // Option 2: appendContinuationItemsAction (index 0)
            // Used for normal "Load More" pagination
            if (!Array.isArray(continuationItems) || continuationItems.length === 0) {
                continuationItems = responseData.onResponseReceivedEndpoints?.[0]
                    ?.appendContinuationItemsAction?.continuationItems || [];
            }

            // No continuation items found - end of comments
            if (!Array.isArray(continuationItems) || continuationItems.length === 0) {
                return { token: null, clickTrackingParams: null };
            }

            // Get the LAST item in the array (this is the "Load More" button)
            const lastItem = continuationItems[continuationItems.length - 1];

            // Extract token from button.buttonRenderer.command OR continuationEndpoint
            // We check both paths because YouTube uses different structures
            const token =
                lastItem?.continuationItemRenderer?.button?.buttonRenderer
                    ?.command?.continuationCommand?.token ||
                lastItem?.continuationItemRenderer?.continuationEndpoint
                    ?.continuationCommand?.token ||
                null;

            // Extract clickTrackingParams (required for proper API calls)
            const clickTrackingParams =
                lastItem?.continuationItemRenderer?.button?.buttonRenderer
                    ?.command?.clickTrackingParams ||
                lastItem?.continuationItemRenderer?.continuationEndpoint
                    ?.clickTrackingParams ||
                null;

            return { token, clickTrackingParams };

        } catch (error) {
            console.error('[YCA] Error extracting continuation:', error);
            return { token: null, clickTrackingParams: null };
        }
    }

    // Main Fetch via Continuation (for Scroll)
    // Returns: { comments: [], nextToken: endpoint | null }
    async function fetchCommentsViaContinuation(endpoint, entityStore) {
        try {
            console.log('[YCA Page] Fetching main comments continuation (Fixing Token)...');

            const apiKey = window.ytcfg?.get('INNERTUBE_API_KEY');
            const context = window.ytcfg?.get('INNERTUBE_CONTEXT');

            // FIX: Handle both object endpoint and raw string token, AND extract clickParams
            let continuation = null;
            let clickTrackingParams = null;

            if (typeof endpoint === 'string') {
                continuation = endpoint;
            } else {
                continuation = endpoint?.continuationCommand?.token || endpoint?.token;
                clickTrackingParams = endpoint?.continuationCommand?.clickTrackingParams || endpoint?.clickTrackingParams;
            }

            // Debug which one was missing
            if (!apiKey) console.warn('[YCA Page] Missing API Key');
            if (!context) console.warn('[YCA Page] Missing Context');
            if (!continuation) console.warn('[YCA Page] Missing Continuation Token', endpoint);

            if (!apiKey || !context || !continuation) {
                return { comments: [], nextToken: null };
            }

            const body = { context, continuation };
            if (clickTrackingParams) {
                body.clickTracking = { clickTrackingParams };
            }

            // NEW: Use fetchWithRetry helper
            const response = await fetchWithRetry(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'include'
            });

            if (!response.ok) {
                console.error('[YCA Page] Continuation API Error:', response.status);
                return { comments: [], nextToken: null };
            }
            const data = await response.json();

            // Log top-level keys for debugging (LOUD)
            console.log('[YCA Page] API Response Keys:', Object.keys(data));

            if (data.frameworkUpdates) {
                const newUpdates = parseEntityStore(data.frameworkUpdates);
                if (entityStore) {
                    newUpdates.forEach((v, k) => entityStore.set(k, v));
                }
            }

            // Log raw actions count
            console.log('[YCA Page] Response has actions:', !!data.onResponseReceivedEndpoints, data.onResponseReceivedEndpoints?.length);

            const comments = [];
            const replyTokens = [];  // Collect reply tokens for parallel processing

            // Process comment threads from the response
            const actions = data.onResponseReceivedEndpoints;
            if (actions) {
                for (const action of actions) {
                    const items = action.reloadContinuationItemsCommand?.continuationItems ||
                        action.appendContinuationItemsAction?.continuationItems;

                    if (items) {
                        for (const item of items) {
                            if (item.commentThreadRenderer) {
                                // Pass replyTokens array to collect tokens instead of fetching
                                const thread = await processCommentThread(item.commentThreadRenderer, entityStore, 0, replyTokens);
                                if (thread) comments.push(...thread);
                            }
                            // Note: We no longer extract nextToken here - we use extractNextContinuation instead
                        }
                    }
                }
            }

            // Use exact continuation extraction pattern
            // This fixes the 32K comment limit issue
            const nextContinuation = extractNextContinuation(data);
            let nextToken = null;

            if (nextContinuation.token) {
                // Build the token object in the format expected by the pipeline
                nextToken = {
                    token: nextContinuation.token,
                    clickTrackingParams: nextContinuation.clickTrackingParams,
                    continuationCommand: {
                        token: nextContinuation.token,
                        clickTrackingParams: nextContinuation.clickTrackingParams
                    }
                };
                console.log('[YCA] Found next continuation token');
            } else {
                console.log('[YCA] No more continuation tokens - end of comments');
            }

            // Critical Debug: If comments are 0, warn loud
            if (comments.length === 0) {
                console.warn('[YCA Page] Parsed 0 comments from API response. (YouTube might be throttling or empty batch).');
                if (actions) {
                    actions.forEach((a, i) => console.log(`Action ${i}:`, Object.keys(a)));
                } else {
                    console.log('No actions found in response.');
                }
            }

            return { comments, nextToken, replyTokens };

        } catch (e) {
            console.error('[YCA Page] fetchCommentsViaContinuation error:', e);
            return { comments: [], nextToken: null };
        }
    }

    console.log('[YCA Page] Ready to extract data (Deep Scan Loaded)');

    /**
     * fetchWithRetry - Generic fetch wrapper with retries and exponential backoff
     * @param {string} url 
     * @param {object} options 
     * @param {number} retries 
     * @param {number} backoff 
     */
    async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
        try {
            const response = await fetch(url, options);

            // If strictly successful, return
            if (response.ok) return response;

            // If 404 or 400 that implies bad request, maybe don't retry? 
            // We'll stick to retrying on errors.
            console.warn(`[YCA Page] Fetch failed with status ${response.status}. Retrying...`);

            throw new Error(`Fetch failed: ${response.status}`);
        } catch (err) {
            if (retries > 0) {
                console.warn(`[YCA Page] Fetch retry ${6 - retries}/5 failed: ${err.message}. Waiting ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                return fetchWithRetry(url, options, retries - 1, backoff * 2);
            } else {
                console.error(`[YCA Page] Final fetch failure after retries: ${err.message}`);
                // Return a mock error response to avoid crash, or rethrow. 
                // Existing code expects {ok: false} like object or throws.
                // Let's propagate an object indicating failure so caller handles it.
                return { ok: false, status: 0, text: () => Promise.resolve(err.message), json: () => Promise.reject(err) };
            }
        }
    }

    /**
     * Switch comment sorting to "Newest first" via DOM interaction
     * @param {string} oldId - The ID of the first comment before sorting
     */
    async function switchToNewestSort(oldId) {
        console.log('[YCA Page] Attempting to switch sort to "Newest first"...');
        try {
            // Helper to simulate generic click
            const safeClick = (el, name) => {
                if (!el) return false;
                console.log(`[YCA Page] Clicking ${name}...`);
                el.click();
                // Also dispatch mousedown/mouseup just in case
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                return true;
            };

            // 1. Find the Sort Button
            // Strategy A: The standard chip/dropdown
            const sortMenu = document.querySelector('yt-sort-filter-sub-menu-renderer');
            let clicked = false;

            if (sortMenu) {
                // Try finding the specific clickable area
                const targets = [
                    sortMenu.querySelector('#trigger'),
                    sortMenu.querySelector('a'),
                    sortMenu.querySelector('button'),
                    sortMenu.querySelector('#icon-label'),
                    sortMenu // Last resort: click the renderer itself
                ];

                for (const t of targets) {
                    if (t && safeClick(t, 'Sort Menu Trigger')) {
                        clicked = true;
                        break;
                    }
                }
            }

            // Strategy B: Search for text "Sort by"
            if (!clicked) {
                console.log('[YCA Page] Standard sort menu not found/clicked. Searching by text...');
                const allSpans = Array.from(document.querySelectorAll('yt-formatted-string, span'));
                const sortLabel = allSpans.find(el => el.textContent.trim() === 'Sort by' || el.textContent.trim() === 'Sırala');

                if (sortLabel && safeClick(sortLabel, '"Sort by" Text Label')) {
                    clicked = true;
                }
            }

            if (!clicked) {
                console.warn('[YCA Page] Could not find any clickable Sort button.');
                return;
            }

            await new Promise(r => setTimeout(r, 800)); // Wait for menu to open

            // 2. Find "Newest first" option in the dropdown
            // High specificity selector for the menu items
            const menuItems = Array.from(document.querySelectorAll('tp-yt-paper-listbox paper-item, tp-yt-paper-listbox a, ytd-menu-service-item-renderer'));

            const newestOption = menuItems.find(el => {
                const text = el.textContent.trim();
                return text.includes('Newest first') ||
                    text.includes('En yeni') ||
                    text.includes('Newest');
            });

            if (newestOption) {
                console.log('[YCA Page] Found "Newest first" option, clicking...');
                safeClick(newestOption, '"Newest first" Option');
                // Allow time for the click to register and page to start fetching
                await new Promise(r => setTimeout(r, 1000));
            } else {
                console.warn('[YCA Page] "Newest first" option not found in dropdown. (Menu might not have opened)');
                // If menu didn't open, we might need to try clicking the sort button again?
                // The main loop will handle the retry.
            }

        } catch (e) {
            console.error('[YCA Page] Error switching sort:', e);
        }
    }

    // Helper: Extract Comments from DOM (Fallback)
    async function extractCommentsFromDOM(entityStore) {
        const comments = [];
        const liveData = document.querySelector('ytd-comments ytd-item-section-renderer')?.data;
        if (!liveData?.contents) return [];

        for (const item of liveData.contents) {
            if (item.commentThreadRenderer) {
                const thread = await processCommentThread(item.commentThreadRenderer, entityStore);
                if (thread) comments.push(...thread);
            }
        }
        return comments;
    }

})();
