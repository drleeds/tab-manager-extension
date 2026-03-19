/**
 * utils.js
 * Shared utility functions: ID generation, favicon, colours, etc.
 */

'use strict';

const Utils = (() => {

  // -------------------------------------------------------
  // Generate a random unique ID
  // -------------------------------------------------------
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // -------------------------------------------------------
  // Extract the domain from a URL string
  // Returns '' on failure.
  // -------------------------------------------------------
  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  // -------------------------------------------------------
  // Build a favicon URL for a given site URL.
  // Prefers Chrome's internal favicon API (which uses the
  // browser's own cache), falls back to Google's service.
  // -------------------------------------------------------
  function faviconUrl(siteUrl) {
    if (!siteUrl) return '';
    try {
      // Chrome extension favicon API — returns cached favicons the browser already has
      const url = new URL(chrome.runtime.getURL('/_favicon/'));
      url.searchParams.set('pageUrl', siteUrl);
      url.searchParams.set('size', '64');
      return url.toString();
    } catch {
      // Fallback for non-extension context (dev/testing)
      const domain = getDomain(siteUrl);
      if (!domain) return '';
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
    }
  }

  // -------------------------------------------------------
  // Deterministic colour for fallback letter badges.
  // Returns a CSS hex colour string.
  // -------------------------------------------------------
  const BADGE_COLORS = [
    '#4285f4', '#ea4335', '#fbbc05', '#34a853',
    '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
    '#e91e63', '#3f51b5', '#009688', '#ff9800'
  ];

  function badgeColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
  }

  // -------------------------------------------------------
  // Derive a display name from a URL when no name is given.
  // e.g. "https://mail.google.com/..." → "mail.google.com"
  // -------------------------------------------------------
  function nameFromUrl(url) {
    const domain = getDomain(url);
    if (!domain) return url;
    // Strip 'www.' prefix
    return domain.replace(/^www\./, '');
  }

  // -------------------------------------------------------
  // Normalise a URL — add https:// if missing a protocol.
  // -------------------------------------------------------
  function normaliseUrl(url) {
    url = url.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    return url;
  }

  // -------------------------------------------------------
  // Validate a URL string (basic check)
  // -------------------------------------------------------
  function isValidUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------
  // Debounce — returns a function that delays invocation.
  // -------------------------------------------------------
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // -------------------------------------------------------
  // Escape HTML special characters (for search highlight)
  // -------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------
  // Convert URLs in plain text to clickable links (HTML safe)
  // -------------------------------------------------------
  function linkifyText(str) {
    const escaped = escapeHtml(str);
    return escaped.replace(
      /https?:\/\/[^\s<>&"]+/gi,
      url => `<a href="${url}" target="_blank" rel="noopener" class="note-link">${url}</a>`
    );
  }

  // -------------------------------------------------------
  // Highlight occurrences of `query` in `text` (HTML safe)
  // -------------------------------------------------------
  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQ = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escapedQ})`, 'gi');
    return escaped.replace(re, '<mark class="search-highlight">$1</mark>');
  }

  // -------------------------------------------------------
  // Show a transient save indicator element
  // -------------------------------------------------------
  function flashSaveIndicator() {
    const el = document.getElementById('saveIndicator');
    if (!el) return;
    el.hidden = false;
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 250);
    }, 1200);
  }

  // -------------------------------------------------------
  // Simple confirm dialog (returns Promise<boolean>)
  // Uses the custom #confirmDialog in the HTML.
  // -------------------------------------------------------
  function confirm(message, okLabel = 'Delete') {
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirmDialog');
      const msgEl = document.getElementById('confirmMessage');
      const okBtn = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');

      msgEl.textContent = message;
      okBtn.textContent = okLabel;

      // Freeze all other open modal overlays so they can't steal clicks
      const frozenOverlays = Array.from(
        document.querySelectorAll('.modal-overlay.is-open:not(#confirmDialog)')
      );
      frozenOverlays.forEach(el => { el.style.pointerEvents = 'none'; });

      overlay.classList.add('is-open');

      function cleanup(result) {
        overlay.classList.remove('is-open');
        // Restore pointer events on previously frozen overlays
        frozenOverlays.forEach(el => { el.style.pointerEvents = ''; });
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        resolve(result);
      }

      function onOk()     { cleanup(true);  }
      function onCancel() { cleanup(false); }
      function onOverlay(e) {
        if (e.target === overlay) cleanup(false);
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
    });
  }

  // -------------------------------------------------------
  // Simple alert dialog (uses native prompt for now)
  // -------------------------------------------------------
  async function alert(message) {
    return new Promise((resolve) => {
      window.alert(message);
      resolve();
    });
  }

  // -------------------------------------------------------
  // Simple prompt dialog (uses native prompt for now)
  // -------------------------------------------------------
  async function prompt(message, defaultValue = '') {
    return new Promise((resolve) => {
      const result = window.prompt(message, defaultValue);
      resolve(result);
    });
  }

  // -------------------------------------------------------
  // Build a favicon <img> element with letter-badge fallback
  // -------------------------------------------------------
  function buildFaviconEl(site) {
    const src = site.favicon || faviconUrl(site.url);
    const letter = (site.name || nameFromUrl(site.url) || '?')[0];

    if (src) {
      const img = document.createElement('img');
      img.className = 'site-favicon';
      img.alt = '';
      img.loading = 'lazy';
      img.src = src;
      img.onerror = () => {
        // Replace with letter badge on load failure
        const badge = buildLetterBadge(letter, site.name || site.url);
        img.replaceWith(badge);
      };
      return img;
    }

    return buildLetterBadge(letter, site.name || site.url);
  }

  function buildLetterBadge(letter, seed) {
    const el = document.createElement('span');
    el.className = 'site-favicon-fallback';
    el.textContent = (letter || '?').toUpperCase();
    el.style.background = badgeColor(seed || letter || '?');
    return el;
  }

  // -------------------------------------------------------
  // Stock favicon SVG data URLs for the picker
  // -------------------------------------------------------
  const STOCK_FAVICONS = [
    { name: 'Globe',    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234285f4' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3Cpath d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/%3E%3C/svg%3E" },
    { name: 'Link',     url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23607d8b' stroke-width='2'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/%3E%3C/svg%3E" },
    { name: 'Star',     url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fbbc05' stroke='%23fbbc05' stroke-width='2'%3E%3Cpolygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/%3E%3C/svg%3E" },
    { name: 'Bookmark', url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e91e63' stroke-width='2'%3E%3Cpath d='M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'/%3E%3C/svg%3E" },
    { name: 'Document', url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233f51b5' stroke-width='2'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3Cpolyline points='14 2 14 8 20 8'/%3E%3Cline x1='16' y1='13' x2='8' y2='13'/%3E%3Cline x1='16' y1='17' x2='8' y2='17'/%3E%3C/svg%3E" },
    { name: 'Folder',   url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff9800' stroke-width='2'%3E%3Cpath d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/%3E%3C/svg%3E" },
    { name: 'Video',    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ea4335' stroke-width='2'%3E%3Cpolygon points='23 7 16 12 23 17 23 7'/%3E%3Crect x='1' y='5' width='15' height='14' rx='2' ry='2'/%3E%3C/svg%3E" },
    { name: 'Music',    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239c27b0' stroke-width='2'%3E%3Cpath d='M9 18V5l12-2v13'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='18' cy='16' r='3'/%3E%3C/svg%3E" },
    { name: 'Camera',   url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2300bcd4' stroke-width='2'%3E%3Cpath d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'/%3E%3Ccircle cx='12' cy='13' r='4'/%3E%3C/svg%3E" },
    { name: 'Headphones', url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff5722' stroke-width='2'%3E%3Cpath d='M3 18v-6a9 9 0 0 1 18 0v6'/%3E%3Cpath d='M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'/%3E%3C/svg%3E" },
    { name: 'Code',     url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2334a853' stroke-width='2'%3E%3Cpolyline points='16 18 22 12 16 6'/%3E%3Cpolyline points='8 6 2 12 8 18'/%3E%3C/svg%3E" },
    { name: 'Terminal', url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23607d8b' stroke-width='2'%3E%3Cpolyline points='4 17 10 11 4 5'/%3E%3Cline x1='12' y1='19' x2='20' y2='19'/%3E%3C/svg%3E" },
    { name: 'Database', url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23009688' stroke-width='2'%3E%3Cellipse cx='12' cy='5' rx='9' ry='3'/%3E%3Cpath d='M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'/%3E%3Cpath d='M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5'/%3E%3C/svg%3E" },
    { name: 'Cloud',    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234285f4' stroke-width='2'%3E%3Cpath d='M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'/%3E%3C/svg%3E" },
    { name: 'Mail',     url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e91e63' stroke-width='2'%3E%3Cpath d='M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'/%3E%3Cpolyline points='22 6 12 13 2 6'/%3E%3C/svg%3E" },
    { name: 'Chat',     url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233f51b5' stroke-width='2'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E" },
    { name: 'Shopping', url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff9800' stroke-width='2'%3E%3Ccircle cx='9' cy='21' r='1'/%3E%3Ccircle cx='20' cy='21' r='1'/%3E%3Cpath d='M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6'/%3E%3C/svg%3E" },
    { name: 'Finance',  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2334a853' stroke-width='2'%3E%3Cline x1='12' y1='1' x2='12' y2='23'/%3E%3Cpath d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/%3E%3C/svg%3E" },
  ];

  // -------------------------------------------------------
  // Fetch a favicon from multiple sources, return data URL
  // -------------------------------------------------------
  async function fetchFavicon(siteUrl) {
    const domain = getDomain(siteUrl);
    if (!domain) return '';

    const sources = [
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
      `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
      `https://${domain}/favicon.ico`,
    ];

    for (const src of sources) {
      try {
        const resp = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (!resp.ok) continue;

        const ct = resp.headers.get('content-type') || '';
        if (!ct.startsWith('image/')) continue;

        const blob = await resp.blob();
        if (blob.size < 10) continue; // skip empty/trivial responses

        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return dataUrl;
      } catch {
        // Try next source
      }
    }

    return '';
  }

  // -------------------------------------------------------
  // Fetch the meta description from a URL
  // -------------------------------------------------------
  async function fetchDescFromUrl(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) return '';
      const text = await resp.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const meta = doc.querySelector('meta[name="description" i]')
        || doc.querySelector('meta[property="og:description" i]');
      return meta?.getAttribute('content')?.trim() || '';
    } catch {
      clearTimeout(timer);
      return '';
    }
  }

  async function fetchMetaDescription(url) {
    try {
      // Try the original URL first
      let desc = await fetchDescFromUrl(url);
      if (desc) return desc;

      // Fallback: try the root domain (handles login/dashboard/app pages)
      const root = new URL(url).origin + '/';
      if (root !== url) {
        desc = await fetchDescFromUrl(root);
        if (desc) return desc;
      }

      // Fallback: try the bare domain without subdomain
      // e.g. app.marketmuse.com → marketmuse.com
      const hostname = new URL(url).hostname;
      const parts = hostname.split('.');
      if (parts.length > 2) {
        const bareDomain = 'https://' + parts.slice(-2).join('.') + '/';
        if (bareDomain !== root) {
          desc = await fetchDescFromUrl(bareDomain);
          if (desc) return desc;
        }
      }

      return '';
    } catch {
      return '';
    }
  }

  return {
    generateId,
    getDomain,
    faviconUrl,
    badgeColor,
    nameFromUrl,
    normaliseUrl,
    isValidUrl,
    debounce,
    escapeHtml,
    linkifyText,
    highlightText,
    flashSaveIndicator,
    confirm,
    alert,
    prompt,
    buildFaviconEl,
    buildLetterBadge,
    fetchFavicon,
    fetchMetaDescription,
    STOCK_FAVICONS
  };
})();
