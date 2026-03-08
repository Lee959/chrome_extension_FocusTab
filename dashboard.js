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

let currentDate = new Date();

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

async function loadDayData(dateKey) {
  const trackingKey = 'tracking_' + dateKey;
  const timelineKey = 'timeline_' + dateKey;
  const data = await chrome.storage.local.get([trackingKey, timelineKey]);
  return {
    tracking: data[trackingKey] || {},
    timeline: data[timelineKey] || []
  };
}

function renderStats(tracking) {
  const totalTimeEl = document.getElementById('totalTime');
  const siteCountEl = document.getElementById('siteCount');
  const topSiteEl = document.getElementById('topSite');

  const entries = Object.entries(tracking);
  if (entries.length === 0) {
    totalTimeEl.textContent = '0m';
    siteCountEl.textContent = '0';
    topSiteEl.textContent = '--';
    return;
  }

  const totalMs = entries.reduce((sum, [, ms]) => sum + ms, 0);
  totalTimeEl.textContent = formatDuration(totalMs);
  siteCountEl.textContent = entries.length.toString();

  entries.sort((a, b) => b[1] - a[1]);
  topSiteEl.textContent = entries[0][0];
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

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(time);
    container.appendChild(row);
  });
}

function renderTimeline(timeline) {
  const container = document.getElementById('timeline');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (timeline.length === 0) return;

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

  timeline.forEach(entry => {
    const startOffset = entry.start - dayStart.getTime();
    const duration = entry.end - entry.start;

    const block = document.createElement('div');
    block.className = 'timeline-block';
    block.style.left = ((startOffset / dayMs) * 100) + '%';
    block.style.width = Math.max((duration / dayMs) * 100, 0.1) + '%';
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

async function renderDay(date) {
  const dateKey = formatDateKey(date);
  datePicker.value = dateKey;

  const { tracking, timeline } = await loadDayData(dateKey);
  renderStats(tracking);
  renderBarChart(tracking);
  renderTimeline(timeline);
}

// Date navigation
function changeDate(delta) {
  currentDate.setDate(currentDate.getDate() + delta);
  renderDay(currentDate);
}

prevDayBtn.addEventListener('click', () => changeDate(-1));
nextDayBtn.addEventListener('click', () => changeDate(1));
todayBtn.addEventListener('click', () => {
  currentDate = new Date();
  renderDay(currentDate);
});
datePicker.addEventListener('change', () => {
  currentDate = new Date(datePicker.value + 'T00:00:00');
  renderDay(currentDate);
});

// ==================== Sync ====================

const syncBtn = document.getElementById('syncBtn');
const settingsBtn = document.getElementById('settingsBtn');
const syncStatus = document.getElementById('syncStatus');

settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'settings.html' });
});

function showSyncStatus(msg, isError) {
  syncStatus.textContent = msg;
  syncStatus.style.color = isError ? '#e74c3c' : '#4CAF50';
  if (!isError) setTimeout(() => { syncStatus.textContent = ''; }, 3000);
}

async function getAllTrackingData() {
  const all = await chrome.storage.local.get(null);
  const trackingData = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('tracking_')) {
      trackingData[key] = value;
    }
  }
  return trackingData;
}

function mergeTrackingData(local, remote) {
  const merged = { ...local };
  for (const [key, remoteDomains] of Object.entries(remote)) {
    if (!merged[key]) {
      merged[key] = remoteDomains;
    } else {
      // For each domain, keep the larger value
      for (const [domain, ms] of Object.entries(remoteDomains)) {
        merged[key][domain] = Math.max(merged[key][domain] || 0, ms);
      }
    }
  }
  return merged;
}

async function syncData() {
  const settings = await chrome.storage.local.get(['githubToken', 'gistId']);
  const token = settings.githubToken;

  if (!token) {
    showSyncStatus('No GitHub token. Go to Settings first.', true);
    return;
  }

  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';

  try {
    const localData = await getAllTrackingData();
    let gistId = settings.gistId;

    if (gistId) {
      // Download remote data and merge
      const getRes = await fetch('https://api.github.com/gists/' + gistId, {
        headers: { 'Authorization': 'token ' + token }
      });

      if (!getRes.ok) throw new Error('Failed to fetch gist: ' + getRes.status);

      const gist = await getRes.json();
      const remoteContent = gist.files['focustab_data.json'];
      const remoteData = remoteContent ? JSON.parse(remoteContent.content) : {};

      // Merge
      const merged = mergeTrackingData(localData, remoteData);

      // Save merged data locally
      await chrome.storage.local.set(merged);

      // Upload merged data
      const updateRes = await fetch('https://api.github.com/gists/' + gistId, {
        method: 'PATCH',
        headers: {
          'Authorization': 'token ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: { 'focustab_data.json': { content: JSON.stringify(merged) } }
        })
      });

      if (!updateRes.ok) throw new Error('Failed to update gist: ' + updateRes.status);
    } else {
      // Create new gist
      const createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': 'token ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'FocusTab Sync Data',
          public: false,
          files: { 'focustab_data.json': { content: JSON.stringify(localData) } }
        })
      });

      if (!createRes.ok) throw new Error('Failed to create gist: ' + createRes.status);

      const newGist = await createRes.json();
      gistId = newGist.id;
      await chrome.storage.local.set({ gistId });
    }

    showSyncStatus('Synced!', false);
    renderDay(currentDate);
  } catch (err) {
    showSyncStatus('Sync failed: ' + err.message, true);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync';
  }
}

syncBtn.addEventListener('click', syncData);

// Initial render
renderDay(currentDate);
