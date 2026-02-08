/**
 * Innertube API Wrapper
 * Handles communication with YouTube's internal API (YouTubei).
 * Expects to run in the MAIN world (page context) to access `ytcfg`.
 */

export class Innertube {
    constructor() {
        this.context = null;
        this.apiKey = null;
        this.clientName = null;
        this.clientVersion = null;
        this.apiUrl = '/youtubei/v1';
    }

    init() {
        if (typeof window.ytcfg === 'undefined') {
            console.error('[YCA] ytcfg not found. Make sure this script runs in the Main World.');
            return false;
        }

        const cfg = window.ytcfg.get('INNERTUBE_CONTEXT');
        this.apiKey = window.ytcfg.get('INNERTUBE_API_KEY');
        this.clientName = cfg.client.clientName;
        this.clientVersion = cfg.client.clientVersion;

        this.context = {
            context: {
                client: {
                    hl: 'en',
                    gl: 'US',
                    clientName: this.clientName,
                    clientVersion: this.clientVersion,
                },
            },
        };
        return true;
    }

    async call(endpoint, payload) {
        if (!this.apiKey) {
            if (!this.init()) throw new Error('Innertube not initialized');
        }

        const url = `${this.apiUrl}/${endpoint}?key=${this.apiKey}&prettyPrint=false`;
        const body = {
            ...this.context,
            ...payload
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Innertube API Error: ${response.status}`);
        }

        return response.json();
    }

    async browse(browseId, params = null) {
        const payload = { browseId };
        if (params) payload.params = params;
        return this.call('browse', payload);
    }

    async getVideoData(videoId) {
        // Calling 'next' with videoId gives us the Watch Page data (metadata, comments entry point, etc.)
        return this.call('next', { videoId });
    }

    async getTranscript(params) {
        if (!params) return null;
        return this.call('get_transcript', { params });
    }
}

