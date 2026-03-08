// FocusTab - Popup UI Logic

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

const domainInput = document.getElementById('domainInput');
const addBtn = document.getElementById('addBtn');
const domainList = document.getElementById('domainList');
const enableToggle = document.getElementById('enableToggle');
const emptyMsg = document.getElementById('emptyMsg');

let timerInterval = null;

const DEFAULT_DOMAINS = ['chatgpt.com', 'claude.ai'];

// Load and render current settings
async function loadSettings() {
  const data = await chrome.storage.local.get(['restrictedDomains', 'enabled', 'pendingChanges']);
  const domains = data.restrictedDomains || [];
  const enabled = data.enabled !== undefined ? data.enabled : true;
  const pendingChanges = data.pendingChanges || {};

  enableToggle.checked = enabled;
  renderDomainList(domains, pendingChanges);
  startTimerUpdates();
}

// Start interval to update cooldown timers
function startTimerUpdates() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(['restrictedDomains', 'pendingChanges']);
    renderDomainList(data.restrictedDomains || [], data.pendingChanges || {});
  }, 1000);
}

// Format remaining time as "Xm Ys"
function formatTimeLeft(ms) {
  if (ms <= 0) return '';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.ceil((ms % 60000) / 1000);
  if (minutes > 0) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

// Render the domain list
async function renderDomainList(domains, pendingChanges) {
  const allTabs = await chrome.tabs.query({});
  while (domainList.firstChild) {
    domainList.removeChild(domainList.firstChild);
  }
  // Show presets for domains not yet added
  const presetsContainer = document.getElementById('presets');
  while (presetsContainer.firstChild) {
    presetsContainer.removeChild(presetsContainer.firstChild);
  }
  const existingDomains = domains.map(d => d.domain);
  const available = DEFAULT_DOMAINS.filter(d => !existingDomains.includes(d));
  if (available.length > 0) {
    const label = document.createElement('span');
    label.className = 'presets-label';
    label.textContent = 'Quick add:';
    presetsContainer.appendChild(label);
    available.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = d;
      btn.addEventListener('click', () => addPreset(d));
      presetsContainer.appendChild(btn);
    });
  }

  emptyMsg.style.display = domains.length === 0 ? 'block' : 'none';

  const now = Date.now();

  domains.forEach(entry => {
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'domain-name';
    nameSpan.textContent = entry.domain;

    const controls = document.createElement('div');
    controls.className = 'domain-controls';

    const pending = pendingChanges[entry.domain];
    const hasPending = pending && now < pending.effectiveAt;

    // Decrease button (always available, instant effect)
    const minusBtn = document.createElement('button');
    minusBtn.className = 'limit-btn';
    minusBtn.textContent = '-';
    minusBtn.title = 'Decrease limit (instant)';
    if (entry.maxTabs <= 1) {
      minusBtn.disabled = true;
    }
    minusBtn.addEventListener('click', () => changeLimit(entry.domain, -1));

    // Current limit display
    const limitSpan = document.createElement('span');
    limitSpan.className = 'limit-display';
    limitSpan.textContent = entry.maxTabs;

    // Increase button (triggers cooldown)
    const plusBtn = document.createElement('button');
    plusBtn.className = 'limit-btn';
    plusBtn.title = 'Increase limit (15min cooldown)';
    plusBtn.textContent = '+';
    if (hasPending) {
      plusBtn.disabled = true;
    }
    plusBtn.addEventListener('click', () => changeLimit(entry.domain, 1));

    // Cooldown indicator
    const cooldownSpan = document.createElement('span');
    cooldownSpan.className = 'cooldown';
    if (hasPending) {
      const timeLeft = pending.effectiveAt - now;
      cooldownSpan.textContent = formatTimeLeft(timeLeft) + ' \u2192 ' + pending.newMaxTabs;
    }

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => removeDomain(entry.domain));

    controls.appendChild(minusBtn);
    controls.appendChild(limitSpan);
    controls.appendChild(plusBtn);
    controls.appendChild(cooldownSpan);
    controls.appendChild(removeBtn);

    // Show "Close N" button if too many tabs are open
    const matchingTabs = allTabs.filter(t => {
      try {
        const h = new URL(t.url).hostname;
        return h === entry.domain || h.endsWith('.' + entry.domain);
      } catch { return false; }
    });
    if (matchingTabs.length > entry.maxTabs) {
      const excess = matchingTabs.length - entry.maxTabs;
      const closeBtn = document.createElement('button');
      closeBtn.className = 'close-excess-btn';
      closeBtn.textContent = 'Close ' + excess;
      closeBtn.title = 'Close ' + excess + ' excess tab' + (excess > 1 ? 's' : '');
      closeBtn.addEventListener('click', async () => {
        const toClose = matchingTabs.slice(0, excess);
        await chrome.tabs.remove(toClose.map(t => t.id));
        loadSettings();
      });
      controls.appendChild(closeBtn);
    }

    li.appendChild(nameSpan);
    li.appendChild(controls);
    domainList.appendChild(li);
  });
}

