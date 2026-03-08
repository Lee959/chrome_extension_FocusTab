// FocusTab Dashboard

const COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0',
  '#00BCD4', '#FF5722', '#8BC34A', '#3F51B5', '#FFC107',
  '#607D8B', '#795548', '#009688', '#CDDC39', '#F44336'
];

const datePicker = document.getElementById('datePicker');
const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');
const todayBtn = document.getElementById('todayBtn');
const deviceFilter = document.getElementById('deviceFilter');
const dateRangeLabel = document.getElementById('dateRangeLabel');
const timelineSection = document.getElementById('timelineSection');

let currentDate = new Date();
let viewMode = 'day';

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

function getDomainColor(domain, domainList) {
  const idx = domainList.indexOf(domain);
  return COLORS[idx % COLORS.length];
}

const TIMELINE_MIN_DURATION = 30 * 1000; // hide entries shorter than 30s from timeline
const DEFAULT_HIDDEN = ['newtab', 'mnjncmkflhcjaajjfhahdilkkmaaaida'];
let hiddenDomains = [];

async function loadHiddenDomains() {
  const data = await chrome.storage.local.get('hiddenDomains');
  if (data.hiddenDomains) {
    hiddenDomains = data.hiddenDomains;
  } else {
    hiddenDomains = [...DEFAULT_HIDDEN];
    await chrome.storage.local.set({ hiddenDomains });
  }
}

async function saveHiddenDomains() {
  await chrome.storage.local.set({ hiddenDomains });
}

function isHidden(domain) {
  return hiddenDomains.some(h => domain === h || domain.includes(h));
}

function filterTracking(tracking) {
  const filtered = {};
  for (const [domain, ms] of Object.entries(tracking)) {
    if (isHidden(domain)) continue;
    filtered[domain] = ms;
  }
  return filtered;
}

function filterTimeline(timeline) {
  return timeline.filter(entry => !isHidden(entry.domain));
}

async function loadDayData(dateKey) {
  const filter = deviceFilter.value;
  const trackingKey = 'tracking_' + dateKey;
  const timelineKey = 'timeline_' + dateKey;

  if (filter === 'local') {
    // This device only
    const data = await chrome.storage.local.get([trackingKey, timelineKey]);
    return { tracking: data[trackingKey] || {}, timeline: data[timelineKey] || [] };
  }

  if (filter.startsWith('remote_')) {
    // Specific remote device
    const device = filter.slice(7);
    const remoteKey = 'remote_' + device + '_' + trackingKey;
    const data = await chrome.storage.local.get([remoteKey]);
    return { tracking: data[remoteKey] || {}, timeline: [] };
  }

  // "all" — merge local + all remote devices
  const allData = await chrome.storage.local.get(null);
  const merged = { ...(allData[trackingKey] || {}) };
  const knownDevices = allData.knownDevices || [];

  for (const device of knownDevices) {
    const remoteData = allData['remote_' + device + '_' + trackingKey] || {};
    for (const [domain, ms] of Object.entries(remoteData)) {
      merged[domain] = (merged[domain] || 0) + ms;
    }
  }

  return { tracking: merged, timeline: allData[timelineKey] || [] };
}

function getDateRange(date, mode) {
  if (mode === 'day') {
    return [formatDateKey(date)];
  }
  if (mode === 'week') {
    const d = new Date(date);
    const dayOfWeek = d.getDay();
    // Monday = start of week (getDay: 0=Sun, 1=Mon, ...)
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);
    const keys = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      keys.push(formatDateKey(day));
    }
    return keys;
  }
  // month
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const keys = [];
  for (let i = 1; i <= daysInMonth; i++) {
    keys.push(formatDateKey(new Date(year, month, i)));
  }
  return keys;
}

function formatRangeLabel(dateKeys, mode) {
  if (mode === 'day') return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  if (mode === 'week') {
    const start = new Date(dateKeys[0] + 'T00:00:00');
    const end = new Date(dateKeys[6] + 'T00:00:00');
    return months[start.getMonth()] + ' ' + start.getDate() + ' – ' +
           months[end.getMonth()] + ' ' + end.getDate();
  }
  // month
  const d = new Date(dateKeys[0] + 'T00:00:00');
  return fullMonths[d.getMonth()] + ' ' + d.getFullYear();
}

async function loadRangeData(dateKeys) {
  const merged = {};
  for (const key of dateKeys) {
    const { tracking } = await loadDayData(key);
    for (const [domain, ms] of Object.entries(tracking)) {
      merged[domain] = (merged[domain] || 0) + ms;
    }
  }
  return { tracking: merged };
}

