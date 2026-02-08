import XLSX from './xlsx.js';

export class XLSXExporter {
    static generate(videoData) {
        const { videoId, title, url, comments } = videoData;

        // Flatten data for "Comments" and "Replies" sheets
        // Based on standard structure
        const commentRows = [];

        let totalComments = 0;
        let totalReplies = 0;

        if (comments && comments.length > 0) {
            console.log(`[YCA Exporter] Received ${comments.length} root comments`); // DEBUG
            // Flatten the comments tree (root comments + replies)
            const flatComments = [];
            comments.forEach(c => {
                flatComments.push(c);
                if (c.replies && c.replies.length > 0) {
                    // Add replies to the flat list
                    c.replies.forEach(r => flatComments.push(r));
                }
            });



            console.log(`[YCA Exporter] Flattened to ${flatComments.length} items`); // DEBUG
            console.log(`[YCA Exporter] Sample item:`, flatComments[0]); // DEBUG

            // Use the flattened list for processing
            flatComments.forEach((comment, index) => {
                const row = {
                    "Row ID": index + 1,
                    "Comment ID": comment.id,
                    "Commenter Username": comment.author,
                    "Comment": comment.text,
                    "Comment Time": comment.time
                };
                commentRows.push(row);
            });
            console.log(`[YCA Exporter] Generated ${commentRows.length} rows for Table1-1`); // DEBUG
        } else {
            console.warn('[YCA Exporter] No comments received to generate!');
        }

        // Create Workbook
        const wb = XLSX.utils.book_new();

        // 1. Single Sheet "Table1-1"
        const ws = XLSX.utils.json_to_sheet(commentRows);
        XLSX.utils.book_append_sheet(wb, ws, "Table1-1");

        // Generate Output
        // Return base64 string
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
        return wbout;
    }
}
