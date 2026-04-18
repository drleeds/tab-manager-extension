/**
 * newtab.js
 * Main application controller for Tab Manager Pro.
 * Orchestrates UI rendering, event handling, modals,
 * search, settings, and coordinates storage + drag-drop.
 */

'use strict';

// =========================================================
// App State
// =========================================================
let appData = null;        // { categories: [...], settings: {...} }
let editingSiteId = null;  // id of site being edited (null = new)
let editingCatId = null;   // target category for new/edit site
let editingCategoryId = null; // id of category being edited (null = new)
let contextSiteId = null;  // site id for context menu
let contextCatId = null;   // category id for context menu
let searchQuery = '';
// When true, saveAndRefresh() skips its scroll restoration (navigation code will handle scrolling)
let skipScrollRestore = false;
// Counter of pending local saves; the chrome.storage.onChanged listener skips re-rendering while > 0
let localSavePending = 0;

// Live Tabs workspace
const LIVE_TABS_ID = '__live_tabs__';
let liveTabsData = null;       // { categories: [...] } — ephemeral, never saved
let liveTabsListeners = null;  // array of listener removers

// Select mode state
let selectMode = false;
// Set of "catId::siteId" strings for selected sites
let selectedSites = new Set();
// Anchor key for range selection ("catId::siteId", or null)
let anchorKey = null;
// When true, saveCategory() will also move selectedSites into the new category
let pendingMoveAfterCreate = false;
// 'top' or 'bottom' — placement within the target category for a pending move
let pendingMovePosition = 'bottom';
// When true, saveCategory() will also add pickerItems to the new category
let pendingPickerAddAfterCreate = false;
// When true, saveCategory() will move a single context-menu site into the new category
let pendingContextMoveAfterCreate = false;
let pendingMoveMode = 'move';

// =========================================================
// Boot
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Clear any browser-restored search value before rendering
  const searchEl = document.getElementById('searchInput');
  searchEl.value = '';
  document.getElementById('clearSearch').hidden = true;

  appData = await Storage.loadData();
  applySettings();

  // If resuming on Live Tabs workspace, load the live data first
  if (appData.settings.currentWorkspace === LIVE_TABS_ID) {
    await loadLiveTabs();
    startLiveTabsListeners();
  }

  renderAll();
  bindGlobalEvents();
  DragDrop.init(handleDrop);
  Undo.init(handleUndo);
});

// =========================================================
// Undo handler
// =========================================================
function handleUndo() {
  const restoredData = Undo.undo();
  if (restoredData) {
    appData = restoredData;
    saveAndRefresh();
  }
}

// =========================================================
// Apply settings to DOM
// =========================================================
function applySettings() {
  const s = appData.settings;

  // Ensure hiddenCategories is always an array
  if (!Array.isArray(s.hiddenCategories)) s.hiddenCategories = [];

  // Force Kanban mode (column mode is deprecated)
  s.layoutMode = 'kanban';

  // Theme class on body
  document.body.className = `theme-${s.theme} layout-kanban`;

  // Layout mode class on grid
  const grid = document.getElementById('categoriesGrid');
  grid.classList.add('layout-kanban');

  // Settings modal UI sync
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });
  const countToggle = document.getElementById('showSiteCount');
  if (countToggle) countToggle.checked = s.showSiteCount;

  // Bird's-eye toggle state
  const birdsEyeBtn = document.getElementById('birdsEyeToggle');
  if (birdsEyeBtn) birdsEyeBtn.classList.toggle('active', s.birdsEyeView);

  // Tab Splitter settings sync
  const splitMaxInput = document.getElementById('tabSplitMaxTabs');
  if (splitMaxInput) splitMaxInput.value = s.tabSplitMaxTabs || 12;
  const splitAutoToggle = document.getElementById('tabSplitAutoSplit');
  if (splitAutoToggle) splitAutoToggle.checked = s.tabSplitAutoSplit || false;
}

// =========================================================
// Full re-render
// =========================================================
function renderAll() {
  const container = document.getElementById('categoriesGrid');
  container.innerHTML = '';

  // Update workspace UI first (even if empty)
  updateWorkspaceUI();

  if (appData.settings.birdsEyeView && !searchQuery && !isLiveTabsActive()) {
    // Bird's-eye: render all workspaces stacked vertically
    document.body.classList.add('birdseye-active');
    document.body.classList.remove('live-tabs-active');
    container.classList.remove('categories-grid');
    container.classList.add('birdseye-container');

    const sortedWorkspaces = [...appData.workspaces].sort((a, b) => a.order - b.order);
    let totalCats = 0;
    sortedWorkspaces.forEach(ws => {
      const section = buildWorkspaceSection(ws);
      container.appendChild(section);
      totalCats += appData.categories.filter(c => c.workspaceId === ws.id).length;
    });

    document.getElementById('emptyState').hidden = totalCats > 0;
    document.getElementById('searchEmptyState').hidden = true;
  } else if (isLiveTabsActive()) {
    // Live Tabs workspace — show open browser windows
    document.body.classList.remove('birdseye-active');
    document.body.classList.add('live-tabs-active');
    container.classList.add('categories-grid');
    container.classList.remove('birdseye-container');

    const liveCats = liveTabsData?.categories || [];
    const isEmpty = liveCats.length === 0;
    document.getElementById('emptyState').hidden = !isEmpty;
    document.getElementById('searchEmptyState').hidden = true;

    if (isEmpty) return;

    liveCats.forEach(cat => {
      const card = buildLiveTabCard(cat);
      container.appendChild(card);
    });

    applySearch(searchQuery);
  } else {
    // Normal single-workspace view (or search mode)
    document.body.classList.remove('birdseye-active');
    document.body.classList.remove('live-tabs-active');
    container.classList.add('categories-grid');
    container.classList.remove('birdseye-container');

    const currentWorkspace = appData.settings.currentWorkspace;
    const allCategories = [...appData.categories];
    const filtered = searchQuery
      ? allCategories
      : allCategories.filter(cat => cat.workspaceId === currentWorkspace);

    const sorted = filtered.sort((a, b) => a.order - b.order);

    const isEmpty = sorted.length === 0;
    document.getElementById('emptyState').hidden = !isEmpty;
    document.getElementById('searchEmptyState').hidden = true;

    if (isEmpty) return;

    sorted.forEach(cat => {
      const card = cat.isLive ? buildLiveTabCard(cat) : buildCategoryCard(cat);
      container.appendChild(card);
    });

    applySearch(searchQuery);
  }
}

// =========================================================
// Bird's-Eye View helpers
// =========================================================

function buildWorkspaceSection(ws) {
  const wsCats = appData.categories
    .filter(c => c.workspaceId === ws.id)
    .sort((a, b) => a.order - b.order);

  const section = document.createElement('div');
  section.className = 'workspace-section';
  section.dataset.workspaceId = ws.id;

  const isCollapsed = (appData.settings.collapsedWorkspaces || []).includes(ws.id);
  if (isCollapsed) section.classList.add('collapsed');
  if (ws.id === appData.settings.currentWorkspace) section.classList.add('active');

  // Header
  const header = document.createElement('div');
  header.className = 'workspace-section-header';

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'workspace-section-chevron');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-width', '2');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '6 9 12 15 18 9');
  chevron.appendChild(polyline);

  const name = document.createElement('span');
  name.className = 'workspace-section-name';
  name.textContent = ws.name;

  const count = document.createElement('span');
  count.className = 'workspace-section-count';
  count.textContent = `${wsCats.length} ${wsCats.length === 1 ? 'category' : 'categories'}`;

  header.append(chevron, name, count);

  // Click header to toggle collapse
  header.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWorkspaceCollapse(ws.id);
  });

  // Click anywhere in section to set active workspace
  section.addEventListener('click', () => {
    setActiveWorkspace(ws.id);
  });

  // Grid for this workspace's categories
  const grid = document.createElement('div');
  grid.className = 'categories-grid';

  wsCats.forEach(cat => {
    const card = buildCategoryCard(cat);
    grid.appendChild(card);
  });

  section.append(header, grid);
  return section;
}

function toggleBirdsEyeView() {
  appData.settings.birdsEyeView = !appData.settings.birdsEyeView;
  document.getElementById('birdsEyeToggle').classList.toggle('active', appData.settings.birdsEyeView);
  saveAndRefresh();
}

function toggleWorkspaceCollapse(wsId) {
  const collapsed = appData.settings.collapsedWorkspaces || [];
  const idx = collapsed.indexOf(wsId);
  if (idx === -1) collapsed.push(wsId);
  else collapsed.splice(idx, 1);
  appData.settings.collapsedWorkspaces = collapsed;
  saveAndRefresh();
}

function setActiveWorkspace(wsId) {
  if (appData.settings.currentWorkspace === wsId) return;
  appData.settings.currentWorkspace = wsId;
  // Update visual indicators without full re-render
  document.querySelectorAll('.workspace-section').forEach(s => {
    s.classList.toggle('active', s.dataset.workspaceId === wsId);
  });
  updateWorkspaceUI();
  localSavePending++;
  Storage.saveData(appData, Utils.flashSaveIndicator);
}

function flashHighlightCard(catId) {
  const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
  if (!card) return;
  card.style.transition = 'box-shadow 0.3s ease';
  card.style.boxShadow = '0 0 0 3px var(--accent)';
  setTimeout(() => {
    card.style.boxShadow = '';
    setTimeout(() => { card.style.transition = ''; }, 300);
  }, 1500);
}

// =========================================================
// Save All Open Tabs to a new category
// =========================================================
async function saveAllOpenTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    alert('This feature requires the Chrome extension context.');
    return;
  }

  const tabs = await chrome.tabs.query({});
  // Filter out chrome:// and extension pages
  const validTabs = tabs.filter(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));

  if (validTabs.length === 0) {
    alert('No open tabs with valid URLs found.');
    return;
  }

  // Sort by most recently accessed first
  validTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  // Build timestamp: Tabs_YYYY-MM-DD_HH-MM-SS
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const currentWorkspace = appData.settings.currentWorkspace;
  const wsCats = appData.categories.filter(c => c.workspaceId === currentWorkspace);
  const maxOrder = wsCats.length > 0 ? Math.max(...wsCats.map(c => c.order)) + 1 : 0;

  const newCat = {
    id: Utils.generateId(),
    name: `Tabs_${timestamp}`,
    icon: '🗂️',
    order: maxOrder,
    workspaceId: currentWorkspace,
    sites: validTabs.map((tab, i) => ({
      id: Utils.generateId(),
      name: tab.title || Utils.nameFromUrl(tab.url),
      url: tab.url,
      favicon: tab.favIconUrl || '',
      order: i
    }))
  };

  Undo.saveSnapshot('Save all tabs', appData);
  appData.categories.push(newCat);
  saveAndRefresh();

  // Scroll to the new category after render
  setTimeout(() => {
    if (appData.settings.birdsEyeView) {
      const section = document.querySelector(`.workspace-section[data-workspace-id="${currentWorkspace}"]`);
      if (section) section.scrollIntoView({ behavior: 'instant', block: 'start' });
      scrollToCategoryInGrid(newCat.id);
    } else {
      scrollToCategory(newCat.id);
    }
    flashHighlightCard(newCat.id);
  }, 100);
}

// =========================================================
// Close All Tabs in All Windows
// =========================================================
async function closeAllTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.windows) {
    alert('This feature requires the Chrome extension context.');
    return;
  }

  const confirmed = await Utils.confirm(
    'Close all tabs in all windows? You may want to save your tabs first. This cannot be undone.',
    'Close All'
  );
  if (!confirmed) return;

  const currentTab = (await chrome.tabs.getCurrent());
  const currentWindowId = currentTab?.windowId;

  // Get all windows
  const allWindows = await chrome.windows.getAll({ populate: false });

  // Close every other window first
  for (const win of allWindows) {
    if (win.id !== currentWindowId) {
      await chrome.windows.remove(win.id);
    }
  }

  // In the current window, close every tab except this one
  const remainingTabs = await chrome.tabs.query({ windowId: currentWindowId });
  const tabsToClose = remainingTabs.filter(t => t.id !== currentTab.id);
  if (tabsToClose.length > 0) {
    await chrome.tabs.remove(tabsToClose.map(t => t.id));
  }

  // Ensure the surviving window is focused and in normal state
  await chrome.windows.update(currentWindowId, { focused: true, state: 'normal' });
}

// =========================================================
// Copy All Open Tabs to Clipboard (sorted by most recent)
// =========================================================
async function copyAllOpenTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    alert('This feature requires the Chrome extension context.');
    return;
  }

  const tabs = await chrome.tabs.query({});
  const validTabs = tabs.filter(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));

  if (validTabs.length === 0) {
    alert('No open tabs with valid URLs found.');
    return;
  }

  // Sort by most recently accessed first
  validTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  const pad = (n) => String(n).padStart(2, '0');
  const lines = validTabs.map(tab => {
    const d = new Date(tab.lastAccessed || 0);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const title = tab.title || '';
    return `${tab.url}\t${title}\t${stamp}`;
  });

  await navigator.clipboard.writeText(lines.join('\n'));

  // Briefly swap indicator text to "Copied!" then restore
  const indicator = document.getElementById('saveIndicator');
  const originalText = indicator ? indicator.textContent : '';
  if (indicator) indicator.textContent = 'Copied!';
  Utils.flashSaveIndicator();
  if (indicator) setTimeout(() => { indicator.textContent = originalText; }, 1500);
}

// =========================================================
// Sort browser tabs by most-recently-used
// =========================================================
async function sortTabsByRecent() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  const btn = document.getElementById('sortTabsRecentBtn');

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });

    const pinned = tabs.filter(t => t.pinned);
    const unpinned = tabs.filter(t => !t.pinned);

    if (unpinned.length <= 1) return;

    // Sort ascending by lastAccessed (oldest first = leftmost, newest = rightmost)
    unpinned.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));

    // Move each unpinned tab sequentially (indices shift as tabs move)
    const startIndex = pinned.length;
    for (let i = 0; i < unpinned.length; i++) {
      await chrome.tabs.move(unpinned[i].id, { index: startIndex + i });
    }

    // Brief visual feedback
    btn.style.color = 'var(--accent)';
    setTimeout(() => { btn.style.color = ''; }, 800);
  } catch (err) {
    console.error('Sort tabs by recent failed:', err);
  }
}

// =========================================================
// Build a category card DOM element
// =========================================================
function buildCategoryCard(cat) {
  const card = document.createElement('div');
  card.className = 'category-card';
  if (cat.id === appData.settings.quickAddInbox) {
    card.classList.add('inbox-highlight');
  }
  card.dataset.categoryId = cat.id;
  card.dataset.dragType = 'category';

  // Header
  const header = document.createElement('div');
  header.className = 'category-header';

  // Drag handle (category)
  const catHandle = document.createElement('span');
  catHandle.className = 'category-drag-handle';
  catHandle.setAttribute('data-drag-handle', '');
  catHandle.setAttribute('title', 'Drag to reorder');
  catHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="9" y1="5"  x2="9"  y2="19"/>
    <line x1="15" y1="5" x2="15" y2="19"/>
  </svg>`;

  // Icon (click to re-pick emoji)
  const iconEl = document.createElement('span');
  iconEl.className = 'category-icon';
  iconEl.textContent = cat.icon || '📁';
  iconEl.title = 'Click to change icon';
  iconEl.setAttribute('role', 'button');
  iconEl.setAttribute('tabindex', '0');
  iconEl.addEventListener('click', () => openCategoryModal(cat.id));
  iconEl.addEventListener('keydown', e => { if (e.key === 'Enter') openCategoryModal(cat.id); });

  // Title (click to edit inline)
  const titleEl = document.createElement('span');
  titleEl.className = 'category-title';
  titleEl.textContent = cat.name;
  titleEl.title = 'Click to rename';
  titleEl.setAttribute('role', 'button');
  titleEl.setAttribute('tabindex', '0');
  titleEl.addEventListener('click', () => startInlineEdit(titleEl, cat));
  titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') startInlineEdit(titleEl, cat); });

  // Workspace badge (shown during search if from different workspace)
  const workspaceBadge = document.createElement('span');
  workspaceBadge.className = 'workspace-badge';
  if (searchQuery && cat.workspaceId !== appData.settings.currentWorkspace) {
    const workspace = getWorkspaceById(cat.workspaceId);
    workspaceBadge.textContent = workspace?.name || 'Unknown';
  }
  workspaceBadge.hidden = !searchQuery || cat.workspaceId === appData.settings.currentWorkspace;

  // Count badge
  const countEl = document.createElement('span');
  countEl.className = 'category-count';
  countEl.textContent = cat.sites.length;
  countEl.hidden = !appData.settings.showSiteCount;

  // Hidden state (still driven by Settings > Category Visibility)
  const isHidden = (appData.settings.hiddenCategories || []).includes(cat.id);

  // Duplicate category button
  const duplicateBtn = document.createElement('button');
  duplicateBtn.className = 'category-menu-btn';
  duplicateBtn.title = 'Duplicate category';
  duplicateBtn.setAttribute('aria-label', `Duplicate ${cat.name}`);
  duplicateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;
  duplicateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    duplicateCategory(cat.id);
  });

  // Move to workspace button (only show if more than 1 workspace)
  const moveWorkspaceBtn = document.createElement('button');
  moveWorkspaceBtn.className = 'category-menu-btn category-workspace-btn';
  moveWorkspaceBtn.title = 'Move to workspace';
  moveWorkspaceBtn.setAttribute('aria-label', `Move ${cat.name} to workspace`);
  moveWorkspaceBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
  </svg>`;
  moveWorkspaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showWorkspaceMenu(e.currentTarget, cat.id);
  });
  moveWorkspaceBtn.hidden = appData.workspaces.length <= 1;

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'category-menu-btn';
  deleteBtn.title = 'Delete category';
  deleteBtn.setAttribute('aria-label', `Delete ${cat.name}`);
  deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>`;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteCategoryWithConfirm(cat.id);
  });

  // Per-category select-all checkbox (only in select mode)
  const catCb = document.createElement('input');
  catCb.type = 'checkbox';
  catCb.className = 'cat-select-all-cb';
  catCb.title = 'Select all in this category';
  catCb.setAttribute('aria-label', `Select all in ${cat.name}`);
  catCb.addEventListener('click', (e) => {
    e.stopPropagation();
    selectAllInCategory(cat.id);
  });

  // Expand width button (kanban mode only)
  const expandBtn = document.createElement('button');
  expandBtn.className = 'category-expand-btn';
  expandBtn.title = 'Expand column width';
  expandBtn.setAttribute('aria-label', `Expand ${cat.name} column`);
  expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="8 18 12 22 16 18"/>
    <polyline points="8 6 12 2 16 6"/>
    <line x1="12" y1="2" x2="12" y2="22"/>
    <polyline points="3 12 7 12"/>
    <polyline points="17 12 21 12"/>
  </svg>`;
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCategoryExpand(cat.id);
  });

  // Collapse toggle chevron
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'category-collapse-btn';
  collapseBtn.title = isHidden ? 'Expand category' : 'Collapse category';
  collapseBtn.setAttribute('aria-label', isHidden ? `Expand ${cat.name}` : `Collapse ${cat.name}`);
  collapseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`;
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCategoryVisibility(cat.id);
  });

  header.append(catCb, catHandle, iconEl, titleEl, workspaceBadge, expandBtn, countEl, collapseBtn, duplicateBtn, moveWorkspaceBtn, deleteBtn);

  // Go to category link (visible during search)
  const goToLink = document.createElement('button');
  goToLink.className = 'go-to-category';
  goToLink.textContent = 'Go to category →';
  goToLink.addEventListener('click', () => goToCategory(cat.id));

  // Sites list
  const sitesList = document.createElement('div');
  sitesList.className = 'sites-list';
  sitesList.dataset.categoryId = cat.id;

  const sortedSites = [...cat.sites].sort((a, b) => a.order - b.order);
  sortedSites.forEach(site => {
    // Drop indicator before each tile
    const indicator = document.createElement('div');
    indicator.className = 'site-drop-indicator';
    sitesList.appendChild(indicator);

    const tile = site.type === 'note'
      ? buildNoteTile(site, cat.id)
      : buildSiteTile(site, cat.id);
    sitesList.appendChild(tile);
  });

  // Trailing drop indicator
  const lastIndicator = document.createElement('div');
  lastIndicator.className = 'site-drop-indicator';
  sitesList.appendChild(lastIndicator);

  // Add Site button
  const addBtn = document.createElement('button');
  addBtn.className = 'add-site-btn';
  addBtn.setAttribute('aria-label', `Add site to ${cat.name}`);
  addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg> Add site`;
  addBtn.addEventListener('click', () => openSiteModal(null, cat.id));

  // Category footer with Add Site and Deduplicate
  const footer = document.createElement('div');
  footer.className = 'category-footer';

  const dedupeLink = document.createElement('button');
  dedupeLink.className = 'category-dedupe-link';
  dedupeLink.textContent = 'Deduplicate';
  dedupeLink.title = 'Remove duplicate URLs in this category';
  dedupeLink.addEventListener('click', (e) => {
    e.stopPropagation();
    deduplicateCategory(cat.id);
  });

  // Open as Tabs button
  const openTabsBtn = document.createElement('button');
  openTabsBtn.className = 'open-tabs-btn';
  openTabsBtn.setAttribute('aria-label', `Open ${cat.name} as pinned tabs`);
  openTabsBtn.title = 'Open as pinned tabs (replaces existing pinned tabs)';
  openTabsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/>
  </svg>`;
  openTabsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCategoryAsTabs(cat.id);
  });

  // Copy all URLs button
  const copyAllBtn = document.createElement('button');
  copyAllBtn.className = 'open-tabs-btn';
  copyAllBtn.setAttribute('aria-label', `Copy all URLs in ${cat.name}`);
  copyAllBtn.title = 'Copy all URLs to clipboard';
  copyAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>`;
  copyAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyAllUrlsInCategory(cat.id);
  });

  // Group the icon buttons together
  const footerIcons = document.createElement('div');
  footerIcons.className = 'category-footer-icons';
  footerIcons.append(openTabsBtn, copyAllBtn);

  footer.append(addBtn, footerIcons, dedupeLink);

  card.append(header, goToLink, sitesList, footer);

  // Apply collapsed state
  if (isHidden) {
    card.classList.add('category-collapsed');
  }

  DragDrop.makeCategoryDraggable(card, cat.id);

  return card;
}

