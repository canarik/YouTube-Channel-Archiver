import { NCaptureGenerator } from '../utils/ncapture-generator.js';
import { XLSXExporter } from '../utils/xlsx-exporter.js';

// ... (Rest of imports if any, but YCA structure is sparse here)

// ...

// In saveVideoData function (I need to target the specific block)
// I will use a larger block replacement to ensure I catch the logic.

// ...


/**
 * Background Service Worker
 * Opens tabs for each video and orchestrates data extraction
 */

console.log('[YCA Background] Service worker started');

function nestComments(flatComments) {
    if (!flatComments || flatComments.length === 0) return [];

    const commentMap = new Map();
    const rootComments = [];

    // First pass: Create map and identify root comments
    flatComments.forEach(comment => {
        commentMap.set(comment.id, { ...comment, replies: [] });
        if (!comment.isReply) {
            rootComments.push(commentMap.get(comment.id));
        }
    });

    // Second pass: Nest replies under their parents
    flatComments.forEach(comment => {
        if (comment.isReply && comment.parentId) {
            const parent = commentMap.get(comment.parentId);
            if (parent) {
                parent.replies.push(commentMap.get(comment.id));
            }
        }
    });

    return rootComments;
}

let videoQueue = [];
let currentChannelId = null;
let currentChannelName = null;
let currentOptions = {}; // Store options for current batch
let isProcessing = false;
let mainTabId = null; // Store the tab ID that initiated the download

// Listen for download requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[YCA Background] Received:', message.type);

    if (message.type === 'YCA_START_DOWNLOAD') {
        const { videos, channelId, channelName } = message.payload;
        console.log(`[YCA Background] Starting download for ${videos.length} videos`);

        // Store the initiating tab ID to send completion message later
        if (sender.tab) {
            mainTabId = sender.tab.id;
            console.log(`[YCA Background] Main tab ID: ${mainTabId}`);
        }
        console.log(`[YCA Background] Channel: ${channelName} (${channelId})`);

        videoQueue = [...videos];
        currentChannelId = channelId;
        currentChannelName = channelName || channelId; // Fallback to ID if name not provided
        currentOptions = message.payload.options || {}; // Extract options

        // Persist state to storage for reliability
        chrome.storage.local.set({
            'yca_session': {
                channelName: currentChannelName,
                options: currentOptions
            }
        }, () => {
            console.log('[YCA Background] Options saved to storage:', JSON.stringify(currentOptions));
            isProcessing = true;
            processNextVideo();
        });
    }

    if (message.type === 'YCA_VIDEO_DATA_READY') {
        // Data extracted from the tab
        const { videoId, title, transcript, comments, chatReplay, options, channelName, duration } = message.payload;
        console.log(`[YCA Background] Received data for ${videoId}`);
        console.log(`[YCA Background] - Duration: ${duration} seconds`);
        console.log(`[YCA Background] - Transcript: ${transcript ? transcript.length + ' chars' : 'NULL'}`);
        console.log(`[YCA Background] - Comments: ${comments ? comments.length + ' items' : 'NULL'}`);
        console.log(`[YCA Background] - Chat: ${chatReplay ? 'YES' : 'NULL'}`);
        console.log(`[YCA Background] - Options: ${JSON.stringify(options || {})}`);

        // Save the data, passing options and channel name if available
        saveVideoData(videoId, title, transcript, comments, chatReplay, options, channelName, duration);

        // Close the tab after extraction ONLY if part of a batch process (YCA Scan)
        // Single videos opened manually should stay open
        if (sender.tab && isProcessing) {
            console.log(`[YCA Background] Closing tab ${sender.tab.id} (Batch Mode)`);
            chrome.tabs.remove(sender.tab.id);
        } else if (sender.tab) {
            console.log(`[YCA Background] Keeping tab ${sender.tab.id} open (Single/Manual Mode)`);
        }

        // Script-based extraction is fast (~4-5 seconds total)
        // Wait 1 second before processing next video to avoid overwhelming the browser
        console.log(`[YCA Background] Waiting 1 second before next video...`);
        setTimeout(processNextVideo, 1000);
    }
});

