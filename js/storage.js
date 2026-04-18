/**
 * storage.js
 * Handles all data persistence via chrome.storage.local.
 * Provides load, save (debounced), export, import, and reset.
 */

'use strict';

const Storage = (() => {
  const STORAGE_KEY = 'tabManagerData';
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 500;

  // -------------------------------------------------------
  // Default data structure (first install)
  // -------------------------------------------------------
  const DEFAULT_DATA = {
    workspaces: [
      {
        id: 'ws-main',
        name: 'Main',
        order: 0
      }
    ],
    categories: [
      {
        id: 'welcome-1',
        name: 'Getting Started',
        icon: '👋',
        order: 0,
        workspaceId: 'ws-main',
        sites: [
          {
            id: 'site-welcome-1',
            name: 'Google',
            url: 'https://www.google.com',
            favicon: '',
            order: 0
          },
          {
            id: 'site-welcome-2',
            name: 'YouTube',
            url: 'https://www.youtube.com',
            favicon: '',
            order: 1
          }
        ]
      },
      {
        id: 'productivity-1',
        name: 'Productivity',
        icon: '🛠️',
        order: 1,
        workspaceId: 'ws-main',
        sites: [
          {
            id: 'site-prod-1',
            name: 'Gmail',
            url: 'https://mail.google.com',
            favicon: '',
            order: 0
          },
          {
            id: 'site-prod-2',
            name: 'Google Calendar',
            url: 'https://calendar.google.com',
            favicon: '',
            order: 1
          },
          {
            id: 'site-prod-3',
            name: 'Google Drive',
            url: 'https://drive.google.com',
            favicon: '',
            order: 2
          }
        ]
      },
      {
        id: 'news-1',
        name: 'News & Reading',
        icon: '📰',
        order: 2,
        workspaceId: 'ws-main',
        sites: [
          {
            id: 'site-news-1',
            name: 'Hacker News',
            url: 'https://news.ycombinator.com',
            favicon: '',
            order: 0
          },
          {
            id: 'site-news-2',
            name: 'Reddit',
            url: 'https://www.reddit.com',
            favicon: '',
            order: 1
          }
        ]
      }
    ],
    settings: {
      theme: 'light',
      columns: 3,
      showSiteCount: true,
      hiddenCategories: [],
      layoutMode: 'kanban',
      currentWorkspace: 'ws-main',
      quickAddInbox: '',
      birdsEyeView: false,
      collapsedWorkspaces: [],
      tabSplitMaxTabs: 12,
      tabSplitAutoSplit: false
    }
  };

  // -------------------------------------------------------
  // Load data from chrome.storage.local
  // Falls back to DEFAULT_DATA if nothing is stored yet.
  // -------------------------------------------------------
  async function loadData() {
    return new Promise((resolve) => {
      // Support both extension context and plain browser (for dev)
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(STORAGE_KEY, (result) => {
          if (chrome.runtime.lastError) {
            console.error('Storage load error:', chrome.runtime.lastError);
            resolve(deepClone(DEFAULT_DATA));
            return;
          }
          if (result[STORAGE_KEY]) {
            // Merge with defaults so new settings keys are always present
            const data = result[STORAGE_KEY];
            data.settings = Object.assign({}, DEFAULT_DATA.settings, data.settings);

            // Migrate to workspaces if needed
            migrateToWorkspaces(data);

            resolve(data);
          } else {
            // First install — save defaults so they persist
            const fresh = deepClone(DEFAULT_DATA);
            chrome.storage.local.set({ [STORAGE_KEY]: fresh }, () => resolve(fresh));
          }
        });
      } else {
        // Dev / non-extension fallback: use localStorage
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const data = raw ? JSON.parse(raw) : deepClone(DEFAULT_DATA);
          data.settings = Object.assign({}, DEFAULT_DATA.settings, data.settings);

          // Migrate to workspaces if needed
          migrateToWorkspaces(data);

          resolve(data);
        } catch (e) {
          resolve(deepClone(DEFAULT_DATA));
        }
      }
    });
  }

  // -------------------------------------------------------
  // Migrate old data to workspace format
  // -------------------------------------------------------
  function migrateToWorkspaces(data) {
    // Create workspaces array if it doesn't exist
    if (!Array.isArray(data.workspaces)) {
      data.workspaces = [
        {
          id: 'ws-main',
          name: 'Main',
          order: 0
        }
      ];
    }

    // Ensure currentWorkspace is set
    if (!data.settings.currentWorkspace) {
      data.settings.currentWorkspace = data.workspaces[0]?.id || 'ws-main';
    }

    // Assign all categories without workspaceId to the first workspace
    if (Array.isArray(data.categories)) {
      const defaultWorkspaceId = data.workspaces[0]?.id || 'ws-main';
      data.categories.forEach(cat => {
        if (!cat.workspaceId) {
          cat.workspaceId = defaultWorkspaceId;
        }
      });
    }
  }

  // -------------------------------------------------------
  // Save data immediately (used internally after debounce)
  // -------------------------------------------------------
  function saveImmediate(data) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
          if (chrome.runtime.lastError) {
            console.error('Storage save error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } else {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  // -------------------------------------------------------
  // Debounced save — call this after any data mutation.
  // Returns a Promise that resolves when the save completes.
  // -------------------------------------------------------
  function saveData(data, onSaved) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveImmediate(data);
        if (typeof onSaved === 'function') onSaved();
      } catch (e) {
        console.error('Failed to save data:', e);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  // -------------------------------------------------------
  // Export data as a downloaded JSON file
  // -------------------------------------------------------
  function exportData(data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `tab-manager-backup-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------
  // Import data from a File object (JSON)
  // Returns a Promise resolving to the parsed data object,
  // or rejects with a validation error message.
  // -------------------------------------------------------
  function importData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          const validated = validateImport(parsed);
          resolve(validated);
        } catch (err) {
          reject(new Error('Invalid JSON file: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsText(file);
    });
  }

  // -------------------------------------------------------
  // Validate and sanitise imported data
  // -------------------------------------------------------
  function validateImport(data) {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Root must be an object.');
    }
    if (!Array.isArray(data.categories)) {
      throw new Error('Missing "categories" array.');
    }

    // Sanitise workspaces
    if (!Array.isArray(data.workspaces)) {
      data.workspaces = [
        {
          id: 'ws-main',
          name: 'Main',
          order: 0
        }
      ];
    } else {
      data.workspaces = data.workspaces.map((ws, i) => ({
        id: String(ws.id || Utils.generateId()),
        name: String(ws.name || 'Workspace'),
        order: typeof ws.order === 'number' ? ws.order : i
      }));
    }

    const defaultWorkspaceId = data.workspaces[0]?.id || 'ws-main';

    // Sanitise categories
    data.categories = data.categories.map((cat, i) => ({
      id: String(cat.id || Utils.generateId()),
      name: String(cat.name || 'Category'),
      icon: String(cat.icon || '📁'),
      order: typeof cat.order === 'number' ? cat.order : i,
      workspaceId: String(cat.workspaceId || defaultWorkspaceId),
      sites: Array.isArray(cat.sites) ? cat.sites.map((site, j) => {
        const base = {
          id: String(site.id || Utils.generateId()),
          name: String(site.name || ''),
          url: String(site.url || ''),
          favicon: String(site.favicon || ''),
          order: typeof site.order === 'number' ? site.order : j
        };
        if (site.type === 'note') {
          base.type = 'note';
          base.text = String(site.text || '');
        }
        if (site.note) {
          base.note = String(site.note);
        }
        if (!base.name && !base.type) base.name = 'Site';
        return base;
      }) : []
    }));

    // Sanitise settings
    const defaults = DEFAULT_DATA.settings;
    const s = data.settings || {};
    data.settings = {
      theme: ['light', 'dark'].includes(s.theme) ? s.theme : defaults.theme,
      columns: [2, 3, 4].includes(Number(s.columns)) ? Number(s.columns) : defaults.columns,
      showSiteCount: typeof s.showSiteCount === 'boolean' ? s.showSiteCount : defaults.showSiteCount,
      hiddenCategories: Array.isArray(s.hiddenCategories) ? s.hiddenCategories.map(String) : [],
      layoutMode: s.layoutMode === 'kanban' ? 'kanban' : 'kanban', // Force kanban mode
      currentWorkspace: String(s.currentWorkspace || data.workspaces[0]?.id || 'ws-main'),
      quickAddInbox: typeof s.quickAddInbox === 'string' ? s.quickAddInbox : defaults.quickAddInbox,
      birdsEyeView: typeof s.birdsEyeView === 'boolean' ? s.birdsEyeView : defaults.birdsEyeView,
      collapsedWorkspaces: Array.isArray(s.collapsedWorkspaces) ? s.collapsedWorkspaces.map(String) : [],
      tabSplitMaxTabs: (typeof s.tabSplitMaxTabs === 'number' && s.tabSplitMaxTabs >= 3 && s.tabSplitMaxTabs <= 50) ? s.tabSplitMaxTabs : defaults.tabSplitMaxTabs,
      tabSplitAutoSplit: typeof s.tabSplitAutoSplit === 'boolean' ? s.tabSplitAutoSplit : defaults.tabSplitAutoSplit
    };

    return data;
  }

  // -------------------------------------------------------
  // Import from a TabExtend JSON export file.
  // TabExtend format:
  //   { categories: [{id, name, tabIndex}],
  //     tabData:    [{id, title, emoji, categoryID, tabs: [{url, title, favIcon}]}] }
  // Each tabData entry is a "tab group" that belongs to a category.
  // We flatten all tab groups into sites, grouped by their category.
  // Tab groups whose categoryID no longer exists go into an "Imported" category.
  // -------------------------------------------------------
  // Accepts either a File object or an already-parsed plain object.
  function importTabExtend(fileOrParsed) {
    if (fileOrParsed && typeof fileOrParsed === 'object' && !(fileOrParsed instanceof File)) {
      // Already parsed — wrap in a resolved promise
      return Promise.resolve().then(() => _convertTabExtend(fileOrParsed));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const raw = JSON.parse(e.target.result);
          resolve(_convertTabExtend(raw));
        } catch (err) {
          reject(new Error('TabExtend import failed: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsText(fileOrParsed);
    });
  }

  function _convertTabExtend(raw) {
    if (!raw || !Array.isArray(raw.categories) || !Array.isArray(raw.tabData)) {
      throw new Error('Not a valid TabExtend export (missing categories or tabData).');
    }

    // Create a default workspace for imported data
    const defaultWorkspaceId = 'ws-main';

    // Map TabExtend category id → our new category object
    const catMap = new Map();
    raw.categories
      .slice()
      .sort((a, b) => (a.tabIndex || 0) - (b.tabIndex || 0))
      .forEach((tc, i) => {
        catMap.set(tc.id, {
          id:    Utils.generateId(),
          name:  tc.name || 'Imported',
          icon:  '📁',
          order: i,
          workspaceId: defaultWorkspaceId,
          sites: []
        });
      });

    // Collect any orphaned tab groups into a catch-all category
    let orphanCat = null;
    function getOrphanCat(nextOrder) {
      if (!orphanCat) {
        orphanCat = {
          id:    Utils.generateId(),
          name:  'Imported',
          icon:  '📦',
          order: nextOrder,
          workspaceId: defaultWorkspaceId,
          sites: []
        };
      }
      return orphanCat;
    }

    // Flatten each tab group's tabs into its parent category
    raw.tabData.forEach(group => {
      if (!Array.isArray(group.tabs)) return;
      const targetCat = catMap.has(group.categoryID)
        ? catMap.get(group.categoryID)
        : getOrphanCat(catMap.size);

      group.tabs.forEach(tab => {
        const url = (tab.url || '').trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) return;
        targetCat.sites.push({
          id:      Utils.generateId(),
          name:    (tab.title || Utils.nameFromUrl(url)).trim(),
          url,
          favicon: tab.favIcon || '',
          order:   targetCat.sites.length
        });
      });
    });

    // Build final categories array — skip empty ones
    const categories = Array.from(catMap.values()).filter(c => c.sites.length > 0);
    if (orphanCat && orphanCat.sites.length > 0) {
      orphanCat.order = categories.length;
      categories.push(orphanCat);
    }

    if (categories.length === 0) {
      throw new Error('No importable URLs found in this TabExtend file.');
    }

    // Re-index orders
    categories.forEach((c, i) => { c.order = i; });

    return {
      workspaces: [
        {
          id: defaultWorkspaceId,
          name: 'Main',
          order: 0
        }
      ],
      categories,
      settings: deepClone(DEFAULT_DATA.settings)
    };
  }

  // -------------------------------------------------------
  // Reset to default data
  // -------------------------------------------------------
  async function resetData() {
    const fresh = deepClone(DEFAULT_DATA);
    await saveImmediate(fresh);
    return fresh;
  }

  // -------------------------------------------------------
  // Deep clone helper
  // -------------------------------------------------------
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // -------------------------------------------------------
  // Export data as a self-contained responsive HTML file
  // -------------------------------------------------------
  function exportHtml(data) {
    const cats = [...data.categories].sort((a, b) => a.order - b.order);
    const theme = data.settings?.theme || 'light';
    const layoutMode = data.settings?.layoutMode || 'column';
    const hiddenCategoryIds = new Set(data.settings?.hiddenCategories || []);

    // ---- Escape helpers (used inside template literal) ----
    function esc(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ---- Build category toggle pills HTML ----
    const pillsHtml = cats.map((cat, i) => {
      const isHidden = hiddenCategoryIds.has(cat.id);
      const activeClass = isHidden ? '' : 'active';
      return `<button class="pill ${activeClass}" data-cat="${i}" onclick="toggleCat(${i},this)">${esc(cat.icon)} ${esc(cat.name)}</button>`;
    }).join('\n        ');

    // Local badge colour (mirrors Utils.badgeColor — storage.js can't access Utils)
    const BADGE_COLORS = [
      '#4285f4','#ea4335','#fbbc05','#34a853',
      '#9c27b0','#00bcd4','#ff5722','#607d8b',
      '#e91e63','#3f51b5','#009688','#ff9800'
    ];
    function badgeColor(str) {
      let hash = 0;
      const s = String(str || '?');
      for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
      }
      return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
    }

    // Safe favicon URL — never throws
    function faviconFor(siteUrl) {
      try {
        const hostname = new URL(siteUrl).hostname;
        if (!hostname) return '';
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
      } catch {
        return '';
      }
    }

    // ---- Build category cards HTML ----
    const cardsHtml = cats.map((cat, i) => {
      const sites = [...cat.sites].sort((a, b) => a.order - b.order);
      const isHidden = hiddenCategoryIds.has(cat.id);
      const hiddenClass = isHidden ? ' hidden' : '';
      const sitesHtml = sites.map(site => {
        if (site.type === 'note') {
          const label = site.name ? `<span class="note-block-label">${esc(site.name)}</span>` : '';
          // Preserve line breaks in note text
          const textHtml = esc(site.text || '').replace(/\n/g, '<br>');
          return `        <div class="note-block" data-name="${esc((site.name||'').toLowerCase())}" data-text="${esc((site.text||'').toLowerCase())}">
          ${label}<p class="note-block-text">${textHtml}</p>
        </div>`;
        }
        const faviconSrc = site.favicon || faviconFor(site.url);
        return `        <a class="site-tile" href="${esc(site.url)}" target="_blank" rel="noopener" data-name="${esc((site.name||'').toLowerCase())}" data-url="${esc((site.url||'').toLowerCase())}">
          <img class="site-icon" src="${esc(faviconSrc)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="site-icon-fallback" style="display:none;background:${esc(badgeColor(site.name||site.url))}">${esc((site.name||'?')[0].toUpperCase())}</span>
          <span class="site-name">${esc(site.name || site.url)}</span>
        </a>`;
      }).join('\n');
      return `    <div class="cat-card${hiddenClass}" data-cat="${i}">
      <div class="cat-header">
        <span class="cat-icon">${esc(cat.icon)}</span>
        <span class="cat-name">${esc(cat.name)}</span>
        <span class="cat-count">${sites.length}</span>
      </div>
      <div class="sites-list">
${sitesHtml}
      </div>
    </div>`;
    }).join('\n\n');

    // ---- Colour variables per theme ----
    const isDark = theme === 'dark';
    const vars = isDark ? `
    --bg:        #1a1a1a;
    --bg-card:   #242424;
    --bg-input:  #2a2a2a;
    --bg-hover:  #2e2e2e;
    --border:    #333;
    --text:      #e8e8e8;
    --text-muted:#888;
    --accent:    #4f8ef7;
    --accent-bg: rgba(79,142,247,0.12);
    --shadow:    0 2px 8px rgba(0,0,0,0.4);` : `
    --bg:        #f5f5f7;
    --bg-card:   #ffffff;
    --bg-input:  #ffffff;
    --bg-hover:  #f0f0f0;
    --border:    #e0e0e0;
    --text:      #1a1a1a;
    --text-muted:#888;
    --accent:    #2563eb;
    --accent-bg: rgba(37,99,235,0.08);
    --shadow:    0 2px 8px rgba(0,0,0,0.08);`;

    const timestamp = new Date().toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });

    // Build array of hidden category indices for JavaScript initialization
    const hiddenCatIndices = cats
      .map((cat, i) => hiddenCategoryIds.has(cat.id) ? i : -1)
      .filter(i => i >= 0);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tab Manager Export</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {${vars}
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 15px;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    /* ---- Header ---- */
    .page-header {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .page-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
      white-space: nowrap;
    }
    .page-date {
      font-size: 12px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    /* ---- Search ---- */
    .search-wrap {
      position: relative;
      flex: 1;
      min-width: 160px;
      max-width: 400px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 36px;
      padding: 0 12px 0 34px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--bg-input);
      color: var(--text);
      font-size: 14px;
      outline: none;
    }
    .search-input:focus { border-color: var(--accent); }

    /* ---- Toggle pills ---- */
    .pills-wrap {
      max-width: 1400px;
      margin: 16px auto 0;
      padding: 0 24px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .pills-label {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
      margin-right: 4px;
      white-space: nowrap;
    }
    .pill-controls {
      display: flex;
      gap: 6px;
      margin-left: auto;
    }
    .pill-ctrl-btn {
      font-size: 12px;
      color: var(--accent);
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .pill-ctrl-btn:hover { background: var(--accent-bg); }
    .pill {
      padding: 5px 12px;
      border-radius: 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-muted);
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .pill.active {
      background: var(--accent-bg);
      color: var(--accent);
      border-color: var(--accent);
    }
    .pill:hover { border-color: var(--accent); }

    /* ---- Layout toggle ---- */
    .layout-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-left: auto;
    }
    .layout-btn {
      padding: 5px 10px;
      border: none;
      background: none;
      color: var(--text-muted);
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .layout-btn:hover { color: var(--text); }
    .layout-btn.active {
      background: var(--bg-card);
      color: var(--text);
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }

    /* ---- Grid (Column mode) ---- */
    .main {
      max-width: 1400px;
      margin: 20px auto 48px;
      padding: 0 24px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 1100px) { .main { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 600px)  {
      .main { grid-template-columns: 1fr; padding: 0 12px; }
      .pills-wrap { padding: 0 12px; }
      .page-header { padding: 12px; }
    }

    /* ---- Kanban mode ---- */
    .main.layout-kanban {
      display: flex;
      flex-direction: row;
      gap: 16px;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 12px;
      align-items: stretch;
    }
    .main.layout-kanban .cat-card {
      width: 320px;
      min-width: 320px;
      flex-shrink: 0;
      max-height: calc(100vh - 200px);
      display: flex;
      flex-direction: column;
    }
    .main.layout-kanban .sites-list {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }
    @media (max-width: 600px) {
      .main.layout-kanban {
        display: grid;
        grid-template-columns: 1fr;
        overflow-x: visible;
        overflow-y: visible;
        padding-bottom: 0;
      }
      .main.layout-kanban .cat-card {
        width: 100%;
        min-width: 0;
        max-height: none;
      }
      .main.layout-kanban .sites-list {
        overflow-y: visible;
      }
      .layout-toggle { display: none; }
    }

    /* ---- Category card ---- */
    .cat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    .cat-card.hidden { display: none; }
    .cat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px 10px;
      border-bottom: 1px solid var(--border);
    }
    .cat-icon { font-size: 18px; line-height: 1; }
    .cat-name { font-size: 14px; font-weight: 600; flex: 1; }
    .cat-count {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-hover);
      padding: 2px 7px;
      border-radius: 10px;
    }

    /* ---- Sites ---- */
    .sites-list { padding: 6px 8px 8px; }
    .site-tile {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 8px;
      border-radius: 8px;
      text-decoration: none;
      color: var(--text);
      transition: background 0.12s;
    }
    .site-tile:hover { background: var(--bg-hover); }
    .site-tile.hidden { display: none; }
    .site-icon, .site-icon-fallback {
      width: 18px;
      height: 18px;
      border-radius: 3px;
      flex-shrink: 0;
      object-fit: contain;
    }
    .site-icon-fallback {
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
    }
    .site-name {
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ---- Note blocks ---- */
    .note-block {
      margin: 4px 8px 6px;
      padding: 10px 12px;
      background: var(--accent-bg);
      border-left: 3px solid var(--accent);
      border-radius: 6px;
    }
    .note-block.hidden { display: none; }
    .note-block-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .note-block-text {
      font-size: 13px;
      color: var(--text);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ---- Search empty state ---- */
    .search-empty {
      display: none;
      grid-column: 1 / -1;
      text-align: center;
      padding: 60px 20px;
      color: var(--text-muted);
      font-size: 15px;
    }
    .search-empty.visible { display: block; }

    /* ---- No-JS fallback ---- */
    noscript { display: block; padding: 12px 24px; background: #fef3c7; color: #92400e; font-size: 13px; }
  </style>
</head>
<body>

<noscript>Search and category toggles require JavaScript. Links still work without it.</noscript>

<header class="page-header">
  <div class="header-inner">
    <span class="page-title">Tab Manager Export</span>
    <span class="page-date">${esc(timestamp)}</span>
    <div class="search-wrap">
      <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="search" class="search-input" placeholder="Search sites..." oninput="doSearch(this.value)" autocomplete="off">
    </div>
    <div class="layout-toggle">
      <button class="layout-btn" id="columnBtn" onclick="setLayout('column')">Column</button>
      <button class="layout-btn" id="kanbanBtn" onclick="setLayout('kanban')">Kanban</button>
    </div>
  </div>
</header>

<div class="pills-wrap">
  <span class="pills-label">Categories:</span>
  ${pillsHtml}
  <div class="pill-controls">
    <button class="pill-ctrl-btn" onclick="showAll()">Show all</button>
    <button class="pill-ctrl-btn" onclick="hideAll()">Hide all</button>
  </div>
</div>

<main class="main" id="grid">
${cardsHtml}
  <div class="search-empty" id="searchEmpty">No sites match your search.</div>
</main>

<script>
  // Category visibility — initialize with hidden categories from settings
  var hiddenCats = new Set(${JSON.stringify(hiddenCatIndices)});

  // Layout mode — initialize from settings, fall back to localStorage
  var currentLayout = localStorage.getItem('tabManagerLayout') || '${layoutMode}';

  function setLayout(mode) {
    currentLayout = mode;
    localStorage.setItem('tabManagerLayout', mode);
    var grid = document.getElementById('grid');
    var columnBtn = document.getElementById('columnBtn');
    var kanbanBtn = document.getElementById('kanbanBtn');

    if (mode === 'kanban') {
      grid.classList.add('layout-kanban');
      kanbanBtn.classList.add('active');
      columnBtn.classList.remove('active');
    } else {
      grid.classList.remove('layout-kanban');
      columnBtn.classList.add('active');
      kanbanBtn.classList.remove('active');
    }
  }

  // Initialize layout on page load
  setLayout(currentLayout);

  function toggleCat(idx, pill) {
    var cards = document.querySelectorAll('.cat-card[data-cat="' + idx + '"]');
    if (hiddenCats.has(idx)) {
      hiddenCats.delete(idx);
      pill.classList.add('active');
      cards.forEach(function(c) { c.classList.remove('hidden'); });
    } else {
      hiddenCats.add(idx);
      pill.classList.remove('active');
      cards.forEach(function(c) { c.classList.add('hidden'); });
    }
    updateSearchEmpty();
  }

  function showAll() {
    hiddenCats.clear();
    document.querySelectorAll('.pill').forEach(function(p) { p.classList.add('active'); });
    document.querySelectorAll('.cat-card').forEach(function(c) { c.classList.remove('hidden'); });
    doSearch(document.querySelector('.search-input').value);
  }

  function hideAll() {
    document.querySelectorAll('.cat-card').forEach(function(c, i) {
      hiddenCats.add(parseInt(c.dataset.cat));
      c.classList.add('hidden');
    });
    document.querySelectorAll('.pill').forEach(function(p) { p.classList.remove('active'); });
    updateSearchEmpty();
  }

  // Search — overrides hidden categories (shows all matches)
  var lastQuery = '';
  function doSearch(q) {
    lastQuery = q.trim().toLowerCase();
    var anyVisible = false;

    document.querySelectorAll('.cat-card').forEach(function(card) {
      var catIdx = parseInt(card.dataset.cat);
      if (!lastQuery) {
        // Restore to pill state
        var isHidden = hiddenCats.has(catIdx);
        card.classList.toggle('hidden', isHidden);
        card.querySelectorAll('.site-tile, .note-block').forEach(function(t) { t.classList.remove('hidden'); });
        if (!isHidden) anyVisible = true;
        return;
      }

      // While searching, show card if any site or note matches (ignore pill state)
      var cardMatch = false;
      card.querySelectorAll('.site-tile').forEach(function(tile) {
        var nm = tile.dataset.name || '';
        var ur = tile.dataset.url  || '';
        var match = nm.includes(lastQuery) || ur.includes(lastQuery);
        tile.classList.toggle('hidden', !match);
        if (match) cardMatch = true;
      });
      card.querySelectorAll('.note-block').forEach(function(note) {
        var nm = note.dataset.name || '';
        var tx = note.dataset.text || '';
        var match = nm.includes(lastQuery) || tx.includes(lastQuery);
        note.classList.toggle('hidden', !match);
        if (match) cardMatch = true;
      });
      card.classList.toggle('hidden', !cardMatch);
      if (cardMatch) anyVisible = true;
    });

    updateSearchEmpty();
  }

  function updateSearchEmpty() {
    var anyVisible = !!document.querySelector('.cat-card:not(.hidden)');
    document.getElementById('searchEmpty').classList.toggle('visible', !anyVisible);
  }
<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const timestamp2 = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `tab-manager-export-${timestamp2}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { loadData, saveData, saveImmediate, exportData, exportHtml, importData, importTabExtend, resetData, deepClone, DEFAULT_DATA };
})();