// =========================================================
// Build a site tile DOM element
// =========================================================
function buildSiteTile(site, categoryId) {
  const key = `${categoryId}::${site.id}`;

  const tile = document.createElement('div');
  tile.className = 'site-tile';
  if (selectMode && selectedSites.has(key)) tile.classList.add('selected');
  tile.dataset.siteId = site.id;
  tile.dataset.categoryId = categoryId;
  tile.dataset.dragType = 'site';
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('role', selectMode ? 'checkbox' : 'link');
  tile.setAttribute('aria-label', site.name);
  tile.title = selectMode ? '' : site.url;

  // Click: toggle, range-select, or open in new tab
  tile.addEventListener('click', (e) => {
    if (selectMode) {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift-click: select range from anchor
        selectRange(key);
      } else {
        // Plain click or Cmd/Ctrl-click: toggle single item
        toggleSiteSelection(key, tile);
      }
      return;
    }
    if (!e.defaultPrevented) {
      window.open(site.url, '_blank', 'noopener');
    }
  });

  // Keyboard navigation
  tile.addEventListener('keydown', (e) => {
    if (selectMode) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.shiftKey) {
          selectRange(key);
        } else {
          toggleSiteSelection(key, tile);
        }
      }
      return;
    }
    if (e.key === 'Enter') window.open(site.url, '_blank', 'noopener');
    if (e.key === ' ') { e.preventDefault(); openSiteModal(site.id, categoryId); }
  });

  // Right-click context menu (only outside select mode)
  tile.addEventListener('contextmenu', (e) => {
    if (selectMode) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, site.id, categoryId);
  });

  // Checkbox (shown in select mode)
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'site-select-cb';
  cb.checked = selectedSites.has(key);
  cb.setAttribute('aria-hidden', 'true');
  cb.tabIndex = -1;
  // Clicks on checkbox are handled by the tile click above
  cb.addEventListener('click', (e) => e.stopPropagation());

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'site-drag-handle';
  handle.setAttribute('data-drag-handle', '');
  handle.title = 'Drag to reorder';
  handle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="9" y1="5"  x2="9"  y2="19"/>
    <line x1="15" y1="5" x2="15" y2="19"/>
  </svg>`;

  // Favicon
  const faviconEl = Utils.buildFaviconEl(site);

  // Name
  const nameEl = document.createElement('span');
  nameEl.className = 'site-name';
  nameEl.textContent = (site.name || '').trim() || Utils.nameFromUrl(site.url);

  tile.append(cb, handle, faviconEl, nameEl);

  // Note preview and expandable content (only if site has a note)
  const hasNote = site.note && site.note.trim();
  if (hasNote) {
    const notePreview = document.createElement('div');
    notePreview.className = 'site-note-preview';
    notePreview.innerHTML = Utils.linkifyText(site.note);
    notePreview.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return; // let links open normally
      e.stopPropagation();
      e.preventDefault();
      tile.classList.toggle('note-expanded');
    });
    tile.appendChild(notePreview);

    const noteArea = document.createElement('div');
    noteArea.className = 'site-note-content';
    noteArea.innerHTML = Utils.linkifyText(site.note);
    noteArea.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return; // let links open normally
      e.stopPropagation();
      e.preventDefault();
      tile.classList.remove('note-expanded');
    });
    tile.appendChild(noteArea);
  }

  DragDrop.makeSiteDraggable(tile, site.id, categoryId);

  return tile;
}

// =========================================================
// Build a note tile DOM element
// =========================================================
function buildNoteTile(site, categoryId) {
  const key = `${categoryId}::${site.id}`;

  const tile = document.createElement('div');
  tile.className = 'note-tile';
  if (selectMode && selectedSites.has(key)) tile.classList.add('selected');
  tile.dataset.siteId = site.id;
  tile.dataset.categoryId = categoryId;
  tile.dataset.dragType = 'site';
  tile.dataset.noteText = (site.text || '').toLowerCase();

  // Click in select mode toggles selection
  tile.addEventListener('click', (e) => {
    if (selectMode) {
      if (e.target.closest('.note-tile-btn')) return; // don't intercept action buttons
      if (e.shiftKey) {
        selectRange(key);
      } else {
        toggleNoteSelection(key, tile);
      }
    }
  });

  // Checkbox (shown in select mode)
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'note-select-cb';
  cb.checked = selectedSites.has(key);
  cb.setAttribute('aria-hidden', 'true');
  cb.tabIndex = -1;
  cb.addEventListener('click', e => e.stopPropagation());

  // Header row: icon + label + action buttons
  const header = document.createElement('div');
  header.className = 'note-tile-header';

  // Drag handle (mirrors site tile handle)
  const handle = document.createElement('span');
  handle.className = 'site-drag-handle';
  handle.setAttribute('data-drag-handle', '');
  handle.title = 'Drag to reorder';
  handle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="9" y1="5"  x2="9"  y2="19"/>
    <line x1="15" y1="5" x2="15" y2="19"/>
  </svg>`;

  const iconEl = document.createElement('span');
  iconEl.className = 'note-tile-icon';
  iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>`;

  const labelEl = document.createElement('span');
  labelEl.className = 'note-tile-label';
  labelEl.textContent = site.name || '';

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'note-tile-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'note-tile-btn';
  editBtn.title = 'Edit note';
  editBtn.setAttribute('aria-label', 'Edit note');
  editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSiteModal(site.id, categoryId);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'note-tile-btn note-tile-btn--danger';
  delBtn.title = 'Delete note';
  delBtn.setAttribute('aria-label', 'Delete note');
  delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>`;
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSiteWithConfirm(site.id, categoryId);
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'note-tile-btn';
  copyBtn.title = 'Copy note text';
  copyBtn.setAttribute('aria-label', 'Copy note text');
  copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(site.text || '').then(() => {
      const el = document.getElementById('saveIndicator');
      if (el) {
        el.textContent = 'Note copied';
        el.hidden = false;
        el.classList.add('show');
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => {
          el.classList.remove('show');
          setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
        }, 1200);
      }
    }).catch(console.error);
  });

  actions.append(copyBtn, editBtn, delBtn);
  header.append(cb, handle, iconEl, labelEl, actions);

  // Note text
  const textEl = document.createElement('div');
  textEl.className = 'note-tile-text';
  textEl.innerHTML = Utils.linkifyText(site.text || '');

  tile.append(header, textEl);

  DragDrop.makeSiteDraggable(tile, site.id, categoryId);

  return tile;
}

function toggleNoteSelection(key, tile) {
  if (selectedSites.has(key)) {
    selectedSites.delete(key);
    tile.classList.remove('selected');
    tile.querySelector('.note-select-cb').checked = false;
  } else {
    selectedSites.add(key);
    tile.classList.add('selected');
    tile.querySelector('.note-select-cb').checked = true;
  }
  anchorKey = key;
  updateSelectionToolbar();
}

// Toggle a single site's selection state and move the anchor to it
function toggleSiteSelection(key, tile) {
  if (selectedSites.has(key)) {
    selectedSites.delete(key);
    tile.classList.remove('selected');
    tile.querySelector('.site-select-cb').checked = false;
  } else {
    selectedSites.add(key);
    tile.classList.add('selected');
    tile.querySelector('.site-select-cb').checked = true;
  }
  anchorKey = key;
  updateSelectionToolbar();
}

// Select a range within a category from anchorKey to targetKey (inclusive).
// Clears any existing within-category selection first; additive selections
// from other categories are preserved.
function selectRange(targetKey) {
  const [targetCatId, targetSiteId] = targetKey.split('::');
  const cat = getCatById(targetCatId);
  if (!cat) return;

  // If no anchor yet, just select the target tile and set it as anchor
  if (!anchorKey) {
    anchorKey = targetKey;
    selectedSites.add(targetKey);
    syncTileSelection(targetCatId);
    updateSelectionToolbar();
    return;
  }

  const [anchorCatId] = anchorKey.split('::');

  // If anchor is in a different category, treat target as a fresh anchor
  if (anchorCatId !== targetCatId) {
    anchorKey = targetKey;
    selectedSites.add(targetKey);
    syncTileSelection(targetCatId);
    updateSelectionToolbar();
    return;
  }

  // Same category — find indices in sorted order
  const sorted = [...cat.sites].sort((a, b) => a.order - b.order);
  const anchorSiteId = anchorKey.split('::')[1];
  const anchorIdx = sorted.findIndex(s => s.id === anchorSiteId);
  const targetIdx = sorted.findIndex(s => s.id === targetSiteId);
  if (anchorIdx === -1 || targetIdx === -1) return;

  const lo = Math.min(anchorIdx, targetIdx);
  const hi = Math.max(anchorIdx, targetIdx);

  // Clear current within-category selection, keep other categories
  cat.sites.forEach(s => selectedSites.delete(`${targetCatId}::${s.id}`));

  // Select the range
  for (let i = lo; i <= hi; i++) {
    selectedSites.add(`${targetCatId}::${sorted[i].id}`);
  }

  // Anchor stays fixed — only the endpoint moves
  syncTileSelection(targetCatId);
  updateSelectionToolbar();
}

// Sync DOM tile checked/selected state for all tiles in a category
function syncTileSelection(catId) {
  document.querySelectorAll(`.site-tile[data-category-id="${catId}"], .note-tile[data-category-id="${catId}"]`).forEach(tile => {
    const key = `${catId}::${tile.dataset.siteId}`;
    const on = selectedSites.has(key);
    tile.classList.toggle('selected', on);
    const cb = tile.querySelector('.site-select-cb, .note-select-cb');
    if (cb) cb.checked = on;
  });
}

// =========================================================
// Inline category title editing
// =========================================================
function startInlineEdit(titleEl, cat) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'category-title-input';
  input.value = cat.name;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim();
    if (newName && newName !== cat.name) {
      Undo.saveSnapshot('Rename category', appData);
      cat.name = newName;
      saveAndRefresh();
    } else{
      // Restore title element without changes
      const restored = document.createElement('span');
      restored.className = 'category-title';
      restored.textContent = cat.name;
      restored.title = 'Click to rename';
      restored.setAttribute('role', 'button');
      restored.setAttribute('tabindex', '0');
      restored.addEventListener('click', () => startInlineEdit(restored, cat));
      restored.addEventListener('keydown', e => { if (e.key === 'Enter') startInlineEdit(restored, cat); });
      input.replaceWith(restored);
    }
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = cat.name; input.blur(); }
  });
}

// =========================================================
// Search
// =========================================================
function applySearch(query) {
  const previousQuery = searchQuery;
  searchQuery = query;
  const q = query.toLowerCase().trim();

  // If transitioning between search/no-search, re-render to show/hide workspaces
  const wasSearching = !!previousQuery;
  const isSearching = !!q;
  if (wasSearching !== isSearching) {
    renderAll();
    return;
  }

  // Add/remove class to disable drag-and-drop during search
  document.body.classList.toggle('search-active', !!q);

  const cards = document.querySelectorAll('.category-card');
  let totalVisible = 0;

  cards.forEach(card => {
    const catId = card.dataset.categoryId;
    const cat = getCatById(catId);
    if (!cat) return;

    if (!q) {
      // Reset
      card.classList.remove('search-hidden');
      // Reset each tile's name using its site ID (not array index!)
      card.querySelectorAll('.site-tile, .note-tile').forEach(tile => {
        const siteId = tile.dataset.siteId;
        const site = getSiteById(catId, siteId);
        if (!site) return;

        tile.style.display = '';
        const nameEl = tile.querySelector('.site-name');
        if (nameEl && site.type !== 'note') {
          nameEl.innerHTML = Utils.escapeHtml(site.name || Utils.nameFromUrl(site.url));
        }
        // Remove position indicator
        const posIndicator = tile.querySelector('.search-position');
        if (posIndicator) posIndicator.remove();
        // Remove note match badge
        const noteBadge = tile.querySelector('.note-match-badge');
        if (noteBadge) noteBadge.remove();
      });
      // Reset category title highlight
      const titleEl = card.querySelector('.category-title');
      if (titleEl) titleEl.textContent = cat.name;
      // Reset count to total
      const countBadge = card.querySelector('.category-count');
      if (countBadge) countBadge.textContent = cat.sites.length;
      totalVisible++;
      return;
    }

    // Check if category name matches
    const catNameMatch = (cat.name || '').toLowerCase().includes(q);
    const titleEl = card.querySelector('.category-title');
    if (titleEl) {
      titleEl.innerHTML = catNameMatch ? Utils.highlightText(cat.name, query) : Utils.escapeHtml(cat.name);
    }

    // Match sites and notes (item filtering)
    // If category name matches, show all items in the category
    let siteMatchCount = 0;
    card.querySelectorAll('.site-tile, .note-tile').forEach(tile => {
      const siteId = tile.dataset.siteId;
      const site = getSiteById(catId, siteId);
      if (!site) {
        tile.style.display = 'none'; // Hide orphaned tiles
        return;
      }

      let match = false;
      if (site.type === 'note') {
        match = catNameMatch || (site.name || '').toLowerCase().includes(q) ||
                (site.text || '').toLowerCase().includes(q);
        tile.style.display = match ? '' : 'none';
      } else {
        const nameMatch = (site.name || '').toLowerCase().includes(q);
        const urlMatch  = (site.url  || '').toLowerCase().includes(q);
        const noteMatch = (site.note || '').toLowerCase().includes(q);
        match = catNameMatch || nameMatch || urlMatch || noteMatch;
        const onlyNoteMatch = noteMatch && !nameMatch && !urlMatch;

        tile.style.display = match ? '' : 'none';
        const nameEl = tile.querySelector('.site-name');
        if (nameEl) {
          // Always work from the original site data, not from existing DOM content
          if (match) {
            nameEl.innerHTML = Utils.highlightText(site.name || Utils.nameFromUrl(site.url), query);
          } else {
            nameEl.innerHTML = Utils.escapeHtml(site.name || Utils.nameFromUrl(site.url));
          }
        }

        // Add "Note" badge if only the note matched
        let noteBadge = tile.querySelector('.note-match-badge');
        if (onlyNoteMatch) {
          if (!noteBadge) {
            noteBadge = document.createElement('span');
            noteBadge.className = 'note-match-badge';
            noteBadge.textContent = 'Note';
            tile.appendChild(noteBadge);
          }
        } else {
          if (noteBadge) noteBadge.remove();
        }
      }

      // Show/hide position indicator during search
      if (match) {
        siteMatchCount++;
        // Add position indicator (position = order + 1 for human-readable numbering)
        let posIndicator = tile.querySelector('.search-position');
        if (!posIndicator) {
          posIndicator = document.createElement('span');
          posIndicator.className = 'search-position';
          tile.appendChild(posIndicator);
        }
        posIndicator.textContent = `#${site.order + 1}`;
      } else {
        // Remove position indicator if present
        const posIndicator = tile.querySelector('.search-position');
        if (posIndicator) posIndicator.remove();
      }
    });

    // Show category if its name matches or it has matching items
    const show = catNameMatch || siteMatchCount > 0;
    card.classList.toggle('search-hidden', !show);
    if (show) {
      totalVisible++;
      // Update count badge to show "matching/total"
      const countBadge = card.querySelector('.category-count');
      if (countBadge) {
        countBadge.textContent = `${siteMatchCount}/${cat.sites.length}`;
      }
      // In kanban mode, scroll to top so matching items are visible
      const sitesList = card.querySelector('.sites-list');
      if (sitesList && q) {
        sitesList.scrollTop = 0;
      }
    }
  });

  // Empty state
  document.getElementById('searchEmptyState').hidden = !(q && totalVisible === 0);
  document.getElementById('emptyState').hidden = true;
}

// =========================================================
// Context Menu
// =========================================================
function showContextMenu(x, y, siteId, catId) {
  contextSiteId = siteId;
  contextCatId  = catId;

  const menu = document.getElementById('contextMenu');
  menu.hidden = false;

  const site = getSiteById(catId, siteId);
  const isLive = !!(site && site.tabId);

  // Toggle visibility of live-only vs regular-only items
  menu.querySelectorAll('[data-action="switch-to-tab"], [data-action="close-tab"]').forEach(el => {
    el.style.display = isLive ? '' : 'none';
  });
  menu.querySelectorAll('[data-action="edit"], [data-action="refresh-favicon"], [data-action="fetch-description"], [data-action="move"], [data-action="copy"], [data-action="move-to-top"], [data-action="move-to-bottom"], [data-action="delete"]').forEach(el => {
    el.style.display = isLive ? 'none' : '';
  });

  // Hide "Fetch description" for note-type items
  const fetchDescItem = menu.querySelector('[data-action="fetch-description"]');
  if (fetchDescItem && !isLive) {
    fetchDescItem.style.display = (site && site.type === 'note') ? 'none' : '';
  }

  // Position smartly within viewport
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  menu.style.left = '0';
  menu.style.top  = '0';
  menu.hidden = false;

  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = Math.min(x, vpW - mw - 8) + 'px';
  menu.style.top  = Math.min(y, vpH - mh - 8) + 'px';
}

function hideContextMenu() {
  document.getElementById('contextMenu').hidden = true;
  document.getElementById('moveMenu').hidden = true;
}

// =========================================================
// Move-to-category submenu (shared helper + context menu + select menu)
// =========================================================

/**
 * Returns categories sorted by workspace order, then category order.
 * Each entry gets a `workspaceName` property.
 * @param {string|null} excludeCatId — category to omit (e.g. current category)
 */
function getSortedCategoriesWithWorkspace(excludeCatId) {
  const multipleWorkspaces = appData.workspaces.length > 1;
  const wsOrder = new Map(appData.workspaces.map((w, i) => [w.id, i]));

  return appData.categories
    .filter(c => c.id !== excludeCatId)
    .map(c => {
      const ws = getWorkspaceById(c.workspaceId);
      return {
        ...c,
        workspaceName: ws?.name || 'Unknown',
        wsOrder: wsOrder.get(c.workspaceId) ?? 999
      };
    })
    .sort((a, b) => a.wsOrder - b.wsOrder || a.order - b.order)
    .map(c => ({
      cat: c,
      label: multipleWorkspaces ? `${c.workspaceName} → ${c.icon} ${c.name}` : `${c.icon} ${c.name}`
    }));
}

/**
 * Populate a menu element with workspace-grouped category rows
 * featuring Top/Bottom buttons, plus "New category" options.
 * @param {HTMLElement} menu — the menu container to populate
 * @param {Function} onSelect — callback(catId, position) when a category is chosen
 * @param {Function} onNewCategory — callback(position) when "New category" is chosen
 * @param {string|null} excludeCatId — category id to exclude from the list
 */
function buildMoveMenuContent(menu, onSelect, onNewCategory, excludeCatId) {
  menu.innerHTML = '';

  // Move / Copy radio toggle
  let mode = 'move';
  const toggleBar = document.createElement('div');
  toggleBar.className = 'move-menu-mode-toggle';

  const moveLabel = document.createElement('label');
  moveLabel.className = 'move-menu-mode-label';
  const moveRadio = document.createElement('input');
  moveRadio.type = 'radio';
  moveRadio.name = 'moveMode_' + (excludeCatId || 'sel');
  moveRadio.value = 'move';
  moveRadio.checked = true;
  moveRadio.addEventListener('change', () => { mode = 'move'; });
  moveLabel.append(moveRadio, ' Move');

  const copyLabel = document.createElement('label');
  copyLabel.className = 'move-menu-mode-label';
  const copyRadio = document.createElement('input');
  copyRadio.type = 'radio';
  copyRadio.name = 'moveMode_' + (excludeCatId || 'sel');
  copyRadio.value = 'copy';
  copyRadio.addEventListener('change', () => { mode = 'copy'; });
  copyLabel.append(copyRadio, ' Copy');

  toggleBar.append(moveLabel, copyLabel);
  menu.appendChild(toggleBar);

  const entries = getSortedCategoriesWithWorkspace(excludeCatId);

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'context-item';
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'No other categories';
    menu.appendChild(empty);
  } else {
    // Track workspace headers for grouping
    const multipleWorkspaces = appData.workspaces.length > 1;
    let lastWsName = null;

    entries.forEach(({ cat, label }) => {
      // Workspace group header
      if (multipleWorkspaces && cat.workspaceName !== lastWsName) {
        lastWsName = cat.workspaceName;
        if (menu.children.length > 0) {
          const div = document.createElement('div');
          div.className = 'context-divider';
          menu.appendChild(div);
        }
        const header = document.createElement('div');
        header.className = 'move-menu-ws-header';
        header.textContent = cat.workspaceName;
        menu.appendChild(header);
      }

      const row = document.createElement('div');
      row.className = 'move-menu-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'move-menu-cat-label';
      labelEl.textContent = `${cat.icon} ${cat.name}`;

      const btnGroup = document.createElement('div');
      btnGroup.className = 'move-menu-pos-btns';

      const topBtn = document.createElement('button');
      topBtn.className = 'move-menu-pos-btn';
      topBtn.title = 'Place at top of category';
      topBtn.textContent = '↑ Top';
      topBtn.addEventListener('click', () => onSelect(cat.id, 'top', mode));

      const botBtn = document.createElement('button');
      botBtn.className = 'move-menu-pos-btn';
      botBtn.title = 'Place at bottom of category';
      botBtn.textContent = '↓ Bottom';
      botBtn.addEventListener('click', () => onSelect(cat.id, 'bottom', mode));

      btnGroup.append(topBtn, botBtn);
      row.append(labelEl, btnGroup);
      menu.appendChild(row);
    });
  }

  // Divider + New category options
  const div = document.createElement('div');
  div.className = 'context-divider';
  menu.appendChild(div);

  const newTopBtn = document.createElement('button');
  newTopBtn.className = 'context-item';
  newTopBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg> New category at top\u2026`;
  newTopBtn.addEventListener('click', () => onNewCategory('top', mode));
  menu.appendChild(newTopBtn);

  const newBotBtn = document.createElement('button');
  newBotBtn.className = 'context-item';
  newBotBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg> New category at bottom\u2026`;
  newBotBtn.addEventListener('click', () => onNewCategory('bottom', mode));
  menu.appendChild(newBotBtn);
}

