// FocusTab Settings

const deviceNameInput = document.getElementById('deviceNameInput');
const tokenInput = document.getElementById('tokenInput');
const gistIdInput = document.getElementById('gistIdInput');
const saveBtn = document.getElementById('saveBtn');
const verifyBtn = document.getElementById('verifyBtn');
const toggleToken = document.getElementById('toggleToken');
const status = document.getElementById('status');
const verifyResult = document.getElementById('verifyResult');
const toggleGistId = document.getElementById('toggleGistId');
const tokenLink = document.getElementById('tokenLink');
const backBtn = document.getElementById('backBtn');

// Back to Dashboard — reuse existing tab if open
backBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard.html') });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    chrome.tabs.remove((await chrome.tabs.getCurrent()).id);
  } else {
    chrome.tabs.update({ url: 'dashboard.html' });
  }
});

// Set the GitHub token creation URL (cannot use target="_blank" in extension pages)
tokenLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://github.com/settings/tokens/new?scopes=gist&description=FocusTab+Sync' });
});

// Load saved settings
async function loadSettings() {
  const data = await chrome.storage.local.get(['githubToken', 'gistId', 'deviceName']);
  if (data.deviceName) deviceNameInput.value = data.deviceName;
  if (data.githubToken) tokenInput.value = data.githubToken;
  if (data.gistId) gistIdInput.value = data.gistId;
}

// Toggle password visibility
toggleToken.addEventListener('click', () => {
  if (tokenInput.type === 'password') {
    tokenInput.type = 'text';
    toggleToken.textContent = 'Hide';
  } else {
    tokenInput.type = 'password';
    toggleToken.textContent = 'Show';
  }
});

// Toggle Gist ID visibility
toggleGistId.addEventListener('click', () => {
  if (gistIdInput.type === 'password') {
    gistIdInput.type = 'text';
    toggleGistId.textContent = 'Hide';
  } else {
    gistIdInput.type = 'password';
    toggleGistId.textContent = 'Show';
  }
});

// Save settings
saveBtn.addEventListener('click', async () => {
  const deviceName = deviceNameInput.value.trim();
  const token = tokenInput.value.trim();
  const gistId = gistIdInput.value.trim();

  await chrome.storage.local.set({
    deviceName: deviceName || '',
    githubToken: token,
    gistId: gistId || ''
  });

  status.textContent = 'Saved!';
  status.style.color = '#4CAF50';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

// Verify token
verifyBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    verifyResult.textContent = 'Please enter a token first.';
    verifyResult.style.color = '#e74c3c';
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Testing...';
  verifyResult.textContent = '';

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': 'token ' + token }
    });

    if (res.ok) {
      const user = await res.json();
      verifyResult.textContent = 'Connected as ' + user.login;
      verifyResult.style.color = '#4CAF50';
    } else if (res.status === 401) {
      verifyResult.textContent = 'Invalid token. Please check and try again.';
      verifyResult.style.color = '#e74c3c';
    } else {
      verifyResult.textContent = 'Error: HTTP ' + res.status;
      verifyResult.style.color = '#e74c3c';
    }
  } catch (err) {
    verifyResult.textContent = 'Network error. Check your connection.';
    verifyResult.style.color = '#e74c3c';
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Test Connection';
  }
});

loadSettings();