function processNextVideo() {
    if (videoQueue.length === 0) {
        console.log('[YCA Background] All videos processed!');
        isProcessing = false;

        // Notify the main tab that all downloads are complete
        if (mainTabId) {
            console.log(`[YCA Background] Sending completion message to main tab ${mainTabId}`);
            chrome.tabs.sendMessage(mainTabId, {
                type: 'YCA_QUEUE_COMPLETE'
            }).catch(err => console.log('[YCA Background] Could not notify main tab (closed?):', err));
            mainTabId = null; // Reset
        }

        return;
    }

    const video = videoQueue.shift();

    // Encode state into URL to survive service worker suspension/restarts
    const channelParam = encodeURIComponent(currentChannelName || '');
    const ncaptureParam = currentOptions.ncapture ? '1' : '0';

    // Append parameters for content script to read
    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}&autoplay=0&yca=1&yca_channel=${channelParam}&yca_ncapture=${ncaptureParam}`;

    console.log(`[YCA Background] Opening tab for ${video.videoId} (${videoQueue.length} remaining)`);
    console.log(`[YCA Background] URL: ${videoUrl}`);

    // Open video in new tab with yca=1 parameter to trigger automatic extraction
    // MUST be active:true so transcript button clicking works!
    chrome.tabs.create({
        url: videoUrl,
        active: true
    }, (tab) => {
        console.log(`[YCA Background] Tab created: ${tab.id}`);
        // We also set up a listener for this specific tab to trigger extraction when ready
        // This is a fallback/redundant trigger in case the URL param based trigger fails
        const listener = function (tabId, changeInfo, tabInfo) {
            if (tabId === tab.id && changeInfo.status === 'complete') {
                console.log(`[YCA Background] Tab ${tabId} loaded, sending trigger command...`);
                chrome.tabs.sendMessage(tabId, {
                    type: 'YCA_TRIGGER_EXTRACTION',
                    videoId: video.videoId,
                    options: currentOptions // Pass options to content script
                });
                // Remove listener after triggering (or we could keep it? better remove to avoid dupes)
                chrome.tabs.onUpdated.removeListener(listener);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

function saveVideoData(videoId, title, transcript, comments, chatReplay, options = null, channelName = null, duration = 0) {
    console.log(`[YCA Background] saveVideoData called for ${videoId}`);
    console.log(`[YCA Background] - Title: ${title}`);
    console.log(`[YCA Background] - Duration: ${duration} seconds`);
    console.log(`[YCA Background] - Transcript: ${transcript ? 'YES' : 'NO'}`);
    console.log(`[YCA Background] - Comments: ${comments ? comments.length : 0}`);
    console.log(`[YCA Background] - Chat: ${chatReplay ? chatReplay.length : 0}`);

    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);

    // Logic: Favor currentChannelName (Bulk/Global) if available.
    let effectiveChannelName = currentChannelName;

    if (!effectiveChannelName && channelName && channelName !== 'Unknown Channel') {
        effectiveChannelName = channelName;
    }

    if (!effectiveChannelName) {
        effectiveChannelName = "Unknown Channel";
    }

    const folder = `${effectiveChannelName}/${safeTitle}_${videoId}`;

    console.log(`[YCA Background] Folder path: ${folder}`);

    // Save transcript
    if (transcript) {
        console.log(`[YCA Background] Calling downloadTextFile for transcript`);
        const textContent = typeof transcript === 'object' ? transcript.text : transcript;
        downloadTextFile(`${folder}/transcript.txt`, textContent, true); // true = UTF-16LE encoding for NVivo
    } else {
        console.log(`[YCA Background] No transcript to save`);
    }

    // Save comments
    if (comments && comments.length > 0) {
        console.log(`[YCA Background] Calling downloadTextFile for comments`);
        downloadTextFile(`${folder}/comments.json`, JSON.stringify(comments, null, 2));
    } else {
        console.log(`[YCA Background] No comments to save`);
    }

    // Save chat replay
    if (chatReplay && chatReplay.length > 0) {
        console.log(`[YCA Background] Calling downloadTextFile for chat`);
        downloadTextFile(`${folder}/chat_replay.json`, JSON.stringify(chatReplay, null, 2));
    } else {
        console.log(`[YCA Background] No chat to save`);
    }

    // Save XLSX (Replacing NCapture)
    let xlsxEnabled = true; // Default to true

    if (options && typeof options.exportXlsx === 'boolean') {
        xlsxEnabled = options.exportXlsx;
    }

    console.log('[YCA Background] Checking XLSX export condition:');
    console.log(`[YCA Background] - Enabled: ${xlsxEnabled}`);

    if (xlsxEnabled && comments && comments.length > 0) {
        try {
            console.log(`[YCA Background] Generating XLSX file for ${comments.length} comments...`); // DEBUG LOG
            console.log(`[YCA Background] Sample comment:`, comments[0]); // DEBUG LOG

            const videoDataForXlsx = {
                videoId,
                title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                comments,
                duration: duration && duration > 0 ? String(duration) : "0"
            };

            const xlsxContent = XLSXExporter.generate(videoDataForXlsx);

            // Filename format: "Title Comments.xlsx"
            const filename = `${safeTitle} Comments.xlsx`;
            const fullPath = `${folder}/${filename}`;

            downloadTextFile(fullPath, xlsxContent, false, true); // isBase64 = true
        } catch (err) {
            console.error('[YCA Background] XLSX generation failed:', err);
        }
    }

    console.log(`[YCA Background] Saved data for ${videoId}`);
}

function downloadTextFile(filename, content, forceUTF16LE = false, isBase64 = false) {
    console.log(`[YCA Background] Attempting download: ${filename}`);
    console.log(`[YCA Background] Content length: ${content.length} chars`);

    let dataUrl;

    if (isBase64) {
        // Content is already base64 (e.g. XLSX)
        dataUrl = `data:application/octet-stream;base64,${content}`;
        console.log('[YCA Background] Using provided Base64 content');
    } else if (filename.endsWith('.nvcx') || forceUTF16LE) {
        // Special handling for UTF-16LE
        let str = content;
        if (!filename.endsWith('.nvcx')) {
            str = '\uFEFF' + str;
        }

        const codeUnits = new Uint16Array(str.length);
        for (let i = 0; i < str.length; i++) {
            codeUnits[i] = str.charCodeAt(i);
        }

        let binary = '';
        const bytes = new Uint8Array(codeUnits.buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }

        const base64Content = btoa(binary);
        dataUrl = `data:application/octet-stream;base64,${base64Content}`;
        console.log('[YCA Background] Encoded as UTF-16LE');
    } else {
        // Standard UTF-8
        const base64Content = btoa(unescape(encodeURIComponent(content)));
        dataUrl = `data:text/plain;charset=utf-8;base64,${base64Content}`;
    }

    console.log(`[YCA Background] Data URL created, length: ${dataUrl.length}`);

    chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error('[YCA Background] Download FAILED:', chrome.runtime.lastError);
        } else {
            console.log(`[YCA Background] Download SUCCESS: ${filename} (ID: ${downloadId})`);
        }
    });
}