function showMoveMenu(anchorEl) {
  const menu = document.getElementById('moveMenu');
  const siteId = contextSiteId;
  const fromCatId = contextCatId;

  buildMoveMenuContent(
    menu,
    (catId, position, mode) => {
      hideContextMenu();
      if (mode === 'copy') {
        copySiteToCategory(siteId, fromCatId, catId, position);
      } else {
        moveSiteToCategory(siteId, fromCatId, catId, position);
      }
    },
    (position, modeVal) => {
      hideContextMenu();
      pendingContextMoveAfterCreate = true;
      pendingMovePosition = position;
      pendingMoveMode = modeVal;
      openCategoryModal(null);
    },
    fromCatId
  );

  // Position relative to the "Move to category" menu item
  const rect = anchorEl.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  menu.hidden = false;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;

  // Show to the right, or left if no room
  const left = rect.right + 4 + mw > vpW ? rect.left - mw - 4 : rect.right + 4;
  menu.style.left = left + 'px';

  // Position vertically: align with menu item top, but clamp to viewport
  const top = Math.min(rect.top, vpH - mh - 8);
  menu.style.top  = Math.max(8, top) + 'px';
}

function showCopyMenu(anchorEl) {
  const menu = document.getElementById('moveMenu');
  const siteId = contextSiteId;
  const fromCatId = contextCatId;

  // Build menu without the move/copy radio — always copy
  const savedBuild = buildMoveMenuContent;
  buildMoveMenuContent(
    menu,
    (catId, position) => {
      hideContextMenu();
      copySiteToCategory(siteId, fromCatId, catId, position);
    },
    (position) => {
      hideContextMenu();
      pendingContextMoveAfterCreate = true;
      pendingMovePosition = position;
      pendingMoveMode = 'copy';
      openCategoryModal(null);
    },
    fromCatId
  );

  // Remove the move/copy radio toggle — this menu is always copy
  const toggle = menu.querySelector('.move-menu-mode-toggle');
  if (toggle) toggle.remove();

  // Position relative to the "Copy to category" menu item
  const rect = anchorEl.getBoundingClientRect();
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  menu.hidden = false;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;

  const left = rect.right + 4 + mw > vpW ? rect.left - mw - 4 : rect.right + 4;
  menu.style.left = left + 'px';

  const top = Math.min(rect.top, vpH - mh - 8);
  menu.style.top  = Math.max(8, top) + 'px';
}

// =========================================================
// Modals
// =========================================================

