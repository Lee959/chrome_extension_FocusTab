// FocusTab Settings

const tokenInput = document.getElementById('tokenInput');
const gistIdInput = document.getElementById('gistIdInput');
const saveBtn = document.getElementById('saveBtn');
const toggleToken = document.getElementById('toggleToken');
const status = document.getElementById('status');
const tokenLink = document.getElementById('tokenLink');

// Set the GitHub token creation URL (cannot use target="_blank" in extension pages)
tokenLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://github.com/settings/tokens/new?scopes=gist&description=FocusTab+Sync' });
});

// Load saved settings
async function loadSettings() {
  const data = await chrome.storage.local.get(['githubToken', 'gistId']);
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

// Save settings
saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  const gistId = gistIdInput.value.trim();

  await chrome.storage.local.set({
    githubToken: token,
    gistId: gistId || ''
  });

  status.textContent = 'Saved!';
  status.style.color = '#4CAF50';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

loadSettings();
