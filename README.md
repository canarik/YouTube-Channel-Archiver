# YouTube Channel Archiver

A powerful Google Chrome extension designed to archive entire YouTube channels. It allows you to download transcripts, comments, and live chat replays from videos efficiently.

## Features

- **Channel Scanning**: Quickly scan and list all videos available on a YouTube channel page.
- **Single Video Archiving**: Archive transcripts, comments, and chat from individual video watch pages.
- **Transcript Download**: Automatically fetches and downloads video transcripts.
- **Comment Archiving**: Archives top-level comments and replies.
- **Live Chat Replay**: Captures live chat messages from past live streams.
- **Format Options**: Export data in TXT format, with an option to also export comments as an Excel (XLSX) file.
- **User-Friendly Interface**: Integrates directly into the YouTube UI with a simple "YCA Scan" button.
- **Background Processing**: Handles downloads in the background to keep the UI responsive.

## Installation

1. **Clone the Repository:**

    ```bash
    git clone https://github.com/canarik/YouTube-Channel-Archiver
    ```

2. **Open Chrome Extensions:**
    - Navigate to `chrome://extensions/` in your Chrome browser.
    - Enable **Developer mode** in the top right corner.
3. **Load Unpacked Extension:**
    - Click the **Load unpacked** button.
    - Select the directory where you cloned this repository (the folder containing `manifest.json`).
4. **Confirm Installation:**
    - You should see "YouTube Channel Archiver" in your list of extensions.

## Usage

1. **Navigate to a Channel or Video:**
    - Go to any YouTube channel page (e.g., `https://www.youtube.com/@ChannelName/videos`) or a specific video watch page.
2. **Start Scanning:**
    - Look for the red **"YCA Scan"** button.
    - Click the button to begin the scanning process.
3. **Monitor Progress:**
    - The extension will scan the videos and start downloading the available data (transcripts, comments, chat).
    - A status indicator may appear to show progress.
4. **Access Data:**
    - The extension will trigger file downloads for each video's data. Check your browser's download folder.
    - Files are typically named with the video title and ID.

## Options

- **Export Comments as XLSX**: Click the extension icon in the toolbar to open the popup settings. Check "Export Comments as XLSX (Excel)" to enable Excel export for comments.

## Project Structure

- `manifest.json`: Extension configuration.
- `content/`: Content scripts injected into YouTube pages.
- `background/`: Service worker for background tasks.
- `popup/`: Extension popup UI and logic.
- `utils/`: Utility functions and helpers.
- `icons/`: Extension icons.