// --- Site Modal ---
function openSiteModal(siteId, catId) {
  editingSiteId = siteId;
  editingCatId  = catId;

  const title        = document.getElementById('siteModalTitle');
  const urlInput     = document.getElementById('siteUrl');
  const nameInput    = document.getElementById('siteName');
  const faviconInput = document.getElementById('siteFavicon');
  const siteNoteInput = document.getElementById('siteNote');
  const catSelect    = document.getElementById('siteCategorySelect');
  const urlError     = document.getElementById('siteUrlError');
  const nameGroup    = document.getElementById('siteNameGroup');
  const faviconGroup = document.getElementById('siteFaviconGroup');
  const typeToggle   = document.getElementById('siteTypeToggle');
  const urlFields    = document.getElementById('siteUrlFields');
  const noteFields   = document.getElementById('siteNoteFields');
  const noteText     = document.getElementById('noteText');
  const noteLabel    = document.getElementById('noteLabel');
  const noteError    = document.getElementById('noteTextError');
  const savBtn       = document.getElementById('saveSiteBtn');

  // Reset errors
  urlInput.classList.remove('error');
  urlError.hidden = true;
  noteText.classList.remove('error');
  noteError.hidden = true;
  nameGroup.hidden = false;
  faviconGroup.hidden = false;

  // Populate category dropdown
  catSelect.innerHTML = '';
  [...appData.categories].sort((a, b) => a.order - b.order).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.icon} ${cat.name}`;
    if (cat.id === catId) opt.selected = true;
    catSelect.appendChild(opt);
  });

  if (siteId) {
    const site = getSiteById(catId, siteId);
    if (site?.type === 'note') {
      // Edit note
      title.textContent = 'Edit Note';
      savBtn.textContent = 'Save Note';
      typeToggle.hidden = true;
      urlFields.hidden = true;
      noteFields.hidden = false;
      noteLabel.value = site.name || '';
      noteText.value  = site.text || '';
      openModal('siteModal');
      noteText.focus();
    } else {
      // Edit URL site
      title.textContent = 'Edit Site';
      savBtn.textContent = 'Save Site';
      typeToggle.hidden = true;
      urlFields.hidden = false;
      noteFields.hidden = true;
      if (site) {
        urlInput.value     = site.url;
        nameInput.value    = site.name;
        faviconInput.value = site.favicon || '';
        siteNoteInput.value = site.note || '';
        updateFaviconPreview(site.favicon || '');
      }
      urlInput.rows = 1;
      openModal('siteModal');
      urlInput.focus();
    }
  } else {
    // Add mode — show type toggle, default to URL
    title.textContent = 'Add Site';
    savBtn.textContent = 'Save Site';
    typeToggle.hidden = false;
    urlFields.hidden = false;
    noteFields.hidden = true;
    urlInput.value     = '';
    nameInput.value    = '';
    faviconInput.value = '';
    siteNoteInput.value = '';
    noteText.value     = '';
    noteLabel.value    = '';
    updateFaviconPreview('');
    urlInput.rows = 3;
    // Reset toggle buttons to URL active
    document.getElementById('typeUrlBtn').classList.add('active');
    document.getElementById('typeNoteBtn').classList.remove('active');
    openModal('siteModal');
    urlInput.focus();
  }
}

function closeSiteModal() {
  closeModal('siteModal');
  editingSiteId = null;
  editingCatId  = null;
  // Reset favicon picker state
  const grid = document.getElementById('faviconPickerGrid');
  if (grid) {
    grid.hidden = true;
    grid.querySelectorAll('.favicon-picker-item.selected').forEach(el => el.classList.remove('selected'));
  }
  const toggle = document.getElementById('faviconPickerToggle');
  if (toggle) toggle.textContent = 'Stock icons';
}

function updateFaviconPreview(src) {
  const preview = document.getElementById('faviconPreview');
  if (!preview) return;
  if (src) {
    preview.src = src;
    preview.hidden = false;
    preview.onerror = () => { preview.hidden = true; };
  } else {
    preview.hidden = true;
    preview.src = '';
  }
}

async function saveSite() {
  const urlInput     = document.getElementById('siteUrl');
  const nameInput    = document.getElementById('siteName');
  const faviconInput = document.getElementById('siteFavicon');
  const siteNoteInput = document.getElementById('siteNote');
  const catSelect    = document.getElementById('siteCategorySelect');
  const urlError     = document.getElementById('siteUrlError');
  const nameGroup    = document.getElementById('siteNameGroup');
  const faviconGroup = document.getElementById('siteFaviconGroup');
  const noteFields   = document.getElementById('siteNoteFields');
  const noteTextEl   = document.getElementById('noteText');
  const noteLabelEl  = document.getElementById('noteLabel');
  const noteError    = document.getElementById('noteTextError');

  const targetCatId = catSelect.value;
  const isNoteMode  = !noteFields.hidden;

  // ---- Save note ----
  if (isNoteMode) {
    const text  = noteTextEl.value.trim();
    const label = noteLabelEl.value.trim();

    if (!text) {
      noteTextEl.classList.add('error');
      noteError.hidden = false;
      noteTextEl.focus();
      return;
    }
    noteTextEl.classList.remove('error');
    noteError.hidden = true;

    if (editingSiteId) {
      // Update existing note
      const origCat = getCatById(editingCatId);
      const site = origCat?.sites.find(s => s.id === editingSiteId);
      if (site) {
        site.name = label;
        site.text = text;
        site.type = 'note';

        // Handle category move if needed
        const newCat = getCatById(targetCatId);
        if (origCat && newCat && origCat.id !== newCat.id) {
          origCat.sites = origCat.sites.filter(s => s.id !== editingSiteId);
          site.order = newCat.sites.length;
          newCat.sites.push(site);
          reindexSites(origCat);
        }
      }
    } else {
      const cat = getCatById(targetCatId);
      if (cat) {
        cat.sites.push({
          id:    Utils.generateId(),
          type:  'note',
          name:  label,
          text,
          url:   '',
          favicon: '',
          order: cat.sites.length
        });
      }
    }
    closeSiteModal();
    saveAndRefresh();
    return;
  }

  const rawValue = urlInput.value;

  // Split into lines; filter blanks
  const lines = rawValue.split('\n').map(l => l.trim()).filter(Boolean);

  // ---- Bulk add (multiple lines, only in add mode) ----
  if (!editingSiteId && lines.length > 1) {
    const cat = getCatById(targetCatId);
    if (!cat) return;

    const validUrls = [];
    const invalidLines = [];
    lines.forEach(line => {
      const url = Utils.normaliseUrl(line);
      if (Utils.isValidUrl(url)) {
        validUrls.push(url);
      } else {
        invalidLines.push(line);
      }
    });

    if (validUrls.length === 0) {
      urlInput.classList.add('error');
      urlError.hidden = false;
      urlInput.focus();
      return;
    }

    urlInput.classList.remove('error');
    urlError.hidden = true;

    // Add sites immediately with empty favicons, then fetch in background
    const newSites = validUrls.map(url => {
      const site = {
        id:      Utils.generateId(),
        name:    Utils.nameFromUrl(url),
        url,
        favicon: '',
        note:    '',
        order:   cat.sites.length
      };
      cat.sites.push(site);
      return site;
    });

    closeSiteModal();
    saveAndRefresh();

    // Fetch favicons in parallel (non-blocking)
    const results = await Promise.allSettled(
      newSites.map(async (site) => {
        const fav = await Utils.fetchFavicon(site.url);
        if (fav) site.favicon = fav;
      })
    );
    // Re-save if any favicons were fetched
    if (newSites.some(s => s.favicon)) saveAndRefresh();

    // Warn about any lines that couldn't be parsed (non-blocking)
    if (invalidLines.length > 0) {
      const skipped = invalidLines.map(l => `• ${l}`).join('\n');
      alert(`Added ${validUrls.length} site(s).\n\nSkipped ${invalidLines.length} invalid line(s):\n${skipped}`);
    }
    return;
  }

  // ---- Single add / edit ----
  const rawUrl = lines[0] || '';
  const url    = Utils.normaliseUrl(rawUrl);

  if (!url || !Utils.isValidUrl(url)) {
    urlInput.classList.add('error');
    urlError.hidden = false;
    urlInput.focus();
    return;
  }
  urlInput.classList.remove('error');
  urlError.hidden = true;

  const name    = (nameInput.value || '').trim() || Utils.nameFromUrl(url);
  let   favicon = (faviconInput.value || '').trim();
  const note    = (siteNoteInput.value || '').trim();

  // Auto-fetch favicon if none provided
  const needsFaviconFetch = !favicon;
  let siteRef = null;

  if (editingSiteId) {
    // Update existing
    const origCat = getCatById(editingCatId);
    const site = origCat?.sites.find(s => s.id === editingSiteId);
    if (site) {
      const urlChanged = site.url !== url;
      site.url = url;
      site.name = name;
      site.favicon = favicon;
      site.note = note;

      // Only re-fetch favicon on edit if URL changed and no custom favicon
      if (urlChanged && needsFaviconFetch) siteRef = site;

      // Handle category move if needed
      const newCat = getCatById(targetCatId);
      if (origCat && newCat && origCat.id !== newCat.id) {
        origCat.sites = origCat.sites.filter(s => s.id !== editingSiteId);
        site.order = newCat.sites.length;
        newCat.sites.push(site);
        reindexSites(origCat);
      }
    }
  } else {
    // Create single new site
    const cat = getCatById(targetCatId);
    if (cat) {
      const site = {
        id:      Utils.generateId(),
        name,
        url,
        favicon,
        note,
        order:   cat.sites.length
      };
      cat.sites.push(site);
      if (needsFaviconFetch) siteRef = site;
    }
  }

  closeSiteModal();
  saveAndRefresh();

  // Fetch favicon in background after modal closes
  if (siteRef) {
    const fav = await Utils.fetchFavicon(siteRef.url);
    if (fav) {
      siteRef.favicon = fav;
      saveAndRefresh();
    }
  }
}

// --- Category Modal ---
const EMOJIS = [
  '📁','🗂️','🛠️','💼','🏠','⭐','🔖','📌','🎯','💡',
  '📚','🎓','🏋️','🎮','🎵','🎨','📷','✈️','🍕','☕',
  '💰','📈','🔧','🔬','🌐','👋','🚀','💻','📱','🛒',
  '🏥','🎬','📧','🔐','🌟','❤️','🌱','🐾','🎁','⚡'
];

function openCategoryModal(catId) {
  editingCategoryId = catId || null;

  const modal  = document.getElementById('categoryModal');
  const title  = document.getElementById('categoryModalTitle');
  const nameInput  = document.getElementById('categoryName');
  const nameError  = document.getElementById('categoryNameError');
  const emojiBtn   = document.getElementById('selectedEmoji');
  const emojiGrid  = document.getElementById('emojiGrid');

  // Build emoji grid if empty
  if (emojiGrid.children.length === 0) {
    EMOJIS.forEach(em => {
      const btn = document.createElement('button');
      btn.className = 'emoji-option';
      btn.textContent = em;
      btn.addEventListener('click', () => {
        emojiBtn.textContent = em;
        emojiGrid.querySelectorAll('.emoji-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        emojiGrid.classList.remove('open');
      });
      emojiGrid.appendChild(btn);
    });
  }

  // Toggle emoji grid
  emojiBtn.onclick = (e) => {
    e.stopPropagation();
    emojiGrid.classList.toggle('open');
  };

  nameError.hidden = true;
  nameInput.classList.remove('error');

  if (catId) {
    // Edit mode
    title.textContent = 'Edit Category';
    const cat = getCatById(catId);
    if (cat) {
      nameInput.value = cat.name;
      emojiBtn.textContent = cat.icon || '📁';
    }
  } else {
    // Add mode
    title.textContent = 'Add Category';
    nameInput.value = '';
    emojiBtn.textContent = '📁';
  }

  openModal('categoryModal');
  nameInput.focus();
}

function closeCategoryModal() {
  closeModal('categoryModal');
  document.getElementById('emojiGrid').classList.remove('open');
  editingCategoryId = null;

  // If we were creating a category from the picker and user cancelled, restore picker modal
  if (pendingPickerAddAfterCreate) {
    document.getElementById('pickerModal').style.display = '';
  }

  pendingMoveAfterCreate = false;
  pendingContextMoveAfterCreate = false;
  pendingPickerAddAfterCreate = false;
  pendingMovePosition = 'bottom';
  pendingMoveMode = 'move';
}

function saveCategory() {
  const nameInput = document.getElementById('categoryName');
  const emojiBtn  = document.getElementById('selectedEmoji');
  const nameError = document.getElementById('categoryNameError');

  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.add('error');
    nameError.hidden = false;
    nameInput.focus();
    return;
  }
  nameInput.classList.remove('error');
  nameError.hidden = true;

  const icon = emojiBtn.textContent || '📁';

  if (editingCategoryId) {
    // Update
    const cat = getCatById(editingCategoryId);
    if (cat) { cat.name = name; cat.icon = icon; }
    closeCategoryModal();
    saveAndRefresh();
  } else {
    // Create
    const newCat = {
      id:    Utils.generateId(),
      name,
      icon,
      order: 0,
      workspaceId: appData.settings.currentWorkspace,
      sites: []
    };

    if (pendingMovePosition === 'top') {
      // Insert at position 0 — shift all existing categories down
      appData.categories.unshift(newCat);
    } else {
      // Append at end
      appData.categories.push(newCat);
    }
    reindexCategories();

    // If triggered from "Move to new category" (select mode), move selected sites in
    if (pendingMoveAfterCreate) {
      const pos = pendingMovePosition;
      const isCopy = pendingMoveMode === 'copy';
      pendingMoveAfterCreate = false;
      pendingMovePosition = 'bottom';
      pendingMoveMode = 'move';
      if (isCopy) {
        copySelectedTo(newCat.id, pos);
      } else {
        moveSelectedTo(newCat.id, pos);
      }
      closeCategoryModal();
      // moveSelectedTo/copySelectedTo calls exitSelectMode + saveAndRefresh
    } else if (pendingContextMoveAfterCreate) {
      // Single-site move/copy from context menu → new category
      const pos = pendingMovePosition;
      const isCopy = pendingMoveMode === 'copy';
      const siteId = contextSiteId;
      const fromCatId = contextCatId;
      pendingContextMoveAfterCreate = false;
      pendingMovePosition = 'bottom';
      pendingMoveMode = 'move';
      closeCategoryModal();
      if (siteId && fromCatId) {
        if (isCopy) {
          copySiteToCategory(siteId, fromCatId, newCat.id, pos);
        } else {
          moveSiteToCategory(siteId, fromCatId, newCat.id, pos);
        }
      } else {
        saveAndRefresh();
      }
    } else if (pendingPickerAddAfterCreate) {
      // If triggered from picker "Add to new category", add picker items
      const pos = pendingMovePosition;
      // Reset flags before closing modal to prevent picker from being restored
      const wasPendingPickerAdd = true;
      pendingPickerAddAfterCreate = false;
      pendingMovePosition = 'bottom';
      closeCategoryModal();
      addPickerItemsToCategory(newCat.id, pos);
      // Will call saveAndRefresh
    } else {
      closeCategoryModal();
      saveAndRefresh();
    }
  }
}

// =========================================================
// Delete operations
// =========================================================
async function deleteCategoryWithConfirm(catId) {
  const cat = getCatById(catId);
  if (!cat) return;
  const msg = cat.sites.length > 0
    ? `Delete "${cat.name}" and its ${cat.sites.length} site(s)?`
    : `Delete category "${cat.name}"?`;
  const ok = await Utils.confirm(msg);
  if (!ok) return;

  Undo.saveSnapshot('Delete category', appData);
  const idx = appData.categories.indexOf(cat);
  appData.categories.splice(idx, 1);

  // Remove from hidden list if present
  const hiddenIdx = (appData.settings.hiddenCategories || []).indexOf(catId);
  if (hiddenIdx !== -1) appData.settings.hiddenCategories.splice(hiddenIdx, 1);

  saveAndRefresh();
}

async function openCategoryAsTabs(catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  // Collect up to 12 URLs (skip notes and items without URLs)
  const urls = cat.sites
    .filter(s => s.url && s.type !== 'note')
    .slice(0, 12)
    .map(s => s.url);
  if (urls.length === 0) return;

  const currentWindow = await chrome.windows.getCurrent();
  const windowKey = `pinnedCat_${currentWindow.id}`;

  // Check if same category was last pinned in this window
  const stored = await chrome.storage.session.get(windowKey);
  const pinnedTabs = await chrome.tabs.query({ pinned: true, currentWindow: true });

  if (stored[windowKey] === catId && pinnedTabs.length > 0) {
    await chrome.tabs.remove(pinnedTabs.map(t => t.id));
    await chrome.storage.session.remove(windowKey);
    return;
  }

  // Remove all existing pinned tabs in this window
  if (pinnedTabs.length > 0) {
    await chrome.tabs.remove(pinnedTabs.map(t => t.id));
  }

  // Open each URL as a pinned tab at the far left, in order
  for (let i = 0; i < urls.length; i++) {
    const tab = await chrome.tabs.create({ url: urls[i], index: i, active: false });
    await chrome.tabs.update(tab.id, { pinned: true });
  }

  await chrome.storage.session.set({ [windowKey]: catId });
}

async function deduplicateCategory(catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  // Normalize URL for comparison (handle trailing slashes, http/https, www)
  function normalizeUrl(url) {
    if (!url) return '';
    try {
      let normalized = url.toLowerCase().trim();
      // Remove trailing slash
      normalized = normalized.replace(/\/$/, '');
      // Normalize protocol (treat http and https as same)
      normalized = normalized.replace(/^https?:\/\//, '');
      // Remove www prefix
      normalized = normalized.replace(/^www\./, '');
      return normalized;
    } catch {
      return url.toLowerCase().trim();
    }
  }

  // Find duplicates by normalized URL match
  const urlMap = new Map(); // normalizedUrl → first site object
  const duplicates = [];

  cat.sites.forEach(site => {
    if (!site.url) return;

    const normalized = normalizeUrl(site.url);
    if (urlMap.has(normalized)) {
      // This is a duplicate
      duplicates.push(site);
    } else {
      // First occurrence
      urlMap.set(normalized, site);
    }
  });

  if (duplicates.length === 0) {
    alert(`No duplicate URLs found in "${cat.name}".`);
    return;
  }

  const msg = duplicates.length === 1
    ? `Remove 1 duplicate URL from "${cat.name}"?`
    : `Remove ${duplicates.length} duplicate URLs from "${cat.name}"?`;
  const ok = await Utils.confirm(msg, 'Deduplicate');
  if (!ok) return;

  Undo.saveSnapshot('Deduplicate category', appData);

  // Remove duplicates
  const duplicateIds = new Set(duplicates.map(s => s.id));
  cat.sites = cat.sites.filter(s => !duplicateIds.has(s.id));
  reindexSites(cat);

  saveAndRefresh();
}

async function deleteSiteWithConfirm(siteId, catId) {
  const site = getSiteById(catId, siteId);
  if (!site) return;
  const ok = await Utils.confirm(`Delete "${site.name || site.url}"?`);
  if (!ok) return;

  Undo.saveSnapshot('Delete item', appData);
  const cat = getCatById(catId);
  cat.sites = cat.sites.filter(s => s.id !== siteId);
  reindexSites(cat);
  saveAndRefresh();
}

// =========================================================
// Category visibility (collapse / expand)
// =========================================================
function toggleCategoryVisibility(catId) {
  const hidden = appData.settings.hiddenCategories;
  const idx = hidden.indexOf(catId);
  const nowHidden = idx === -1;
  if (nowHidden) {
    hidden.push(catId);
  } else {
    hidden.splice(idx, 1);
  }

  // Toggle the class directly on the card — no full re-render needed
  const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
  if (card) {
    card.classList.toggle('category-collapsed', nowHidden);
    const btn = card.querySelector('.category-collapse-btn');
    if (btn) btn.title = nowHidden ? 'Expand category' : 'Collapse category';
  }

  // Save without re-rendering
  localSavePending++;
  Storage.saveData(appData, Utils.flashSaveIndicator);
}

// =========================================================
// Category width expansion (kanban mode only)
// =========================================================
function toggleCategoryExpand(catId) {
  // Find all category cards
  const cards = document.querySelectorAll('.category-card');
  const clickedCard = document.querySelector(`.category-card[data-category-id="${catId}"]`);

  if (!clickedCard) return;

  const isExpanded = clickedCard.classList.contains('category-expanded');

  // Collapse all categories first (only one can be expanded at a time)
  cards.forEach(card => card.classList.remove('category-expanded'));

  // Toggle the clicked category (if it wasn't expanded, expand it)
  if (!isExpanded) {
    clickedCard.classList.add('category-expanded');
  }
}

// =========================================================
// Move site to top/bottom of current category
// =========================================================
function moveSiteToTop(siteId, catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  const siteIdx = cat.sites.findIndex(s => s.id === siteId);
  if (siteIdx === -1 || siteIdx === 0) return; // Already at top

  Undo.saveSnapshot('Move to top', appData);

  // Remove site from current position
  const [site] = cat.sites.splice(siteIdx, 1);
  // Insert at the beginning
  cat.sites.unshift(site);
  // Reindex
  reindexSites(cat);

  saveAndRefresh();
}

function moveSiteToBottom(siteId, catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  const siteIdx = cat.sites.findIndex(s => s.id === siteId);
  if (siteIdx === -1 || siteIdx === cat.sites.length - 1) return; // Already at bottom

  Undo.saveSnapshot('Move to bottom', appData);

  // Remove site from current position
  const [site] = cat.sites.splice(siteIdx, 1);
  // Insert at the end
  cat.sites.push(site);
  // Reindex
  reindexSites(cat);

  saveAndRefresh();
}

// =========================================================
// Move site between categories
// =========================================================
function moveSiteToCategory(siteId, fromCatId, toCatId, position = 'bottom') {
  const fromCat = getCatById(fromCatId);
  const toCat   = getCatById(toCatId);
  if (!fromCat || !toCat) return;

  Undo.saveSnapshot('Move item', appData);

  const siteIdx = fromCat.sites.findIndex(s => s.id === siteId);
  if (siteIdx === -1) return;

  const [site] = fromCat.sites.splice(siteIdx, 1);
  if (position === 'top') {
    toCat.sites.unshift(site);
  } else {
    site.order = toCat.sites.length;
    toCat.sites.push(site);
  }
  reindexSites(fromCat);
  reindexSites(toCat);
  saveAndRefresh();
}

function copySiteToCategory(siteId, fromCatId, toCatId, position = 'bottom') {
  const fromCat = getCatById(fromCatId);
  const toCat   = getCatById(toCatId);
  if (!fromCat || !toCat) return;

  const site = fromCat.sites.find(s => s.id === siteId);
  if (!site) return;

  Undo.saveSnapshot('Copy item', appData);

  const copy = { ...JSON.parse(JSON.stringify(site)), id: Utils.generateId() };
  if (position === 'top') {
    toCat.sites.unshift(copy);
  } else {
    copy.order = toCat.sites.length;
    toCat.sites.push(copy);
  }
  reindexSites(toCat);
  saveAndRefresh();
}

// =========================================================
// Drag-and-drop handler
// =========================================================
function handleDrop(type, sourceId, sourceCatId, targetId, targetCatId) {
  if (type === 'site') {
    // Check if source is from Live Tabs (copy to target, don't remove from live)
    const sourceLive = (liveTabsData?.categories || []).find(c => c.id === sourceCatId);
    const targetCat = appData.categories.find(c => c.id === targetCatId);

    if (sourceLive && targetCat) {
      // Drag from Live Tabs to a regular category = save that tab
      const liveSite = sourceLive.sites.find(s => s.id === sourceId);
      if (!liveSite) return;

      Undo.saveSnapshot('Save tab from Live Tabs', appData);
      const newSite = {
        id: Utils.generateId(),
        name: liveSite.name || Utils.nameFromUrl(liveSite.url),
        url: liveSite.url,
        favicon: liveSite.favicon || '',
        order: targetCat.sites.length
      };

      let targetIndex;
      if (targetId) {
        const targetSiteIndex = targetCat.sites.findIndex(s => s.id === targetId);
        targetIndex = targetSiteIndex;
      } else {
        targetIndex = targetCat.sites.length;
      }
      targetCat.sites.splice(targetIndex, 0, newSite);
      reindexSites(targetCat);
      saveAndRefresh();
      return;
    }

    // Don't allow drops INTO live tab categories
    if (!targetCat) return;

    Undo.saveSnapshot('Move item', appData);
    const sourceCat = appData.categories.find(c => c.id === sourceCatId);
    if (!sourceCat) return;

    const sourceIndex = sourceCat.sites.findIndex(s => s.id === sourceId);
    if (sourceIndex === -1) return;

    const [site] = sourceCat.sites.splice(sourceIndex, 1);

    // Calculate target index
    let targetIndex;
    if (targetId) {
      const targetSiteIndex = targetCat.sites.findIndex(s => s.id === targetId);
      targetIndex = targetSiteIndex;
    } else {
      targetIndex = targetCat.sites.length;
    }

    targetCat.sites.splice(targetIndex, 0, site);

    // Reindex both categories (even if same, it's safe)
    reindexSites(sourceCat);
    if (sourceCat.id !== targetCat.id) {
      reindexSites(targetCat);
    }

    saveAndRefresh();
  } else if (type === 'category') {
    Undo.saveSnapshot('Reorder category', appData);
    const sourceCat = getCatById(sourceId);
    const targetCat = getCatById(targetId);
    if (!sourceCat || !targetCat) return;
    if (sourceCat.workspaceId !== targetCat.workspaceId) return;

    // Work within the workspace scope, sorted by display order
    const wsCategories = appData.categories
      .filter(c => c.workspaceId === sourceCat.workspaceId)
      .sort((a, b) => a.order - b.order);

    const sourceIdx = wsCategories.findIndex(c => c.id === sourceId);
    const targetIdx = wsCategories.findIndex(c => c.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    wsCategories.splice(sourceIdx, 1);
    const newTargetIdx = wsCategories.findIndex(c => c.id === targetId);
    // Insert after target when dragging forward, before when dragging backward
    const insertIdx = sourceIdx < targetIdx ? newTargetIdx + 1 : newTargetIdx;
    wsCategories.splice(insertIdx, 0, sourceCat);

    // Reindex only this workspace's categories
    wsCategories.forEach((c, i) => c.order = i);
    saveAndRefresh();
  }
}

// =========================================================
// Select Mode
// =========================================================

function enterSelectMode() {
  selectMode = true;
  selectedSites.clear();
  document.body.classList.add('select-mode');
  document.getElementById('selectModeBtn').classList.add('active');
  document.getElementById('selectModeBtn').textContent = 'Done';

  // Capture scroll positions before re-render
  const scrollState = {};
  const isKanban = document.querySelector('.categories-grid.layout-kanban');
  if (isKanban) {
    document.querySelectorAll('.category-card').forEach(card => {
      const catId = card.dataset.categoryId;
      const sitesList = card.querySelector('.sites-list');
      if (sitesList && catId) {
        scrollState[catId] = sitesList.scrollTop;
      }
    });
  } else {
    scrollState.window = window.scrollY;
  }

  renderAll();
  updateSelectionToolbar();

  // Restore scroll positions after re-render
  setTimeout(() => {
    if (isKanban) {
      Object.entries(scrollState).forEach(([catId, scrollTop]) => {
        const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
        const sitesList = card?.querySelector('.sites-list');
        if (sitesList) {
          sitesList.scrollTop = scrollTop;
        }
      });
    } else {
      window.scrollTo({ top: scrollState.window, behavior: 'instant' });
    }
  }, 0);
}

function exitSelectMode() {
  selectMode = false;
  selectedSites.clear();
  anchorKey = null;
  pendingMoveAfterCreate = false;
  pendingMovePosition = 'bottom';
  pendingMoveMode = 'move';
  document.body.classList.remove('select-mode');
  const btn = document.getElementById('selectModeBtn');
  btn.classList.remove('active');
  btn.textContent = 'Select';
  document.getElementById('moveSelectedMenu').hidden = true;

  // Capture scroll positions before re-render
  const scrollState = {};
  const isKanban = document.querySelector('.categories-grid.layout-kanban');
  if (isKanban) {
    document.querySelectorAll('.category-card').forEach(card => {
      const catId = card.dataset.categoryId;
      const sitesList = card.querySelector('.sites-list');
      if (sitesList && catId) {
        scrollState[catId] = sitesList.scrollTop;
      }
    });
  } else {
    scrollState.window = window.scrollY;
  }

  renderAll();
  updateSelectionToolbar();

  // Restore scroll positions after re-render
  setTimeout(() => {
    if (isKanban) {
      Object.entries(scrollState).forEach(([catId, scrollTop]) => {
        const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
        const sitesList = card?.querySelector('.sites-list');
        if (sitesList) {
          sitesList.scrollTop = scrollTop;
        }
      });
    } else {
      window.scrollTo({ top: scrollState.window, behavior: 'instant' });
    }
  }, 0);
}

function updateSelectionToolbar() {
  const toolbar = document.getElementById('selectionToolbar');
  const count = selectedSites.size;
  const isLive = isLiveTabsActive();
  document.getElementById('selectionCount').textContent =
    count === 0 ? 'None selected'
    : count === 1 ? '1 selected'
    : `${count} selected`;

  // Show/hide buttons based on whether we're in Live Tabs or regular mode
  document.getElementById('deleteSelectedBtn').disabled = count === 0;
  document.getElementById('deleteSelectedBtn').style.display = isLive ? 'none' : '';
  document.getElementById('moveSelectedBtn').disabled = count === 0;
  document.getElementById('moveSelectedBtn').style.display = isLive ? 'none' : '';
  document.getElementById('copyUrlsBtn').disabled = count === 0;
  document.getElementById('consolidateSelectedBtn').disabled = count === 0;
  document.getElementById('consolidateSelectedBtn').style.display = isLive ? 'none' : '';
  document.getElementById('refreshNamesBtn').disabled = count === 0;
  document.getElementById('refreshNamesBtn').style.display = isLive ? 'none' : '';
  document.getElementById('fetchDescriptionsBtn').disabled = count === 0;
  document.getElementById('fetchDescriptionsBtn').style.display = isLive ? 'none' : '';

  // Live Tabs specific buttons
  document.getElementById('closeSelectedTabsBtn').disabled = count === 0;
  document.getElementById('closeSelectedTabsBtn').style.display = isLive ? '' : 'none';
  document.getElementById('saveSelectedTabsBtn').disabled = count === 0;
  document.getElementById('saveSelectedTabsBtn').style.display = isLive ? '' : 'none';

  toolbar.classList.toggle('is-visible', selectMode);

  // Update per-category header checkboxes
  document.querySelectorAll('.category-card').forEach(card => {
    const catId = card.dataset.categoryId;
    const cat = getCatById(catId);
    if (!cat) return;
    const catCb = card.querySelector('.cat-select-all-cb');
    if (!catCb) return;

    // Count only visible items (respects search filter)
    const visibleTiles = Array.from(
      card.querySelectorAll('.site-tile, .note-tile')
    ).filter(tile => tile.style.display !== 'none');

    const total = visibleTiles.length;
    const checked = visibleTiles.filter(tile => {
      const key = `${catId}::${tile.dataset.siteId}`;
      return selectedSites.has(key);
    }).length;

    catCb.checked = total > 0 && checked === total;
    catCb.indeterminate = checked > 0 && checked < total;
  });
}

function selectAllSites() {
  const categories = isLiveTabsActive()
    ? (liveTabsData?.categories || [])
    : appData.categories;
  categories.forEach(cat => {
    cat.sites.forEach(site => {
      selectedSites.add(`${cat.id}::${site.id}`);
    });
  });
  // Sync DOM checkboxes for both site tiles and note tiles
  document.querySelectorAll('.site-tile, .note-tile').forEach(tile => {
    const key = `${tile.dataset.categoryId}::${tile.dataset.siteId}`;
    tile.classList.add('selected');
    const cb = tile.querySelector('.site-select-cb, .note-select-cb');
    if (cb) cb.checked = true;
  });
  updateSelectionToolbar();
}

function clearAllSelection() {
  selectedSites.clear();
  document.querySelectorAll('.site-tile, .note-tile').forEach(tile => {
    tile.classList.remove('selected');
    const cb = tile.querySelector('.site-select-cb, .note-select-cb');
    if (cb) cb.checked = false;
  });
  updateSelectionToolbar();
}

function selectAllInCategory(catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  // Get only visible tiles (respects search filter)
  const visibleTiles = Array.from(
    document.querySelectorAll(`.site-tile[data-category-id="${catId}"], .note-tile[data-category-id="${catId}"]`)
  ).filter(tile => tile.style.display !== 'none');

  // Check if all visible items are selected
  const allVisibleSelected = visibleTiles.every(tile => {
    const key = `${catId}::${tile.dataset.siteId}`;
    return selectedSites.has(key);
  });

  // Toggle: if all visible selected, deselect all visible; otherwise select all visible
  visibleTiles.forEach(tile => {
    const key = `${catId}::${tile.dataset.siteId}`;
    if (allVisibleSelected) {
      selectedSites.delete(key);
    } else {
      selectedSites.add(key);
    }
    tile.classList.toggle('selected', selectedSites.has(key));
    const cb = tile.querySelector('.site-select-cb, .note-select-cb');
    if (cb) cb.checked = selectedSites.has(key);
  });

  updateSelectionToolbar();
}

function showMoveSelectedMenu() {
  const menu = document.getElementById('moveSelectedMenu');

  // Close if already open
  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }

  buildMoveMenuContent(
    menu,
    (catId, position, mode) => {
      menu.hidden = true;
      if (mode === 'copy') {
        copySelectedTo(catId, position);
      } else {
        moveSelectedTo(catId, position);
      }
    },
    (position, modeVal) => {
      menu.hidden = true;
      pendingMoveAfterCreate = true;
      pendingMovePosition = position;
      pendingMoveMode = modeVal;
      openCategoryModal(null);
    },
    null // don't exclude any category
  );

  // Measure menu before final positioning
  menu.style.visibility = 'hidden';
  menu.style.bottom = '';
  menu.style.top = '';
  menu.style.left = '';
  menu.style.right = '';
  menu.hidden = false;

  const anchor = document.getElementById('moveSelectedBtn');
  const rect   = anchor.getBoundingClientRect();
  const vpW    = window.innerWidth;
  const vpH    = window.innerHeight;
  const mh     = menu.offsetHeight;
  const mw     = menu.offsetWidth;

  // Prefer opening above the button; if not enough room, open below
  const spaceAbove = rect.top - 8;
  const spaceBelow = vpH - rect.bottom - 8;

  if (spaceAbove >= mh || spaceAbove >= spaceBelow) {
    menu.style.top = Math.max(8, rect.top - mh - 6) + 'px';
  } else {
    menu.style.top = (rect.bottom + 6) + 'px';
  }

  // Horizontal: right-align to button, clamp to viewport
  const rightEdge = vpW - rect.right;
  menu.style.right = Math.max(8, rightEdge) + 'px';
  const leftPos = vpW - Math.max(8, rightEdge) - mw;
  if (leftPos < 8) menu.style.right = (vpW - mw - 8) + 'px';

  menu.style.visibility = '';
}

// position: 'top' | 'bottom' (default 'bottom')
function moveSelectedTo(targetCatId, position = 'bottom') {
  const targetCat = getCatById(targetCatId);
  if (!targetCat || selectedSites.size === 0) return;

  Undo.saveSnapshot('Move selected items', appData);
  // Group selected keys by source category
  const bySourceCat = new Map();
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    if (!bySourceCat.has(catId)) bySourceCat.set(catId, []);
    bySourceCat.get(catId).push(siteId);
  });

  // Collect sites to move (preserving their original relative order)
  const sitesToMove = [];

  bySourceCat.forEach((siteIds, srcCatId) => {
    const srcCat = getCatById(srcCatId);
    if (!srcCat) return;

    if (srcCatId === targetCatId) {
      // Reordering within the same category:
      // Remove selected sites from their current positions
      const extracted = [];
      siteIds.forEach(siteId => {
        const idx = srcCat.sites.findIndex(s => s.id === siteId);
        if (idx !== -1) extracted.push(srcCat.sites.splice(idx, 1)[0]);
      });
      // Re-insert at top or bottom
      if (position === 'top') {
        srcCat.sites.unshift(...extracted);
      } else {
        srcCat.sites.push(...extracted);
      }
      reindexSites(srcCat);
      return; // handled inline — don't add to sitesToMove
    }

    // Moving from a different category — extract in order
    siteIds.forEach(siteId => {
      const idx = srcCat.sites.findIndex(s => s.id === siteId);
      if (idx === -1) return;
      const [site] = srcCat.sites.splice(idx, 1);
      sitesToMove.push(site);
    });
    reindexSites(srcCat);
  });

  // Insert the collected sites into the target category
  if (sitesToMove.length > 0) {
    if (position === 'top') {
      targetCat.sites.unshift(...sitesToMove);
    } else {
      targetCat.sites.push(...sitesToMove);
    }
    reindexSites(targetCat);
  }

  exitSelectMode();
  saveAndRefresh();
}

function copySelectedTo(targetCatId, position = 'bottom') {
  const targetCat = getCatById(targetCatId);
  if (!targetCat || selectedSites.size === 0) return;

  Undo.saveSnapshot('Copy selected items', appData);

  const copies = [];
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const cat = getCatById(catId);
    if (!cat) return;
    const site = cat.sites.find(s => s.id === siteId);
    if (!site) return;
    copies.push({ ...JSON.parse(JSON.stringify(site)), id: Utils.generateId() });
  });

  if (copies.length > 0) {
    if (position === 'top') {
      targetCat.sites.unshift(...copies);
    } else {
      targetCat.sites.push(...copies);
    }
    reindexSites(targetCat);
  }

  exitSelectMode();
  saveAndRefresh();
}

async function copySelectedUrls() {
  if (selectedSites.size === 0) return;
  const urls = [];
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const cat = getCatById(catId);
    if (!cat) return;
    const site = cat.sites.find(s => s.id === siteId);
    if (site && site.url) urls.push(site.url);
  });
  if (urls.length === 0) return;
  try {
    await navigator.clipboard.writeText(urls.join('\n'));
    const el = document.getElementById('saveIndicator');
    if (el) {
      el.textContent = `${urls.length} URL${urls.length === 1 ? '' : 's'} copied`;
      el.hidden = false;
      el.classList.add('show');
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
      }, 1200);
    }
  } catch (err) {
    console.error('Clipboard write failed:', err);
  }
}

async function copyAllUrlsInCategory(catId) {
  const cat = getCatById(catId);
  if (!cat) return;
  const urls = cat.sites.filter(s => s.url).map(s => s.url);
  if (urls.length === 0) return;
  try {
    await navigator.clipboard.writeText(urls.join('\n'));
    const el = document.getElementById('saveIndicator');
    if (el) {
      el.textContent = `${urls.length} URL${urls.length === 1 ? '' : 's'} copied`;
      el.hidden = false;
      el.classList.add('show');
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
      }, 1200);
    }
  } catch (err) {
    console.error('Clipboard write failed:', err);
  }
}

async function deleteSelected() {
  const count = selectedSites.size;
  if (count === 0) return;
  const msg = count === 1 ? 'Delete 1 selected site?' : `Delete ${count} selected sites?`;
  const ok = await Utils.confirm(msg, 'Delete');
  if (!ok) return;

  Undo.saveSnapshot('Delete selected items', appData);
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const cat = getCatById(catId);
    if (cat) {
      cat.sites = cat.sites.filter(s => s.id !== siteId);
    }
  });

  // Reindex all affected categories
  appData.categories.forEach(cat => reindexSites(cat));

  exitSelectMode();
  saveAndRefresh();
}

async function closeSelectedTabs() {
  const count = selectedSites.size;
  if (count === 0) return;
  const msg = count === 1 ? 'Close 1 selected tab?' : `Close ${count} selected tabs?`;
  const ok = await Utils.confirm(msg, 'Close');
  if (!ok) return;

  const tabIds = [];
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const site = getSiteById(catId, siteId);
    if (site && site.tabId) tabIds.push(site.tabId);
  });

  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch (err) {
      console.error('Failed to close tabs:', err);
    }
  }

  exitSelectMode();
  // Live tabs listeners will trigger refresh
}

function showSaveSelectedMenu() {
  const menu = document.getElementById('moveSelectedMenu');

  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }

  // Build a simple category picker
  menu.innerHTML = '';

  const entries = getSortedCategoriesWithWorkspace(null);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'context-item';
    empty.style.color = 'var(--text-muted)';
    empty.textContent = 'No categories — create one first';
    menu.appendChild(empty);
  } else {
    const multipleWorkspaces = appData.workspaces.length > 1;
    let lastWsName = null;

    entries.forEach(({ cat, label }) => {
      if (multipleWorkspaces && cat.workspaceName !== lastWsName) {
        lastWsName = cat.workspaceName;
        if (menu.children.length > 0) {
          const div = document.createElement('div');
          div.className = 'context-divider';
          menu.appendChild(div);
        }
        const wsHeader = document.createElement('div');
        wsHeader.className = 'context-item';
        wsHeader.style.cssText = 'font-weight: 600; font-size: 11px; color: var(--text-muted); pointer-events: none;';
        wsHeader.textContent = cat.workspaceName;
        menu.appendChild(wsHeader);
      }

      const item = document.createElement('button');
      item.className = 'context-item';
      item.textContent = `${cat.icon} ${cat.name}`;
      item.addEventListener('click', () => {
        menu.hidden = true;
        saveSelectedTabsToCategory(cat.id);
      });
      menu.appendChild(item);
    });
  }

  // Position relative to the Save button
  menu.style.visibility = 'hidden';
  menu.hidden = false;

  const anchor = document.getElementById('saveSelectedTabsBtn');
  const rect = anchor.getBoundingClientRect();
  const vpH = window.innerHeight;
  const vpW = window.innerWidth;
  const mh = menu.offsetHeight;
  const mw = menu.offsetWidth;

  const spaceAbove = rect.top - 8;
  if (spaceAbove >= mh) {
    menu.style.top = Math.max(8, rect.top - mh - 6) + 'px';
  } else {
    menu.style.top = (rect.bottom + 6) + 'px';
  }
  const rightEdge = vpW - rect.right;
  menu.style.right = Math.max(8, rightEdge) + 'px';
  const leftPos = vpW - Math.max(8, rightEdge) - mw;
  if (leftPos < 8) menu.style.right = (vpW - mw - 8) + 'px';

  menu.style.visibility = '';
}

function saveSelectedTabsToCategory(targetCatId) {
  const targetCat = appData.categories.find(c => c.id === targetCatId);
  if (!targetCat) return;

  Undo.saveSnapshot('Save tabs to category', appData);

  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const site = getSiteById(catId, siteId);
    if (!site || !site.url) return;

    // Skip duplicates
    if (targetCat.sites.some(s => s.url === site.url)) return;

    targetCat.sites.push({
      id: Utils.generateId(),
      name: site.name || Utils.nameFromUrl(site.url),
      url: site.url,
      favicon: site.favicon || '',
      order: targetCat.sites.length
    });
  });

  reindexSites(targetCat);
  exitSelectMode();
  saveAndRefresh();

  showSplitFeedback(`Saved to ${targetCat.icon} ${targetCat.name}`);
}

async function consolidateSelectedUrls() {
  const count = selectedSites.size;
  if (count === 0) return;

  const msg = count === 1
    ? 'Convert 1 selected URL to its root domain?'
    : `Convert ${count} selected URLs to root domains and remove duplicates?`;
  const ok = await Utils.confirm(msg, 'Consolidate');
  if (!ok) return;

  Undo.saveSnapshot('Consolidate URLs', appData);

  // Group selected sites by base URL
  const baseUrlMap = new Map(); // baseUrl → {catId, siteId, site, firstOccurrence}

  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const cat = getCatById(catId);
    if (!cat) return;

    const site = cat.sites.find(s => s.id === siteId);
    if (!site) return;

    const base = baseUrl(site.url);
    if (!base) return;

    // Keep track of first occurrence of each base URL
    if (!baseUrlMap.has(base)) {
      baseUrlMap.set(base, { catId, siteId, site, firstOccurrence: true });
    } else {
      // Mark duplicates for deletion
      baseUrlMap.set(`${base}::${catId}::${siteId}`, { catId, siteId, site, firstOccurrence: false });
    }
  });

  // Process all sites
  baseUrlMap.forEach((data, key) => {
    const { catId, siteId, site, firstOccurrence } = data;
    const cat = getCatById(catId);
    if (!cat) return;

    if (firstOccurrence) {
      // Update first occurrence to use base URL
      const base = baseUrl(site.url);
      site.url = base;
      site.name = Utils.nameFromUrl(base);
    } else {
      // Delete duplicate
      cat.sites = cat.sites.filter(s => s.id !== siteId);
    }
  });

  // Reindex all affected categories
  appData.categories.forEach(cat => reindexSites(cat));

  exitSelectMode();
  saveAndRefresh();
}

async function refreshSelectedNames() {
  const count = selectedSites.size;
  if (count === 0) return;

  const msg = count === 1
    ? 'Refresh name and favicon for 1 selected item from its URL?'
    : `Refresh names and favicons for ${count} selected items from their URLs?`;
  const ok = await Utils.confirm(msg, 'Refresh');
  if (!ok) return;

  Undo.saveSnapshot('Refresh names from URLs', appData);

  const sitesToRefresh = [];
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const cat = getCatById(catId);
    if (!cat) return;

    const site = cat.sites.find(s => s.id === siteId);
    if (!site || !site.url || site.type === 'note') return;

    // Refresh name from URL - use full path without protocol, decode URL encoding
    try {
      let name = site.url.replace(/^https?:\/\//, '');
      name = decodeURIComponent(name);
      site.name = name;
    } catch (e) {
      site.name = site.url.replace(/^https?:\/\//, '');
    }
    // Clear favicon immediately, then fetch fresh
    site.favicon = '';
    sitesToRefresh.push(site);
  });

  exitSelectMode();
  saveAndRefresh();

  // Fetch fresh favicons in parallel
  if (sitesToRefresh.length > 0) {
    await Promise.allSettled(
      sitesToRefresh.map(async (site) => {
        const fav = await Utils.fetchFavicon(site.url);
        if (fav) site.favicon = fav;
      })
    );
    saveAndRefresh();
  }
}

async function fetchSelectedDescriptions() {
  const count = selectedSites.size;
  if (count === 0) return;

  // Collect URL sites (skip note-type)
  const sitesToFetch = [];
  selectedSites.forEach(key => {
    const [catId, siteId] = key.split('::');
    const cat = getCatById(catId);
    if (!cat) return;
    const site = cat.sites.find(s => s.id === siteId);
    if (!site || !site.url || site.type === 'note') return;
    sitesToFetch.push(site);
  });

  if (sitesToFetch.length === 0) return;

  const msg = sitesToFetch.length === 1
    ? 'Fetch meta description for 1 selected item?'
    : `Fetch meta descriptions for ${sitesToFetch.length} selected items?`;
  const ok = await Utils.confirm(msg, 'Fetch');
  if (!ok) return;

  Undo.saveSnapshot('Fetch descriptions', appData);

  const el = document.getElementById('saveIndicator');
  let completed = 0;
  let added = 0;

  function showProgress() {
    if (el) {
      el.textContent = `Fetching descriptions... ${completed}/${sitesToFetch.length}`;
      el.hidden = false;
      el.classList.add('show');
      clearTimeout(el._hideTimer);
    }
  }
  showProgress();

  // Worker-pool with concurrency limit of 5
  const queue = [...sitesToFetch];
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const site = queue[i];
      try {
        const desc = await Utils.fetchMetaDescription(site.url);
        if (desc) {
          site.note = site.note ? site.note + '\n\n---\n' + desc : desc;
          added++;
        }
      } catch { /* skip */ }
      completed++;
      showProgress();
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(5, sitesToFetch.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  exitSelectMode();
  saveAndRefresh();

  if (el) {
    el.textContent = `${added} description${added === 1 ? '' : 's'} added`;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
    }, 1200);
  }
}

// =========================================================
// Browser Picker (Tabs + Bookmarks)
// =========================================================

// Items currently loaded in the picker: [{ url, name, favicon, alreadySaved, folder }]
let pickerItems = [];
let pickerSource = 'tabs'; // 'tabs' | 'bookmarks'
let pickerFolders = []; // Available bookmark folders
let pickerSelectedFolder = 'all'; // Selected folder filter ('all' or folder name)
let pickerAllowSavedSelection = false; // Allow selecting already-saved items

function openPickerModal() {
  // Populate category selector (only current workspace)
  const catSel = document.getElementById('pickerCategorySelect');
  catSel.innerHTML = '';
  const currentWorkspace = appData.settings.currentWorkspace;
  const workspaceCategories = appData.categories.filter(cat => cat.workspaceId === currentWorkspace);
  const sorted = [...workspaceCategories].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) {
    // No categories yet — show an informative message and bail
    const opt = document.createElement('option');
    opt.textContent = 'Create a category first';
    catSel.appendChild(opt);
    document.getElementById('pickerAddBtn').disabled = true;
    openModal('pickerModal');
    loadPickerSource('tabs');
    return;
  }
  sorted.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.icon} ${cat.name}`;
    catSel.appendChild(opt);
  });

  // Add divider and "New category" options
  const divider = document.createElement('option');
  divider.disabled = true;
  divider.textContent = '──────────────';
  catSel.appendChild(divider);

  const newTopOpt = document.createElement('option');
  newTopOpt.value = '__new_top__';
  newTopOpt.textContent = '+ New category at top...';
  catSel.appendChild(newTopOpt);

  const newBottomOpt = document.createElement('option');
  newBottomOpt.value = '__new_bottom__';
  newBottomOpt.textContent = '+ New category at bottom...';
  catSel.appendChild(newBottomOpt);

  document.getElementById('pickerAddBtn').disabled = true;

  // Reset to tabs, clear filter
  pickerSource = 'tabs';
  document.querySelectorAll('.picker-source-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === 'tabs');
  });
  document.getElementById('pickerSearch').value = '';

  // Reset "allow saved selection" toggle
  pickerAllowSavedSelection = false;
  document.getElementById('pickerToggleSavedText').textContent = 'Enable saved';

  openModal('pickerModal');
  loadPickerSource('tabs');
}

