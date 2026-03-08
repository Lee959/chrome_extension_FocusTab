// FocusTab - Background Service Worker
// Monitors tab events, closes duplicate tabs, and tracks browsing time

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const RETENTION_DAYS = 90;

// ==================== Tab Limiting ====================

let restrictedDomains = []; // [{domain, maxTabs}]
let pendingChanges = {};    // {domain: {newMaxTabs, effectiveAt}}
let enabled = true;

async function loadSettings() {
  const data = await chrome.storage.local.get(['restrictedDomains', 'enabled', 'pendingChanges']);
  restrictedDomains = data.restrictedDomains || [];
  enabled = data.enabled !== undefined ? data.enabled : true;
  pendingChanges = data.pendingChanges || {};
  applyReadyChanges();
}

async function applyReadyChanges() {
  const now = Date.now();
  let changed = false;

  for (const domain of Object.keys(pendingChanges)) {
    const pending = pendingChanges[domain];
    if (now >= pending.effectiveAt) {
      const entry = restrictedDomains.find(d => d.domain === domain);
      if (entry) {
        entry.maxTabs = pending.newMaxTabs;
      }
      delete pendingChanges[domain];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ restrictedDomains, pendingChanges });
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function findRestrictedEntry(hostname) {
  if (!hostname) return null;
  return restrictedDomains.find(entry => {
    return hostname === entry.domain || hostname.endsWith('.' + entry.domain);
  });
}

async function handleTabUpdate(tabId, changeInfo, tab) {
  if (!enabled) return;
  if (changeInfo.status !== 'loading' || !tab.url) return;

  await applyReadyChanges();

  const hostname = getHostname(tab.url);
  const entry = findRestrictedEntry(hostname);
  if (!entry) return;

  const allTabs = await chrome.tabs.query({});
  const matchingTabs = allTabs.filter(t => {
    if (t.id === tabId) return false;
    const h = getHostname(t.url);
    if (!h) return false;
    return h === hostname || h.endsWith('.' + entry.domain) || hostname.endsWith('.' + h);
  });

  if (matchingTabs.length >= entry.maxTabs) {
    chrome.tabs.remove(tabId);
  }
}

chrome.tabs.onUpdated.addListener(handleTabUpdate);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.restrictedDomains) {
    restrictedDomains = changes.restrictedDomains.newValue || [];
  }
  if (changes.enabled) {
    enabled = changes.enabled.newValue;
  }
  if (changes.pendingChanges) {
    pendingChanges = changes.pendingChanges.newValue || {};
  }
});

setInterval(applyReadyChanges, 30 * 1000);

// ==================== Time Tracking ====================

let activeHostname = null;
let activeStartTime = null;

function getDateKey(timestamp) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function stripWww(hostname) {
  return hostname ? hostname.replace(/^www\./, '') : hostname;
}

// Filter out browser internal pages that have no tracking value
function isTrackableUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
  // This excludes: chrome://, chrome-extension://, about:, edge://, file://
}

async function saveTimeForPrevious() {
  if (!activeHostname || !activeStartTime) return;

  const now = Date.now();
  const elapsed = now - activeStartTime;
  if (elapsed < 1000) return; // ignore < 1 second

  const domain = stripWww(activeHostname);
  const dateKey = getDateKey(activeStartTime);
  const trackingKey = 'tracking_' + dateKey;
  const timelineKey = 'timeline_' + dateKey;

  const data = await chrome.storage.local.get([trackingKey, timelineKey]);
  const tracking = data[trackingKey] || {};
  const timeline = data[timelineKey] || [];

  tracking[domain] = (tracking[domain] || 0) + elapsed;
  timeline.push({ domain, start: activeStartTime, end: now });

  await chrome.storage.local.set({
    [trackingKey]: tracking,
    [timelineKey]: timeline
  });
}

async function startTracking(hostname) {
  await saveTimeForPrevious();
  activeHostname = hostname;
  activeStartTime = hostname ? Date.now() : null;
}

async function onTabActivated(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const hostname = isTrackableUrl(tab.url) ? getHostname(tab.url) : null;
    await startTracking(hostname);
  } catch {
    await startTracking(null);
  }
}

async function onWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await startTracking(null);
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    if (tabs.length > 0 && isTrackableUrl(tabs[0].url)) {
      await startTracking(getHostname(tabs[0].url));
    } else {
      await startTracking(null);
    }
  } catch {
    await startTracking(null);
  }
}

// Also track when a tab's URL changes while it's active
async function onTabUpdateForTracking(tabId, changeInfo, tab) {
  if (!changeInfo.url) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab && activeTab.id === tabId) {
      const hostname = isTrackableUrl(changeInfo.url) ? getHostname(changeInfo.url) : null;
      await startTracking(hostname);
    }
  } catch {
    // ignore
  }
}

chrome.tabs.onActivated.addListener(onTabActivated);
chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);
chrome.tabs.onUpdated.addListener(onTabUpdateForTracking);

// ==================== Idle Detection ====================

const IDLE_THRESHOLD = 180; // 3 minutes in seconds

chrome.idle.setDetectionInterval(IDLE_THRESHOLD);

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'active') {
    // User is back — resume tracking the current active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && isTrackableUrl(tab.url)) {
        await startTracking(getHostname(tab.url));
      }
    } catch {
      // ignore
    }
  } else {
    // idle or locked — pause tracking
    await startTracking(null);
  }
});

// Periodic save to avoid data loss if service worker dies
setInterval(() => {
  if (activeHostname && activeStartTime) {
    saveTimeForPrevious();
    activeStartTime = Date.now();
  }
}, 60 * 1000);

// ==================== Data Cleanup ====================

async function cleanOldData() {
  const allKeys = await chrome.storage.local.get(null);
  const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const keysToRemove = [];

  for (const key of Object.keys(allKeys)) {
    const match = key.match(/^(tracking|timeline)_(\d{4}-\d{2}-\d{2})$/);
    if (match) {
      const dateStr = match[2];
      if (new Date(dateStr).getTime() < cutoff) {
        keysToRemove.push(key);
      }
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

// ==================== Startup ====================

async function init() {
  await loadSettings();
  await cleanOldData();

  // Start tracking the current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && isTrackableUrl(tab.url)) {
      activeHostname = getHostname(tab.url);
      activeStartTime = Date.now();
    }
  } catch {
    // ignore
  }
}

init();
