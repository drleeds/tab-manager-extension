# Tab Manager Pro — Project Guide

## What This Is
A Chrome extension (Manifest V3) that replaces the new tab page with an organized dashboard of bookmarked sites. Categories are displayed as kanban-style horizontal scroll columns, grouped into workspaces. Includes a Live Tabs workspace for real-time browser tab management and a Tab Splitter for managing window overcrowding.

## Architecture

### Module Pattern
All JS modules use the IIFE (Immediately Invoked Function Expression) pattern — no bundler, no imports. Scripts load in order via `<script>` tags in `newtab.html`:

1. `js/utils.js` — Shared helpers (ID generation, favicon URLs, escaping, debounce)
2. `js/storage.js` — Chrome storage persistence, import/export, data validation
3. `js/snapshot.js` — Session Snapshot module: capture open windows/tabs/groups to a self-contained interactive HTML file, and restore a saved snapshot back into new windows
4. `js/dragdrop.js` — HTML5 drag-and-drop for sites and categories
5. `js/undo.js` — Snapshot-based undo (Ctrl/Cmd+Z, max 2 levels)
6. `js/newtab.js` — Main controller (~6000 lines). Rendering, events, modals, search, all UI logic
7. `js/background.js` — Service worker for Quick Add (extension icon click) + auto-split tab monitoring

### Data Model
```
appData = {
  workspaces: [{ id, name, order }],
  categories: [{ id, name, icon, order, workspaceId, sites: [{ id, name, url, favicon, order, type?, text?, note? }] }],
  settings: {
    theme, columns, showSiteCount, hiddenCategories, layoutMode,
    currentWorkspace, quickAddInbox, birdsEyeView, collapsedWorkspaces,
    tabSplitMaxTabs, tabSplitAutoSplit, testMode
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
- **Drag between live tab windows** = `chrome.tabs.move()` to reorder within or move between windows
- **`liveTabsDragPaused`** flag suppresses auto-refresh during drag operations to prevent UI rebuild mid-drag; set `true` on `dragstart`, `false` on `dragend` (in `dragdrop.js`)
- **Drop indicators** are inserted between live tab tiles (same as saved tiles) for visual drag feedback
- **Context menu** shows: Switch to tab, Close tab, Move to window (submenu), Copy to window (submenu), Move to top/bottom, Pin/Unpin tab, Open in new tab, Copy URL
- **Window-level context menu** (right-click on window header): Focus window, New window, Merge into window (submenu), Close window
- **Live tab move/copy submenus** (`#liveWindowMenu`) list all windows with Top/Bottom placement buttons, plus "New window" option
- **Merge menu** (`#mergeMenu`) moves all tabs from one window into another via `chrome.tabs.move()`
- **"New Window" card** appears at the end of live tabs grid (dashed-border card with + button), creates `chrome.windows.create({ url: 'about:blank' })`
- **Pin/Unpin** uses `chrome.tabs.update(tabId, { pinned: !isPinned })`
- **Move to top** respects pinned tab constraints — unpinned tabs move to the first position after pinned tabs
- **`hideAllContextMenus()`** hides all 5 context menu/submenu elements (contextMenu, moveMenu, liveWindowMenu, windowContextMenu, mergeMenu)
- **`getCatById()` and `getSiteById()`** search both `appData.categories` and `liveTabsData.categories`

### Tab Splitter
Splits overcrowded browser windows into multiple windows:

- **Manual split**: header button or Settings > Tab Splitter > "Split Now" — calls `splitWindowById()` directly from newtab.js using `chrome.tabs` and `chrome.windows` APIs
- **Auto-split**: background.js monitors `chrome.tabs.onCreated` and splits when tab count exceeds `tabSplitMaxTabs`
- **Strategy**: keeps first N (oldest) tabs in original window, moves rest to new window(s), recurses if needed
- **Settings**: `tabSplitMaxTabs` (3–50, default 12) and `tabSplitAutoSplit` (boolean)
- **Important**: manual splits run in newtab.js (not via message passing to background) to avoid service worker wake-up issues

