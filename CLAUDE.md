# Tab Manager Pro — Project Guide

## What This Is
A Chrome extension (Manifest V3) that replaces the new tab page with an organized dashboard of bookmarked sites. Categories are displayed as kanban-style horizontal scroll columns, grouped into workspaces. Includes a Live Tabs workspace for real-time browser tab management and a Tab Splitter for managing window overcrowding.

## Architecture

### Module Pattern
All JS modules use the IIFE (Immediately Invoked Function Expression) pattern — no bundler, no imports. Scripts load in order via `<script>` tags in `newtab.html`:

1. `js/utils.js` — Shared helpers (ID generation, favicon URLs, escaping, debounce)
2. `js/storage.js` — Chrome storage persistence, import/export, data validation
3. `js/dragdrop.js` — HTML5 drag-and-drop for sites and categories
4. `js/undo.js` — Snapshot-based undo (Ctrl/Cmd+Z, max 2 levels)
5. `js/newtab.js` — Main controller (~6000 lines). Rendering, events, modals, search, all UI logic
6. `js/background.js` — Service worker for Quick Add (extension icon click) + auto-split tab monitoring

### Data Model
```
appData = {
  workspaces: [{ id, name, order }],
  categories: [{ id, name, icon, order, workspaceId, sites: [{ id, name, url, favicon, order, type?, text?, note? }] }],
  settings: {
    theme, columns, showSiteCount, hiddenCategories, layoutMode,
    currentWorkspace, quickAddInbox, birdsEyeView, collapsedWorkspaces,
    tabSplitMaxTabs, tabSplitAutoSplit
  }
}
```

### Live Tabs Workspace
A special ephemeral workspace (`LIVE_TABS_ID = '__live_tabs__'`) that mirrors all open browser windows in real time:

- **Not stored in `appData.workspaces`** — it's a virtual workspace, always appears last in the dropdown
- **Data lives in `liveTabsData`** (global variable), never persisted to storage
- **Each Chrome window → a category card** with auto-generated name (e.g. "YouTube, Gmail & 5 more")
- **Each tab → a site tile** showing page title + domain, with click-to-switch behavior
- **Tab event listeners** (`onCreated`, `onRemoved`, `onUpdated`, `onMoved`, `onAttached`, `onDetached`) auto-refresh the view with 500ms debounce
- **Listeners are started/stopped** when entering/leaving the Live Tabs workspace via `startLiveTabsListeners()` / `stopLiveTabsListeners()`
- **The newtab page itself is filtered out** using `chrome.runtime.getURL('')`
- **Search is scoped** — when on Live Tabs, search only searches live tabs, not saved categories
- **Select mode works** — with "Close Selected Tabs" and "Save to Category" actions instead of Move/Delete
- **Drag from Live Tabs to a regular category** = save that tab (creates a new site with fresh ID)
- **Context menu** shows "Switch to tab" and "Close tab" instead of Edit/Move/Delete
- **`getCatById()` and `getSiteById()`** search both `appData.categories` and `liveTabsData.categories`

### Tab Splitter
Splits overcrowded browser windows into multiple windows:

- **Manual split**: header button or Settings > Tab Splitter > "Split Now" — calls `splitWindowById()` directly from newtab.js using `chrome.tabs` and `chrome.windows` APIs
- **Auto-split**: background.js monitors `chrome.tabs.onCreated` and splits when tab count exceeds `tabSplitMaxTabs`
- **Strategy**: keeps first N (oldest) tabs in original window, moves rest to new window(s), recurses if needed
- **Settings**: `tabSplitMaxTabs` (3–50, default 12) and `tabSplitAutoSplit` (boolean)
- **Important**: manual splits run in newtab.js (not via message passing to background) to avoid service worker wake-up issues

### Core Rendering Flow
- `renderAll()` wipes `#categoriesGrid` innerHTML and rebuilds from scratch
- **Bird's-eye mode** (not available on Live Tabs): builds `.workspace-section` wrappers, each with its own `.categories-grid`
- **Live Tabs mode**: builds live tab cards via `buildLiveTabCard()` / `buildLiveTabTile()`
- **Normal mode**: single `.categories-grid` with current workspace's categories
- Search mode temporarily exits bird's-eye to show flat cross-workspace results
- `saveAndRefresh()` wraps save + renderAll + DragDrop.init + scroll restoration

