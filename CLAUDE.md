# Tab Manager Pro — Project Guide

## What This Is
A Chrome extension (Manifest V3) that replaces the new tab page with an organized dashboard of bookmarked sites. Categories are displayed as kanban-style horizontal scroll columns, grouped into workspaces.

## Architecture

### Module Pattern
All JS modules use the IIFE (Immediately Invoked Function Expression) pattern — no bundler, no imports. Scripts load in order via `<script>` tags in `newtab.html`:

1. `js/utils.js` — Shared helpers (ID generation, favicon URLs, escaping, debounce)
2. `js/storage.js` — Chrome storage persistence, import/export, data validation
3. `js/dragdrop.js` — HTML5 drag-and-drop for sites and categories
4. `js/undo.js` — Snapshot-based undo (Ctrl/Cmd+Z, max 2 levels)
5. `js/newtab.js` — Main controller (~5000 lines). Rendering, events, modals, search, all UI logic
6. `js/background.js` — Service worker for Quick Add (extension icon click)

### Data Model
```
appData = {
  workspaces: [{ id, name, order }],
  categories: [{ id, name, icon, order, workspaceId, sites: [{ id, name, url, favicon, order, type?, text?, note? }] }],
  settings: { theme, columns, showSiteCount, hiddenCategories, layoutMode, currentWorkspace, quickAddInbox, birdsEyeView, collapsedWorkspaces }
}
```

### Core Rendering Flow
- `renderAll()` wipes `#categoriesGrid` innerHTML and rebuilds from scratch
- In bird's-eye mode: builds `.workspace-section` wrappers, each with its own `.categories-grid`
- In normal mode: single `.categories-grid` with current workspace's categories
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

## File Structure
```
newtab.html          — Main page (header, modals, context menus)
help.html            — User guide (standalone styled page)
manifest.json        — Manifest V3 config
css/styles.css       — All styles (~2500 lines)
css/themes.css       — Theme variable definitions
js/newtab.js         — Main app controller
js/storage.js        — Data persistence
js/utils.js          — Shared utilities
js/dragdrop.js       — Drag-and-drop
js/undo.js           — Undo system
js/background.js     — Service worker (Quick Add)
icons/               — Extension icons
```

## Features Inventory
Categories, sites, notes, workspaces, bird's-eye view (all workspaces stacked), category collapse/expand, search with highlighting, drag-and-drop (sites + categories), multi-select mode, keyboard shortcuts, Quick Add inbox, save all open tabs, open category as pinned tabs, deduplicate URLs, consolidate URLs, refresh names/favicons, fetch descriptions, copy URLs, export (JSON + HTML), import (native + TabExtend), undo, light/dark themes.