function renderStats(allTracking, filteredTracking) {
  const totalTimeEl = document.getElementById('totalTime');
  const siteCountEl = document.getElementById('siteCount');
  const topSiteEl = document.getElementById('topSite');

  const allEntries = Object.entries(allTracking);
  const filteredEntries = Object.entries(filteredTracking);

  const totalMs = allEntries.reduce((sum, [, ms]) => sum + ms, 0);
  totalTimeEl.textContent = totalMs > 0 ? formatDuration(totalMs) : '0m';
  siteCountEl.textContent = filteredEntries.length.toString();

  if (filteredEntries.length > 0) {
    filteredEntries.sort((a, b) => b[1] - a[1]);
    topSiteEl.textContent = filteredEntries[0][0];
  } else {
    topSiteEl.textContent = '--';
  }
}

function renderBarChart(tracking) {
  const container = document.getElementById('barChart');
  const noData = document.getElementById('noData');

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const entries = Object.entries(tracking);
  if (entries.length === 0) {
    noData.style.display = 'block';
    return;
  }
  noData.style.display = 'none';

  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 15);
  const maxMs = top[0][1];
  const allDomains = top.map(e => e[0]);

  top.forEach(([domain, ms]) => {
    const row = document.createElement('div');
    row.className = 'bar-row';

    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = domain;

    const track = document.createElement('div');
    track.className = 'bar-track';

    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = ((ms / maxMs) * 100) + '%';
    fill.style.background = getDomainColor(domain, allDomains);

    const time = document.createElement('div');
    time.className = 'bar-time';
    time.textContent = formatDuration(ms);

    const hideBtn = document.createElement('button');
    hideBtn.className = 'bar-hide';
    hideBtn.textContent = '×';
    hideBtn.title = 'Hide this site';
    hideBtn.addEventListener('click', async () => {
      hiddenDomains.push(domain);
      await saveHiddenDomains();
      renderView(currentDate);
    });

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(time);
    row.appendChild(hideBtn);
    container.appendChild(row);
  });
}

function renderHiddenDomains() {
  const container = document.getElementById('hiddenDomains');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Manual add input
  const addRow = document.createElement('div');
  addRow.className = 'hidden-add-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add domain to hide...';
  input.className = 'hidden-add-input';

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Hide';
  addBtn.className = 'hidden-add-btn';

  async function addToHidden() {
    const domain = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    if (!domain || hiddenDomains.includes(domain)) return;
    hiddenDomains.push(domain);
    await saveHiddenDomains();
    renderView(currentDate);
  }

  addBtn.addEventListener('click', addToHidden);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addToHidden(); });

  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  container.appendChild(addRow);

  // Tags for currently hidden domains
  if (hiddenDomains.length > 0) {
    const tagRow = document.createElement('div');
    tagRow.className = 'hidden-tag-row';

    const label = document.createElement('span');
    label.className = 'hidden-label';
    label.textContent = 'Hidden: ';
    tagRow.appendChild(label);

    hiddenDomains.forEach(domain => {
      const tag = document.createElement('span');
      tag.className = 'hidden-tag';
      tag.textContent = domain;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async () => {
        hiddenDomains = hiddenDomains.filter(d => d !== domain);
        await saveHiddenDomains();
        renderView(currentDate);
      });

      tag.appendChild(removeBtn);
      tagRow.appendChild(tag);
    });

    container.appendChild(tagRow);
  }
}