function closePickerModal() {
  const modal = document.getElementById('pickerModal');
  modal.style.display = ''; // Reset display in case it was hidden
  closeModal('pickerModal');
  pickerItems = [];
}

// ---- Extract base URL (scheme + host only) ----
function baseUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin; // e.g. "https://example.com"
  } catch {
    return null;
  }
}

// ---- Get set of all already-saved base URLs (current workspace only) ----
function savedBaseUrls() {
  const set = new Set();
  const currentWorkspace = appData.settings.currentWorkspace;
  appData.categories.forEach(cat => {
    if (cat.workspaceId !== currentWorkspace) return;
    cat.sites.forEach(site => {
      const b = baseUrl(site.url);
      if (b) set.add(b);
    });
  });
  return set;
}

// ---- Get set of all already-saved full URLs (current workspace only) ----
function savedFullUrls() {
  const set = new Set();
  const currentWorkspace = appData.settings.currentWorkspace;
  appData.categories.forEach(cat => {
    if (cat.workspaceId !== currentWorkspace) return;
    cat.sites.forEach(site => {
      if (site.url) set.add(site.url);
    });
  });
  return set;
}

// ---- Load items from tabs or bookmarks ----
async function loadPickerSource(source) {
  pickerSource = source;
  const list = document.getElementById('pickerList');
  list.innerHTML = '<div class="picker-empty">Loading\u2026</div>';
  pickerItems = [];
  updatePickerCount();
  document.getElementById('pickerAddBtn').disabled = true;

  try {
    let rawItems = [];

    if (source === 'tabs') {
      const tabs = await chrome.tabs.query({});
      rawItems = tabs
        .map(t => ({ url: t.url || '', name: t.title || '' }))
        .filter(t => t.url.startsWith('http://') || t.url.startsWith('https://'));
    } else {
      // Flatten bookmark tree, extract leaf nodes (URLs)
      const tree = await chrome.bookmarks.getTree();
      rawItems = flattenBookmarks(tree);
    }

    // Filter out invalid URLs
    rawItems = rawItems.filter(item => {
      try {
        const u = new URL(item.url);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    });

    const saved = savedFullUrls();
    pickerItems = rawItems.map(item => ({
      url:          item.url,
      name:         item.name || Utils.nameFromUrl(item.url),
      folder:       item.folder || null,
      alreadySaved: saved.has(item.url),
      checked:      false,
    }));

    // Sort: unsaved first, then alphabetical by name
    pickerItems.sort((a, b) => {
      if (a.alreadySaved !== b.alreadySaved) return a.alreadySaved ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    // Extract unique folders for bookmarks
    if (source === 'bookmarks') {
      const folderSet = new Set();
      pickerItems.forEach(item => {
        if (item.folder) folderSet.add(item.folder);
      });
      pickerFolders = Array.from(folderSet).sort();
      populateFolderDropdown();
    } else {
      pickerFolders = [];
      const folderDropdown = document.getElementById('pickerFolderSelect');
      const folderWrap = document.querySelector('.picker-folder-wrap');
      if (folderDropdown) folderDropdown.style.display = 'none';
      if (folderWrap) folderWrap.style.display = 'none';
    }

    renderPickerList(document.getElementById('pickerSearch').value);
  } catch (err) {
    list.innerHTML = `<div class="picker-empty">Could not load ${source}: ${Utils.escapeHtml(err.message)}</div>`;
  }
}

// ---- Populate folder dropdown ----
function populateFolderDropdown() {
  const folderDropdown = document.getElementById('pickerFolderSelect');
  const folderWrap = document.querySelector('.picker-folder-wrap');
  if (!folderDropdown || !folderWrap) return;

  folderDropdown.innerHTML = '';
  folderDropdown.style.display = 'block';
  folderWrap.style.display = 'flex';

  // Add "All folders" option
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All folders';
  folderDropdown.appendChild(allOption);

  // Add each folder
  pickerFolders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = folder;
    folderDropdown.appendChild(option);
  });

  // Reset to "All folders"
  pickerSelectedFolder = 'all';
  folderDropdown.value = 'all';
}

// ---- Recursively flatten Chrome bookmark tree into [{url, name, folder}] ----
function flattenBookmarks(nodes) {
  const results = [];
  function walk(arr, path = []) {
    arr.forEach(node => {
      if (node.url) {
        results.push({
          url: node.url,
          name: node.title || '',
          folder: path.length > 0 ? path.join(' > ') : 'Root'
        });
      }
      if (node.children) {
        // Skip the root "Bookmarks Bar" and "Other Bookmarks" parent nodes from path
        const newPath = node.title && !['Bookmarks', 'Bookmarks Bar', 'Other Bookmarks'].includes(node.title)
          ? [...path, node.title]
          : path;
        walk(node.children, newPath);
      }
    });
  }
  walk(nodes);
  return results;
}

// ---- Render the picker list (with optional filter) ----
function renderPickerList(filter) {
  const list = document.getElementById('pickerList');
  list.innerHTML = '';
  const q = (filter || '').toLowerCase().trim();

  const visible = pickerItems.filter(item => {
    // Filter by folder
    if (pickerSource === 'bookmarks' && pickerSelectedFolder !== 'all') {
      if (item.folder !== pickerSelectedFolder) return false;
    }
    // Filter by search query
    if (!q) return true;
    const matchesName = item.name.toLowerCase().includes(q);
    const matchesUrl = item.url.toLowerCase().includes(q);
    const matchesFolder = item.folder && item.folder.toLowerCase().includes(q);
    return matchesName || matchesUrl || matchesFolder;
  });

  if (visible.length === 0) {
    list.innerHTML = `<div class="picker-empty">${q ? 'No results match your filter.' : 'Nothing to show.'}</div>`;
    updatePickerCount();
    return;
  }

  visible.forEach(item => {
    const row = document.createElement('label');
    row.className = 'picker-item' + (item.alreadySaved ? ' already-saved' : '');
    row.title = item.url;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.checked;
    cb.disabled = item.alreadySaved && !pickerAllowSavedSelection;
    cb.addEventListener('change', () => {
      item.checked = cb.checked;
      updatePickerCount();
    });

    // Favicon
    const faviconSrc = Utils.faviconUrl(item.url);
    let faviconEl;
    if (faviconSrc) {
      faviconEl = document.createElement('img');
      faviconEl.className = 'picker-item-favicon';
      faviconEl.src = faviconSrc;
      faviconEl.alt = '';
      faviconEl.loading = 'lazy';
      faviconEl.onerror = () => {
        const badge = buildPickerBadge(item.name, item.url);
        faviconEl.replaceWith(badge);
      };
    } else {
      faviconEl = buildPickerBadge(item.name, item.url);
    }

    const info = document.createElement('div');
    info.className = 'picker-item-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'picker-item-name';
    nameEl.textContent = item.name;

    const urlEl = document.createElement('div');
    urlEl.className = 'picker-item-url';
    urlEl.textContent = item.url;

    info.append(nameEl, urlEl);

    // Add folder path for bookmarks
    if (item.folder) {
      const folderEl = document.createElement('div');
      folderEl.className = 'picker-item-folder';
      folderEl.textContent = `📁 ${item.folder}`;
      info.appendChild(folderEl);
    }

    row.append(cb, faviconEl, info);

    if (item.alreadySaved) {
      const badge = document.createElement('span');
      badge.className = 'picker-item-badge';
      badge.textContent = 'Saved';
      row.appendChild(badge);
    }

    list.appendChild(row);
  });

  updatePickerCount();
}

function buildPickerBadge(name, seed) {
  const el = document.createElement('span');
  el.className = 'picker-item-favicon-fallback';
  el.textContent = ((name || seed || '?')[0]).toUpperCase();
  el.style.background = Utils.badgeColor(seed || name || '?');
  return el;
}

function updatePickerCount() {
  const selected = pickerItems.filter(i => i.checked && (pickerAllowSavedSelection || !i.alreadySaved)).length;
  const countEl = document.getElementById('pickerCount');
  countEl.textContent = selected === 0 ? '0 selected'
    : selected === 1 ? '1 selected' : `${selected} selected`;

  const hasCategories = appData.categories.length > 0;
  document.getElementById('pickerAddBtn').disabled = selected === 0 || !hasCategories;
}

// ---- Add selected items to chosen category ----
function addPickerSelected() {
  const catId = document.getElementById('pickerCategorySelect').value;
  const cat = getCatById(catId);
  if (!cat) return;

  const toAdd = pickerItems.filter(i => i.checked && (pickerAllowSavedSelection || !i.alreadySaved));
  if (toAdd.length === 0) return;

  toAdd.forEach(item => {
    cat.sites.push({
      id:      Utils.generateId(),
      name:    item.name,
      url:     item.url,
      favicon: '',
      order:   cat.sites.length,
    });
  });

  closePickerModal();
  saveAndRefresh();
}

// ---- Add picker items to a specific category (used after creating new category) ----
function addPickerItemsToCategory(catId, position) {
  const cat = getCatById(catId);
  if (!cat) return;

  const toAdd = pickerItems.filter(i => i.checked && (pickerAllowSavedSelection || !i.alreadySaved));
  if (toAdd.length === 0) {
    // No items to add, just refresh to show the new category
    saveAndRefresh();
    return;
  }

  const newSites = toAdd.map(item => ({
    id:      Utils.generateId(),
    name:    item.name,
    url:     item.url,
    favicon: '',
    order:   0,
  }));

  if (position === 'top') {
    cat.sites.unshift(...newSites);
  } else {
    cat.sites.push(...newSites);
  }

  // Reindex to ensure correct order
  reindexSites(cat);

  // Update the picker dropdown to select the new category
  const catSelect = document.getElementById('pickerCategorySelect');
  catSelect.value = catId;

  closePickerModal();
  saveAndRefresh();
}

// =========================================================
// Live Tabs Workspace
// =========================================================

function isLiveTabsActive() {
  return appData.settings.currentWorkspace === LIVE_TABS_ID;
}

async function loadLiveTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  const windows = await chrome.windows.getAll({ populate: true });
  const categories = [];

  // Get current extension newtab URL to filter it out
  const extensionOrigin = chrome.runtime.getURL('');

  windows.forEach((win, i) => {
    // Filter out devtools and other non-normal windows
    if (win.type !== 'normal') return;

    const validTabs = win.tabs.filter(t => {
      // Filter out the Tab Manager Pro newtab page
      if (t.url && t.url.startsWith(extensionOrigin)) return false;
      return true;
    });

    if (validTabs.length === 0) return;

    const sites = validTabs.map((tab, j) => {
      let domain = '';
      try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch {}

      return {
        id: `live-tab-${tab.id}`,
        name: tab.title || domain || tab.url,
        url: tab.url || '',
        favicon: tab.favIconUrl || '',
        order: j,
        tabId: tab.id,
        windowId: win.id,
        domain: domain,
        isActive: tab.active,
        isPinned: tab.pinned
      };
    });

    // Generate window name from most prominent domains
    const windowName = generateWindowName(sites, win.focused);

    categories.push({
      id: `live-win-${win.id}`,
      name: windowName,
      icon: win.focused ? '🟢' : '🪟',
      order: i,
      workspaceId: LIVE_TABS_ID,
      windowId: win.id,
      isFocused: win.focused,
      isLive: true,
      sites: sites
    });
  });

  // Put focused window first
  categories.sort((a, b) => (b.isFocused ? 1 : 0) - (a.isFocused ? 1 : 0));
  categories.forEach((c, i) => c.order = i);

  liveTabsData = { categories };
}

