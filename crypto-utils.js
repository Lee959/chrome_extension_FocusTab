// FocusTab — AES-256-GCM token encryption
// Key stored as non-extractable CryptoKey in IndexedDB (per-origin, inaccessible to other extensions)
// Encrypted token stored in chrome.storage.local

const CRYPTO_DB_NAME = 'focustab_keys';
const CRYPTO_STORE_NAME = 'keys';
const CRYPTO_KEY_ID = 'token_key';

function openKeyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CRYPTO_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(CRYPTO_STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateKey() {
  const db = await openKeyDB();

  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction(CRYPTO_STORE_NAME, 'readonly');
    const req = tx.objectStore(CRYPTO_STORE_NAME).get(CRYPTO_KEY_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (existing) {
    db.close();
    return existing;
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );

  await new Promise((resolve, reject) => {
    const tx = db.transaction(CRYPTO_STORE_NAME, 'readwrite');
    tx.objectStore(CRYPTO_STORE_NAME).put(key, CRYPTO_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return key;
}

async function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
  };
}

async function decryptToken(encrypted) {
  if (!encrypted || !encrypted.iv || !encrypted.data) return null;
  try {
    const key = await getOrCreateKey();
    const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.warn('[FocusTab] Token decryption failed:', err.message);
    return null;
  }
}