function renderTimeline(timeline) {
  const container = document.getElementById('timeline');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (timeline.length === 0) return;

  // DEBUG: log timeline data
  console.log('[Timeline DEBUG] entries:', timeline.length);
  timeline.forEach((e, i) => {
    console.log(`[Timeline DEBUG] #${i}: domain=${e.domain}, start=${e.start}, end=${e.end}, duration=${e.end - e.start}ms, startType=${typeof e.start}, endType=${typeof e.end}`);
  });

  // Build list of unique domains for consistent coloring
  const domainSet = [];
  timeline.forEach(entry => {
    if (!domainSet.includes(entry.domain)) {
      domainSet.push(entry.domain);
    }
  });

  // Find the day's time range
  const dayStart = new Date(timeline[0].start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  const dayMs = dayEnd.getTime() - dayStart.getTime();

  // Hour labels
  const hours = document.createElement('div');
  hours.className = 'timeline-hours';
  for (let h = 0; h <= 24; h += 3) {
    const span = document.createElement('span');
    span.textContent = h.toString().padStart(2, '0') + ':00';
    hours.appendChild(span);
  }
  container.appendChild(hours);

  // Timeline bar
  const bar = document.createElement('div');
  bar.className = 'timeline-bar';

  const tooltip = document.createElement('div');
  tooltip.className = 'timeline-tooltip';
  bar.appendChild(tooltip);

  console.log('[Timeline DEBUG] dayStart:', dayStart.getTime(), 'dayMs:', dayMs);

  timeline.forEach((entry, idx) => {
    const startOffset = entry.start - dayStart.getTime();
    const duration = entry.end - entry.start;
    const leftPct = (startOffset / dayMs) * 100;
    const widthPct = Math.max((duration / dayMs) * 100, 0.4);

    console.log(`[Timeline DEBUG] block#${idx}: left=${leftPct.toFixed(2)}%, width=${widthPct.toFixed(4)}%, bg=${getDomainColor(entry.domain, domainSet)}`);

    const block = document.createElement('div');
    block.className = 'timeline-block';
    block.style.left = leftPct + '%';
    block.style.width = widthPct + '%';
    block.style.background = getDomainColor(entry.domain, domainSet);

    block.addEventListener('mouseenter', (e) => {
      tooltip.textContent = entry.domain + '  ' + formatTime(entry.start) + ' - ' + formatTime(entry.end) + '  (' + formatDuration(duration) + ')';
      tooltip.style.display = 'block';
      tooltip.style.left = block.style.left;
    });
    block.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });

    bar.appendChild(block);
  });

  container.appendChild(bar);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'timeline-legend';
  domainSet.slice(0, 10).forEach(domain => {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color';
    colorBox.style.background = getDomainColor(domain, domainSet);

    const name = document.createElement('span');
    name.textContent = domain;

    item.appendChild(colorBox);
    item.appendChild(name);
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

async function renderView(date) {
  await loadHiddenDomains();

  const dateKeys = getDateRange(date, viewMode);
  const rangeText = formatRangeLabel(dateKeys, viewMode);

  // Update date picker / range label visibility
  if (viewMode === 'day') {
    datePicker.style.display = '';
    dateRangeLabel.style.display = 'none';
    datePicker.value = formatDateKey(date);
  } else {
    datePicker.style.display = 'none';
    dateRangeLabel.style.display = '';
    dateRangeLabel.textContent = rangeText;
  }

  let tracking, timeline;
  if (viewMode === 'day') {
    const data = await loadDayData(dateKeys[0]);
    tracking = data.tracking;
    timeline = data.timeline;
  } else {
    const data = await loadRangeData(dateKeys);
    tracking = data.tracking;
    timeline = [];
  }

  const filteredTracking = filterTracking(tracking);
  const filteredTimeline = filterTimeline(timeline).filter(e => (e.end - e.start) >= TIMELINE_MIN_DURATION);

  renderStats(tracking, filteredTracking);
  renderBarChart(filteredTracking);
  renderTimeline(filteredTimeline);
  renderHiddenDomains();

  // Hide timeline section for multi-day views
  timelineSection.style.display = viewMode === 'day' ? '' : 'none';
}

// Date navigation
function changeDate(delta) {
  if (viewMode === 'month') {
    currentDate.setMonth(currentDate.getMonth() + delta);
  } else if (viewMode === 'week') {
    currentDate.setDate(currentDate.getDate() + delta * 7);
  } else {
    currentDate.setDate(currentDate.getDate() + delta);
  }
  renderView(currentDate);
}

prevDayBtn.addEventListener('click', () => changeDate(-1));
nextDayBtn.addEventListener('click', () => changeDate(1));
todayBtn.addEventListener('click', () => {
  currentDate = new Date();
  renderView(currentDate);
});
datePicker.addEventListener('change', () => {
  currentDate = new Date(datePicker.value + 'T00:00:00');
  renderView(currentDate);
});

// View toggle
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    viewMode = btn.dataset.view;
    renderView(currentDate);
  });
});

// ==================== Sync & Device Filter ====================

const syncBtn = document.getElementById('syncBtn');
const settingsBtn = document.getElementById('settingsBtn');
const syncStatus = document.getElementById('syncStatus');

settingsBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('settings.html') });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.update({ url: 'settings.html' });
  }
});

function showSyncStatus(msg, isError) {
  syncStatus.textContent = msg;
  syncStatus.style.color = isError ? '#e74c3c' : '#4CAF50';
  if (!isError) setTimeout(() => { syncStatus.textContent = ''; }, 3000);
}

async function populateDeviceFilter() {
  const data = await chrome.storage.local.get(['knownDevices', 'deviceName']);
  const knownDevices = data.knownDevices || [];
  const currentDevice = data.deviceName || 'Default';

  // Preserve current selection
  const currentValue = deviceFilter.value;

  // Clear dynamic options (keep "This Device" and "All Devices")
  while (deviceFilter.options.length > 2) {
    deviceFilter.remove(2);
  }

  // Update "This Device" label
  deviceFilter.options[0].textContent = currentDevice + ' (this)';

  // Add other devices
  knownDevices.forEach(device => {
    const opt = document.createElement('option');
    opt.value = 'remote_' + device;
    opt.textContent = device;
    deviceFilter.appendChild(opt);
  });

  // Restore selection if still valid
  if ([...deviceFilter.options].some(o => o.value === currentValue)) {
    deviceFilter.value = currentValue;
  }
}

deviceFilter.addEventListener('change', () => {
  renderView(currentDate);
});

syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';

  const result = await chrome.runtime.sendMessage({ action: 'sync' });

  if (result.success) {
    showSyncStatus('Synced!', false);
    await populateDeviceFilter();
    renderView(currentDate);
  } else {
    showSyncStatus(result.error || 'Sync failed', true);
  }

  syncBtn.disabled = false;
  syncBtn.textContent = 'Sync';
});

// Initial render
populateDeviceFilter().then(() => renderView(currentDate));