function generateWindowName(sites, isFocused) {
  // Collect unique domains, preserving order
  const seen = new Set();
  const domains = [];
  sites.forEach(s => {
    if (s.domain && !seen.has(s.domain)) {
      seen.add(s.domain);
      domains.push(s.domain);
    }
  });

  if (domains.length === 0) return `Window (${sites.length} tabs)`;

  // Show first 2 domains + count
  const shown = domains.slice(0, 2).join(', ');
  const remaining = sites.length - 2;
  if (remaining > 0) {
    return `${shown} & ${remaining} more`;
  }
  return shown;
}

function buildLiveTabCard(cat) {
  const card = document.createElement('div');
  card.className = 'category-card live-tab-card';
  if (cat.isFocused) card.classList.add('live-focused-window');
  card.dataset.categoryId = cat.id;
  card.dataset.windowId = cat.windowId;

  // Header
  const header = document.createElement('div');
  header.className = 'category-header live-tab-header';

  // Per-card select-all checkbox (shown in select mode)
  const catCb = document.createElement('input');
  catCb.type = 'checkbox';
  catCb.className = 'cat-select-all-cb';
  catCb.title = 'Select all in this window';
  catCb.addEventListener('click', (e) => {
    e.stopPropagation();
    selectAllInCategory(cat.id);
  });

  const iconEl = document.createElement('span');
  iconEl.className = 'category-icon';
  iconEl.textContent = cat.icon;

  const titleEl = document.createElement('span');
  titleEl.className = 'category-title';
  titleEl.textContent = cat.name;

  const countEl = document.createElement('span');
  countEl.className = 'category-count';
  countEl.textContent = cat.sites.length;

  // Focus button — switch to this window
  const focusBtn = document.createElement('button');
  focusBtn.className = 'category-menu-btn';
  focusBtn.title = 'Focus this window';
  focusBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>`;
  focusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.windows.update(cat.windowId, { focused: true });
  });

  header.append(catCb, iconEl, titleEl, countEl, focusBtn);

  // Sites list
  const sitesList = document.createElement('div');
  sitesList.className = 'sites-list';
  sitesList.dataset.categoryId = cat.id;

  const sortedSites = [...cat.sites].sort((a, b) => a.order - b.order);
  sortedSites.forEach(site => {
    const tile = buildLiveTabTile(site, cat.id);
    sitesList.appendChild(tile);
  });

  card.append(header, sitesList);

  // Make sites draggable to regular categories
  sortedSites.forEach(site => {
    const tile = sitesList.querySelector(`[data-site-id="${site.id}"]`);
    if (tile) DragDrop.makeSiteDraggable(tile, site.id, cat.id);
  });

  return card;
}

function buildLiveTabTile(site, categoryId) {
  const key = `${categoryId}::${site.id}`;

  const tile = document.createElement('div');
  tile.className = 'site-tile live-tab-tile';
  if (selectMode && selectedSites.has(key)) tile.classList.add('selected');
  if (site.isActive) tile.classList.add('live-active-tab');
  if (site.isPinned) tile.classList.add('live-pinned-tab');
  tile.dataset.siteId = site.id;
  tile.dataset.categoryId = categoryId;
  tile.dataset.tabId = site.tabId;
  tile.dataset.windowId = site.windowId;
  tile.dataset.dragType = 'site';
  tile.setAttribute('tabindex', '0');
  tile.title = site.url;

  // Click: select mode toggle, or switch to this tab
  tile.addEventListener('click', (e) => {
    if (selectMode) {
      e.preventDefault();
      if (e.shiftKey) {
        selectRange(key);
      } else {
        toggleSiteSelection(key, tile);
      }
      return;
    }
    e.preventDefault();
    chrome.tabs.update(site.tabId, { active: true });
    chrome.windows.update(site.windowId, { focused: true });
  });

  // Right-click context menu
  tile.addEventListener('contextmenu', (e) => {
    if (selectMode) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, site.id, categoryId);
  });

  // Checkbox (shown in select mode)
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'site-select-cb';
  cb.checked = selectedSites.has(key);
  cb.setAttribute('aria-hidden', 'true');
  cb.tabIndex = -1;
  cb.addEventListener('click', (e) => e.stopPropagation());

  // Favicon
  const faviconWrap = document.createElement('span');
  faviconWrap.className = 'site-favicon-wrap';
  if (site.favicon && site.favicon.startsWith('http')) {
    const img = document.createElement('img');
    img.className = 'site-favicon';
    img.src = site.favicon;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => {
      img.style.display = 'none';
      const badge = document.createElement('span');
      badge.className = 'site-favicon-badge';
      badge.style.background = Utils.badgeColor(site.name || site.url);
      badge.textContent = (site.name || '?')[0].toUpperCase();
      faviconWrap.appendChild(badge);
    };
    faviconWrap.appendChild(img);
  } else {
    const badge = document.createElement('span');
    badge.className = 'site-favicon-badge';
    badge.style.background = Utils.badgeColor(site.name || site.url);
    badge.textContent = (site.name || '?')[0].toUpperCase();
    faviconWrap.appendChild(badge);
  }

  // Name + domain
  const textWrap = document.createElement('div');
  textWrap.className = 'live-tab-text';

  const nameEl = document.createElement('span');
  nameEl.className = 'site-name';
  nameEl.textContent = site.name || site.url;

  const domainEl = document.createElement('span');
  domainEl.className = 'live-tab-domain';
  domainEl.textContent = site.domain;

  textWrap.append(nameEl, domainEl);

  // Pinned indicator
  if (site.isPinned) {
    const pinIcon = document.createElement('span');
    pinIcon.className = 'live-pin-icon';
    pinIcon.title = 'Pinned tab';
    pinIcon.textContent = '📌';
    tile.appendChild(pinIcon);
  }

  // Close tab button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'live-tab-close';
  closeBtn.title = 'Close tab';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await chrome.tabs.remove(site.tabId);
      // Will be refreshed by the tab listener
    } catch (err) {
      console.error('Failed to close tab:', err);
    }
  });

  tile.append(cb, faviconWrap, textWrap, closeBtn);
  return tile;
}

function startLiveTabsListeners() {
  if (liveTabsListeners) return; // already listening
  liveTabsListeners = [];

  let refreshTimer = null;
  const debouncedRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (!isLiveTabsActive()) return;
      await loadLiveTabs();
      renderAll();
      DragDrop.init(handleDrop);
    }, 500);
  };

  const events = [
    chrome.tabs.onCreated,
    chrome.tabs.onRemoved,
    chrome.tabs.onUpdated,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.tabs.onDetached
  ];

  events.forEach(event => {
    event.addListener(debouncedRefresh);
    liveTabsListeners.push(() => event.removeListener(debouncedRefresh));
  });
}

function stopLiveTabsListeners() {
  if (!liveTabsListeners) return;
  liveTabsListeners.forEach(remove => remove());
  liveTabsListeners = null;
  liveTabsData = null;
}

// =========================================================
// Tab Splitter
// =========================================================
async function splitWindowById(windowId, maxTabs) {
  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.length <= maxTabs) {
    return { success: true, split: false };
  }

  const tabsToMove = tabs.slice(maxTabs);
  const newWindow = await chrome.windows.create({
    tabId: tabsToMove[0].id,
    focused: false
  });

  const remainingIds = tabsToMove.slice(1).map(t => t.id);
  if (remainingIds.length > 0) {
    await chrome.tabs.move(remainingIds, { windowId: newWindow.id, index: -1 });
  }

  // Recursive split if new window still exceeds limit
  if (tabsToMove.length > maxTabs) {
    await splitWindowById(newWindow.id, maxTabs);
  }

  return { success: true, split: true, originalTabCount: tabs.length };
}

async function splitCurrentWindow(triggerId) {
  const isHeader = (triggerId === 'splitWindowBtn');
  const btn = document.getElementById(triggerId);
  btn.disabled = true;
  if (!isHeader) btn.textContent = 'Splitting...';

  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const maxTabs = appData.settings.tabSplitMaxTabs || 12;
    const result = await splitWindowById(currentTab.windowId, maxTabs);

    if (result.split) {
      const msg = `Split ${result.originalTabCount} tabs`;
      if (isHeader) {
        showSplitFeedback(msg);
      } else {
        btn.textContent = msg;
      }
    } else {
      const msg = 'No split needed';
      if (isHeader) {
        showSplitFeedback(msg);
      } else {
        btn.textContent = msg;
      }
    }
  } catch (err) {
    const msg = 'Split failed';
    if (isHeader) {
      showSplitFeedback(msg);
    } else {
      btn.textContent = msg;
    }
    console.error('Tab split error:', err);
  }

  setTimeout(() => {
    btn.disabled = false;
    if (!isHeader) btn.textContent = 'Split Now';
  }, 2000);
}

function showSplitFeedback(message) {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
  }, 1500);
}

// =========================================================
// Settings
// =========================================================
function openSettingsModal() {
  applySettings(); // sync UI to current state
  populateQuickAddInbox();
  renderCategoryVisibilityList();
  openModal('settingsModal');
}

function populateQuickAddInbox() {
  const select = document.getElementById('quickAddInbox');
  if (!select) return;
  select.innerHTML = '';

  // "None" option
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'None (disabled)';
  select.appendChild(none);

  // Group categories by workspace, sorted by workspace order then category order
  const sortedWorkspaces = [...(appData.workspaces || [])].sort((a, b) => a.order - b.order);
  sortedWorkspaces.forEach(ws => {
    const cats = appData.categories
      .filter(c => c.workspaceId === ws.id)
      .sort((a, b) => a.order - b.order);
    if (cats.length === 0) return;

    const group = document.createElement('optgroup');
    group.label = ws.name;
    cats.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = `${cat.icon} ${cat.name}`;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });

  select.value = appData.settings.quickAddInbox || '';
}

function renderCategoryVisibilityList() {
  const list = document.getElementById('categoryVisibilityList');
  if (!list) return;
  list.innerHTML = '';

  // Show all categories grouped by workspace
  const sortedWorkspaces = [...appData.workspaces].sort((a, b) => a.order - b.order);
  const allSorted = [];
  sortedWorkspaces.forEach(ws => {
    const wsCats = appData.categories
      .filter(c => c.workspaceId === ws.id)
      .sort((a, b) => a.order - b.order);
    if (wsCats.length === 0) return;

    // Add workspace header if there are multiple workspaces
    if (sortedWorkspaces.length > 1) {
      const wsHeader = document.createElement('div');
      wsHeader.className = 'settings-row';
      wsHeader.style.cssText = 'padding: 8px 0 4px; border-bottom: none;';
      const wsLabel = document.createElement('div');
      wsLabel.className = 'settings-label';
      const wsName = document.createElement('span');
      wsName.style.fontWeight = '600';
      wsName.textContent = ws.name;
      wsLabel.appendChild(wsName);
      wsHeader.appendChild(wsLabel);
      list.appendChild(wsHeader);
    }

    wsCats.forEach(cat => allSorted.push(cat));
  });

  if (allSorted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'settings-about';
    empty.textContent = 'No categories yet.';
    list.appendChild(empty);
    return;
  }

  allSorted.forEach(cat => {
    const isHidden = (appData.settings.hiddenCategories || []).includes(cat.id);

    const row = document.createElement('div');
    row.className = 'settings-row vis-row';
    row.dataset.catId = cat.id;

    // Drag grip
    const grip = document.createElement('span');
    grip.className = 'vis-drag-grip';
    grip.title = 'Drag to reorder';
    grip.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="9" y1="5"  x2="9"  y2="19"/>
      <line x1="15" y1="5" x2="15" y2="19"/>
    </svg>`;

    const labelDiv = document.createElement('div');
    labelDiv.className = 'settings-label';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${cat.icon} ${cat.name}`;

    const countSpan = document.createElement('small');
    countSpan.textContent = `${cat.sites.length} item${cat.sites.length === 1 ? '' : 's'}`;

    labelDiv.append(nameSpan, countSpan);

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    toggle.title = isHidden ? 'Show this category' : 'Hide this category';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !isHidden; // checked = visible
    checkbox.addEventListener('change', () => {
      toggleCategoryVisibility(cat.id);
    });

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';

    toggle.append(checkbox, slider);
    row.append(grip, labelDiv, toggle);
    list.appendChild(row);
  });

  // ---- Pointer drag-to-reorder ----
  bindVisibilityListDrag(list);
}

function bindVisibilityListDrag(list) {
  let dragRow = null;       // the row being dragged
  let dragGhost = null;     // floating clone
  let startY = 0;
  let rowHeight = 0;
  let dropIndex = -1;       // current intended insertion index

  function getRows() {
    return Array.from(list.querySelectorAll('.vis-row'));
  }

  list.addEventListener('mousedown', (e) => {
    const grip = e.target.closest('.vis-drag-grip');
    if (!grip) return;

    dragRow = grip.closest('.vis-row');
    if (!dragRow) return;

    e.preventDefault();

    const rect = dragRow.getBoundingClientRect();
    rowHeight = rect.height;
    startY = e.clientY;
    dropIndex = getRows().indexOf(dragRow);

    // Build ghost
    dragGhost = dragRow.cloneNode(true);
    dragGhost.className = 'vis-row vis-drag-ghost';
    dragGhost.style.width  = rect.width + 'px';
    dragGhost.style.top    = rect.top + 'px';
    dragGhost.style.left   = rect.left + 'px';
    document.body.appendChild(dragGhost);

    dragRow.classList.add('vis-row-dragging');

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  });

  function onMouseMove(e) {
    if (!dragRow) return;
    const dy = e.clientY - startY;
    dragGhost.style.top = (parseFloat(dragGhost.style.top) + dy) + 'px';
    startY = e.clientY;

    // Find which slot the ghost centre is over
    const ghostCentreY = dragGhost.getBoundingClientRect().top + rowHeight / 2;
    const rows = getRows();
    let newIndex = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === dragRow) continue;
      const r = rows[i].getBoundingClientRect();
      if (ghostCentreY < r.top + r.height / 2) {
        newIndex = i;
        break;
      }
    }
    dropIndex = newIndex;

    // Visual placeholder: move a thin line or shift rows
    rows.forEach((r, i) => r.classList.remove('vis-drop-above', 'vis-drop-below'));
    if (rows[dropIndex] && rows[dropIndex] !== dragRow) {
      const ghostIdx = rows.indexOf(dragRow);
      rows[dropIndex].classList.add(dropIndex < ghostIdx ? 'vis-drop-above' : 'vis-drop-below');
    }
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);

    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    if (!dragRow)  return;

    dragRow.classList.remove('vis-row-dragging');
    list.querySelectorAll('.vis-drop-above, .vis-drop-below')
      .forEach(r => r.classList.remove('vis-drop-above', 'vis-drop-below'));

    const rows = getRows();
    const srcIndex = rows.indexOf(dragRow);

    if (srcIndex !== -1 && dropIndex !== -1 && srcIndex !== dropIndex) {
      // Re-order appData.categories to match new visual order
      const sorted = [...appData.categories].sort((a, b) => a.order - b.order);
      const [moved] = sorted.splice(srcIndex, 1);
      sorted.splice(dropIndex, 0, moved);
      sorted.forEach((c, i) => { c.order = i; });
      appData.categories = sorted;

      localSavePending++;
      Storage.saveImmediate(appData).then(Utils.flashSaveIndicator).catch(console.error);
      // Re-render the main grid and the list to reflect new order
      renderAll();
      DragDrop.init(handleDrop);
      renderCategoryVisibilityList();
    }

    dragRow = null;
    dropIndex = -1;
  }
}

function openModal(id) {
  document.getElementById(id).classList.add('is-open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('is-open');
}

// =========================================================
// Save and re-render
// =========================================================
function saveAndRefresh() {
  const container = document.getElementById('categoriesGrid');
  // Automatically capture ALL scroll positions before re-rendering
  const scrollState = {};
  const isBirdsEye = appData.settings.birdsEyeView;
  const isKanban = document.querySelector('.categories-grid.layout-kanban');

  if (isBirdsEye) {
    // Bird's-eye mode: capture page scroll + each workspace grid's horizontal scroll + each card's vertical scroll
    scrollState.window = window.scrollY;
    scrollState.grids = {};
    scrollState.cards = {};
    document.querySelectorAll('.workspace-section').forEach(section => {
      const wsId = section.dataset.workspaceId;
      const grid = section.querySelector('.categories-grid');
      if (grid && wsId) {
        scrollState.grids[wsId] = grid.scrollLeft;
      }
    });
    document.querySelectorAll('.category-card').forEach(card => {
      const catId = card.dataset.categoryId;
      const sitesList = card.querySelector('.sites-list');
      if (sitesList && catId) {
        scrollState.cards[catId] = sitesList.scrollTop;
      }
    });
  } else if (isKanban) {
    // Kanban mode: capture main grid horizontal scroll + each category's vertical scroll
    scrollState.gridScrollLeft = container ? container.scrollLeft : 0;
    document.querySelectorAll('.category-card').forEach(card => {
      const catId = card.dataset.categoryId;
      const sitesList = card.querySelector('.sites-list');
      if (sitesList && catId) {
        scrollState[catId] = sitesList.scrollTop;
      }
    });
  } else {
    // Column mode: capture window scroll
    scrollState.window = window.scrollY;
  }

  // Save immediately (no debounce) for user-initiated changes
  localSavePending++;
  Storage.saveImmediate(appData).then(Utils.flashSaveIndicator).catch(console.error);

  // Pin container height to prevent page collapse during DOM rebuild
  const pinHeight = container ? container.offsetHeight : 0;
  if (container && pinHeight > 0) {
    container.style.minHeight = pinHeight + 'px';
  }

  renderAll();
  // Re-init drag-drop after DOM rebuild
  DragDrop.init(handleDrop);

  // Restore ALL scroll positions synchronously after DOM rebuild
  // (skip if navigation code will handle scrolling itself)
  if (skipScrollRestore) {
    skipScrollRestore = false;
    return;
  }
  if (isBirdsEye) {
    window.scrollTo({ top: scrollState.window, behavior: 'instant' });
    if (scrollState.grids) {
      Object.entries(scrollState.grids).forEach(([wsId, scrollLeft]) => {
        const section = document.querySelector(`.workspace-section[data-workspace-id="${wsId}"]`);
        const grid = section?.querySelector('.categories-grid');
        if (grid) grid.scrollTo({ left: scrollLeft, behavior: 'instant' });
      });
    }
    if (scrollState.cards) {
      Object.entries(scrollState.cards).forEach(([catId, scrollTop]) => {
        const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
        const sitesList = card?.querySelector('.sites-list');
        if (sitesList) sitesList.scrollTo({ top: scrollTop, behavior: 'instant' });
      });
    }
  } else if (isKanban) {
    // Restore main grid horizontal scroll
    const freshContainer = document.getElementById('categoriesGrid');
    if (freshContainer && scrollState.gridScrollLeft) {
      freshContainer.scrollTo({ left: scrollState.gridScrollLeft, behavior: 'instant' });
    }
    // Restore each category's internal vertical scroll
    Object.entries(scrollState).forEach(([key, scrollTop]) => {
      if (key === 'gridScrollLeft') return;
      const card = document.querySelector(`.category-card[data-category-id="${key}"]`);
      const sitesList = card?.querySelector('.sites-list');
      if (sitesList) {
        sitesList.scrollTo({ top: scrollTop, behavior: 'instant' });
      }
    });
  } else {
    window.scrollTo({ top: scrollState.window, behavior: 'instant' });
  }

  // Release pinned height
  if (container) container.style.minHeight = '';
}

// =========================================================
// Helpers: find by id
// =========================================================
function getCatById(id) {
  return appData.categories.find(c => c.id === id)
    || (liveTabsData?.categories || []).find(c => c.id === id)
    || null;
}

function getSiteById(catId, siteId) {
  const cat = getCatById(catId);
  return cat ? cat.sites.find(s => s.id === siteId) || null : null;
}

function reindexSites(cat) {
  cat.sites.forEach((s, i) => s.order = i);
}

function reindexCategories() {
  appData.categories.forEach((c, i) => c.order = i);
}

// =========================================================
// Workspace Helpers
// =========================================================
function getWorkspaceById(id) {
  return appData.workspaces.find(w => w.id === id) || null;
}

function reindexWorkspaces() {
  appData.workspaces.forEach((w, i) => w.order = i);
}

function scrollToCategory(catId) {
  const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

// Horizontally center a card within its .categories-grid using getBoundingClientRect
function scrollToCategoryInGrid(catId) {
  const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
  if (!card) return;
  const grid = card.closest('.categories-grid');
  if (!grid) return;
  const gridRect = grid.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const currentScroll = grid.scrollLeft;
  const cardLeftInGrid = cardRect.left - gridRect.left + currentScroll;
  const scrollTarget = cardLeftInGrid - (grid.clientWidth - card.offsetWidth) / 2;
  grid.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
}

let lastSearchQuery = '';

function goToCategory(catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  const savedQuery = searchQuery;

  // Clear search
  const searchInput = document.getElementById('searchInput');
  searchInput.value = '';
  document.getElementById('clearSearch').hidden = true;
  applySearch('');

  if (appData.settings.birdsEyeView) {
    // Bird's-eye mode: all workspaces are visible, just scroll to the right section + card
    lastSearchQuery = savedQuery;
    setActiveWorkspace(cat.workspaceId);
    // Use requestAnimationFrame to let renderAll finish DOM updates
    requestAnimationFrame(() => {
      const section = document.querySelector(`.workspace-section[data-workspace-id="${cat.workspaceId}"]`);
      if (section) {
        // Expand if collapsed
        if (section.classList.contains('collapsed')) {
          skipScrollRestore = true;
          toggleWorkspaceCollapse(cat.workspaceId);
        }
      }
      requestAnimationFrame(() => {
        const freshSection = document.querySelector(`.workspace-section[data-workspace-id="${cat.workspaceId}"]`);
        if (freshSection) freshSection.scrollIntoView({ behavior: 'instant', block: 'start' });
        scrollToCategoryInGrid(catId);
        scrollToMatchInCategory(catId, savedQuery);
        flashHighlightCard(catId);
        showBackToSearch();
      });
    });
  } else if (cat.workspaceId !== appData.settings.currentWorkspace) {
    // Normal mode: switch workspace if needed, then scroll
    lastSearchQuery = savedQuery;
    switchWorkspace(cat.workspaceId);
    // Restore after switchWorkspace clears it
    lastSearchQuery = savedQuery;
    setTimeout(() => {
      scrollToCategory(catId);
      scrollToMatchInCategory(catId, savedQuery);
      showBackToSearch();
    }, 350);
  } else {
    lastSearchQuery = savedQuery;
    scrollToCategory(catId);
    scrollToMatchInCategory(catId, savedQuery);
    showBackToSearch();
  }
}

function scrollToMatchInCategory(catId, query) {
  if (!query) return;
  const q = query.toLowerCase().trim();
  const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
  if (!card) return;

  const cat = getCatById(catId);
  if (!cat) return;

  // Find the first matching site tile
  const tiles = card.querySelectorAll('.site-tile, .note-tile');
  for (const tile of tiles) {
    const siteId = tile.dataset.siteId;
    const site = getSiteById(catId, siteId);
    if (!site) continue;

    let match = false;
    if (site.type === 'note') {
      match = (site.name || '').toLowerCase().includes(q) ||
              (site.text || '').toLowerCase().includes(q);
    } else {
      match = (site.name || '').toLowerCase().includes(q) ||
              (site.url  || '').toLowerCase().includes(q) ||
              (site.note || '').toLowerCase().includes(q);
    }

    if (match) {
      // Scroll the tile into view within the sites-list container
      const sitesList = card.querySelector('.sites-list');
      if (sitesList) {
        const tileTop = tile.offsetTop - sitesList.offsetTop;
        const tileHeight = tile.offsetHeight;
        const listHeight = sitesList.clientHeight;
        sitesList.scrollTop = tileTop - (listHeight / 2) + (tileHeight / 2);
      }

      // Brief highlight to show which item matched
      tile.style.transition = 'background 0.3s ease';
      tile.style.background = 'var(--accent-bg)';
      setTimeout(() => {
        tile.style.background = '';
        setTimeout(() => { tile.style.transition = ''; }, 300);
      }, 1500);

      break;
    }
  }
}

function showBackToSearch() {
  if (!lastSearchQuery) return;
  const bar = document.getElementById('backToSearchBar');
  const querySpan = document.getElementById('backToSearchQuery');
  querySpan.textContent = lastSearchQuery;
  bar.hidden = false;

  function dismiss() {
    bar.hidden = true;
    lastSearchQuery = '';
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.target.closest('.back-to-search-bar')) return;
    dismiss();
  }
  document.addEventListener('keydown', onKey, { once: true });

  document.getElementById('backToSearchBtn').onclick = () => {
    const q = lastSearchQuery;
    dismiss();
    const searchInput = document.getElementById('searchInput');
    searchInput.value = q;
    document.getElementById('clearSearch').hidden = false;
    applySearch(q);
  };
}

let switchingWorkspace = false;

function switchWorkspace(workspaceId) {
  if (switchingWorkspace) return; // Prevent double-switching
  // Allow Live Tabs or a real workspace
  if (workspaceId !== LIVE_TABS_ID && !getWorkspaceById(workspaceId)) return;
  if (appData.settings.currentWorkspace === workspaceId) return; // Already on this workspace

  // Stop live tabs listeners when leaving Live Tabs
  if (isLiveTabsActive() && workspaceId !== LIVE_TABS_ID) {
    stopLiveTabsListeners();
  }

  switchingWorkspace = true;
  appData.settings.currentWorkspace = workspaceId;

  // Dismiss back-to-search bar when manually switching workspaces
  document.getElementById('backToSearchBar').hidden = true;
  lastSearchQuery = '';

  // Clear search when switching workspaces
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    document.getElementById('clearSearch').hidden = true;
  }
  searchQuery = '';

  if (workspaceId === LIVE_TABS_ID) {
    // Load live tabs then render (don't save to storage via saveAndRefresh)
    loadLiveTabs().then(() => {
      startLiveTabsListeners();
      renderAll();
      DragDrop.init(handleDrop);
      updateWorkspaceUI();
      // Save workspace selection
      localSavePending++;
      Storage.saveData(appData, Utils.flashSaveIndicator);
      switchingWorkspace = false;
    }).catch((err) => {
      console.error('Failed to load live tabs:', err);
      switchingWorkspace = false;
    });
  } else {
    saveAndRefresh();
    // Reset flag after a short delay
    setTimeout(() => {
      switchingWorkspace = false;
    }, 300);
  }
}

function createWorkspace(name) {
  const newWorkspace = {
    id: Utils.generateId(),
    name: name || 'New Workspace',
    order: appData.workspaces.length
  };

  Undo.saveSnapshot('Create workspace', appData);
  appData.workspaces.push(newWorkspace);
  appData.settings.currentWorkspace = newWorkspace.id;
  saveAndRefresh();
  return newWorkspace.id;
}

async function deleteWorkspace(workspaceId) {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) return;

  // Check if this is the last workspace
  if (appData.workspaces.length === 1) {
    await Utils.alert('Cannot delete the last workspace.');
    return;
  }

  // Build confirmation message with details about what will be deleted
  const categoriesInWorkspace = appData.categories.filter(c => c.workspaceId === workspaceId);
  const catCount = categoriesInWorkspace.length;
  const siteCount = categoriesInWorkspace.reduce((sum, c) => sum + c.sites.length, 0);

  let msg;
  if (catCount === 0) {
    msg = `Delete workspace "${workspace.name}"?`;
  } else {
    const catLabel = catCount === 1 ? '1 category' : `${catCount} categories`;
    const siteLabel = siteCount === 1 ? '1 site' : `${siteCount} sites`;
    msg = `Delete workspace "${workspace.name}" and its ${catLabel} (${siteLabel})? This can be undone.`;
  }

  const ok = await Utils.confirm(msg, 'Delete');
  if (!ok) return;

  Undo.saveSnapshot('Delete workspace', appData);

  // Remove categories belonging to this workspace
  appData.categories = appData.categories.filter(c => c.workspaceId !== workspaceId);

  // Remove workspace
  appData.workspaces = appData.workspaces.filter(w => w.id !== workspaceId);
  reindexWorkspaces();

  // Switch to first workspace if current was deleted
  if (appData.settings.currentWorkspace === workspaceId) {
    appData.settings.currentWorkspace = appData.workspaces[0].id;
  }

  saveAndRefresh();
}

async function renameWorkspace(workspaceId, newName) {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) return;

  const trimmedName = (newName || '').trim();
  if (!trimmedName || trimmedName === workspace.name) return;

  Undo.saveSnapshot('Rename workspace', appData);
  workspace.name = trimmedName;
  saveAndRefresh();
}

function moveCategoryToWorkspace(catId, targetWorkspaceId, position) {
  const cat = getCatById(catId);
  const targetWorkspace = getWorkspaceById(targetWorkspaceId);
  if (!cat || !targetWorkspace) return;

  Undo.saveSnapshot('Move category to workspace', appData);
  cat.workspaceId = targetWorkspaceId;

  // Set order to place at top or bottom of target workspace
  const siblings = appData.categories.filter(c => c.workspaceId === targetWorkspaceId && c.id !== catId);
  if (position === 'top') {
    const minOrder = siblings.length ? Math.min(...siblings.map(c => c.order)) : 0;
    cat.order = minOrder - 1;
  } else {
    const maxOrder = siblings.length ? Math.max(...siblings.map(c => c.order)) : 0;
    cat.order = maxOrder + 1;
  }

  saveAndRefresh();
}

function duplicateWorkspace(workspaceId) {
  const ws = getWorkspaceById(workspaceId);
  if (!ws) return;

  Undo.saveSnapshot('Duplicate workspace', appData);

  const newWs = {
    id: Utils.generateId(),
    name: ws.name + '+',
    order: ws.order + 0.5
  };
  appData.workspaces.push(newWs);
  // Re-sort and reindex to slot it right after the original
  appData.workspaces.sort((a, b) => a.order - b.order);
  appData.workspaces.forEach((w, i) => { w.order = i; });

  // Deep clone all categories belonging to this workspace
  const cats = appData.categories.filter(c => c.workspaceId === workspaceId);
  cats.forEach(cat => {
    const copy = JSON.parse(JSON.stringify(cat));
    copy.id = Utils.generateId();
    copy.workspaceId = newWs.id;
    copy.sites.forEach(s => { s.id = Utils.generateId(); });
    appData.categories.push(copy);
  });

  saveAndRefresh();
}

function copyCategoryToWorkspace(catId, targetWorkspaceId, position) {
  const cat = getCatById(catId);
  const targetWorkspace = getWorkspaceById(targetWorkspaceId);
  if (!cat || !targetWorkspace) return;

  Undo.saveSnapshot('Copy category to workspace', appData);

  const copy = JSON.parse(JSON.stringify(cat));
  copy.id = Utils.generateId();
  copy.workspaceId = targetWorkspaceId;
  copy.sites.forEach(s => { s.id = Utils.generateId(); });

  // Set order to place at top or bottom of target workspace
  const siblings = appData.categories.filter(c => c.workspaceId === targetWorkspaceId);
  if (position === 'top') {
    const minOrder = siblings.length ? Math.min(...siblings.map(c => c.order)) : 0;
    copy.order = minOrder - 1;
  } else {
    const maxOrder = siblings.length ? Math.max(...siblings.map(c => c.order)) : 0;
    copy.order = maxOrder + 1;
  }

  appData.categories.push(copy);
  saveAndRefresh();
}

function duplicateCategory(catId) {
  const cat = getCatById(catId);
  if (!cat) return;

  Undo.saveSnapshot('Duplicate category', appData);

  // Bump order of all categories after the original in the same workspace
  const originalOrder = cat.order;
  appData.categories.forEach(c => {
    if (c.workspaceId === cat.workspaceId && c.order > originalOrder) {
      c.order++;
    }
  });

  // Clone the category with new IDs
  const copy = JSON.parse(JSON.stringify(cat));
  copy.id = Utils.generateId();
  copy.name = cat.name + '+';
  copy.order = originalOrder + 1;
  copy.sites.forEach(s => { s.id = Utils.generateId(); });

  appData.categories.push(copy);
  saveAndRefresh();

  // Scroll to the new category after render
  setTimeout(() => scrollToCategory(copy.id), 100);
}

function updateWorkspaceUI() {
  const selector = document.getElementById('workspaceSelector');
  if (!selector) return;

  // Update trigger button with current workspace name
  const isLive = isLiveTabsActive();
  const currentWorkspace = isLive ? null : getWorkspaceById(appData.settings.currentWorkspace);
  const displayName = isLive ? 'Live Tabs' : (currentWorkspace?.name || 'Unknown');
  const trigger = selector.querySelector('.workspace-selector-trigger');
  if (trigger) {
    trigger.innerHTML = `${Utils.escapeHtml(displayName)}
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;
  }
}

