/**
 * background.js
 * Manifest V3 service worker for Tab Manager Pro.
 * Handles the extension icon click to quick-add the current tab
 * to the configured inbox category.
 */

'use strict';

const STORAGE_KEY = 'tabManagerData';

// -------------------------------------------------------
// Favicon helpers (inline — can't import window-based utils)
// -------------------------------------------------------
async function fetchFaviconAsDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) return '';
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

async function resolveFavicon(tab) {
  // 1. Try the tab's own favIconUrl
  if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
    const data = await fetchFaviconAsDataUrl(tab.favIconUrl);
    if (data) return data;
  }

  // 2. Try Google's favicon service
  try {
    const hostname = new URL(tab.url).hostname;
    const googleUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
    const data = await fetchFaviconAsDataUrl(googleUrl);
    if (data) return data;
  } catch { /* ignore */ }

  // 3. Try DuckDuckGo
  try {
    const hostname = new URL(tab.url).hostname;
    const ddgUrl = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;
    const data = await fetchFaviconAsDataUrl(ddgUrl);
    if (data) return data;
  } catch { /* ignore */ }

  return '';
}

// -------------------------------------------------------
// URL validation — skip internal browser pages
// -------------------------------------------------------
function isAddableUrl(url) {
  if (!url) return false;
  const blocked = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://', 'devtools://'];
  return !blocked.some(prefix => url.startsWith(prefix));
}

// -------------------------------------------------------
// Generate a random ID (mirrors Utils.generateId)
// -------------------------------------------------------
function generateId() {
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// -------------------------------------------------------
// Derive a display name from URL (mirrors Utils.nameFromUrl)
// -------------------------------------------------------
function nameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Capitalise first letter
    return hostname.charAt(0).toUpperCase() + hostname.slice(1);
  } catch {
    return url;
  }
}

// -------------------------------------------------------
// Badge helpers
// -------------------------------------------------------
function flashBadge(text, color, ms = 1500) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
}

// -------------------------------------------------------
// Content script toast — inject a brief overlay on the active tab
// -------------------------------------------------------
async function showToast(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg) => {
        const el = document.createElement('div');
        el.textContent = msg;
        Object.assign(el.style, {
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: '2147483647',
          padding: '10px 18px',
          borderRadius: '8px',
          background: '#1a1a1a',
          color: '#fff',
          fontSize: '14px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          opacity: '0',
          transition: 'opacity 0.2s ease',
          pointerEvents: 'none'
        });
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
          el.style.opacity = '0';
          setTimeout(() => el.remove(), 300);
        }, 1500);
      },
      args: [message]
    });
  } catch {
    // Can't inject into some pages (e.g. chrome:// URLs) — badge is enough
  }
}

// -------------------------------------------------------
// Main handler: icon click
// -------------------------------------------------------
chrome.action.onClicked.addListener(async (tab) => {
  // 1. Validate URL
  if (!isAddableUrl(tab.url)) {
    flashBadge('✗', '#d93025');
    return;
  }

  // 2. Load app data
  let data;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    data = result[STORAGE_KEY];
    if (!data) {
      flashBadge('?', '#f9ab00');
      return;
    }
  } catch (err) {
    console.error('Quick Add: storage read error', err);
    flashBadge('!', '#d93025');
    return;
  }

  // 3. Check inbox configuration
  const inboxId = data.settings?.quickAddInbox;
  if (!inboxId) {
    flashBadge('?', '#f9ab00');
    return;
  }

  const inbox = data.categories.find(c => c.id === inboxId);
  if (!inbox) {
    flashBadge('?', '#f9ab00');
    return;
  }

  // 4. Duplicate check — if URL already exists in inbox, move to top
  const existingIdx = inbox.sites.findIndex(s => s.url === tab.url);
  let site;
  if (existingIdx >= 0) {
    site = inbox.sites.splice(existingIdx, 1)[0];
  } else {
    site = {
      id: generateId(),
      name: tab.title || nameFromUrl(tab.url),
      url: tab.url,
      favicon: '',
      order: 0
    };
  }

  // 5. Insert at top
  inbox.sites.unshift(site);

  // 6. Reindex orders
  inbox.sites.forEach((s, i) => { s.order = i; });

  // 7. Save immediately (favicon will be updated async)
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  } catch (err) {
    console.error('Quick Add: storage write error', err);
    flashBadge('!', '#d93025');
    return;
  }

  // 8. Show confirmation
  flashBadge('✓', '#34a853');
  showToast(tab.id, `Added to ${inbox.icon} ${inbox.name}`);

  // 9. Fetch favicon asynchronously and update if found
  const favicon = await resolveFavicon(tab);
  if (favicon && favicon !== site.favicon) {
    site.favicon = favicon;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch {
      // Non-critical — site is already saved
    }
  }
});