#### Split to Fit (Live Tabs only)
Separate from the fixed-count splitter above. Header button `#splitToFitBtn` sits to the right of the workspace selector and is CSS-shown only under `body.live-tabs-active`.

- **Goal**: split *every* crowded open window so each Live Tabs column fits on screen without scrolling
- **Sizing is measured, not fixed**: `measureLiveColumnCapacity()` reads the currently rendered live-tab cards (card max-height, header offset, tile row stride via two consecutive tiles' `getBoundingClientRect`) to compute how many tiles fit one column. Clamped to a `MIN_FIT` of 5; falls back to 8 if nothing measurable is rendered. Self-calibrates per display/window size
- **Distribution**: `splitLiveWindowToFit()` splits each over-capacity window into balanced windows (`max-min ≤ 1`, never an orphan window), first chunk stays in place, later chunks go to new windows
- **Keeps dashboard in front**: new windows created with `focused:false`; Live Tabs is reloaded/re-rendered, then the dashboard window (captured via `chrome.windows.getCurrent()`) is re-focused last and re-asserted after a 150ms delay (macOS can raise a new window a beat after `create` resolves when it's seeded from that window's active tab, so a single refocus can lose the race)
- **Never moves the newtab tab**: operates only on `liveTabsData` tabIds, which already exclude the extension page
- **Entry point**: `splitLiveTabsToFit()` in newtab.js
- **`fit` is re-measured every run, not cached**: it reads whichever live card is currently busiest, so its title/header height plus a `floor()` at the capacity boundary can make `fit` drift by ~1 between runs. Consequence: clicking Split again when windows are already at the limit can occasionally re-split a boundary window. Left as-is intentionally (confirmed acceptable 2026-07-05); the "Nothing to split" toast fires when nothing exceeds `fit`. To make Split fully idempotent, cache `fit` keyed on `window.innerHeight` (it's a pure function of column height) and reuse it until the height changes.
- **macOS focus race**: `chrome.windows.create({focused:false})` can still be raised by the OS a beat after it resolves when seeded from the source window's *active* tab. The single + delayed re-focus of the dashboard window handles it; the very first split of a session can still flash a new window forward once.

#### Test Mode
Settings > Test Mode toggle (`settings.testMode`, default false). When on, `body.test-mode-active` is set and a **Combine** button (`#consolidateBtn`) appears next to Split in Live Tabs (CSS gate: `.live-tabs-active.test-mode-active`).

- **Combine** (`consolidateAllWindows()`) merges every open normal window into the dashboard's own window via one `chrome.tabs.move`, so emptied windows auto-close, then reloads/re-renders and refocuses the dashboard. Purpose: exercise the splitter repeatedly (Combine → one big window → Split → tidy columns)
- **`applySettings()` preserves view-state body classes** (`live-tabs-active`, `birdseye-active`, `search-active`, `select-mode`) across its `body.className` reset, because `closeModal()` doesn't re-render — without this, opening Settings while on Live Tabs would drop `live-tabs-active` and hide the Split/Combine buttons

### Session Snapshot (HTML export + restore)
Capture every open window/tab/group to a single self-contained, interactive HTML file, and restore a saved snapshot later. Requires the `tabGroups` manifest permission (added for this). Lives in `js/snapshot.js` (the `Snapshot` module); `newtab.js` holds only UI glue.

- **`generateHTML(data)` is ported verbatim** from the standalone "Tab Snapshot" extension (HTML export only; its Markdown path was intentionally dropped). Treat it as a black box: it takes a snapshot object (with `tabsByGroup` as a **Map**, which it requires) and returns a ~1500-line HTML string with embedded CSS, the data as JSON, and inline sort/search/notes JS. Do not hand-edit it; re-port from source if it must change.
- **Capture** (`Snapshot.capture()`) does its own `chrome.windows.getAll` + `chrome.tabGroups.query` (not `liveTabsData` — it needs richer fields), adds **window geometry** (`left/top/width/height/state`) and a `schemaVersion`, and excludes the dashboard's own new-tab page.
- **Restore payload**: `captureAndDownload()` injects a clean `<script type="application/json" id="tabmgr-snapshot">` block before `</body>`, with `<` escaped to `<` so a `</script>` inside any title/URL can't break the file. `parseSnapshotFile()` reads that block via `DOMParser`. The ported display embedding is hardened the same way (one-line `.replace(/</g,'<')` on `dataJson`).
- **Restore** (`Snapshot.restore(data, {windowIds, discardThreshold=25, skipOpenUrls, commitTimeoutMs=10000, onProgress})`) is **non-destructive** — it only creates new windows, never touches what's open. It recreates windows (with geometry, unless a non-normal `state` forces geometry to be applied after), tabs in index order, pinned/active state, and tab groups (name/color/membership), skips unrestorable URLs (`chrome://` etc. — only `https?|ftp|file` are recreated), unloads tabs when the total exceeds `discardThreshold`, and re-focuses the dashboard at the end.
- **Never `chrome.tabs.discard()` a tab that has not committed its navigation.** `chrome.tabs.create({url})` resolves before the page commits, and a tab discarded in that window is frozen permanently with empty `url`, `title`, `favIconUrl` **and `pendingUrl`** — the extensions API can then tell you nothing about it but its id, window and index, so Live Tabs renders it as a `?` tile with no name. This is deterministic, not a race: in a 65-tab restore, all 52 non-active tabs were destroyed and only the 13 active tabs (one per window, skipped by the discard loop) survived. A tab discarded *after* committing keeps its url/title/favicon, which is how Chrome's own Memory Saver works.
- **Nor discard on the first title.** SPAs (Gmail, Claude, Ads Manager) paint a placeholder title and swap in the real one a beat later; the favicon lands later still. Discarding on first title yields four tabs all named "Gmail" and six with no favicon (measured). `waitForSettledTitle()` waits for `status: 'complete'` plus `titleQuietMs` (700ms) of no title/favicon change, capped at `commitTimeoutMs` (8s). Per-window waits run under one `Promise.all` so a hung page can't restart the timeout for its neighbours. Before discarding, `restore()` re-reads the tab and skips any with an empty `url` — leaving it loaded beats freezing it blank.
- **Consequence**: a large restore now genuinely loads each page once and takes tens of seconds, reported through `onProgress`. It also bakes in redirects (a session-expired tab discards as its login page). Both are accepted costs of having identifiable tabs.
- **UI**: a **Snapshot** button in Live Tabs (`#snapshotBtn`, next to Split); a three-way **snapshot-before-close** prompt on the header close-all button (`#closeAllSnapshotModal`: Cancel / Close without snapshot / Snapshot & close — `closeAllTabs` was split into `promptCloseAllTabs` + `performCloseAllTabs`); and **Restore Session Snapshot** in Settings → Data (`#restoreModal`, a selective per-window tree with a "skip tabs already open" de-dupe option).
- **Naming**: the pre-existing saved-sites "Export HTML" (`Storage.exportHtml`, exports categories) was relabeled "Export Saved Sites (HTML)" to avoid confusion with this open-tabs snapshot.

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
js/snapshot.js       — Session Snapshot (HTML export + restore)
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
Real-time view of all open browser windows/tabs, click-to-switch, close tab buttons, search scoped to live tabs, select mode with bulk close and save-to-category, drag tabs into saved categories, drag-and-drop reorder within and between windows (via Chrome tabs API), right-click move/copy to window submenus, pin/unpin tabs, move to top/bottom, window-level context menu (focus, new window, merge windows, close window), "New Window" card button, auto-refresh on tab events (paused during drag).

### Tab Splitter
Manual and automatic window splitting, configurable max tabs per window (3–50), recursive splitting, header quick-split button, settings panel controls.
