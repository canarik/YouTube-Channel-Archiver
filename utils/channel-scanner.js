import { Innertube } from './innertube.js';
import { Parser } from './parser.js';

export class ChannelScanner {
    constructor() {
        this.innertube = new Innertube();
        this.isScanning = false;
    }

    async scan(channelId, onProgress) {
        if (this.isScanning) throw new Error('Scan in progress');
        this.isScanning = true;
        this.innertube.init();

        let allVideos = [];
        let continuation = null;

        // Initial Request: Get the "Videos" tab

        try {
            // Params for "Videos" tab (reverse engineered or standard constant)
            // 'EgZ2aWRlb3M%3D' is often "Videos"
            const videosTabParams = 'EgZ2aWRlb3M%3D';

            let response = await this.innertube.browse(channelId, videosTabParams);
            let result = Parser.parseChannelVideos(response);

            allVideos = [...result.videos];
            continuation = result.continuationToken;

            if (onProgress) onProgress(allVideos.length);

            while (continuation && this.isScanning) {
                // Throttle?
                await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

                response = await this.innertube.next(continuation);
                result = Parser.parseChannelVideos(response);

                allVideos = [...allVideos, ...result.videos];
                continuation = result.continuationToken;

                if (onProgress) onProgress(allVideos.length);
            }

            return allVideos;

        } catch (e) {
            console.error('[YCA] Scan failed', e);
            throw e;
        } finally {
            this.isScanning = false;
        }
    }

    stop() {
        this.isScanning = false;
    }
}
