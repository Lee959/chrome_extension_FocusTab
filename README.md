# FocusTab

A Chrome extension that limits duplicate tabs per website and tracks your browsing time to help you stay focused.

## Features

- **Tab Limiting** — Set a max number of tabs per domain. Duplicates are silently closed.
- **Cooldown Timer** — Increasing a tab limit requires a 15-minute cooldown to prevent impulsive changes. Decreasing is instant.
- **Input Validation** — Auto-cleans URLs (strips `https://`, `www.`, paths) and rejects invalid domains.
- **Quick Add Presets** — One-click add for ChatGPT and Claude.
- **Time Tracking** — Records active browsing time for all websites.
- **Idle Detection** — Pauses tracking after 3 minutes of no mouse/keyboard input. Resumes automatically.
- **Internal Page Filtering** — Ignores `chrome://newtab`, `chrome://extensions`, and other browser pages.
- **Dashboard** — Full-page view with bar charts (time per site) and a color-coded timeline.
- **GitHub Gist Sync** — Sync tracking data between multiple computers using a private GitHub Gist.
- **90-Day Retention** — Automatically cleans up data older than 3 months.

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the project folder
5. Pin FocusTab to your toolbar for quick access

## Usage

### Tab Limiting
- Click the FocusTab icon to open the popup
- Add websites by typing a domain (e.g. `chatgpt.com`) or use the quick-add presets
- Each site defaults to a max of **1 tab**
- Use **+** / **-** to adjust the limit per site

### Dashboard
- Click the **Dashboard** button in the popup
- View time-per-site bar charts and a daily timeline
- Navigate between days using the date picker

### Data Sync
1. Go to Dashboard > **Settings**
2. Create a GitHub Personal Access Token with the `gist` scope
3. Paste the token and click Save
4. Click **Sync** on the Dashboard to upload/download data
5. Use the same token and Gist ID on another computer to sync