function renderWorkspaceDropdown() {
  const dropdown = document.getElementById('workspaceDropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '';

  const sorted = [...appData.workspaces].sort((a, b) => a.order - b.order);

  sorted.forEach(ws => {
    const item = document.createElement('div');
    item.className = 'workspace-item';
    item.draggable = true;
    item.dataset.workspaceId = ws.id;
    if (ws.id === appData.settings.currentWorkspace) {
      item.classList.add('active');
    }

    // Drag handle
    const dragHandle = document.createElement('span');
    dragHandle.className = 'workspace-drag-handle';
    dragHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <line x1="9" y1="5" x2="9" y2="19"/>
      <line x1="15" y1="5" x2="15" y2="19"/>
    </svg>`;

    const nameEl = document.createElement('span');
    nameEl.className = 'workspace-name';
    nameEl.textContent = ws.name;
    nameEl.contentEditable = false;

    // Click to switch workspace (or scroll to it in bird's-eye mode)
    item.addEventListener('click', (e) => {
      // Don't switch if user is editing the name
      if (nameEl.contentEditable === 'true') return;
      e.stopPropagation();
      if (appData.settings.birdsEyeView && !isLiveTabsActive()) {
        // Bird's-eye mode: scroll to the workspace section instead of switching
        const section = document.querySelector(`.workspace-section[data-workspace-id="${ws.id}"]`);
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setActiveWorkspace(ws.id);
        }
      } else {
        switchWorkspace(ws.id);
      }
      dropdown.hidden = true;
    });

    // Double-click to rename
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const originalName = ws.name;
      nameEl.contentEditable = true;
      nameEl.focus();
      document.execCommand('selectAll', false, null);

      const finishEdit = () => {
        nameEl.contentEditable = false;
        const newName = nameEl.textContent.trim();
        if (newName && newName !== originalName) {
          renameWorkspace(ws.id, newName);
        } else {
          nameEl.textContent = originalName;
        }
      };

      nameEl.addEventListener('blur', finishEdit, { once: true });
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameEl.blur();
        } else if (e.key === 'Escape') {
          nameEl.textContent = originalName;
          nameEl.blur();
        }
      });
    });

    const actions = document.createElement('div');
    actions.className = 'workspace-actions';

    // Duplicate button
    const dupeBtn = document.createElement('button');
    dupeBtn.className = 'workspace-copy-btn';
    dupeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`;
    dupeBtn.title = 'Duplicate workspace';
    dupeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateWorkspace(ws.id);
      renderWorkspaceDropdown();
    });
    actions.appendChild(dupeBtn);

    // Delete button (only if more than one workspace)
    if (appData.workspaces.length > 1) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'workspace-delete-btn';
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>`;
      deleteBtn.title = 'Delete workspace';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.hidden = true;
        deleteWorkspace(ws.id);
      });
      actions.appendChild(deleteBtn);
    }

    // Drag events for reordering
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ws.id);
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const draggingItem = dropdown.querySelector('.dragging');
      if (draggingItem && draggingItem !== item) {
        const rect = item.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          item.parentNode.insertBefore(draggingItem, item);
        } else {
          item.parentNode.insertBefore(draggingItem, item.nextSibling);
        }
      }
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      // Reorder workspaces array based on DOM order
      const items = Array.from(dropdown.querySelectorAll('.workspace-item'));
      const newOrder = items.map(el => {
        const workspaceId = el.dataset.workspaceId;
        return getWorkspaceById(workspaceId);
      }).filter(ws => ws !== null);

      // Replace workspaces array with new order
      appData.workspaces = newOrder;
      reindexWorkspaces();
      localSavePending++;
      Storage.saveData(appData, Utils.flashSaveIndicator);

      // Re-render dropdown to reflect new order
      renderWorkspaceDropdown();
    });

    item.append(dragHandle, nameEl, actions);
    dropdown.appendChild(item);
  });

  // Add "New Workspace" button
  const newBtn = document.createElement('button');
  newBtn.className = 'workspace-new-btn';
  newBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg> New Workspace`;
  newBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdown.hidden = true;
    const name = await Utils.prompt('Workspace name:', 'New Workspace');
    if (name) {
      createWorkspace(name);
    }
  });

  dropdown.appendChild(newBtn);

  // Add Live Tabs workspace entry (always last)
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    const divider = document.createElement('div');
    divider.className = 'workspace-dropdown-divider';
    dropdown.appendChild(divider);

    const liveItem = document.createElement('div');
    liveItem.className = 'workspace-item workspace-item-live';
    if (isLiveTabsActive()) liveItem.classList.add('active');

    const liveIcon = document.createElement('span');
    liveIcon.className = 'workspace-live-icon';
    liveIcon.textContent = '📡';

    const liveName = document.createElement('span');
    liveName.className = 'workspace-name';
    liveName.textContent = 'Live Tabs';

    liveItem.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.hidden = true;
      switchWorkspace(LIVE_TABS_ID);
    });

    liveItem.append(liveIcon, liveName);
    dropdown.appendChild(liveItem);
  }
}

