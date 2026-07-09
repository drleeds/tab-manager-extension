'use strict';

// =========================================================
// js/snapshot.js — Session Snapshot (HTML export + restore)
//
// Captures all open browser windows/tabs/groups into a single self-contained
// interactive HTML file, and restores a saved snapshot back into new windows
// (non-destructively — it only creates, it never touches what you have open).
//
// The interactive HTML generator (`generateHTML`) is ported verbatim from the
// standalone "Tab Snapshot" extension (HTML export only; Markdown dropped). It
// is treated as a black box: give it a snapshot object, get back an HTML string.
//
// Restore reads a machine-readable JSON payload embedded in that HTML
// (`<script type="application/json" id="tabmgr-snapshot">`). Window geometry,
// tab groups (name/color/membership), pinned/active state, and tab order all
// round-trip. Live page state (scroll, forms, sessions) does not — restore
// reopens URLs.
// =========================================================

const Snapshot = (function () {

  const SCHEMA_VERSION = 1;

  // ---------------------------------------------------------
  // Capture — build the snapshot from the live browser state
  // ---------------------------------------------------------
  // Mirrors the standalone extension's data shape (tabsByGroup is a Map, which
  // generateHTML requires), and adds window geometry + a schema version, and
  // excludes the Tab Manager dashboard's own new-tab page.
  async function capture() {
    const windows = await chrome.windows.getAll({ populate: true });
    const allGroups = (chrome.tabGroups ? await chrome.tabGroups.query({}) : []);
    const extensionOrigin = chrome.runtime.getURL('');

    const data = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date(),
      windows: []
    };

    for (const window of windows) {
      // Only real browser windows (skip devtools, popups, etc.)
      if (window.type && window.type !== 'normal') continue;

      const windowData = {
        id: window.id,
        type: window.type,
        focused: window.focused,
        state: window.state,
        left: window.left,
        top: window.top,
        width: window.width,
        height: window.height,
        tabs: [],
        groups: {}
      };

      const tabsByGroup = new Map();
      tabsByGroup.set(-1, []); // ungrouped tabs

      let included = 0;
      for (const tab of window.tabs) {
        // Exclude the dashboard's own new-tab page (consistent with Live Tabs)
        if (tab.url && tab.url.startsWith(extensionOrigin)) continue;

        let domain = '';
        try {
          domain = new URL(tab.url).hostname;
        } catch (e) {
          domain = (tab.url || '').split('/')[0];
        }

        const tabData = {
          title: tab.title,
          url: tab.url,
          domain: domain,
          favIconUrl: tab.favIconUrl,
          active: tab.active,
          pinned: tab.pinned,
          groupId: tab.groupId,
          lastAccessed: tab.lastAccessed,
          audible: tab.audible || false,
          mutedInfo: tab.mutedInfo,
          discarded: tab.discarded || false,
          index: tab.index,
          windowId: window.id
        };
        included++;

        if (tab.groupId === undefined || tab.groupId === -1) {
          tabsByGroup.get(-1).push(tabData);
        } else {
          if (!tabsByGroup.has(tab.groupId)) {
            tabsByGroup.set(tab.groupId, []);
            const groupInfo = allGroups.find(g => g.id === tab.groupId);
            if (groupInfo) {
              windowData.groups[tab.groupId] = {
                title: groupInfo.title || 'Unnamed Group',
                color: groupInfo.color
              };
            }
          }
          tabsByGroup.get(tab.groupId).push(tabData);
        }
      }

      if (included === 0) continue; // window held only the dashboard — skip

      windowData.tabsByGroup = tabsByGroup;
      windowData.tabCount = included;
      data.windows.push(windowData);
    }

    return data;
  }

  // Convert capture() output (Maps) into a plain-object form safe for JSON.
  function toSerializable(data) {
    return {
      ...data,
      windows: data.windows.map(w => ({
        ...w,
        tabsByGroup: Object.fromEntries(w.tabsByGroup)
      }))
    };
  }

  // ---------------------------------------------------------
  // Interactive HTML generator (ported verbatim — see file header)
  // ---------------------------------------------------------
  function generateHTML(data) {
    const timestamp = formatDateTime(data.timestamp);

    // Convert Map objects to plain objects for JSON serialization
    const dataForJson = {
      ...data,
      windows: data.windows.map(window => ({
        ...window,
        tabsByGroup: Object.fromEntries(window.tabsByGroup)
      }))
    };

    // Serialize data as JSON for JavaScript manipulation
    const dataJson = JSON.stringify(dataForJson).replace(/</g, '\\u003c');

    let html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Browser Snapshot - ${timestamp}</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        background: #f5f5f5;
        padding: 20px;
        line-height: 1.6;
      }

      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        padding: 30px;
      }

      h1 {
        color: #1a1a1a;
        margin-bottom: 8px;
        font-size: 28px;
      }

      .timestamp {
        color: #666;
        font-size: 14px;
        margin-bottom: 24px;
      }

      .controls {
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 24px;
      }

      .control-group {
        margin-bottom: 12px;
      }

      .control-group:last-child {
        margin-bottom: 0;
      }

      .control-label {
        font-weight: 600;
        font-size: 13px;
        color: #333;
        margin-bottom: 8px;
        display: block;
      }

      .radio-group {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
      }

      .radio-option {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        color: #555;
        cursor: pointer;
      }

      .radio-option input[type="radio"] {
        cursor: pointer;
      }

      .search-container {
        position: relative;
        margin-bottom: 8px;
      }

      #searchBox {
        width: 100%;
        padding: 10px 40px 10px 12px;
        font-size: 14px;
        border: 2px solid #e0e0e0;
        border-radius: 6px;
        font-family: inherit;
        transition: border-color 0.2s;
      }

      #searchBox:focus {
        outline: none;
        border-color: #4A90E2;
      }

      .clear-btn {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: #dc3545;
        color: white;
        border: none;
        border-radius: 4px;
        width: 28px;
        height: 28px;
        font-size: 16px;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .clear-btn:hover {
        background: #c82333;
      }

      .clear-btn.visible {
        display: flex;
      }

      .search-stats {
        font-size: 12px;
        color: #666;
        min-height: 18px;
      }

      .search-stats.filtered {
        color: #4A90E2;
        font-weight: 600;
      }

      .tab.search-hidden {
        display: none;
      }

      .group.search-hidden,
      .window.search-hidden,
      .domain-section.search-hidden {
        display: none;
      }

      .stats {
        background: #f8f9fa;
        padding: 16px;
        border-radius: 6px;
        margin-bottom: 24px;
        display: flex;
        gap: 24px;
      }

      .stat {
        flex: 1;
      }

      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: #4A90E2;
      }

      .stat-label {
        font-size: 13px;
        color: #666;
        margin-top: 4px;
      }

      .window {
        margin-bottom: 32px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
      }

      .window-header {
        background: #4A90E2;
        color: white;
        padding: 12px 16px;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .window-header:hover {
        background: #357ABD;
      }

      .window-header .arrow {
        transition: transform 0.3s;
      }

      .window-header.collapsed .arrow {
        transform: rotate(-90deg);
      }

      .window-content {
        max-height: 100000px;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .window-content.collapsed {
        max-height: 0;
      }

      .group {
        border-top: 1px solid #e0e0e0;
      }

      .group-header {
        background: #f8f9fa;
        padding: 10px 16px;
        font-weight: 500;
        color: #333;
        cursor: pointer;
        user-select: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .group-header:hover {
        background: #e9ecef;
      }

      .group-header .arrow {
        transition: transform 0.3s;
        font-size: 12px;
      }

      .group-header.collapsed .arrow {
        transform: rotate(-90deg);
      }

      .group-content {
        max-height: 100000px;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .group-content.collapsed {
        max-height: 0;
      }

      .group-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        margin-right: 8px;
        font-weight: 600;
        color: white;
      }

      .tab {
        padding: 12px 16px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        align-items: start;
        gap: 12px;
      }

      .tab:hover {
        background: #f8f9fa;
      }

      .tab.old-tab {
        background: #fff3cd;
      }

      .tab.old-tab:hover {
        background: #ffe9a6;
      }

      .tab-favicon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .tab-info {
        flex: 1;
        min-width: 0;
      }

      .tab-title {
        font-weight: 500;
        color: #1a1a1a;
        margin-bottom: 4px;
        word-wrap: break-word;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tab-url {
        color: #4A90E2;
        font-size: 13px;
        text-decoration: none;
        word-break: break-all;
        display: block;
        margin-bottom: 4px;
      }

      .tab-url:hover {
        text-decoration: underline;
      }

      .tab-meta {
        font-size: 12px;
        color: #666;
        margin-top: 4px;
      }

      .tab-badge {
        display: inline-block;
        background: #28a745;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: 600;
        white-space: nowrap;
      }

      .badge-pinned {
        background: #6C757D;
      }

      .badge-audio {
        background: #FFC107;
        color: #333;
      }

      .badge-unloaded {
        background: #9E9E9E;
      }

      .flat-list-header {
        background: #6C757D;
        color: white;
        padding: 10px 16px;
        font-weight: 600;
        margin-bottom: 0;
      }

      .domain-section {
        margin-bottom: 24px;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
      }

      .domain-header {
        background: #6C757D;
        color: white;
        padding: 10px 16px;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .domain-header:hover {
        background: #5A6268;
      }

      .domain-content {
        max-height: 100000px;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .domain-content.collapsed {
        max-height: 0;
      }

      #content {
        min-height: 200px;
      }

      /* --- NEW: Note Taking Styles --- */
      .note-area {
        width: 100%;
        margin-top: 8px;
        display: none;
      }
      .note-area.visible {
        display: block;
      }
      .note-input {
        width: 100%;
        min-height: 60px;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-family: inherit;
        font-size: 13px;
        resize: vertical;
        background-color: #fffdf0; /* Light yellow for notes */
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);
      }
      .note-input:focus {
        outline: none;
        border-color: #f0c14b;
        background-color: #fff;
      }
      .note-toggle {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 12px;
        color: #4A90E2;
        margin-left: 8px;
        text-decoration: underline;
        padding: 0;
      }

      /* --- NEW: Save Button Styles --- */
      .save-container {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #e0e0e0;
      }
      .save-btn {
        background: #2ea44f;
        color: white;
        border: 1px solid rgba(27,31,35,0.15);
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: background 0.2s;
      }
      .save-btn:hover { background: #2c974b; }

      /* --- FIX: Accessibility Focus States --- */
      .window-header:focus, .group-header:focus, .domain-header:focus {
          outline: 2px solid #4A90E2;
          outline-offset: -2px;
      }

      /* --- NEW: Bulk Note Button Styles --- */
      .bulk-note-btn {
        background: #28a745;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        margin: 0 8px;
        transition: background 0.2s;
        white-space: nowrap;
      }
      .bulk-note-btn:hover {
        background: #218838;
      }
      .search-bulk-btn {
        margin-left: 8px;
        font-size: 12px;
        padding: 4px 8px;
      }

      /* --- NEW: Note Highlight Animation --- */
      @keyframes noteHighlight {
        0% { background-color: #d4edda; }
        100% { background-color: #fffdf0; }
      }
      .tab.note-updated {
        animation: noteHighlight 1s ease;
      }

      /* --- NEW: Collapse All Notes Button --- */
      .notes-toggle-btn {
        background: #6C757D;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        margin-top: 8px;
      }
      .notes-toggle-btn:hover {
        background: #5A6268;
      }

      /* --- NEW: Bulk Note Modal --- */
      .bulk-note-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        z-index: 10000;
        align-items: center;
        justify-content: center;
      }
      .bulk-note-modal.show {
        display: flex;
      }
      .bulk-note-modal-content {
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }
      .bulk-note-modal h3 {
        font-size: 18px;
        margin-bottom: 12px;
        color: #1a1a1a;
      }
      .bulk-note-modal p {
        font-size: 14px;
        color: #666;
        margin-bottom: 16px;
      }
      .bulk-note-modal textarea {
        width: 100%;
        min-height: 80px;
        padding: 10px;
        border: 2px solid #e0e0e0;
        border-radius: 6px;
        font-family: inherit;
        font-size: 14px;
        resize: vertical;
        margin-bottom: 16px;
      }
      .bulk-note-modal textarea:focus {
        outline: none;
        border-color: #4A90E2;
      }
      .bulk-note-modal-buttons {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .bulk-note-modal-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }
      .bulk-note-modal-btn.cancel {
        background: #6C757D;
        color: white;
      }
      .bulk-note-modal-btn.cancel:hover {
        background: #5A6268;
      }
      .bulk-note-modal-btn.confirm {
        background: #28a745;
        color: white;
      }
      .bulk-note-modal-btn.confirm:hover {
        background: #218838;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Browser Snapshot</h1>
      <div class="timestamp">${timestamp}</div>

      <div class="stats">
        <div class="stat">
          <div class="stat-value">${data.windows.length}</div>
          <div class="stat-label">Window${data.windows.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="stat">
          <div class="stat-value">${countTotalTabs(data)}</div>
          <div class="stat-label">Total Tabs</div>
        </div>
      </div>

      <div class="controls">
        <div class="control-group">
          <label class="control-label">Search:</label>
          <div class="search-container">
            <input type="text" id="searchBox" placeholder="Search tabs by title, URL, domain, or notes..." />
            <button id="clearSearch" class="clear-btn" title="Clear search">✕</button>
          </div>
          <div id="searchStats" class="search-stats">
            <span id="searchStatsText"></span>
            <button onclick="addBulkNoteToSearchResults()" class="bulk-note-btn search-bulk-btn" id="searchBulkBtn" style="display: none;">
              + Add Note to Search Results
            </button>
          </div>
        </div>

        <div class="control-group">
          <label class="control-label">Sort by:</label>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="sort" value="browser" checked>
              <span>Browser Order</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="sort" value="recent">
              <span>Most Recent</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="sort" value="oldest">
              <span>Least Recent</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="sort" value="domain">
              <span>Domain</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="sort" value="alpha">
              <span>Alphabetical</span>
            </label>
          </div>
        </div>

        <div class="control-group">
          <label class="control-label">View:</label>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="view" value="structured" checked>
              <span>Preserve Windows/Groups</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="view" value="flat">
              <span>Flat List (All Tabs)</span>
            </label>
          </div>
        </div>

        <div class="control-group save-container">
          <button onclick="saveAndDownload()" class="save-btn">
              <span>💾</span> Save Notes & Download Report
          </button>
          <button onclick="toggleAllNotes()" class="notes-toggle-btn" id="notesToggleBtn">
              Collapse All Notes
          </button>
          <div style="font-size: 12px; color: #666; margin-top: 6px;">
              Downloads a new HTML file with all your notes baked in.
          </div>
        </div>
      </div>

      <div id="content"></div>

      <!-- Bulk Note Modal -->
      <div id="bulkNoteModal" class="bulk-note-modal">
        <div class="bulk-note-modal-content">
          <h3 id="bulkNoteTitle">Add Note</h3>
          <p id="bulkNoteDescription">Enter note to add to tabs:</p>
          <textarea id="bulkNoteInput" placeholder="Type your note here..." autofocus></textarea>
          <div class="bulk-note-modal-buttons">
            <button class="bulk-note-modal-btn cancel" onclick="closeBulkNoteModal()">Cancel</button>
            <button class="bulk-note-modal-btn confirm" onclick="confirmBulkNote()">Add Note</button>
          </div>
        </div>
      </div>
    </div>

    <script>
      // Embedded snapshot data
      const snapshotData = ${dataJson};

      // Initialize
      document.addEventListener('DOMContentLoaded', () => {
        renderContent();

        // Add event listeners for controls
        document.querySelectorAll('input[name="sort"], input[name="view"]').forEach(radio => {
          radio.addEventListener('change', renderContent);
        });

        // Add search functionality
        const searchBox = document.getElementById('searchBox');
        const clearBtn = document.getElementById('clearSearch');

        // FIX: Debounce search to improve performance on large lists
        let debounceTimer;
        searchBox.addEventListener('input', (e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(performSearch, 300); // Wait 300ms before searching
        });
        clearBtn.addEventListener('click', clearSearch);

        // Show initial count
        updateSearchStats();
      });

      function renderContent() {
        const sortBy = document.querySelector('input[name="sort"]:checked').value;
        const viewMode = document.querySelector('input[name="view"]:checked').value;

        const content = document.getElementById('content');

        if (viewMode === 'flat') {
          content.innerHTML = renderFlatView(sortBy);
        } else {
          content.innerHTML = renderStructuredView(sortBy);
        }

        // Re-apply search if there's a search term
        const searchBox = document.getElementById('searchBox');
        if (searchBox && searchBox.value.trim()) {
          performSearch();
        } else {
          updateSearchStats();
        }
      }

      function renderStructuredView(sortBy) {
        let html = '';

        snapshotData.windows.forEach((window, windowIndex) => {
          const windowNum = windowIndex + 1;
          html += \`
          <div class="window" data-window-index="\${windowIndex}">
            <div class="window-header" role="button" tabindex="0" onkeydown="handleHeaderKey(event)">
              <span onclick="toggleCollapse(this.parentElement)" style="flex: 1; cursor: pointer;">Window \${windowNum} (\${window.tabCount} tab\${window.tabCount !== 1 ? 's' : ''})</span>
              <button class="bulk-note-btn" onclick="event.stopPropagation(); addBulkNoteToContainer(this.closest('.window'));" title="Add note to all tabs in this window">+ Add Note to Window</button>
              <span class="arrow" onclick="toggleCollapse(this.parentElement)" style="cursor: pointer;">▼</span>
            </div>
            <div class="window-content">
          \`;

          if (sortBy === 'domain') {
            // Group by domain within window
            html += renderTabsByDomain(window, sortBy);
          } else {
            // Get all tabs from this window
            let allTabs = [];
            Object.entries(window.tabsByGroup).forEach(([groupId, tabs]) => {
              const gid = parseInt(groupId);
              tabs.forEach(tab => {
                allTabs.push({ ...tab, groupId: gid, originalGroupId: gid });
              });
            });

            // Sort tabs
            allTabs = sortTabs(allTabs, sortBy);

            if (sortBy === 'browser') {
              // Preserve groups for browser order
              const ungroupedTabs = allTabs.filter(t => t.groupId === -1);
              if (ungroupedTabs.length > 0) {
                ungroupedTabs.forEach(tab => {
                  html += renderTabHTML(tab);
                });
              }

              // Render groups
              const groupIds = [...new Set(allTabs.filter(t => t.groupId !== -1).map(t => t.groupId))];
              groupIds.forEach(groupId => {
                const groupTabs = allTabs.filter(t => t.groupId === groupId);
                const groupInfo = window.groups[groupId];
                if (groupInfo) {
                  html += renderGroupHTML(groupInfo, groupTabs, windowIndex, groupId);
                }
              });
            } else {
              // Flat rendering within window for non-browser sorts
              allTabs.forEach(tab => {
                html += renderTabHTML(tab);
              });
            }
          }

          html += \`
            </div>
          </div>
          \`;
        });

        return html;
      }

      function renderFlatView(sortBy) {
        let html = '';

        // Collect all tabs across all windows
        let allTabs = [];
        snapshotData.windows.forEach((window, windowIndex) => {
          Object.entries(window.tabsByGroup).forEach(([groupId, tabs]) => {
            const gid = parseInt(groupId);
            tabs.forEach(tab => {
              allTabs.push({ ...tab, windowNum: windowIndex + 1, groupId: gid });
            });
          });
        });

        // Sort all tabs
        allTabs = sortTabs(allTabs, sortBy);

        if (sortBy === 'domain') {
          // Group by domain
          const tabsByDomain = {};
          allTabs.forEach(tab => {
            if (!tabsByDomain[tab.domain]) {
              tabsByDomain[tab.domain] = [];
            }
            tabsByDomain[tab.domain].push(tab);
          });

          // Sort domains
          const sortedDomains = Object.keys(tabsByDomain).sort();

          sortedDomains.forEach(domain => {
            const tabs = tabsByDomain[domain];
            html += \`
            <div class="domain-section">
              <div class="domain-header" role="button" tabindex="0" onkeydown="handleHeaderKey(event)">
                <span onclick="toggleCollapse(this.parentElement)" style="flex: 1; cursor: pointer;">\${domain} (\${tabs.length} tab\${tabs.length !== 1 ? 's' : ''})</span>
                <button class="bulk-note-btn" onclick="event.stopPropagation(); addBulkNoteToContainer(this.closest('.domain-section'));" title="Add note to all tabs in this domain">+ Add Note to Domain</button>
                <span class="arrow" onclick="toggleCollapse(this.parentElement)" style="cursor: pointer;">▼</span>
              </div>
              <div class="domain-content">
            \`;

            tabs.forEach(tab => {
              html += renderTabHTML(tab, true);
            });

            html += \`
              </div>
            </div>
            \`;
          });
        } else {
          html += \`
          <div class="window">
            <div class="flat-list-header">
              All Tabs (\${allTabs.length})
            </div>
            <div class="window-content">
          \`;

          allTabs.forEach(tab => {
            html += renderTabHTML(tab, true);
          });

          html += \`
            </div>
          </div>
          \`;
        }

        return html;
      }

      function renderTabsByDomain(window, sortBy) {
        let html = '';

        // Collect all tabs
        let allTabs = [];
        Object.entries(window.tabsByGroup).forEach(([groupId, tabs]) => {
          const gid = parseInt(groupId);
          tabs.forEach(tab => {
            allTabs.push({ ...tab, groupId: gid });
          });
        });

        // Group by domain
        const tabsByDomain = {};
        allTabs.forEach(tab => {
          if (!tabsByDomain[tab.domain]) {
            tabsByDomain[tab.domain] = [];
          }
          tabsByDomain[tab.domain].push(tab);
        });

        // Sort domains
        const sortedDomains = Object.keys(tabsByDomain).sort();

        sortedDomains.forEach(domain => {
          const tabs = tabsByDomain[domain];
          html += \`
          <div class="group">
            <div class="group-header" role="button" tabindex="0" onkeydown="handleHeaderKey(event)">
              <span onclick="toggleCollapse(this.parentElement)" style="flex: 1; cursor: pointer;">
                <span style="color: #333; font-weight: 600;">\${domain}</span>
                <span style="color: #666; font-size: 13px; margin-left: 8px;">\${tabs.length} tab\${tabs.length !== 1 ? 's' : ''}</span>
              </span>
              <button class="bulk-note-btn" onclick="event.stopPropagation(); addBulkNoteToContainer(this.closest('.group'));" title="Add note to all tabs in this domain">+ Add Note to Domain</button>
              <span class="arrow" onclick="toggleCollapse(this.parentElement)" style="cursor: pointer;">▼</span>
            </div>
            <div class="group-content">
          \`;

          tabs.forEach(tab => {
            html += renderTabHTML(tab);
          });

          html += \`
            </div>
          </div>
          \`;
        });

        return html;
      }

      function renderGroupHTML(groupInfo, tabs, windowIndex, groupId) {
        const groupColor = getGroupColor(groupInfo.color);
        return \`
          <div class="group">
            <div class="group-header" role="button" tabindex="0" onkeydown="handleHeaderKey(event)">
              <span onclick="toggleCollapse(this.parentElement)" style="flex: 1; cursor: pointer;">
                <span class="group-badge" style="background: \${groupColor};">\${escapeHtml(groupInfo.title)}</span>
                <span style="color: #666; font-size: 13px;">\${tabs.length} tab\${tabs.length !== 1 ? 's' : ''}</span>
              </span>
              <button class="bulk-note-btn" onclick="event.stopPropagation(); addBulkNoteToContainer(this.closest('.group'));" title="Add note to all tabs in this group">+ Add Note to Group</button>
              <span class="arrow" onclick="toggleCollapse(this.parentElement)" style="cursor: pointer;">▼</span>
            </div>
            <div class="group-content">
              \${tabs.map(tab => renderTabHTML(tab)).join('')}
            </div>
          </div>
        \`;
      }

      function renderTabHTML(tab, showWindow = false) {
        // FIX: Use a lightweight SVG data URI as default to prevent broken image icons
        const favicon = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23ddd"/></svg>';
        const badges = [];

        if (tab.active) badges.push('<span class="tab-badge">Active</span>');
        if (tab.pinned) badges.push('<span class="tab-badge badge-pinned">Pinned</span>');
        if (tab.audible) badges.push('<span class="tab-badge badge-audio">🔊 Audio</span>');
        if (tab.discarded) badges.push('<span class="tab-badge badge-unloaded">💤 Unloaded</span>');

        const timeAgo = getTimeAgo(tab.lastAccessed);
        const isOld = isTabOld(tab.lastAccessed);

        let meta = '';
        if (tab.lastAccessed) {
          const absTime = new Date(tab.lastAccessed).toLocaleString();
          meta = \`<div class="tab-meta">Last accessed: \${timeAgo} (\${absTime})\`;
          if (showWindow && tab.windowNum) {
            meta += \` • Window \${tab.windowNum}\`;
          }
          meta += '</div>';
        }

        // NEW: Logic to handle Notes
        // Create a unique ID based on window/group/index to link DOM to Data
        const uniqueId = \`w\${tab.windowId}-g\${tab.groupId}-i\${tab.index}\`;
        const currentNote = tab.userNote || ''; // Check if note exists in JSON
        const isNoteVisible = currentNote.length > 0 ? 'visible' : '';
        const btnText = currentNote.length > 0 ? 'Edit Note' : '+ Add Note';

        return \`
          <div class="tab\${isOld ? ' old-tab' : ''}" id="tab-\${uniqueId}">
            <img class="tab-favicon" src="\${escapeHtml(favicon)}" loading="lazy" alt=""
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22><rect width=%2216%22 height=%2216%22 fill=%22%23ddd%22/></svg>'">

            <div class="tab-info">
              <div class="tab-title">
                <span>\${escapeHtml(tab.title)}</span>
                \${badges.join('')}
                <button class="note-toggle" onclick="toggleNote('\${uniqueId}')">\${btnText}</button>
              </div>

              <a href="\${escapeHtml(tab.url)}" class="tab-url" target="_blank">\${escapeHtml(tab.url)}</a>
              \${meta}

              <div class="note-area \${isNoteVisible}" id="area-\${uniqueId}">
                  <textarea
                      class="note-input"
                      placeholder="Type a note here..."
                      oninput="updateNoteData(this, \${tab.windowId}, \${tab.groupId}, \${tab.index})"
                  >\${escapeHtml(currentNote)}</textarea>
              </div>
            </div>
          </div>
        \`;
      }

      function sortTabs(tabs, sortBy) {
        const sorted = [...tabs];

        switch(sortBy) {
          case 'recent':
            sorted.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            break;
          case 'oldest':
            sorted.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
            break;
          case 'domain':
            sorted.sort((a, b) => {
              const domainCompare = a.domain.localeCompare(b.domain);
              if (domainCompare !== 0) return domainCompare;
              return (b.lastAccessed || 0) - (a.lastAccessed || 0);
            });
            break;
          case 'alpha':
            sorted.sort((a, b) => a.title.localeCompare(b.title));
            break;
          case 'browser':
          default:
            sorted.sort((a, b) => (a.index || 0) - (b.index || 0));
            break;
        }

        return sorted;
      }

      function toggleCollapse(header) {
        const content = header.nextElementSibling;
        const arrow = header.querySelector('.arrow');
        content.classList.toggle('collapsed');
        arrow.style.transform = content.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
      }

      function getTimeAgo(timestamp) {
        if (!timestamp) return 'Unknown';

        const now = Date.now();
        const diff = now - timestamp;

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return \`\${days} day\${days !== 1 ? 's' : ''} ago\`;
        if (hours > 0) return \`\${hours} hour\${hours !== 1 ? 's' : ''} ago\`;
        if (minutes > 0) return \`\${minutes} minute\${minutes !== 1 ? 's' : ''} ago\`;
        return 'Just now';
      }

      function isTabOld(timestamp) {
        if (!timestamp) return false;
        const daysSince = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
        return daysSince > 30; // Highlight tabs not viewed in 30+ days
      }

      function getGroupColor(colorName) {
        const colors = {
          grey: '#5F6368',
          blue: '#1A73E8',
          red: '#D93025',
          yellow: '#F9AB00',
          green: '#1E8E3E',
          pink: '#D01884',
          purple: '#9334E6',
          cyan: '#12B5CB',
          orange: '#E8710A'
        };
        return colors[colorName] || '#5F6368';
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function performSearch() {
        const searchBox = document.getElementById('searchBox');
        const clearBtn = document.getElementById('clearSearch');
        const searchTerm = searchBox.value.toLowerCase().trim();

        // Show/hide clear button
        if (searchTerm) {
          clearBtn.classList.add('visible');
        } else {
          clearBtn.classList.remove('visible');
        }

        // If search is empty, show everything
        if (!searchTerm) {
          document.querySelectorAll('.tab, .group, .window, .domain-section').forEach(el => {
            el.classList.remove('search-hidden');
          });
          updateSearchStats();
          return;
        }

        let matchCount = 0;

        // Search through all tabs
        document.querySelectorAll('.tab').forEach(tab => {
          const title = tab.querySelector('.tab-title')?.textContent.toLowerCase() || '';
          const url = tab.querySelector('.tab-url')?.textContent.toLowerCase() || '';
          const note = tab.querySelector('.note-input')?.value.toLowerCase() || '';

          const matches = title.includes(searchTerm) || url.includes(searchTerm) || note.includes(searchTerm);

          if (matches) {
            tab.classList.remove('search-hidden');
            matchCount++;
          } else {
            tab.classList.add('search-hidden');
          }
        });

        // Hide empty groups/windows/domains
        document.querySelectorAll('.group, .domain-section').forEach(container => {
          const visibleTabs = container.querySelectorAll('.tab:not(.search-hidden)');
          if (visibleTabs.length === 0) {
            container.classList.add('search-hidden');
          } else {
            container.classList.remove('search-hidden');
          }
        });

        document.querySelectorAll('.window').forEach(window => {
          const visibleTabs = window.querySelectorAll('.tab:not(.search-hidden)');
          if (visibleTabs.length === 0) {
            window.classList.add('search-hidden');
          } else {
            window.classList.remove('search-hidden');
          }
        });

        // Update search stats
        updateSearchStats(matchCount);
      }

      function updateSearchStats(matchCount = null) {
        const searchStatsText = document.getElementById('searchStatsText');
        const searchBulkBtn = document.getElementById('searchBulkBtn');
        const searchStats = document.getElementById('searchStats');
        const totalTabs = document.querySelectorAll('.tab').length;

        if (matchCount === null) {
          // No filter active
          searchStatsText.textContent = \`Showing all \${totalTabs} tabs\`;
          searchStats.classList.remove('filtered');
          if (searchBulkBtn) searchBulkBtn.style.display = 'none';
        } else {
          // Filter active
          searchStatsText.textContent = \`Showing \${matchCount} of \${totalTabs} tabs\`;
          searchStats.classList.add('filtered');
          if (searchBulkBtn && matchCount > 0) {
            searchBulkBtn.style.display = 'inline-block';
            searchBulkBtn.textContent = \`+ Add Note to Search Results (\${matchCount})\`;
          } else if (searchBulkBtn) {
            searchBulkBtn.style.display = 'none';
          }
        }
      }

      function clearSearch() {
        const searchBox = document.getElementById('searchBox');
        const clearBtn = document.getElementById('clearSearch');

        searchBox.value = '';
        clearBtn.classList.remove('visible');

        // Show everything
        document.querySelectorAll('.tab, .group, .window, .domain-section').forEach(el => {
          el.classList.remove('search-hidden');
        });

        updateSearchStats();
        searchBox.focus();
      }

      // --- NEW: Note Logic ---

      // 1. Toggles the visibility of the note textarea
      function toggleNote(uniqueId) {
          const area = document.getElementById(\`area-\${uniqueId}\`);
          const btn = area.parentElement.querySelector('.note-toggle');
          const isHidden = !area.classList.contains('visible');

          if (isHidden) {
              area.classList.add('visible');
              const textarea = area.querySelector('textarea');
              textarea.focus();
              if(!textarea.value) btn.textContent = 'Close Note';
          } else {
              // Only hide if empty. If it has text, we keep it open but maybe change focus.
              const val = area.querySelector('textarea').value.trim();
              if (!val) {
                  area.classList.remove('visible');
                  btn.textContent = '+ Add Note';
              } else {
                  // If user clicks toggle while text exists, treat as "Done/Collapse" or just focus?
                  // Let's treat it as focus for now, or you could implement collapse.
                   area.querySelector('textarea').focus();
              }
          }
      }

      // 2. Updates the global snapshotData object in real-time
      function updateNoteData(textarea, winId, grpId, idx) {
          const text = textarea.value;
          const btn = textarea.closest('.tab-info').querySelector('.note-toggle');

          // Update button text based on content
          btn.textContent = text.trim().length > 0 ? 'Edit Note' : '+ Add Note';

          // Find the specific tab object in memory
          const win = snapshotData.windows.find(w => w.id === winId);
          if (win) {
              // Locate the tab array for this group
              const groupTabs = win.tabsByGroup[grpId];
              if (groupTabs) {
                  // Find the specific tab by index
                  const tab = groupTabs.find(t => t.index === idx);
                  if (tab) {
                      tab.userNote = text; // Write to memory
                  }
              }
          }
      }

      // --- NEW: The "Quine" Save Function ---

      function saveAndDownload() {
          // 1. Update the timestamp to current time
          snapshotData.timestamp = new Date();

          // 2. Convert the current state (with notes) back to a string
          const jsonString = JSON.stringify(snapshotData);

          // 3. Get the current page HTML
          let htmlContent = document.documentElement.outerHTML;

          // 4. Add DOCTYPE (outerHTML excludes it)
          if (!htmlContent.startsWith('<!DOCTYPE')) {
              htmlContent = '<!DOCTYPE html>\\n' + htmlContent;
          }

          // 5. Update the visible timestamp in the HTML
          const newTimestamp = formatDateTime(snapshotData.timestamp);
          const timestampRegex = /<div class="timestamp">.*?<\\/div>/;
          htmlContent = htmlContent.replace(timestampRegex, \`<div class="timestamp">\${newTimestamp}</div>\`);

          // Also update the title
          const titleRegex = /<title>Browser Snapshot - .*?<\\/title>/;
          htmlContent = htmlContent.replace(titleRegex, \`<title>Browser Snapshot - \${newTimestamp}</title>\`);

          // 6. Regex Replace: Find the original data block and swap it
          // We look for 'const snapshotData =' followed by the object until the semi-colon
          const regex = /const snapshotData = \\{.*?\\};/s;

          if (!regex.test(htmlContent)) {
              alert('Error: Could not parse source code. Save failed.');
              return;
          }

          const newScript = \`const snapshotData = \${jsonString};\`;
          const newHtml = htmlContent.replace(regex, newScript);

          // 7. Create Blob and Download
          const blob = new Blob([newHtml], {type: 'text/html'});
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');

          const date = new Date().toISOString().slice(0,10);
          const time = new Date().toTimeString().slice(0,5).replace(':','');
          a.href = url;
          a.download = \`browser-snapshot-notes-\${date}-\${time}.html\`;
          document.body.appendChild(a);
          a.click();

          // Cleanup
          setTimeout(() => {
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);
          }, 100);

          // Update the visible timestamp on the current page too
          const timestampDiv = document.querySelector('.timestamp');
          if (timestampDiv) {
              timestampDiv.textContent = newTimestamp;
          }
      }

      // Helper function to format date/time (matching the one outside the template)
      function formatDateTime(date) {
        const d = new Date(date);
        return d.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      }

      // --- FIX: Accessibility Helper ---
      // Allows pressing "Enter" or "Space" on headers to toggle them
      function handleHeaderKey(e) {
          if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleCollapse(e.currentTarget);
          }
      }

      // --- NEW: Bulk Note Functions ---

      // Track unsaved changes
      let hasUnsavedNotes = false;

      // Store current bulk note context
      let bulkNoteContext = null;

      // Open bulk note modal
      function openBulkNoteModal(title, description, callback) {
        const modal = document.getElementById('bulkNoteModal');
        const titleEl = document.getElementById('bulkNoteTitle');
        const descEl = document.getElementById('bulkNoteDescription');
        const input = document.getElementById('bulkNoteInput');

        titleEl.textContent = title;
        descEl.textContent = description;
        input.value = '';

        bulkNoteContext = callback;
        modal.classList.add('show');

        // Focus the textarea
        setTimeout(() => input.focus(), 100);

        // Allow Enter to submit (with Shift+Enter for newlines)
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            confirmBulkNote();
          }
        };
      }

      // Close bulk note modal
      function closeBulkNoteModal() {
        const modal = document.getElementById('bulkNoteModal');
        modal.classList.remove('show');
        bulkNoteContext = null;
      }

      // Confirm bulk note
      function confirmBulkNote() {
        const input = document.getElementById('bulkNoteInput');
        const note = input.value.trim();

        if (note && bulkNoteContext) {
          bulkNoteContext(note);
        }

        closeBulkNoteModal();
      }

      // Add bulk note to all visible search results
      function addBulkNoteToSearchResults() {
        const visibleTabs = document.querySelectorAll('.tab:not(.search-hidden)');
        if (visibleTabs.length === 0) return;

        openBulkNoteModal(
          'Add Note to Search Results',
          \`Enter note to add to all \${visibleTabs.length} search result tab\${visibleTabs.length !== 1 ? 's' : ''}:\`,
          (bulkNote) => {
            let updatedCount = 0;
            visibleTabs.forEach(tabElement => {
              if (appendNoteToTab(tabElement, bulkNote)) {
                updatedCount++;
              }
            });

            if (updatedCount > 0) {
              hasUnsavedNotes = true;
              alert(\`✓ Note added to \${updatedCount} tab\${updatedCount !== 1 ? 's' : ''}\`);
            }
          }
        );
      }

      // Add bulk note to all tabs in a container (window, group, or domain section)
      function addBulkNoteToContainer(containerElement) {
        const tabs = containerElement.querySelectorAll('.tab');
        if (tabs.length === 0) return;

        const containerType = containerElement.classList.contains('window') ? 'window' :
                             containerElement.classList.contains('domain-section') ? 'domain' : 'group';

        openBulkNoteModal(
          \`Add Note to \${containerType.charAt(0).toUpperCase() + containerType.slice(1)}\`,
          \`Enter note to add to all \${tabs.length} tab\${tabs.length !== 1 ? 's' : ''} in this \${containerType}:\`,
          (bulkNote) => {
            let updatedCount = 0;
            tabs.forEach(tabElement => {
              if (appendNoteToTab(tabElement, bulkNote)) {
                updatedCount++;
              }
            });

            if (updatedCount > 0) {
              hasUnsavedNotes = true;
              alert(\`✓ Note added to \${updatedCount} tab\${updatedCount !== 1 ? 's' : ''}\`);
            }
          }
        );
      }

      // Helper function to append note to a tab element
      function appendNoteToTab(tabElement, newNote) {
        const textarea = tabElement.querySelector('.note-input');
        const noteArea = tabElement.querySelector('.note-area');
        const noteToggleBtn = tabElement.querySelector('.note-toggle');

        if (!textarea) return false;

        // Get current note value
        let currentNote = textarea.value.trim();

        // Append with separator if note exists, otherwise just set it
        if (currentNote) {
          textarea.value = currentNote + '\\n\\n' + newNote;
        } else {
          textarea.value = newNote;
        }

        // Trigger the update to snapshotData
        textarea.dispatchEvent(new Event('input'));

        // Auto-expand the note area
        if (noteArea) {
          noteArea.classList.add('visible');
        }

        // Update button text
        if (noteToggleBtn) {
          noteToggleBtn.textContent = 'Edit Note';
        }

        // Add highlight animation
        tabElement.classList.add('note-updated');
        setTimeout(() => {
          tabElement.classList.remove('note-updated');
        }, 1000);

        return true;
      }

      // --- NEW: Toggle All Notes Function ---
      function toggleAllNotes() {
        const allNoteAreas = document.querySelectorAll('.note-area');
        const toggleBtn = document.getElementById('notesToggleBtn');

        if (allNoteAreas.length === 0) return;

        // Check if any are visible
        const anyVisible = Array.from(allNoteAreas).some(area => area.classList.contains('visible'));

        if (anyVisible) {
          // Collapse all
          allNoteAreas.forEach(area => {
            area.classList.remove('visible');
          });
          if (toggleBtn) toggleBtn.textContent = 'Expand All Notes';
        } else {
          // Expand all
          allNoteAreas.forEach(area => {
            area.classList.add('visible');
          });
          if (toggleBtn) toggleBtn.textContent = 'Collapse All Notes';
        }
      }

      // --- NEW: Unsaved Changes Warning ---
      window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedNotes) {
          e.preventDefault();
          e.returnValue = 'You have unsaved notes. Are you sure you want to leave?';
          return e.returnValue;
        }
      });

      // Update the existing updateNoteData function to track changes
      const originalUpdateNoteData = updateNoteData;
      updateNoteData = function(textarea, winId, grpId, idx) {
        originalUpdateNoteData(textarea, winId, grpId, idx);
        hasUnsavedNotes = true;
      };

      // Update saveAndDownload to reset unsaved flag
      const originalSaveAndDownload = saveAndDownload;
      saveAndDownload = function() {
        originalSaveAndDownload();
        hasUnsavedNotes = false;
      };
    </script>
  </body>
  </html>`;

    return html;
  }

  // ---------------------------------------------------------
  // Outer-scope helpers used by generateHTML
  // ---------------------------------------------------------
  function formatDateTime(date) {
    const d = new Date(date);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }

  function formatDateForFilename(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hour}-${minute}`;
  }

  function countTotalTabs(data) {
    return data.windows.reduce((sum, w) => sum + w.tabCount, 0);
  }

  // ---------------------------------------------------------
  // Download
  // ---------------------------------------------------------
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Capture the current session, generate the HTML (with an embedded
  // machine-readable restore payload), and download it. Returns basic counts.
  async function captureAndDownload() {
    const data = await capture();
    if (data.windows.length === 0) {
      return { windows: 0, tabs: 0 };
    }

    let html = generateHTML(data);

    // Inject a clean JSON payload for restore, separate from the display script.
    // `<` is escaped so a "</script>" inside any title/URL can't break the file.
    const payload = JSON.stringify(toSerializable(data)).replace(/</g, '\\u003c');
    const block = `<script type="application/json" id="tabmgr-snapshot">${payload}</script>`;
    html = html.replace('</body>', `${block}\n</body>`);

    const filename = `tab-snapshot-${formatDateForFilename(data.timestamp)}.html`;
    downloadFile(html, filename, 'text/html');

    return { windows: data.windows.length, tabs: countTotalTabs(data) };
  }

  // ---------------------------------------------------------
  // Restore
  // ---------------------------------------------------------

  // Extract the embedded snapshot payload from an exported HTML file's text.
  function parseSnapshotFile(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const el = doc.getElementById('tabmgr-snapshot');
    if (!el) {
      throw new Error('This file does not contain a restorable Tab Manager snapshot.');
    }
    const data = JSON.parse(el.textContent);
    if (!data || !Array.isArray(data.windows)) {
      throw new Error('Snapshot data is malformed.');
    }
    return data;
  }

  // URLs the browser will not let us recreate programmatically.
  function isRestorableUrl(url) {
    if (!url) return false;
    return /^(https?|ftp|file):/i.test(url);
  }

  // Flatten a serialized window's tabsByGroup back into index order.
  function orderedTabs(win) {
    const groups = win.tabsByGroup || {};
    const all = [];
    Object.values(groups).forEach(arr => {
      (arr || []).forEach(t => all.push(t));
    });
    all.sort((a, b) => (a.index || 0) - (b.index || 0));
    return all;
  }

  // Count how many tabs a selection would open (restorable only).
  function countRestorable(windows) {
    let n = 0;
    windows.forEach(w => {
      orderedTabs(w).forEach(t => { if (isRestorableUrl(t.url)) n++; });
    });
    return n;
  }

  // Wait until a tab has finished loading and its title has stopped changing.
  //
  // Two separate reasons this is not simply "wait for the first title":
  //   1. A tab must commit its navigation before it can be discarded. Discard a
  //      still-pending tab and Chrome freezes it with no url, title, favicon or
  //      even pendingUrl, and nothing can ever identify it again.
  //   2. Single-page apps paint a placeholder title ("Gmail", "Claude", "Ads
  //      Manager") and swap in the real one a beat later. The favicon usually
  //      lands later still. Discarding on the first title bakes in the
  //      placeholder and loses the favicon.
  //
  // Resolves once the tab reports `complete` and then stays quiet for quietMs,
  // or when maxMs runs out, whichever happens first.
  function waitForSettledTitle(tabId, maxMs, quietMs) {
    return new Promise(resolve => {
      let done = false;
      let complete = false;
      let quietTimer = null;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(hardTimer);
        clearTimeout(quietTimer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      };

      // Every title or favicon change restarts the quiet period, so we only
      // settle once the page has stopped revising itself.
      const bumpQuiet = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => { if (complete) finish(); }, quietMs);
      };

      const onUpdated = (id, info) => {
        if (id !== tabId) return;
        if (info.status === 'complete') complete = true;
        if (info.title || info.favIconUrl || info.status === 'complete') bumpQuiet();
      };

      const hardTimer = setTimeout(finish, maxMs);
      chrome.tabs.onUpdated.addListener(onUpdated);

      // The tab may have finished before the listener was attached.
      chrome.tabs.get(tabId).then(t => {
        if (!t) return finish();
        if (t.status === 'complete') { complete = true; bumpQuiet(); }
      }).catch(finish);
    });
  }

  // Restore selected windows from a parsed snapshot. Non-destructive: only
  // creates new windows. options =
  //   { windowIds, discardThreshold, skipOpenUrls, commitTimeoutMs, onProgress }.
  async function restore(data, options = {}) {
    const {
      windowIds = null,          // array of snapshot window ids; null = all
      discardThreshold = 25,     // over this many tabs, unload them after load
      skipOpenUrls = false,
      commitTimeoutMs = 8000,    // hard cap on waiting for any one tab to load
      titleQuietMs = 700,        // how long a title must hold still to count as final
      onProgress = null          // (settled, total) => void, during the unload pass
    } = options;

    const selected = data.windows.filter(w => !windowIds || windowIds.includes(w.id));
    const totalRestorable = countRestorable(selected);
    const discard = totalRestorable > discardThreshold;

    // Existing URLs, only if we're de-duping.
    const openUrls = new Set();
    if (skipOpenUrls) {
      const wins = await chrome.windows.getAll({ populate: true });
      wins.forEach(w => (w.tabs || []).forEach(t => { if (t.url) openUrls.add(t.url); }));
    }

    // Remember the dashboard window so we can keep it in front afterward.
    let dashboardWindowId = null;
    try { dashboardWindowId = (await chrome.windows.getCurrent()).id; } catch {}

    const result = {
      restoredWindows: 0, restoredTabs: 0, skippedUrls: 0, skippedGroups: 0,
      discardedTabs: 0, leftLoaded: 0
    };
    let settled = 0;

    for (const w of selected) {
      const ordered = orderedTabs(w).filter(t => {
        if (!isRestorableUrl(t.url)) { result.skippedUrls++; return false; }
        if (skipOpenUrls && openUrls.has(t.url)) return false;
        return true;
      });
      if (ordered.length === 0) continue;

      // Create the window from the first tab, honoring geometry when possible.
      const first = ordered[0];
      const createOpts = { url: first.url, focused: false };
      const hasBounds = w.left != null && w.top != null && w.width != null && w.height != null;
      const nonNormalState = w.state && w.state !== 'normal';
      if (hasBounds && !nonNormalState) {
        createOpts.left = w.left; createOpts.top = w.top;
        createOpts.width = w.width; createOpts.height = w.height;
      }

      let newWin;
      try {
        newWin = await chrome.windows.create(createOpts);
      } catch (e) {
        // Fall back to a plain window if geometry was rejected.
        newWin = await chrome.windows.create({ url: first.url, focused: false });
      }
      const firstTabId = newWin.tabs && newWin.tabs[0] ? newWin.tabs[0].id : null;

      const created = [];
      if (firstTabId != null) created.push({ tabId: firstTabId, snap: first });

      // Create the remaining tabs in order.
      for (let i = 1; i < ordered.length; i++) {
        const t = ordered[i];
        try {
          const tab = await chrome.tabs.create({
            windowId: newWin.id, url: t.url, active: false, pinned: !!t.pinned
          });
          created.push({ tabId: tab.id, snap: t });
        } catch (e) {
          result.skippedUrls++;
        }
      }

      // Pin the first tab if it was pinned.
      if (first.pinned && firstTabId != null) {
        try { await chrome.tabs.update(firstTabId, { pinned: true }); } catch {}
      }

      // Recreate tab groups (name + color + membership).
      if (chrome.tabGroups) {
        const byGroup = new Map();
        created.forEach(c => {
          const gid = c.snap.groupId;
          if (gid === undefined || gid === -1) return;
          if (!byGroup.has(gid)) byGroup.set(gid, []);
          byGroup.get(gid).push(c.tabId);
        });
        for (const [gid, tabIds] of byGroup) {
          try {
            const newGroupId = await chrome.tabs.group({
              tabIds, createProperties: { windowId: newWin.id }
            });
            const info = (w.groups || {})[gid];
            if (info) {
              await chrome.tabGroups.update(newGroupId, {
                title: info.title || '', color: info.color || 'grey'
              });
            }
          } catch (e) {
            result.skippedGroups++;
          }
        }
      }

      // Restore which tab was active.
      const activeRec = created.find(c => c.snap.active);
      if (activeRec) {
        try { await chrome.tabs.update(activeRec.tabId, { active: true }); } catch {}
      }

      // Apply a non-normal window state (maximized / fullscreen / minimized).
      if (nonNormalState) {
        try { await chrome.windows.update(newWin.id, { state: w.state }); } catch {}
      }

      // On large restores, unload the tabs to give the memory back. Each tab
      // must commit its navigation before it can be discarded, otherwise Chrome
      // freezes it with no url, no title and no favicon, and nothing can ever
      // identify it again. So wait for the title, then discard. A tab that
      // never reports one is left loaded rather than frozen blank.
      if (discard) {
        const targets = created.filter(c => !activeRec || c.tabId !== activeRec.tabId);
        if (activeRec) {
          settled++;
          if (onProgress) onProgress(settled, totalRestorable);
        }

        // Every tab in this window is already loading, so wait on them all at
        // once. Waiting one at a time would restart commitTimeoutMs for each
        // hung page and drag a single slow window out to minutes.
        await Promise.all(targets.map(c =>
          waitForSettledTitle(c.tabId, commitTimeoutMs, titleQuietMs).then(() => {
            settled++;
            if (onProgress) onProgress(settled, totalRestorable);
          })
        ));

        for (const c of targets) {
          let tab = null;
          try { tab = await chrome.tabs.get(c.tabId); } catch { continue; }
          // No committed url means the page never loaded. Discarding now would
          // strand it blank forever, so leave it loaded and take the memory hit.
          if (!tab.url) { result.leftLoaded++; continue; }
          try {
            await chrome.tabs.discard(c.tabId);
            result.discardedTabs++;
          } catch {
            result.leftLoaded++;
          }
        }
      }

      result.restoredWindows++;
      result.restoredTabs += created.length;
    }

    // Keep the dashboard in front so the user watches from where they are.
    if (dashboardWindowId != null) {
      try { await chrome.windows.update(dashboardWindowId, { focused: true }); } catch {}
    }

    return result;
  }

  return {
    capture,
    toSerializable,
    generateHTML,
    captureAndDownload,
    parseSnapshotFile,
    restore,
    orderedTabs,
    countRestorable,
    isRestorableUrl
  };
})();
