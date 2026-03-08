# FocusTab

A Chrome extension that limits duplicate tabs per website and tracks your browsing time to help you stay focused.

## Features

### Tab Limiting
- Set a max number of tabs per domain — duplicates are silently closed
- **Cooldown Timer** — Increasing a limit requires a 15-minute cooldown to prevent impulsive changes. Decreasing is instant
- **Input Validation** — Auto-cleans URLs (strips `https://`, `www.`, paths) and rejects invalid domains
- **Quick Add Presets** — One-click add for ChatGPT and Claude

### Time Tracking
- Records active browsing time per website per day
- **Idle Detection** — Pauses tracking after 3 minutes of inactivity, resumes automatically
- **Internal Page Filtering** — Ignores `chrome://`, `chrome-extension://`, and other browser pages
- **90-Day Retention** — Automatically cleans up data older than 3 months

### Dashboard
- **Time by Site** — Bar chart showing top 15 sites by time spent
- **Timeline** — Color-coded visualization of your browsing activity across the day
- **Stats Cards** — Total active time, sites visited, and top site at a glance
- **Date Navigation** — Browse historical data day by day
- **Hidden Domains** — Hide irrelevant sites from stats (e.g. new tab page). Add manually or click "x" on any bar. Total active time still counts hidden domains so it reflects real screen time

### Multi-Device Support
- **Device Labeling** — Name each device (e.g. "Work Laptop", "Home Desktop") in Settings
- **Device Filter** — Dashboard dropdown to view data from a specific device or all devices combined
- Data from each device stays separate — no accidental merging

### GitHub Gist Sync
- Sync tracking data between computers using a private GitHub Gist
- **Auto-Sync** — Automatically syncs every 30 minutes when credentials are configured
- Also syncs on extension startup
- Manual sync available via the Dashboard "Sync" button
- Token and Gist ID fields are masked by default with show/hide toggles

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the project folder
5. Pin FocusTab to your toolbar for quick access

## Usage

### Tab Limiting
1. Click the FocusTab icon in your toolbar
2. Type a domain (e.g. `chatgpt.com`) and click **Add**, or use the quick-add presets
3. Each site defaults to max **1 tab**
4. Use **+** / **-** to adjust — increasing has a 15-minute cooldown

### Dashboard
1. Click **Dashboard** in the popup
2. View time-per-site charts and daily timeline
3. Navigate between days using the arrows or date picker
4. Click **x** on any site bar to hide it from stats
5. Use the device filter dropdown to switch between devices

### Data Sync Setup
1. Go to Dashboard > **Settings**
2. Enter a **Device Name** (e.g. "Work Laptop")
3. Create a [GitHub Personal Access Token](https://github.com/settings/tokens/new?scopes=gist&description=FocusTab+Sync) with only the `gist` scope
4. Paste the token and click **Save**
5. Click **Sync** on the Dashboard — a Gist ID is auto-generated on first sync
6. On another computer: install the extension, enter the same token and Gist ID, then sync

## Permissions

| Permission | Purpose |
|---|---|
| `tabs` | Monitor tab URLs for limiting and time tracking |
| `storage` | Store settings, tracking data, and sync credentials locally |
| `idle` | Detect user inactivity to pause time tracking |
| `https://api.github.com/*` | Sync data via GitHub Gist API |

## File Structure

```
├── manifest.json      # Extension configuration
├── background.js      # Service worker: tab limiting, time tracking, sync, idle detection
├── popup.html/js/css   # Toolbar popup: manage restricted domains
├── dashboard.html/js/css # Full-page dashboard: stats, charts, timeline, sync
├── settings.html/js/css  # Settings page: device name, GitHub token, Gist ID
└── icons/              # Extension icons (16, 48, 128px)
```
