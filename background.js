// FocusTab - Background Service Worker
// Monitors tab events, closes duplicate tabs, and tracks browsing time

importScripts('crypto-utils.js');

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

// Serialize all saves to prevent read-modify-write races on timeline array
let saveChain = Promise.resolve();

function saveTimeForPrevious() {
  if (!activeHostname || !activeStartTime) return Promise.resolve();

  // Capture values locally before any async work
  const hostname = activeHostname;
  const startTime = activeStartTime;
  const now = Date.now();
  const elapsed = now - startTime;
  if (elapsed < 1000) return Promise.resolve();

  // Chain saves so each reads storage AFTER the previous write completes
  saveChain = saveChain.then(async () => {
    const domain = stripWww(hostname);
    const dateKey = getDateKey(startTime);
    const trackingKey = 'tracking_' + dateKey;
    const timelineKey = 'timeline_' + dateKey;

    const data = await chrome.storage.local.get([trackingKey, timelineKey]);
    const tracking = data[trackingKey] || {};
    const timeline = data[timelineKey] || [];

    tracking[domain] = (tracking[domain] || 0) + elapsed;
    timeline.push({ domain, start: startTime, end: now });

    await chrome.storage.local.set({
      [trackingKey]: tracking,
      [timelineKey]: timeline
    });
  }).catch(err => console.error('[FocusTab] Save error:', err));

  return saveChain;
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
setInterval(async () => {
  if (activeHostname && activeStartTime) {
    await saveTimeForPrevious();
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

// ==================== Sync ====================

const AUTO_SYNC_INTERVAL = 3; // minutes (for chrome.alarms)

function getAllTrackingData(allData) {
  const trackingData = {};
  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith('tracking_')) {
      trackingData[key] = value;
    }
  }
  return trackingData;
}

const TRACKING_KEY_RE = /^tracking_\d{4}-\d{2}-\d{2}$/;
const MAX_DAILY_MS = 24 * 60 * 60 * 1000; // 24 hours

function isValidTrackingValue(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.entries(obj).every(([k, v]) =>
    typeof k === 'string' && typeof v === 'number' && v >= 0 && v <= MAX_DAILY_MS
  );
}

function sanitizeRemoteData(data) {
  const safe = {};
  for (const [key, value] of Object.entries(data)) {
    if (TRACKING_KEY_RE.test(key) && isValidTrackingValue(value)) {
      safe[key] = value;
    }
  }
  return safe;
}

function mergeTrackingData(local, remote) {
  const safeRemote = sanitizeRemoteData(remote);
  const merged = { ...local };
  for (const [key, remoteDomains] of Object.entries(safeRemote)) {
    if (!merged[key]) {
      merged[key] = remoteDomains;
    } else {
      for (const [domain, ms] of Object.entries(remoteDomains)) {
        merged[key][domain] = Math.max(merged[key][domain] || 0, ms);
      }
    }
  }
  return merged;
}

function checkTokenScopes(res) {
  const scopeHeader = res.headers.get('X-OAuth-Scopes');
  if (scopeHeader === null) return; // header not present
  const scopes = scopeHeader.split(',').map(s => s.trim()).filter(Boolean);
  const excess = scopes.filter(s => s !== 'gist');
  if (excess.length > 0) {
    chrome.storage.local.set({ tokenScopeWarning: excess.join(', ') });
  } else {
    chrome.storage.local.remove('tokenScopeWarning');
  }
}

async function syncData() {
  const settings = await chrome.storage.local.get(['githubTokenEncrypted', 'gistId', 'deviceName']);
  const token = await decryptToken(settings.githubTokenEncrypted);
  const deviceName = settings.deviceName || 'Default';

  if (!token) return { success: false, error: 'No GitHub token configured.' };

  try {
    const allData = await chrome.storage.local.get(null);
    const localData = getAllTrackingData(allData);
    let gistId = settings.gistId;

    if (gistId) {
      // Validate gist ID format (must be hex string)
      if (!/^[a-f0-9]+$/i.test(gistId)) {
        return { success: false, error: 'Invalid Gist ID format.' };
      }

      // Download remote data
      const getRes = await fetch('https://api.github.com/gists/' + gistId, {
        headers: { 'Authorization': 'token ' + token }
      });
      if (!getRes.ok) return { success: false, error: 'Failed to fetch gist: ' + getRes.status };
      checkTokenScopes(getRes);

      const gist = await getRes.json();
      const remoteContent = gist.files['focustab_data.json'];
      let remoteAll = remoteContent ? JSON.parse(remoteContent.content) : {};

      // Backward compat: migrate flat format to device-namespaced
      const isFlat = Object.keys(remoteAll).some(k => k.startsWith('tracking_'));
      if (isFlat) {
        remoteAll = { [deviceName]: remoteAll };
      }

      // Merge this device's data
      const remoteDeviceData = remoteAll[deviceName] || {};
      const merged = mergeTrackingData(localData, remoteDeviceData);

      // Save merged data locally
      await chrome.storage.local.set(merged);

      // Store other devices' data locally for dashboard filtering
      const toStore = {};
      const oldRemoteKeys = Object.keys(allData).filter(k => k.startsWith('remote_'));
      if (oldRemoteKeys.length > 0) await chrome.storage.local.remove(oldRemoteKeys);

      const knownDevices = [];
      for (const [device, deviceData] of Object.entries(remoteAll)) {
        if (device === deviceName) continue;
        if (typeof device !== 'string' || device.length > 100) continue;
        knownDevices.push(device);
        const safeDeviceData = sanitizeRemoteData(deviceData);
        for (const [key, value] of Object.entries(safeDeviceData)) {
          toStore['remote_' + device + '_' + key] = value;
        }
      }
      toStore.knownDevices = knownDevices;
      await chrome.storage.local.set(toStore);

      // Upload: update this device's data in the gist
      remoteAll[deviceName] = merged;
      const updateRes = await fetch('https://api.github.com/gists/' + gistId, {
        method: 'PATCH',
        headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: { 'focustab_data.json': { content: JSON.stringify(remoteAll) } }
        })
      });
      if (!updateRes.ok) return { success: false, error: 'Failed to update gist: ' + updateRes.status };

    } else {
      // Create new gist with device-namespaced format
      const gistData = { [deviceName]: localData };
      const createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'FocusTab Sync Data',
          public: false,
          files: { 'focustab_data.json': { content: JSON.stringify(gistData) } }
        })
      });
      if (!createRes.ok) return { success: false, error: 'Failed to create gist: ' + createRes.status };
      checkTokenScopes(createRes);

      const newGist = await createRes.json();
      await chrome.storage.local.set({ gistId: newGist.id });
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function autoSync() {
  const settings = await chrome.storage.local.get(['githubTokenEncrypted', 'gistId']);
  if (settings.githubTokenEncrypted && settings.gistId) {
    await syncData();
  }
}

// Message handler for dashboard/popup to trigger sync
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.action === 'sync') {
    syncData().then(sendResponse);
    return true; // async response
  }
});

// Auto-sync on timer (chrome.alarms survives service worker sleep)
chrome.alarms.create('autoSync', { periodInMinutes: AUTO_SYNC_INTERVAL });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoSync') autoSync();
});

// ==================== Startup ====================

async function migrateToken() {
  const data = await chrome.storage.local.get(['githubToken', 'githubTokenEncrypted']);
  if (data.githubToken && typeof data.githubToken === 'string' && !data.githubTokenEncrypted) {
    const encrypted = await encryptToken(data.githubToken);
    await chrome.storage.local.set({ githubTokenEncrypted: encrypted });
    await chrome.storage.local.remove('githubToken');
  }
}

async function init() {
  await loadSettings();
  await migrateToken();
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

  // Auto-sync on startup
  autoSync();
}

init();
