/**
 * Parser Utils
 * Extracts useful data from complex YouTubei responses.
 */

export const Parser = {
    /**
     * Extracts video IDs from a Channel "Videos" tab response.
     * Handles both initial browse response and continuations.
     */
    parseChannelVideos: (data) => {
        const videos = [];
        let continuationPromise = null;

        // Helper to traverse actions
        const processItems = (items) => {
            if (!items) return;
            items.forEach(item => {
                const gridVideoRenderer = item.gridVideoRenderer || item.richItemRenderer?.content?.videoRenderer;
                if (gridVideoRenderer) {
                    videos.push({
                        videoId: gridVideoRenderer.videoId,
                        title: gridVideoRenderer.title?.runs?.[0]?.text,
                        publishedTime: gridVideoRenderer.publishedTimeText?.simpleText,
                        viewCount: gridVideoRenderer.viewCountText?.simpleText
                    });
                } else if (item.continuationItemRenderer) {
                    continuationPromise = item.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
                }
            });
        };

        // 1. Check for initial Browse response (Tabs -> Tab -> Content -> RichGrid -> Contents)
        const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
        if (tabs) {
            const videosTab = tabs.find(t => t.tabRenderer?.selected);
            // Assumption: We are ALREADY on the videos tab or pass the right params
            if (videosTab) {
                const contents = videosTab.tabRenderer?.content?.richGridRenderer?.contents;
                processItems(contents);
            }
        }

        // 2. Check for Continuation response (onResponseReceivedActions)
        if (data.onResponseReceivedActions) {
            data.onResponseReceivedActions.forEach(action => {
                const items = action.appendContinuationItemsAction?.continuationItems;
                processItems(items);
            });
        }

        return { videos, continuationToken: continuationPromise };
    },

    /**
     * Extracts comments from 'next' endpoint response.
     */
    parseComments: (data) => {
        const comments = [];
        let continuationToken = null;

        // TODO: Implement deep comment parsing

        return { comments, continuationToken };
    }
};