### Critical Mechanism: `localSavePending`
A counter that prevents the `chrome.storage.onChanged` listener from triggering redundant re-renders when saves originate from this page. Every `Storage.saveData()` or `Storage.saveImmediate()` call must be preceded by `localSavePending++`. The `onChanged` listener decrements and skips re-render when > 0. Uses a counter (not boolean) because debounced saves can stack.

### Scroll Preservation
`saveAndRefresh()` captures and restores scroll positions around the DOM rebuild:
- Bird's-eye: window.scrollY + each workspace grid's scrollLeft + each card's sites-list scrollTop
- Kanban: main grid scrollLeft + each card's sites-list scrollTop
- All restores use `scrollTo({ behavior: 'instant' })` to override CSS `scroll-behavior: smooth`
- Container height is pinned via `minHeight` during rebuild to prevent page collapse
- `skipScrollRestore` flag lets navigation code handle its own scrolling after a re-render

### Known Technical Debt
The full DOM rebuild on every data change causes a brief favicon re-decode flicker. Fixing this would require surgical DOM updates (essentially a virtual DOM), which isn't worth the complexity for this project's scope.

## Key Conventions

- **No framework** — vanilla JS, vanilla CSS, no build step
- **`'use strict'`** at the top of every JS file
- **IDs use** `Utils.generateId()` (timestamp + random base36)
- **Undo snapshots** must be saved before mutations: `Undo.saveSnapshot('description', appData)`
- **Settings defaults** in `storage.js` DEFAULT_DATA — new settings keys must also be added to `validateImport()`
- **CSS variables** for theming — `var(--accent)`, `var(--text)`, `var(--bg-card)`, etc.
- **Two themes**: `theme-light` and `theme-dark` classes on `<body>`
- **`.categories-grid`** has `scroll-behavior: smooth` in CSS — always use `behavior: 'instant'` when restoring scroll positions programmatically
- **Live Tabs data is ephemeral** — never save `liveTabsData` to storage, never include live categories in `appData.categories`
- **`isLiveTabsActive()`** — check this before operations that only apply to saved workspaces (add category, bird's-eye view, etc.)
- **Live Tabs bypasses bird's-eye mode** — workspace dropdown click handlers must check `!isLiveTabsActive()` before entering the bird's-eye scroll-to-section path, otherwise `setActiveWorkspace()` is called instead of `switchWorkspace()` and the view stays stuck on Live Tabs
- **Async workspace switches need error handling** — the `loadLiveTabs().then(...)` chain in `switchWorkspace()` must have a `.catch()` that resets `switchingWorkspace = false`, or a rejected promise will permanently lock out all workspace switching

## File Structure
```
newtab.html          — Main page (header, modals, context menus)
help.html            — User guide (standalone styled page)
manifest.json        — Manifest V3 config
css/styles.css       — All styles (~2700 lines)
css/themes.css       — Theme variable definitions
js/newtab.js         — Main app controller (~6000 lines)
js/storage.js        — Data persistence
js/utils.js          — Shared utilities
js/dragdrop.js       — Drag-and-drop
js/undo.js           — Undo system
js/background.js     — Service worker (Quick Add + auto-split)
icons/               — Extension icons
```

## Features Inventory

### Saved Sites
Categories, sites, notes, workspaces, bird's-eye view (all workspaces stacked), category collapse/expand, search with highlighting, drag-and-drop (sites + categories), multi-select mode (move, copy, delete, consolidate, refresh, fetch descriptions), keyboard shortcuts, Quick Add inbox, save all open tabs, open category as pinned tabs, deduplicate URLs, copy URLs, export (JSON + HTML), import (native + TabExtend), undo, light/dark themes.

### Live Tabs
Real-time view of all open browser windows/tabs, click-to-switch, close tab buttons, search scoped to live tabs, select mode with bulk close and save-to-category, drag tabs into saved categories, context menu with switch/close actions, auto-refresh on tab events.

### Tab Splitter
Manual and automatic window splitting, configurable max tabs per window (3–50), recursive splitting, header quick-split button, settings panel controls.