// Change limit for a domain
async function changeLimit(domain, delta) {
  const data = await chrome.storage.local.get(['restrictedDomains', 'pendingChanges']);
  const domains = data.restrictedDomains || [];
  const pendingChanges = data.pendingChanges || {};
  const entry = domains.find(d => d.domain === domain);
  if (!entry) return;

  const newMax = entry.maxTabs + delta;
  if (newMax < 1) return;

  if (delta > 0) {
    // Increasing: apply cooldown
    pendingChanges[domain] = {
      newMaxTabs: newMax,
      effectiveAt: Date.now() + COOLDOWN_MS
    };
    await chrome.storage.local.set({ pendingChanges });
  } else {
    // Decreasing: apply immediately
    entry.maxTabs = newMax;
    // Cancel any pending increase if new limit is already >= pending
    if (pendingChanges[domain] && pendingChanges[domain].newMaxTabs <= newMax) {
      delete pendingChanges[domain];
    }
    await chrome.storage.local.set({ restrictedDomains: domains, pendingChanges });
  }

  renderDomainList(domains, pendingChanges);
}

// Clean domain input (strip protocol, path, whitespace)
function cleanDomain(input) {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.split('/')[0];
  // Remove port number
  domain = domain.split(':')[0];
  domain = domain.replace(/^www\./, '');
  return domain;
}

// Validate a cleaned domain
function isValidDomain(domain) {
  if (!domain) return false;
  // Must have at least one dot, each part alphanumeric/hyphens, TLD >= 2 chars
  const pattern = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
  return pattern.test(domain);
}

// Real-time input validation
domainInput.addEventListener('input', () => {
  const raw = domainInput.value;
  const cleaned = cleanDomain(raw);
  const preview = document.getElementById('domainPreview');

  if (!raw.trim()) {
    domainInput.classList.remove('input-valid', 'input-invalid');
    preview.textContent = '';
    addBtn.disabled = false;
    return;
  }

  if (isValidDomain(cleaned)) {
    domainInput.classList.add('input-valid');
    domainInput.classList.remove('input-invalid');
    // Show cleaned version if different from raw input
    const simplified = cleaned !== raw.trim().toLowerCase();
    preview.textContent = simplified ? '\u2192 ' + cleaned : '';
    preview.className = 'domain-preview valid';
    addBtn.disabled = false;
  } else {
    domainInput.classList.add('input-invalid');
    domainInput.classList.remove('input-valid');
    preview.textContent = 'Invalid domain format';
    preview.className = 'domain-preview invalid';
    addBtn.disabled = true;
  }
});

// Add a domain
async function addDomain() {
  const domain = cleanDomain(domainInput.value);
  if (!isValidDomain(domain)) return;

  const data = await chrome.storage.local.get(['restrictedDomains']);
  const domains = data.restrictedDomains || [];

  if (domains.some(d => d.domain === domain)) {
    domainInput.value = '';
    domainInput.classList.remove('input-valid', 'input-invalid');
    document.getElementById('domainPreview').textContent = 'Already in list';
    document.getElementById('domainPreview').className = 'domain-preview invalid';
    setTimeout(() => { document.getElementById('domainPreview').textContent = ''; }, 1500);
    return;
  }

  domains.push({ domain: domain, maxTabs: 1 });
  await chrome.storage.local.set({ restrictedDomains: domains });
  domainInput.value = '';
  domainInput.classList.remove('input-valid', 'input-invalid');
  document.getElementById('domainPreview').textContent = '';
  const pendingData = await chrome.storage.local.get(['pendingChanges']);
  renderDomainList(domains, pendingData.pendingChanges || {});
}

// Quick-add a preset domain
async function addPreset(domain) {
  const data = await chrome.storage.local.get(['restrictedDomains']);
  const domains = data.restrictedDomains || [];
  if (domains.some(d => d.domain === domain)) return;

  domains.push({ domain: domain, maxTabs: 1 });
  await chrome.storage.local.set({ restrictedDomains: domains });
  const pendingData = await chrome.storage.local.get(['pendingChanges']);
  renderDomainList(domains, pendingData.pendingChanges || {});
}

// Remove a domain
async function removeDomain(domain) {
  const data = await chrome.storage.local.get(['restrictedDomains', 'pendingChanges']);
  const domains = (data.restrictedDomains || []).filter(d => d.domain !== domain);
  const pendingChanges = data.pendingChanges || {};
  delete pendingChanges[domain];
  await chrome.storage.local.set({ restrictedDomains: domains, pendingChanges });
  renderDomainList(domains, pendingChanges);
}

// Toggle enable/disable
enableToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enableToggle.checked });
});

// Add button click
addBtn.addEventListener('click', addDomain);

// Enter key to add
domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain();
});

// Dashboard button — reuse existing tab if open
document.getElementById('dashboardBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard.html') });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: 'dashboard.html' });
  }
});

// Show scope warning if token has excess permissions
async function checkScopeWarning() {
  const data = await chrome.storage.local.get('tokenScopeWarning');
  const el = document.getElementById('scopeWarning');
  if (data.tokenScopeWarning) {
    el.textContent = 'Your GitHub token has excess permissions: ' + data.tokenScopeWarning + '. Only "gist" is needed. Recreate it with gist-only scope.';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// Load on popup open
loadSettings();
checkScopeWarning();