function showWorkspaceMenu(button, catId) {
  // Remove any existing workspace menu
  const existing = document.getElementById('workspaceMenu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'workspaceMenu';
  menu.className = 'workspace-menu';

  // Move / Copy radio toggle
  let mode = 'move';
  const toggleBar = document.createElement('div');
  toggleBar.className = 'move-menu-mode-toggle';

  const moveLabel = document.createElement('label');
  moveLabel.className = 'move-menu-mode-label';
  const moveRadio = document.createElement('input');
  moveRadio.type = 'radio';
  moveRadio.name = 'wsMoveMode';
  moveRadio.value = 'move';
  moveRadio.checked = true;
  moveRadio.addEventListener('change', () => { mode = 'move'; });
  moveLabel.append(moveRadio, ' Move');

  const copyLabel = document.createElement('label');
  copyLabel.className = 'move-menu-mode-label';
  const copyRadio = document.createElement('input');
  copyRadio.type = 'radio';
  copyRadio.name = 'wsMoveMode';
  copyRadio.value = 'copy';
  copyRadio.addEventListener('change', () => { mode = 'copy'; });
  copyLabel.append(copyRadio, ' Copy');

  toggleBar.append(moveLabel, copyLabel);
  menu.appendChild(toggleBar);

  const sorted = [...appData.workspaces].sort((a, b) => a.order - b.order);
  const currentCat = getCatById(catId);

  sorted.forEach(ws => {
    const row = document.createElement('div');
    row.className = 'move-menu-row';
    if (ws.id === currentCat.workspaceId) {
      row.classList.add('current');
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'move-menu-cat-label';
    labelEl.textContent = ws.name;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'move-menu-pos-btns';

    const topBtn = document.createElement('button');
    topBtn.className = 'move-menu-pos-btn';
    topBtn.title = 'Place at front of workspace';
    topBtn.textContent = '↑ Top';
    topBtn.addEventListener('click', () => {
      if (mode === 'copy') {
        copyCategoryToWorkspace(catId, ws.id, 'top');
      } else {
        moveCategoryToWorkspace(catId, ws.id, 'top');
      }
      menu.remove();
    });

    const botBtn = document.createElement('button');
    botBtn.className = 'move-menu-pos-btn';
    botBtn.title = 'Place at back of workspace';
    botBtn.textContent = '↓ Bottom';
    botBtn.addEventListener('click', () => {
      if (mode === 'copy') {
        copyCategoryToWorkspace(catId, ws.id, 'bottom');
      } else {
        moveCategoryToWorkspace(catId, ws.id, 'bottom');
      }
      menu.remove();
    });

    btnGroup.append(topBtn, botBtn);
    row.append(labelEl, btnGroup);
    menu.appendChild(row);
  });

  // Position menu below button, clamped to viewport
  menu.style.position = 'absolute';
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);

  const rect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;

  // Clamp right edge
  if (left + menuRect.width > window.innerWidth - 8) {
    left = window.innerWidth - menuRect.width - 8;
  }
  // Clamp bottom edge — flip above button if needed
  if (top + menuRect.height > window.innerHeight - 8) {
    top = rect.top - menuRect.height - 4;
  }
  // Clamp left/top minimums
  if (left < 8) left = 8;
  if (top < 8) top = 8;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.visibility = '';

  // Close on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target) && e.target !== button) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// =========================================================
// Global Event Bindings
// =========================================================
function bindGlobalEvents() {

  // ---- Bird's-eye toggle ----
  document.getElementById('birdsEyeToggle').addEventListener('click', toggleBirdsEyeView);
  document.getElementById('birdsEyeToggle').classList.toggle('active', appData.settings.birdsEyeView);

  // ---- Save all open tabs ----
  document.getElementById('saveAllTabsBtn').addEventListener('click', saveAllOpenTabs);

  // ---- Copy all open tabs to clipboard ----
  document.getElementById('copyAllTabsBtn').addEventListener('click', copyAllOpenTabs);

  // ---- Sort browser tabs by recent ----
  document.getElementById('sortTabsRecentBtn').addEventListener('click', sortTabsByRecent);

  // ---- Close all tabs ----
  document.getElementById('closeAllTabsBtn').addEventListener('click', closeAllTabs);

  // ---- Search ----
  const searchInput = document.getElementById('searchInput');
  const clearBtn    = document.getElementById('clearSearch');

  const debouncedSearch = Utils.debounce((q) => applySearch(q), 250);

  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    clearBtn.hidden = !q;
    debouncedSearch(q);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.hidden = true;
    applySearch('');
    searchInput.focus();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + K → focus search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    // Option+0 → jump to inbox category
    if (e.altKey && e.code === 'Digit0') {
      const inboxId = appData.settings.quickAddInbox;
      if (!inboxId) return;
      const inboxCat = getCatById(inboxId);
      if (!inboxCat) return;
      e.preventDefault();

      if (appData.settings.birdsEyeView) {
        const section = document.querySelector(`.workspace-section[data-workspace-id="${inboxCat.workspaceId}"]`);
        if (section) {
          const wasCollapsed = section.classList.contains('collapsed');
          if (wasCollapsed) {
            skipScrollRestore = true;
            toggleWorkspaceCollapse(inboxCat.workspaceId);
          }
          setActiveWorkspace(inboxCat.workspaceId);
          // Allow re-render to complete if collapsed section was expanded
          requestAnimationFrame(() => {
            const freshSection = document.querySelector(`.workspace-section[data-workspace-id="${inboxCat.workspaceId}"]`);
            if (freshSection) freshSection.scrollIntoView({ behavior: 'instant', block: 'start' });
            // Horizontally scroll the card into view within the grid using getBoundingClientRect
            const card = document.querySelector(`.category-card[data-category-id="${inboxId}"]`);
            if (card) {
              const grid = card.closest('.categories-grid');
              if (grid) {
                const gridRect = grid.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const currentScroll = grid.scrollLeft;
                const cardLeftInGrid = cardRect.left - gridRect.left + currentScroll;
                const scrollTarget = cardLeftInGrid - (grid.clientWidth - card.offsetWidth) / 2;
                grid.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
              }
              flashHighlightCard(inboxId);
            }
          });
        }
      } else if (inboxCat.workspaceId !== appData.settings.currentWorkspace) {
        switchWorkspace(inboxCat.workspaceId);
        setTimeout(() => {
          scrollToCategory(inboxId);
          flashHighlightCard(inboxId);
        }, 350);
      } else {
        scrollToCategory(inboxId);
        flashHighlightCard(inboxId);
      }
    }
    // Option+Up/Down → previous/next workspace
    if (e.altKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      const sorted = [...appData.workspaces].sort((a, b) => a.order - b.order);
      const curIdx = sorted.findIndex(w => w.id === appData.settings.currentWorkspace);
      const nextIdx = e.code === 'ArrowUp' ? curIdx - 1 : curIdx + 1;
      if (nextIdx >= 0 && nextIdx < sorted.length) {
        e.preventDefault();
        if (appData.settings.birdsEyeView) {
          setActiveWorkspace(sorted[nextIdx].id);
          const section = document.querySelector(`.workspace-section[data-workspace-id="${sorted[nextIdx].id}"]`);
          if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          switchWorkspace(sorted[nextIdx].id);
        }
      }
      return;
    }
    // Option+Left/Right → scroll categories grid horizontally
    if (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      let grid;
      if (appData.settings.birdsEyeView) {
        grid = document.querySelector('.workspace-section.active .categories-grid');
      } else {
        grid = document.querySelector('.categories-grid');
      }
      if (grid) {
        e.preventDefault();
        const distance = e.code === 'ArrowLeft' ? -672 : 672;
        grid.scrollBy({ left: distance, behavior: 'smooth' });
      }
      return;
    }
    // Option+1–9 (or Cmd+Option+1–9) → switch workspace by position
    if (e.altKey && e.code >= 'Digit1' && e.code <= 'Digit9') {
      const sorted = [...appData.workspaces].sort((a, b) => a.order - b.order);
      const idx = parseInt(e.code.charAt(5), 10) - 1;
      if (idx < sorted.length) {
        e.preventDefault();
        if (appData.settings.birdsEyeView) {
          const section = document.querySelector(`.workspace-section[data-workspace-id="${sorted[idx].id}"]`);
          if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveWorkspace(sorted[idx].id);
          }
        } else {
          switchWorkspace(sorted[idx].id);
        }
      }
      return;
    }
    // ESC → exit select mode, or clear search, or close menus
    if (e.key === 'Escape') {
      if (selectMode) {
        exitSelectMode();
        return;
      }
      if (searchInput.value) {
        searchInput.value = '';
        clearBtn.hidden = true;
        applySearch('');
      }
      hideContextMenu();
      document.getElementById('emojiGrid').classList.remove('open');
    }
  });

  // ---- Add Category ----
  document.getElementById('addCategoryBtn').addEventListener('click', () => {
    openCategoryModal(null);
  });

  // ---- Save Category ----
  document.getElementById('saveCategoryBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    saveCategory();
  });

  // Enter key in category name field
  document.getElementById('categoryName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.stopPropagation(); saveCategory(); }
  });

  // ---- Save Site ----
  document.getElementById('saveSiteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    saveSite();
  });

  // Enter on URL field: only save in edit mode (single URL).
  // In add mode, Enter always inserts a newline so bulk pasting works freely.
  document.getElementById('siteUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter' && editingSiteId) {
      e.preventDefault();
      e.stopPropagation();
      saveSite();
    }
  });

  // Auto-populate name from URL (single URL only — multi-line uses nameFromUrl per item)
  document.getElementById('siteUrl').addEventListener('blur', () => {
    const nameInput = document.getElementById('siteName');
    const urlVal = document.getElementById('siteUrl').value.trim();
    // Only auto-fill if this looks like a single URL (no newlines)
    if (!nameInput.value && urlVal && !urlVal.includes('\n')) {
      nameInput.value = Utils.nameFromUrl(Utils.normaliseUrl(urlVal));
    }
  });

  // Show/hide Name and Favicon fields based on single vs multi-line URL input
  document.getElementById('siteUrl').addEventListener('input', () => {
    if (editingSiteId) return; // always show in edit mode
    const isBulk = document.getElementById('siteUrl').value.includes('\n');
    document.getElementById('siteNameGroup').hidden    = isBulk;
    document.getElementById('siteFaviconGroup').hidden = isBulk;
  });

  // ---- Favicon preview (live update) ----
  document.getElementById('siteFavicon').addEventListener('input', () => {
    updateFaviconPreview(document.getElementById('siteFavicon').value.trim());
  });

  // ---- Stock Favicon Picker ----
  (function initFaviconPicker() {
    const grid = document.getElementById('faviconPickerGrid');
    const toggle = document.getElementById('faviconPickerToggle');
    const input = document.getElementById('siteFavicon');

    // Populate grid
    Utils.STOCK_FAVICONS.forEach(icon => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'favicon-picker-item';
      btn.title = icon.name;
      btn.dataset.url = icon.url;
      const img = document.createElement('img');
      img.src = icon.url;
      img.alt = icon.name;
      btn.appendChild(img);
      grid.appendChild(btn);
    });

    // Toggle grid visibility
    toggle.addEventListener('click', () => {
      const isHidden = grid.hidden;
      grid.hidden = !isHidden;
      toggle.textContent = isHidden ? 'Hide icons' : 'Stock icons';
    });

    // Click handler for picking an icon
    grid.addEventListener('click', (e) => {
      const item = e.target.closest('.favicon-picker-item');
      if (!item) return;
      // Clear previous selection
      grid.querySelectorAll('.favicon-picker-item.selected').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      input.value = item.dataset.url;
      updateFaviconPreview(item.dataset.url);
    });
  })();

  // Type toggle: URL / Note
  document.getElementById('typeUrlBtn').addEventListener('click', () => {
    document.getElementById('typeUrlBtn').classList.add('active');
    document.getElementById('typeNoteBtn').classList.remove('active');
    document.getElementById('siteUrlFields').hidden  = false;
    document.getElementById('siteNoteFields').hidden = true;
    document.getElementById('saveSiteBtn').textContent = 'Save Site';
    document.getElementById('siteUrl').focus();
  });

  document.getElementById('typeNoteBtn').addEventListener('click', () => {
    document.getElementById('typeNoteBtn').classList.add('active');
    document.getElementById('typeUrlBtn').classList.remove('active');
    document.getElementById('siteNoteFields').hidden = false;
    document.getElementById('siteUrlFields').hidden  = true;
    document.getElementById('saveSiteBtn').textContent = 'Save Note';
    document.getElementById('noteText').focus();
  });

  // ---- Modal close buttons (data-modal attribute) ----
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-modal]');
    if (closeBtn) {
      const modalId = closeBtn.dataset.modal;
      closeModal(modalId);
      if (modalId === 'siteModal')     { editingSiteId = null; editingCatId = null; }
      if (modalId === 'categoryModal') { editingCategoryId = null; document.getElementById('emojiGrid').classList.remove('open'); }
      if (modalId === 'pickerModal')   { pickerItems = []; }
    }
  });

  // Click outside modal overlay (on the backdrop) to close
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay') &&
        e.target.classList.contains('is-open') &&
        e.target.id !== 'confirmDialog') {
      const id = e.target.id;
      closeModal(id);
      if (id === 'pickerModal') pickerItems = [];
    }
  });

  // ---- Theme Toggle (header button) ----
  document.getElementById('themeToggle').addEventListener('click', () => {
    appData.settings.theme = appData.settings.theme === 'light' ? 'dark' : 'light';
    applySettings();
    localSavePending++;
    Storage.saveData(appData, Utils.flashSaveIndicator);
  });

  // ---- Workspace Selector ----
  const workspaceTrigger = document.getElementById('workspaceTrigger');
  const workspaceDropdown = document.getElementById('workspaceDropdown');

  workspaceTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !workspaceDropdown.hidden;
    workspaceDropdown.hidden = isOpen;

    if (!isOpen) {
      // Populate dropdown
      renderWorkspaceDropdown();
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    if (workspaceDropdown) workspaceDropdown.hidden = true;
  });

  // ---- Settings button ----
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);

  // Settings: theme options
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      appData.settings.theme = btn.dataset.theme;
      applySettings();
      localSavePending++;
      Storage.saveData(appData, Utils.flashSaveIndicator);
    });
  });

  // Settings: column options
  document.querySelectorAll('.col-option').forEach(btn => {
    btn.addEventListener('click', () => {
      appData.settings.columns = Number(btn.dataset.cols);
      applySettings();
      document.getElementById('categoriesGrid').style.setProperty('--cols', appData.settings.columns);
      localSavePending++;
      Storage.saveData(appData, Utils.flashSaveIndicator);
    });
  });

  // Settings: show site count toggle
  document.getElementById('showSiteCount').addEventListener('change', (e) => {
    appData.settings.showSiteCount = e.target.checked;
    // Update badges live without full re-render
    document.querySelectorAll('.category-count').forEach(el => {
      el.hidden = !appData.settings.showSiteCount;
    });
    localSavePending++;
    Storage.saveData(appData, Utils.flashSaveIndicator);
  });

  // Settings: Quick Add inbox dropdown
  document.getElementById('quickAddInbox').addEventListener('change', (e) => {
    appData.settings.quickAddInbox = e.target.value;
    localSavePending++;
    Storage.saveData(appData, Utils.flashSaveIndicator);
  });

  // Settings: Tab Splitter — max tabs
  document.getElementById('tabSplitMaxTabs').addEventListener('change', (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val) || val < 3) val = 3;
    if (val > 50) val = 50;
    e.target.value = val;
    appData.settings.tabSplitMaxTabs = val;
    localSavePending++;
    Storage.saveData(appData, Utils.flashSaveIndicator);
  });

  // Settings: Tab Splitter — auto-split toggle
  document.getElementById('tabSplitAutoSplit').addEventListener('change', (e) => {
    appData.settings.tabSplitAutoSplit = e.target.checked;
    localSavePending++;
    Storage.saveData(appData, Utils.flashSaveIndicator);
  });

  // Settings: Tab Splitter — split now button
  document.getElementById('tabSplitNowBtn').addEventListener('click', () => splitCurrentWindow('tabSplitNowBtn'));

  // Header: Split window button
  document.getElementById('splitWindowBtn').addEventListener('click', () => splitCurrentWindow('splitWindowBtn'));

  // Settings: export JSON
  document.getElementById('exportBtn').addEventListener('click', () => {
    Storage.exportData(appData);
  });

  // Settings: export HTML
  document.getElementById('exportHtmlBtn').addEventListener('click', () => {
    Storage.exportHtml(appData);
  });

  // Settings: copy all URLs to clipboard
  document.getElementById('copyAllUrlsBtn').addEventListener('click', async () => {
    const urls = appData.categories.flatMap(cat => cat.sites.filter(s => s.url).map(s => s.url));
    if (urls.length === 0) return;
    try {
      await navigator.clipboard.writeText(urls.join('\n'));
      const el = document.getElementById('saveIndicator');
      if (el) {
        el.textContent = `${urls.length} URL${urls.length === 1 ? '' : 's'} copied`;
        el.hidden = false;
        el.classList.add('show');
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => {
          el.classList.remove('show');
          setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
        }, 1200);
      }
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  });

  // Settings: import
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // Auto-detect format: peek at JSON to decide native vs TabExtend
      const text = await file.text();
      const parsed = JSON.parse(text);
      let imported;
      if (Array.isArray(parsed.tabData)) {
        // TabExtend export format
        imported = await Storage.importTabExtend(file);
      } else {
        // Native Tab Manager Pro format
        imported = await Storage.importData(file);
      }
      appData = imported;
      localSavePending++;
      await Storage.saveImmediate(appData);
      applySettings();
      renderAll();
      DragDrop.init(handleDrop);
      Utils.flashSaveIndicator();
      closeModal('settingsModal');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = ''; // reset input
  });

  // Settings: reset
  document.getElementById('resetBtn').addEventListener('click', async () => {
    const ok = await Utils.confirm('This will delete ALL your categories and sites. Are you sure?', 'Reset');
    if (!ok) return;
    appData = await Storage.resetData();
    applySettings();
    renderAll();
    DragDrop.init(handleDrop);
    closeModal('settingsModal');
    Utils.flashSaveIndicator();
  });

  // ---- Context Menu ----
  document.getElementById('contextMenu').addEventListener('click', async (e) => {
    const item = e.target.closest('.context-item');
    if (!item) return;
    const action = item.dataset.action;

    if (action === 'switch-to-tab') {
      const site = getSiteById(contextCatId, contextSiteId);
      hideContextMenu();
      if (site && site.tabId) {
        chrome.tabs.update(site.tabId, { active: true });
        chrome.windows.update(site.windowId, { focused: true });
      }
    }
    if (action === 'close-tab') {
      const site = getSiteById(contextCatId, contextSiteId);
      hideContextMenu();
      if (site && site.tabId) {
        chrome.tabs.remove(site.tabId).catch(console.error);
      }
    }
    if (action === 'open-new-tab') {
      const site = getSiteById(contextCatId, contextSiteId);
      if (site) window.open(site.url, '_blank', 'noopener');
      hideContextMenu();
    }
    if (action === 'copy-url') {
      const site = getSiteById(contextCatId, contextSiteId);
      hideContextMenu();
      if (site && site.url) {
        navigator.clipboard.writeText(site.url).then(() => {
          const el = document.getElementById('saveIndicator');
          if (el) {
            el.textContent = 'URL copied';
            el.hidden = false;
            el.classList.add('show');
            clearTimeout(el._hideTimer);
            el._hideTimer = setTimeout(() => {
              el.classList.remove('show');
              setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
            }, 1200);
          }
        }).catch(console.error);
      }
    }
    if (action === 'edit') {
      const id  = contextSiteId;
      const cid = contextCatId;
      hideContextMenu();
      openSiteModal(id, cid);
    }
    if (action === 'refresh-favicon') {
      const site = getSiteById(contextCatId, contextSiteId);
      hideContextMenu();
      if (site && site.url) {
        const fav = await Utils.fetchFavicon(site.url);
        if (fav) {
          site.favicon = fav;
        } else {
          site.favicon = '';
        }
        saveAndRefresh();
      }
    }
    if (action === 'fetch-description') {
      const site = getSiteById(contextCatId, contextSiteId);
      hideContextMenu();
      if (site && site.url && site.type !== 'note') {
        const el = document.getElementById('saveIndicator');
        if (el) {
          el.textContent = 'Fetching...';
          el.hidden = false;
          el.classList.add('show');
          clearTimeout(el._hideTimer);
        }
        const desc = await Utils.fetchMetaDescription(site.url);
        if (desc) {
          Undo.saveSnapshot('Fetch description', appData);
          site.note = site.note ? site.note + '\n\n---\n' + desc : desc;
          saveAndRefresh();
          if (el) {
            el.textContent = 'Description added';
            clearTimeout(el._hideTimer);
            el._hideTimer = setTimeout(() => {
              el.classList.remove('show');
              setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
            }, 1200);
          }
        } else {
          if (el) {
            el.textContent = 'No description found';
            clearTimeout(el._hideTimer);
            el._hideTimer = setTimeout(() => {
              el.classList.remove('show');
              setTimeout(() => { el.textContent = 'Saved'; el.hidden = true; }, 250);
            }, 1200);
          }
        }
      }
    }
    if (action === 'move') {
      showMoveMenu(item);
    }
    if (action === 'copy') {
      showCopyMenu(item);
    }
    if (action === 'move-to-top') {
      const id  = contextSiteId;
      const cid = contextCatId;
      hideContextMenu();
      moveSiteToTop(id, cid);
    }
    if (action === 'move-to-bottom') {
      const id  = contextSiteId;
      const cid = contextCatId;
      hideContextMenu();
      moveSiteToBottom(id, cid);
    }
    if (action === 'delete') {
      const id  = contextSiteId;
      const cid = contextCatId;
      hideContextMenu();
      deleteSiteWithConfirm(id, cid);
    }
  });

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#contextMenu') && !e.target.closest('#moveMenu')) {
      hideContextMenu();
    }
  });

  // Close emoji grid on outside click
  document.addEventListener('click', (e) => {
    const grid = document.getElementById('emojiGrid');
    const btn  = document.getElementById('selectedEmoji');
    if (!grid.contains(e.target) && e.target !== btn) {
      grid.classList.remove('open');
    }
  });

  // ---- From Browser button ----
  document.getElementById('addFromBrowserBtn').addEventListener('click', openPickerModal);

  // ---- Picker: source toggle ----
  document.querySelectorAll('.picker-source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.source;
      if (src === pickerSource) return;
      document.querySelectorAll('.picker-source-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      loadPickerSource(src);
    });
  });

  // ---- Picker: live filter ----
  document.getElementById('pickerSearch').addEventListener('input', (e) => {
    renderPickerList(e.target.value);
  });

  // ---- Picker: folder filter ----
  const folderSelect = document.getElementById('pickerFolderSelect');
  if (folderSelect) {
    folderSelect.addEventListener('change', (e) => {
      pickerSelectedFolder = e.target.value;
      renderPickerList(document.getElementById('pickerSearch').value);
    });
  }

  // ---- Picker: category selector (handle "New category" options) ----
  document.getElementById('pickerCategorySelect').addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === '__new_top__') {
      pendingPickerAddAfterCreate = true;
      pendingMovePosition = 'top';
      // Hide picker modal while creating category
      document.getElementById('pickerModal').style.display = 'none';
      openCategoryModal(null);
      // Reset dropdown to first category (will be updated after save)
      e.target.selectedIndex = 0;
    } else if (value === '__new_bottom__') {
      pendingPickerAddAfterCreate = true;
      pendingMovePosition = 'bottom';
      // Hide picker modal while creating category
      document.getElementById('pickerModal').style.display = 'none';
      openCategoryModal(null);
      // Reset dropdown to first category (will be updated after save)
      e.target.selectedIndex = 0;
    }
  });

  // ---- Picker: toggle "allow selecting saved items" ----
  document.getElementById('pickerToggleSaved').addEventListener('click', () => {
    pickerAllowSavedSelection = !pickerAllowSavedSelection;
    const btnText = document.getElementById('pickerToggleSavedText');
    btnText.textContent = pickerAllowSavedSelection ? 'Disable saved' : 'Enable saved';
    renderPickerList(document.getElementById('pickerSearch').value);
  });

  // ---- Picker: select all / clear ----
  document.getElementById('pickerSelectAll').addEventListener('click', () => {
    const q = (document.getElementById('pickerSearch').value || '').toLowerCase().trim();

    pickerItems.forEach(item => {
      // Only select items that match current filters
      if (item.alreadySaved && !pickerAllowSavedSelection) return;

      // Filter by folder
      if (pickerSource === 'bookmarks' && pickerSelectedFolder !== 'all') {
        if (item.folder !== pickerSelectedFolder) return;
      }

      // Filter by search query
      if (q) {
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesUrl = item.url.toLowerCase().includes(q);
        const matchesFolder = item.folder && item.folder.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl && !matchesFolder) return;
      }

      item.checked = true;
    });
    renderPickerList(document.getElementById('pickerSearch').value);
  });

  document.getElementById('pickerClearAll').addEventListener('click', () => {
    const q = (document.getElementById('pickerSearch').value || '').toLowerCase().trim();

    pickerItems.forEach(item => {
      // Only clear items that match current filters
      // Filter by folder
      if (pickerSource === 'bookmarks' && pickerSelectedFolder !== 'all') {
        if (item.folder !== pickerSelectedFolder) return;
      }

      // Filter by search query
      if (q) {
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesUrl = item.url.toLowerCase().includes(q);
        const matchesFolder = item.folder && item.folder.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl && !matchesFolder) return;
      }

      item.checked = false;
    });
    renderPickerList(document.getElementById('pickerSearch').value);
  });

  // ---- Picker: add selected ----
  document.getElementById('pickerAddBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    addPickerSelected();
  });

  // ---- Select mode ----
  document.getElementById('selectModeBtn').addEventListener('click', () => {
    selectMode ? exitSelectMode() : enterSelectMode();
  });

  document.getElementById('selectAllBtn').addEventListener('click', selectAllSites);
  document.getElementById('clearSelectionBtn').addEventListener('click', clearAllSelection);
  document.getElementById('deleteSelectedBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSelected();
  });

  document.getElementById('moveSelectedBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    showMoveSelectedMenu();
  });

  document.getElementById('copyUrlsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    copySelectedUrls();
  });

  document.getElementById('consolidateSelectedBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    consolidateSelectedUrls();
  });

  document.getElementById('refreshNamesBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    refreshSelectedNames();
  });

  document.getElementById('fetchDescriptionsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    fetchSelectedDescriptions();
  });

  // Live Tabs: Close Selected Tabs button
  document.getElementById('closeSelectedTabsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSelectedTabs();
  });

  // Live Tabs: Save Selected to Category button
  document.getElementById('saveSelectedTabsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    showSaveSelectedMenu();
  });

  // Close move menu on outside click
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('moveSelectedMenu');
    if (!menu.hidden &&
        !e.target.closest('#moveSelectedMenu') &&
        !e.target.closest('#moveSelectedBtn') &&
        !e.target.closest('#saveSelectedTabsBtn')) {
      menu.hidden = true;
    }
  });

  // ---- Live refresh when background script updates storage ----
  // Skip re-render if the save originated from this page (localSaveInProgress flag)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.tabManagerData) {
        if (localSavePending > 0) {
          localSavePending--;
          return;
        }
        appData = changes.tabManagerData.newValue;
        applySettings();
        renderAll();
        DragDrop.init(handleDrop);
      }
    });
  }
}
