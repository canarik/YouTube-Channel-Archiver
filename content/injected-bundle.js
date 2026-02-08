/**
 * Bundled Injected Script - SIMPLIFIED VERSION
 * Extracts videos from page data after user scrolls
 */

(function () {
    'use strict';

    console.log('[YCA Bundle] Script loaded');

    // Innertube API wrapper
    class Innertube {
        constructor() {
            this.apiKey = null;
            this.context = null;
        }

        init() {
            if (!window.ytcfg) return false;
            this.apiKey = window.ytcfg.get('INNERTUBE_API_KEY');
            const cfg = window.ytcfg.get('INNERTUBE_CONTEXT');
            this.context = {
                context: {
                    client: {
                        hl: 'en',
                        gl: 'US',
                        clientName: cfg.client.clientName,
                        clientVersion: cfg.client.clientVersion
                    }
                }
            };
            return true;
        }

        async call(endpoint, payload) {
            if (!this.apiKey && !this.init()) throw new Error('Innertube not initialized');

            const url = `/youtubei/v1/${endpoint}?key=${this.apiKey}&prettyPrint=false`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...this.context, ...payload })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            return response.json();
        }

        async getVideoData(videoId) {
            return this.call('player', { videoId });
        }

        async getComments(videoId, continuation = null) {
            if (continuation) {
                return this.call('next', { continuation });
            }
            return this.call('next', { videoId });
        }
    }

    // Simple scanner that reads from page
    class ChannelScanner {
        constructor() {
            this.isScanning = false;
        }

        async scan(channelId, onProgress) {
            if (this.isScanning) throw new Error('Scan in progress');
            this.isScanning = true;

            try {
                console.log('[YCA] Scanning from page data...');
                const videos = [];

                // Method 1: Extract from ytInitialData
                console.log('[YCA] window.ytInitialData exists:', !!window.ytInitialData);
                if (window.ytInitialData) {
                    const tabs = window.ytInitialData.contents?.twoColumnBrowseResultsRenderer?.tabs;
                    console.log('[YCA] Tabs found:', !!tabs, 'count:', tabs?.length);
                    if (tabs) {
                        const selectedTab = tabs.find(t => t.tabRenderer?.selected);
                        console.log('[YCA] Selected tab found:', !!selectedTab);
                        const sections = selectedTab?.tabRenderer?.content?.sectionListRenderer?.contents;
                        console.log('[YCA] Sections found:', sections?.length);

                        if (sections) {
                            sections.forEach(section => {
                                const items = section.itemSectionRenderer?.contents;
                                if (items) {
                                    items.forEach(item => {
                                        if (item.shelfRenderer) {
                                            const shelfItems = item.shelfRenderer.content?.horizontalListRenderer?.items ||
                                                item.shelfRenderer.content?.expandedShelfContentsRenderer?.items;
                                            if (shelfItems) {
                                                shelfItems.forEach(shelfItem => {
                                                    const vr = shelfItem.gridVideoRenderer || shelfItem.videoRenderer;
                                                    if (vr?.videoId) {
                                                        videos.push({
                                                            videoId: vr.videoId,
                                                            title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || 'Untitled'
                                                        });
                                                    }
                                                });
                                            }
                                        }
                                    });
                                }
                            });
                        }
                    }
                }

                console.log('[YCA] Videos from ytInitialData:', videos.length);

                // Method 2: Extract from DOM
                console.log('[YCA] Extracting from DOM...');
                const videoElements = document.querySelectorAll('ytd-grid-video-renderer, ytd-rich-item-renderer');
                console.log('[YCA] Found DOM video elements:', videoElements.length);

                let domCount = 0;
                videoElements.forEach((el, idx) => {
                    try {
                        // Try multiple ways to get the video link
                        let videoId = null;
                        let title = null;

                        // Method 1: #video-title with href
                        let titleEl = el.querySelector('#video-title');
                        if (titleEl?.href) {
                            videoId = titleEl.href.match(/watch\?v=([^&]+)/)?.[1];
                            title = titleEl.textContent?.trim();
                        }

                        // Method 2: a#video-title-link
                        if (!videoId) {
                            titleEl = el.querySelector('a#video-title-link');
                            if (titleEl?.href) {
                                videoId = titleEl.href.match(/watch\?v=([^&]+)/)?.[1];
                                title = titleEl.getAttribute('title') || titleEl.textContent?.trim();
                            }
                        }

                        // Method 3: Any link with /watch?v=
                        if (!videoId) {
                            const links = el.querySelectorAll('a[href*="/watch?v="]');
                            if (links.length > 0) {
                                videoId = links[0].href.match(/watch\?v=([^&]+)/)?.[1];
                                titleEl = el.querySelector('#video-title, h3, .title');
                                title = titleEl?.textContent?.trim();
                            }
                        }

                        if (videoId && title) {
                            videos.push({ videoId, title });
                            domCount++;
                        } else if (idx < 5) {
                            console.log(`[YCA] Failed element ${idx}: videoId=${videoId}, title=${!!title}`);
                        }
                    } catch (e) {
                        if (idx < 5) console.log(`[YCA] Error on element ${idx}:`, e);
                    }
                });

                console.log('[YCA] Videos extracted from DOM:', domCount);

                // Deduplicate
                const uniqueVideos = Array.from(new Map(videos.map(v => [v.videoId, v])).values());

                console.log('[YCA] Found', uniqueVideos.length, 'videos');
                if (onProgress) onProgress(uniqueVideos.length);

                return uniqueVideos;

            } finally {
                this.isScanning = false;
            }
        }
    }

    // Message Handler
    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;

        if (event.data.type === 'YCA_START_SCAN') {
            console.log('[YCA] Received START_SCAN');

            // Strategy: Check for Single Video (Watch Page) first
            const urlParams = new URLSearchParams(window.location.search);
            const currentVideoId = urlParams.get('v');
            if (currentVideoId && window.location.pathname === '/watch') {
                console.log('[YCA] Detected Watch Page. Showing Single Video Selection.');
                const title = document.title.replace(' - YouTube', '');
                const video = { videoId: currentVideoId, title: title };

                // Show popup with just this video
                showVideoSelectionPopup([video], 'SINGLE_VIDEO');
                return;
            }

            let channelId = null;
            let channelName = null;
            try {
                if (window.ytcfg && window.ytcfg.get) {
                    const client = window.ytcfg.get('INNERTUBE_CONTEXT')?.client;
                    if (client?.browseId) channelId = client.browseId;
                }
                if (!channelId) {
                    channelId = document.querySelector('meta[itemprop="identifier"]')?.content;
                }
                if (!channelId) {
                    const url = window.location.href;
                    const channelMatch = url.match(/\/channel\/(UC[\w-]{22})/);
                    if (channelMatch) channelId = channelMatch[1];
                }

                // Extract channel name
                // Prioritize DOM selectors because window.ytInitialData might be stale after SPA navigation
                // Helper to get text from the first VISIBLE element matching the selector
                // YouTube SPA often keeps old hidden pages in the DOM, so querySelector returns the old one.
                const getVisibleText = (sel) => {
                    const elements = document.querySelectorAll(sel);
                    for (const el of elements) {
                        if (el.offsetParent !== null) { // Check visibility
                            return el.textContent?.trim();
                        }
                    }
                    return null;
                };

                // Try to get title from document.title first (usually "Channel Name - YouTube")
                let docTitleName = null;
                const docTitle = document.title || '';
                if (docTitle.includes(' - YouTube')) {
                    docTitleName = docTitle.replace(' - YouTube', '').trim();
                }

                console.log('[YCA Debug] scanName list:');
                console.log('1. document.title:', docTitleName);
                console.log('2. #channel-header-container:', getVisibleText('#channel-header-container #text.ytd-channel-name'));
                console.log('3. ytd-channel-name formatted:', getVisibleText('ytd-channel-name yt-formatted-string'));
                console.log('4. #channel-name:', getVisibleText('#channel-name'));

                channelName = docTitleName ||
                    getVisibleText('#channel-header-container #text.ytd-channel-name') ||
                    getVisibleText('ytd-channel-name yt-formatted-string') ||
                    getVisibleText('#channel-name') ||
                    window.ytInitialData?.metadata?.channelMetadataRenderer?.title ||
                    window.ytInitialData?.header?.c4TabbedHeaderRenderer?.title ||
                    'Unknown Channel';
            } catch (e) {
                console.error('[YCA] ID error:', e);
            }

            console.log('[YCA] Channel ID:', channelId);
            console.log('[YCA] Channel Name:', channelName);

            if (!channelId) {
                alert('Could not find Channel ID');
                return;
            }

            try {
                const scanner = new ChannelScanner();
                const videos = await scanner.scan(channelId, (count) => {
                    window.postMessage({ type: 'YCA_SCAN_PROGRESS', payload: { count } }, '*');
                });

                console.log('[YCA] Scan complete, showing popup');
                showVideoSelectionPopup(videos, channelId, channelName);

            } catch (e) {
                console.error('[YCA] Scan error:', e);
                alert('Scan failed: ' + e.message);
            }
        }
    });

    // Show video selection popup
    function showVideoSelectionPopup(videos, channelId, channelName = null) {
        const existing = document.getElementById('yca-popup-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'yca-popup-overlay';

        // Inject CSS inline
        const style = document.createElement('style');
        style.textContent = `
            #yca-popup-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: "Roboto","Arial",sans-serif; }
            #yca-popup { background: #1f1f1f; border-radius: 12px; width: 90%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
            #yca-popup-header { padding: 20px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
            #yca-popup-header h2 { margin: 0; color: #fff; font-size: 22px; }
            #yca-popup-close { background: #ff4e45; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; }
            #yca-popup-controls { padding: 15px 20px; border-bottom: 1px solid #333; display: flex; gap: 20px; align-items: center; color: #fff; font-size: 16px; }
            #yca-select-all { margin-right: 8px; transform: scale(1.2); cursor: pointer; }
            #yca-popup-controls label { display: flex; align-items: center; cursor: pointer; }
            #yca-download-btn { background: #0f0; color: #000; border: none; padding: 10px 24px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-left: auto; font-size: 14px; }
            #yca-download-btn:disabled { background: #666; cursor: not-allowed; }
            #yca-video-list { flex: 1; overflow-y: auto; padding: 10px 20px; }
            .yca-video-item { display: flex; align-items: center; padding: 12px; margin: 5px 0; background: #2a2a2a; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
            .yca-video-item:hover { background: #333; }
            .yca-video-item input[type="checkbox"] { margin-right: 15px; width: 18px; height: 18px; cursor: pointer; }
            .yca-video-title { color: #fff; flex: 1; font-size: 15px; line-height: 1.4; }
            .yca-video-id { color: #888; font-size: 12px; margin-left: 10px; font-family: monospace; }
            #yca-popup-footer { padding: 15px 20px; border-top: 1px solid #333; color: #aaa; font-size: 13px; }
        `;
        document.head.appendChild(style);

        overlay.innerHTML = `
            <div id="yca-popup">
                <div id="yca-popup-header">
                    <h2>Select Videos (${videos.length} found)</h2>
                    <button id="yca-popup-close">Close</button>
                </div>
                <div id="yca-popup-controls">
                    <label><input type="checkbox" id="yca-select-all"> Select All</label>
                    <label style="margin-left: 15px;"><input type="checkbox" id="yca-ncapture-check"> XLSX Format (.xlsx)</label>
                    <span id="yca-selected-count">0 selected</span>
                    <button id="yca-download-btn" disabled>Download Selected</button>
                </div>
                <div id="yca-video-list"></div>
                <div id="yca-popup-footer">Downloads: Transcripts, Comments, Chat Replay | XLSX: Excel file with all data</div>
            </div>
        `;

        document.body.appendChild(overlay);

        const videoList = document.getElementById('yca-video-list');
        videos.forEach(video => {
            const item = document.createElement('div');
            item.className = 'yca-video-item';
            item.innerHTML = `
                <input type="checkbox" class="yca-video-checkbox" data-video-id="${video.videoId}">
                <span class="yca-video-title">${video.title}</span>
                <span class="yca-video-id">${video.videoId}</span>
            `;
            videoList.appendChild(item);
        });

        const checkboxes = document.querySelectorAll('.yca-video-checkbox');
        const selectAll = document.getElementById('yca-select-all');
        const downloadBtn = document.getElementById('yca-download-btn');
        const selectedCount = document.getElementById('yca-selected-count');

        function updateUI() {
            const checked = Array.from(checkboxes).filter(cb => cb.checked);
            selectedCount.textContent = `${checked.length} selected`;
            downloadBtn.disabled = checked.length === 0;
            selectAll.checked = checked.length === checkboxes.length;

            // Visual feedback for enabled button
            if (!downloadBtn.disabled) {
                downloadBtn.style.background = '#0f0';
                downloadBtn.style.cursor = 'pointer';
            } else {
                downloadBtn.style.background = '#666';
                downloadBtn.style.cursor = 'not-allowed';
            }
        }

        checkboxes.forEach(cb => cb.addEventListener('change', updateUI));
        selectAll.addEventListener('change', (e) => {
            checkboxes.forEach(cb => cb.checked = e.target.checked);
            updateUI();
        });

        document.getElementById('yca-popup-close').addEventListener('click', () => overlay.remove());

        downloadBtn.addEventListener('click', () => {
            const selected = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => videos.find(v => v.videoId === cb.dataset.videoId));

            // CAPTURE OPTIONS BEFORE REMOVING OVERLAY
            const ncaptureCheck = document.getElementById('yca-ncapture-check');
            const exportXlsx = ncaptureCheck ? ncaptureCheck.checked : true; // Default true

            overlay.remove();

            if (channelId === 'SINGLE_VIDEO' && selected.length > 0) {
                // Direct extraction for single video
                console.log('[YCABundle] Triggering direct extraction for single video:', selected[0].videoId);
                window.postMessage({
                    source: 'YCA_CONTENT_SCRIPT',
                    type: 'YCA_EXTRACT_DATA',
                    videoId: selected[0].videoId,
                    options: { exportXlsx } // Pass as exportXlsx
                }, window.location.origin);
            } else {
                // Standard channel download
                window.postMessage({
                    type: 'YCA_DOWNLOAD_SELECTED',
                    payload: {
                        videos: selected,
                        channelId,
                        channelName,
                        options: { exportXlsx }
                    }
                }, '*');
            }
        });

        // Auto-select if single video
        if (channelId === 'SINGLE_VIDEO') {
            checkboxes.forEach(cb => cb.checked = true);
            updateUI();
        }
    }

    // Handle download request
    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;

        if (event.data.type === 'YCA_DOWNLOAD_SELECTED') {
            const { videos, channelId } = event.data.payload;
            console.log('[YCA] Sending download request to background for', videos.length, 'videos');

            // Send to content script to forward to background
            window.postMessage({
                type: 'YCA_START_DOWNLOAD_REQUEST',
                payload: { ...event.data.payload }
            }, '*');
        }
    });

    console.log('[YCA Bundle] Ready');
})();
