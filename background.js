// FocusTab - Background Service Worker
// Monitors tab events and closes duplicate tabs for restricted domains

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

let restrictedDomains = []; // [{domain, maxTabs}]
let pendingChanges = {};    // {domain: {newMaxTabs, effectiveAt}}
let enabled = true;

// Load settings from storage
async function loadSettings() {
  const data = await chrome.storage.local.get(['restrictedDomains', 'enabled', 'pendingChanges']);
  restrictedDomains = data.restrictedDomains || [];
  enabled = data.enabled !== undefined ? data.enabled : true;
  pendingChanges = data.pendingChanges || {};
  applyReadyChanges();
}

// Apply pending changes whose cooldown has expired
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

// Extract hostname from a URL string
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Find the restricted domain entry that matches a hostname
function findRestrictedEntry(hostname) {
  if (!hostname) return null;
  return restrictedDomains.find(entry => {
    return hostname === entry.domain || hostname.endsWith('.' + entry.domain);
  });
}

// Handle tab updates - close tabs exceeding the limit
async function handleTabUpdate(tabId, changeInfo, tab) {
  if (!enabled) return;
  if (changeInfo.status !== 'loading' || !tab.url) return;

  // Apply any ready pending changes first
  await applyReadyChanges();

  const hostname = getHostname(tab.url);
  const entry = findRestrictedEntry(hostname);
  if (!entry) return;

  // Find all OTHER tabs matching this domain
  const allTabs = await chrome.tabs.query({});
  const matchingTabs = allTabs.filter(t => {
    if (t.id === tabId) return false;
    const h = getHostname(t.url);
    if (!h) return false;
    return h === hostname || h.endsWith('.' + entry.domain) || hostname.endsWith('.' + h);
  });

  // If we've reached or exceeded the limit, close the new tab
  if (matchingTabs.length >= entry.maxTabs) {
    chrome.tabs.remove(tabId);
  }
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener(handleTabUpdate);

// Listen for storage changes to keep settings in sync
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

// Periodically check for pending changes to apply
setInterval(applyReadyChanges, 30 * 1000);

// Load settings on startup
loadSettings();
