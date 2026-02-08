/**
 * NCapture (.nvcx) Generator
 * Generates XML files compatible with NVivo Capture format.
 */

export class NCaptureGenerator {
	/**
	 * Generates the XML content for an .nvcx file based on the official NCapture schema.
	 * Schema Version: 0.2
	 * namespace: http://qsr.com.au/NVivoWebExportXMLSchema.xsd
	 */

	/**
	 * Parses a relative time string (e.g. "7 days ago") into an ISO 8601 timestamp.
	 * Approximates the date relative to the current time.
	 */
	static parseRelativeTime(timeStr) {
		if (!timeStr) return new Date().toISOString(); // Fallback to now

		// If already ISO format (e.g. from API or previous processing)
		if (timeStr.match(/^\d{4}-\d{2}-\d{2}/)) return timeStr;

		const now = new Date();
		const num = parseInt(timeStr, 10);

		if (isNaN(num)) return now.toISOString();

		if (timeStr.includes('second')) {
			now.setSeconds(now.getSeconds() - num);
		} else if (timeStr.includes('minute')) {
			now.setMinutes(now.getMinutes() - num);
		} else if (timeStr.includes('hour')) {
			now.setHours(now.getHours() - num);
		} else if (timeStr.includes('day')) {
			now.setDate(now.getDate() - num);
		} else if (timeStr.includes('week')) {
			now.setDate(now.getDate() - (num * 7));
		} else if (timeStr.includes('month')) {
			now.setMonth(now.getMonth() - num);
		} else if (timeStr.includes('year')) {
			now.setFullYear(now.getFullYear() - num);
		}

		return now.toISOString();
	}

	static generate(videoData) {
		const { videoId, title, comments } = videoData;

		// Escape helper (ti) matching official logic
		const ti = (str) => {
			if (str === null || str === undefined) return '';
			return String(str)
				.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\uD800-\uDfff\ufffe-\uffff]/g, " ")
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		};

		// 1. Header - NO BOM (working sample doesn't have it)
		let xml = '<?xml version="1.0" encoding="utf-16"?>\r\n';
		xml += '<NVivoWebDataPackage schemaVersion="0.2" xmlns="http://qsr.com.au/NVivoWebExportXMLSchema.xsd">\r\n';

		// Source Info
		xml += `\t<SourceName>${ti(title)}</SourceName>\r\n`;

		// Metadata
		const now = new Date();
		const accessDate = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');

		xml += `\t<Metadata>\r\n`;

		const metadata = {
			accessDate: accessDate,
			url: `https://www.youtube.com/watch?v=${videoId}`,
			title: title,
			dataOrigin: "YouTube",
			dataType: "YouTube",
			dataIdentifier: title,
			id: videoId,
			numViews: videoData.viewCount || "0",
			numComments: (comments && comments.length) ? String(comments.length) : "0",
			numLikes: videoData.likeCount || "0",
			numDislikes: "0",
			category: videoData.category || "News & Politics",
			content: videoData.description || "",
			published: videoData.publishedTime || accessDate,
			authorName: videoData.authorName || videoData.channelName || "",
			duration: videoData.duration || "0",
			thumbnail: videoData.thumbnail || ""
		};

		for (const [key, value] of Object.entries(metadata)) {
			if (value !== undefined && value !== null && value !== "") {
				xml += `\t\t<Key name="${key}">${ti(value)}</Key>\r\n`;
			}
		}
		xml += `\t</Metadata>\r\n`;

		// 4. Dataset
		xml += `\t<Dataset>\r\n`;

		// Headings
		xml += `\t\t<Headings>\r\n`;
		const columns = [
			{ id: "ID", title: "Comment ID", dataType: "Text", analysisType: "Classifying" },
			{ id: "Username", title: "Commenter Username", dataType: "Text", analysisType: "Classifying" },
			{ id: "Content", title: "Comment", dataType: "Text", analysisType: "Codable" },
			{ id: "CommentID", title: "Reply ID", dataType: "Text", analysisType: "Classifying" },
			{ id: "CommenterUsername", title: "Reply By Username", dataType: "Text", analysisType: "Classifying" },
			{ id: "CommentText", title: "Reply", dataType: "Text", analysisType: "Codable" },
			{ id: "ParentID", title: "In Reply To Id", dataType: "Text", analysisType: "Classifying" },
			{ id: "CreatedTime", title: "Comment Time", dataType: "DateTime", analysisType: "Classifying" },
			{ id: "CommentTime", title: "Reply Time", dataType: "DateTime", analysisType: "Classifying" },
			{ id: "UpdatedTime", title: "Updated Time", dataType: "DateTime", analysisType: "Classifying" },
			{ id: "Name", title: "Name", dataType: "Text", analysisType: "Classifying" },
			{ id: "Location", title: "Location", dataType: "Text", analysisType: "Classifying" },
			{ id: "Coordinates", title: "Coordinates", dataType: "Text", analysisType: "Classifying" }
		];

		columns.forEach(col => {
			xml += `			<Heading analysisType="${col.analysisType}" dataType="${col.dataType}" columnIdentifier="${col.id}">${ti(col.title)}</Heading>\r\n`;
		});
		xml += `		</Headings>\r\n`;

		// Rows
		xml += `		<Rows>\r\n`;

		if (comments && comments.length > 0) {
			comments.forEach(comment => {
				const rowData = this._createRowData(comment, ti);
				xml += this._renderRow(rowData);
			});
		}

		xml += `		</Rows>\r\n`;
		xml += `	</Dataset>\r\n`;

		// 5. Footer
		xml += '</NVivoWebDataPackage>\r\n';

		return xml;
	}

	static _renderRow(columnValues) {
		let xml = `			<Row>\r\n`;
		columnValues.forEach(val => {
			if (val !== null && val !== "" && val !== undefined) {
				xml += `				<Column>${val}</Column>\r\n`;
			} else {
				xml += `				<Column />\r\n`;
			}
		});
		xml += `			</Row>\r\n`;
		return xml;
	}

	static _createRowData(comment, ti) {
		// Map comment to 13 columns
		// For replies: isReply flag indicates this is a reply
		const isReply = comment.isReply || false;

		// For replies, we need the parent ID
		const parentId = isReply ? comment.parentId : null;

		return [
			ti(isReply ? parentId : comment.id),    // [0] ID (Parent ID for replies, own ID for root)
			ti(isReply ? null : comment.author),    // [1] Username (only for root comments)
			ti(isReply ? null : comment.text),      // [2] Content (only for root comments)

			ti(isReply ? comment.id : null),	// [3] Reply ID (only for replies)
			ti(isReply ? comment.author : null),    // [4] Reply Author (only for replies)
			ti(isReply ? comment.text : null),      // [5] Reply Content (only for replies)

			ti(parentId),			   // [6] ParentID (only for replies)

			ti(isReply ? null : NCaptureGenerator.parseRelativeTime(comment.time)),      // [7] CreatedTime (only for root)
			ti(isReply ? NCaptureGenerator.parseRelativeTime(comment.time) : null),      // [8] CommentTime (only for replies)

			ti(NCaptureGenerator.parseRelativeTime(comment.time)),		       // [9] UpdatedTime (both)

			ti(comment.author),		     // [10] Name (both)
			ti(null),			       // [11] Location
			ti(null)				// [12] Coordinates
		];
	}
}
