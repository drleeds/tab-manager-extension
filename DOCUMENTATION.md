# Tab Manager Pro - Technical Documentation

**Version:** 1.0.0
**Chrome Extension:** Manifest V3
**Last Updated:** 2026-03-19

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Data Model](#data-model)
5. [Core Modules](#core-modules)
6. [Key Features](#key-features)
7. [Common Maintenance Tasks](#common-maintenance-tasks)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Development Workflow](#development-workflow)
10. [Future Enhancement Ideas](#future-enhancement-ideas)

---

## Overview

Tab Manager Pro is a Chrome extension that helps users organize bookmarks and notes into visual, draggable categories. It replaces the default new tab page with a customizable dashboard.

### Key Capabilities
- **Workspaces**: Organize categories into separate workspace groups
- **Bird's-Eye View**: Toggle an all-workspaces panoramic view (stacked vertically with collapsible sections)
- **Category Management**: Create, edit, delete, reorder, and collapse/expand categories
- **Site/Note Management**: Add URLs (multiple at once), bulk import, create text notes
- **Drag & Drop**: Reorder items and categories with visual feedback
- **Multi-Select Mode**: Select multiple items for bulk operations (move, copy, delete, consolidate, refresh names, fetch descriptions)
- **Search**: Real-time search across category names, site names, URLs, and note text
- **Quick Add**: One-click save of the current page to a designated inbox category via the browser toolbar icon
- **Save All Open Tabs**: Snapshot all browser tabs into a new category with one click
- **Undo System**: Snapshot-based undo (Ctrl/Cmd+Z) for destructive operations
- **Browser Import**: Import from open tabs or bookmarks
- **Themes**: Light/dark mode with customizable layouts (column or kanban)
- **Export/Import**: JSON and HTML export for backup and portability

---

## Architecture

### Design Pattern: **IIFE Module Pattern**

The codebase uses **Immediately Invoked Function Expressions (IIFE)** to create isolated modules with private state and public APIs. This prevents global namespace pollution.

```javascript
const ModuleName = (() => {
  // Private state
  let privateVar = null;

  // Private functions
  function privateFunction() { }

  // Public API
  return {
    publicMethod,
    publicMethod2
  };
})();
```

### Key Architectural Principles

1. **Single Source of Truth**: `appData` object contains all categories, sites, and settings
2. **Unidirectional Data Flow**: Changes → Update `appData` → Save → Re-render
3. **Event Delegation**: Document-level listeners for dynamic content
4. **Separation of Concerns**: Each module handles one responsibility
5. **No External Dependencies**: Pure vanilla JavaScript (no jQuery, React, etc.)

---

## File Structure

```
tab-manager-extension/
├── manifest.json              # Chrome extension configuration (Manifest V3)
├── newtab.html               # Main HTML structure (new-tab override page)
├── help.html                 # User guide (opened via ? button)
├── CLAUDE.md                 # Project guide for AI-assisted development
├── DOCUMENTATION.md          # This file (technical documentation)
├── README.md                 # Project overview and quick-start
├── js/
│   ├── newtab.js            # Main application controller (~5000 lines)
│   ├── storage.js           # Chrome storage API wrapper, import/export, validation
│   ├── utils.js             # Helper functions (UUID, URL parsing, favicons, etc.)
│   ├── dragdrop.js          # HTML5 Drag & Drop API implementation
│   ├── undo.js              # Snapshot-based undo system
│   └── background.js        # Service worker for Quick Add (browser toolbar icon)
├── css/
│   ├── styles.css           # Main styles (layout, components, bird's-eye, interactions)
│   └── themes.css           # CSS variables for light/dark themes
├── icons/                    # Extension icons (16, 48, 128px)
└── images/                   # Screenshots for help.html
```

### Load Order (Important!)

Scripts are loaded in this specific order in `newtab.html`:

```html
<script src="js/utils.js"></script>      <!-- 1. Helper functions -->
<script src="js/storage.js"></script>    <!-- 2. Storage operations -->
<script src="js/dragdrop.js"></script>   <!-- 3. Drag & drop -->
<script src="js/undo.js"></script>       <!-- 4. Undo system -->
<script src="js/newtab.js"></script>     <!-- 5. Main controller -->
```

**Dependencies:**
- `newtab.js` depends on all other modules
- Other modules are independent of each other

---

## Data Model

### appData Structure

```javascript
{
  workspaces: [
    {
      id: "ws_abc123",             // Unique identifier
      name: "Work",                // Display name
      order: 0                     // Sort order (0-indexed)
    }
  ],
  categories: [
    {
      id: "cat_abc123",           // Unique identifier
      name: "Work Sites",          // Display name
      icon: "💼",                  // Emoji icon
      order: 0,                    // Sort order (0-indexed)
      workspaceId: "ws_abc123",   // Parent workspace ID
      viewMode: "list",           // "list" | "grid" (per-category)
      sites: [                     // Array of sites/notes
        {
          id: "site_xyz789",       // Unique identifier
          name: "Example Site",    // Display name (optional, falls back to URL)
          url: "https://example.com",
          favicon: "",             // Custom favicon URL (optional)
          note: "Personal note",   // Attached note (optional)
          order: 0,                // Sort order within category
          type: undefined          // Omitted for URL sites
        },
        {
          id: "note_def456",
          name: "Meeting Notes",   // Optional label
          text: "Note content...", // Main note text
          type: "note",            // Distinguishes notes from URL sites
          url: "",                 // Empty for notes
          favicon: "",
          order: 1
        }
      ]
    }
  ],
  settings: {
    theme: "light",              // "light" | "dark"
    columns: 3,                  // Number of columns (2-4)
    showSiteCount: true,         // Show item count badges
    layoutMode: "column",        // "column" | "kanban"
    currentWorkspace: "ws_abc",  // Active workspace ID
    inboxCategoryId: "",         // Quick Add inbox target
    birdsEyeView: false,         // Bird's-eye view toggle
    collapsedWorkspaces: [],     // Collapsed workspace IDs (bird's-eye)
    hiddenCategories: []         // Array of collapsed category IDs
  }
}
```

### Key Data Characteristics

- **IDs**: Generated via `Utils.generateId()` → `"prefix_" + timestamp + random`
- **Order**: 0-indexed integers, used for sorting
- **Sites Array**: Contains both URL sites and notes (distinguished by `type: "note"`)
- **Immutability**: Data is mutated directly, then saved (not using immutable patterns)

---

## Core Modules

### 1. newtab.js - Main Application Controller

**Location:** `js/newtab.js` (~5000 lines)

**Responsibilities:**
- Application state management (`appData`)
- UI rendering (categories, sites, notes, workspaces)
- Bird's-eye view (all-workspaces stacked layout)
- Event handling (clicks, keyboard shortcuts)
- Modal dialogs (site/category editor, settings)
- Search functionality (names, URLs, notes, category names)
- Select mode (multi-select with bulk operations)
- Browser picker (import tabs/bookmarks)
- Save all open tabs feature
- Category collapse/expand

**Key Functions:**

| Function | Purpose | Location |
|----------|---------|----------|
| `renderAll()` | Full UI re-render | Line 84 |
| `buildCategoryCard()` | Create category DOM | Line 109 |
| `buildSiteTile()` | Create site tile DOM | Line 249 |
| `buildNoteTile()` | Create note tile DOM | Line 371 |
| `saveAndRefresh()` | Save data + re-render | Line 2035 |
| `handleDrop()` | Drag & drop handler | Line 1250 |
| `deleteCategoryWithConfirm()` | Delete category | Line 1174 |
| `deleteSiteWithConfirm()` | Delete site/note | Line 1194 |
| `handleUndo()` | Undo handler | Line 52 |

**Global State Variables:**

```javascript
let appData = null;              // Main data object
let editingSiteId = null;        // Currently editing site ID
let editingCatId = null;         // Currently editing category ID
let editingCategoryId = null;    // Category being edited in modal
let contextSiteId = null;        // Right-click context menu state
let contextCatId = null;
let searchQuery = '';            // Current search query
let skipScrollRestore = false;   // When true, saveAndRefresh skips scroll restore
let localSavePending = 0;        // Pending saves counter (suppresses onChanged re-renders)
let selectMode = false;          // Multi-select mode active
let selectedSites = new Set();   // Set of "catId::siteId" strings
let anchorKey = null;            // Anchor for range selection
```

### 2. storage.js - Data Persistence

**Location:** `js/storage.js` (~470 lines)

**Responsibilities:**
- Chrome storage API wrapper (`chrome.storage.sync`)
- Data validation and migration
- Import/export (JSON, HTML, TabExtend format)
- Default data initialization

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `loadData()` | Load from Chrome storage |
| `saveData(data, callback)` | Debounced save (300ms) |
| `saveImmediate(data)` | Save without debounce |
| `exportData(data)` | Download JSON backup |
| `exportHtml(data)` | Export as standalone HTML |
| `importData(file)` | Import from JSON |
| `importTabExtend(file)` | Import TabExtend format |
| `resetData()` | Clear all data |

**Storage Key:** `'tabManagerData'`

**Storage Limits:** Chrome sync storage has a 100KB quota (split across all data)

### 3. utils.js - Helper Functions

**Location:** `js/utils.js` (~200 lines)

**Responsibilities:**
- ID generation
- URL validation and normalization
- Favicon handling
- Text highlighting (search)
- Color generation (badges)
- Debounce utility
- Confirmation dialogs

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `generateId(prefix)` | Create unique IDs |
| `normaliseUrl(url)` | Add protocol, clean URL |
| `isValidUrl(url)` | Validate URL format |
| `nameFromUrl(url)` | Extract domain name |
| `faviconUrl(url)` | Get Google favicon URL |
| `buildFaviconEl(site)` | Create favicon element |
| `badgeColor(str)` | Deterministic color from string |
| `highlightText(text, query)` | Wrap matches in `<mark>` |
| `escapeHtml(text)` | XSS prevention |
| `debounce(fn, delay)` | Debounce function calls |
| `confirm(message, okLabel)` | Show confirmation dialog |
| `flashSaveIndicator()` | Show "Saved" toast |

### 4. dragdrop.js - Drag & Drop

**Location:** `js/dragdrop.js` (235 lines)

**Responsibilities:**
- HTML5 Drag & Drop API implementation
- Custom ghost element (preview while dragging)
- Drop indicators (visual feedback)
- Site and category dragging

**Architecture:**

```javascript
DragDrop.init(dropCallback)              // Initialize listeners
DragDrop.makeSiteDraggable(el, id, catId) // Enable site dragging
DragDrop.makeCategoryDraggable(el, catId)  // Enable category dragging
```

**Drag Types:**
- `'site'`: Moving sites/notes within or between categories
- `'category'`: Reordering categories

**State Management:**

```javascript
let state = {
  type: null,          // 'site' | 'category'
  sourceId: null,      // ID being dragged
  sourceCatId: null,   // Source category (sites only)
  ghostEl: null,       // Custom ghost element
  onDrop: null         // Callback function
};
```

**Event Flow:**
1. `onDragStart` → Create ghost, store state
2. `onDragOver` → Show drop indicators, allow drop
3. `onDragLeave` → Hide indicators
4. `onDrop` → Execute callback with drop data
5. `onDragEnd` → Clean up visual states

### 5. undo.js - Undo System

**Location:** `js/undo.js` (105 lines)

**Responsibilities:**
- Snapshot-based undo (saves full `appData` copies)
- Keyboard shortcut handling (Ctrl/Cmd+Z)
- Toast notifications

**Architecture:**

```javascript
Undo.init(undoCallback)              // Initialize keyboard listener
Undo.saveSnapshot(description, data) // Save before operation
Undo.undo()                          // Restore last snapshot
Undo.canUndo()                       // Check if undo available
Undo.clearHistory()                  // Clear stack (after import/reset)
```

**Implementation:**

```javascript
let history = [];  // [{ data, description }, ...]
const MAX_STACK = 2;  // Keep only 1-2 undo levels
```

**Deep Cloning:** Uses `JSON.parse(JSON.stringify(data))` to create independent snapshots.

**Usage Pattern:**

```javascript
// Before destructive operation
Undo.saveSnapshot('Delete category', appData);

// Perform operation
appData.categories.splice(idx, 1);
saveAndRefresh();

// User presses Ctrl/Cmd+Z
// → undo.js calls undoCallback()
// → handleUndo() restores the snapshot
```

### 6. background.js - Service Worker (Quick Add)

**Location:** `js/background.js`

**Responsibilities:**
- Handles browser toolbar icon clicks (Quick Add)
- Saves the current tab's URL and title to the designated inbox category
- Runs as a Manifest V3 service worker (no persistent background page)

**How It Works:**
1. User clicks the Tab Manager Pro icon in the browser toolbar
2. `chrome.action.onClicked` fires in the service worker
3. Gets the active tab's URL and title
4. Loads `appData` from storage, finds the inbox category
5. Adds the site and saves back to storage

---

## Key Features

### 1. Drag & Drop

**Files:** `dragdrop.js`, `newtab.js`

**How It Works:**

1. **Initialization:**
   ```javascript
   DragDrop.init(handleDrop);  // newtab.js line 45
   ```

2. **Making Elements Draggable:**
   ```javascript
   DragDrop.makeSiteDraggable(tile, site.id, category.id);     // Line 363
   DragDrop.makeCategoryDraggable(card, category.id);          // Line 241
   ```

3. **Drop Handler:**
   ```javascript
   function handleDrop(type, sourceId, sourceCatId, targetId, targetCatId) {
     if (type === 'site') {
       // Move site from sourceCat to targetCat at targetId position
     } else if (type === 'category') {
       // Reorder categories
     }
   }
   ```

**Visual Feedback:**
- `.dragging` / `.dragging-card`: Opacity on source element
- `.drag-over`: Border on target category
- `.site-drop-indicator.visible`: Blue line showing drop position

**Bug Fix History:**
- 2026-02-15: Fixed category reorder index calculation (adjusted for array splice)

### 2. Multi-Select Mode

**Files:** `newtab.js` (lines 1282-1597)

**How It Works:**

1. **Enter Select Mode:**
   - Click "Select" button → `enterSelectMode()` (line 1298)
   - Sets `selectMode = true`
   - Adds `.select-mode` class to body
   - Shows selection toolbar
   - Re-renders to show checkboxes

2. **Selection Logic:**
   - **Plain click**: Toggle single item (`toggleSiteSelection()`)
   - **Shift + click**: Select range from anchor (`selectRange()`)
   - **Per-category checkbox**: Select/deselect all in category

3. **Selected Items Storage:**
   ```javascript
   let selectedSites = new Set();  // Stores "catId::siteId" strings
   let anchorKey = null;           // Last clicked item for range selection
   ```

4. **Bulk Operations:**
   - **Move to category**: `moveSelectedTo(targetCatId, position)`
   - **Delete selected**: `deleteSelected()`

**Bug Fix History:**
- 2026-02-15: Fixed erratic selection (plain click was selecting ranges instead of toggling)

### 3. Search

**Files:** `newtab.js` (lines 616-687)

**How It Works:**

1. **Input Handling:**
   ```javascript
   const debouncedSearch = Utils.debounce((q) => applySearch(q), 250);
   searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));
   ```

2. **Matching Logic:**
   - Categories: Match by name (when matched, all sites in that category are shown)
   - Sites: Match by name OR URL
   - Notes: Match by label OR text content
   - In bird's-eye view, search temporarily shows a flat cross-workspace list

3. **Visual Feedback:**
   - Highlights matches with `.search-highlight` class
   - Hides non-matching items (`tile.hidden = true`)
   - Hides categories with no matches (`.search-hidden`)
   - Shows "No results" empty state

4. **Clearing:**
   - Clear button or ESC key
   - Restores all content, removes highlights

**Keyboard Shortcut:** Cmd/Ctrl+K → Focus search

### 4. Undo System

**Files:** `undo.js`, `newtab.js`

**Supported Operations:**
- Rename category (inline edit)
- Delete category
- Delete item/note
- Move item (drag & drop)
- Reorder category (drag & drop)
- Move selected items (bulk)
- Delete selected items (bulk)

**NOT Supported:**
- Add operations (creating new items/categories)
- Edit operations (site modal changes)
- Theme/settings changes
- Import/export

**Rationale:** Undo focuses on destructive operations that could lose data. Additions and edits can be manually reversed.

**Implementation Pattern:**

```javascript
// BEFORE operation:
Undo.saveSnapshot('Operation description', appData);

// AFTER operation:
appData.categories.splice(...);  // Modify data
saveAndRefresh();                // Save + render

// Undo (Ctrl/Cmd+Z):
function handleUndo() {
  const restoredData = Undo.undo();
  if (restoredData) {
    appData = restoredData;
    saveAndRefresh();
  }
}
```

### 5. Browser Picker (Import)

**Files:** `newtab.js` (lines 1600-1850)

**How It Works:**

1. **Open Picker Modal:**
   - Click "From Browser" button
   - Loads open tabs or bookmarks via Chrome API

2. **Data Loading:**
   ```javascript
   chrome.tabs.query({})           // Get all open tabs
   chrome.bookmarks.getTree()      // Get bookmark tree
   ```

3. **Deduplication:**
   - Extracts base URL (origin only): `https://example.com/page` → `https://example.com`
   - Shows only one entry per domain
   - Marks already-saved domains as "Saved" (disabled checkbox)

4. **Selection:**
   - Checkboxes for each item
   - "Select all" / "Clear" buttons
   - Live search filter

5. **Import:**
   - Adds selected items to chosen category
   - Uses base URL (not full path)

**UX Rationale:** Prevents duplicate sites when user has multiple tabs/bookmarks for same domain.

### 6. Workspaces

**Files:** `newtab.js`, `storage.js`

**How It Works:**
- Workspaces are top-level groups that contain categories
- Each category has a `workspaceId` linking it to its parent workspace
- The workspace selector dropdown allows switching, creating, renaming, duplicating, and deleting workspaces
- Keyboard shortcuts (Option+1-9) switch between workspaces
- Workspaces can be reordered and duplicated (deep-copies all categories and sites)

### 7. Bird's-Eye View

**Files:** `newtab.js`, `css/styles.css`

**How It Works:**
1. Toggle via `#birdsEyeToggle` button or `toggleBirdsEyeView()`
2. `renderAll()` branches: in bird's-eye mode, it calls `buildWorkspaceSection()` for each workspace
3. Each workspace section has a collapsible header and its own `.categories-grid`
4. Clicking a section sets the "active workspace" (accent-highlighted, target for keyboard shortcuts)
5. Search temporarily exits bird's-eye mode for a flat cross-workspace view

**Key Functions:** `buildWorkspaceSection()`, `toggleBirdsEyeView()`, `toggleWorkspaceCollapse()`, `setActiveWorkspace()`, `flashHighlightCard()`

**Scroll Preservation:** `saveAndRefresh()` captures per-grid `scrollLeft`, per-card `scrollTop`, and `window.scrollY`, restoring them after DOM rebuild using `scrollTo({ behavior: 'instant' })`.

**Important:** The `localSavePending` counter prevents `chrome.storage.onChanged` from triggering redundant re-renders that would destroy scroll positions.

### 8. Category Collapse/Expand

**Files:** `newtab.js`, `css/styles.css`

**How It Works:**
- Each category header has a chevron button (`.category-collapse-btn`)
- Clicking it toggles `.category-collapsed` CSS class on the card, hiding sites-list, footer, and go-to link
- Uses `Storage.saveData` directly (no full re-render) to avoid scroll disruption
- Collapsed state is persisted in `appData.settings.hiddenCategories` array

### 9. Save All Open Tabs

**Files:** `newtab.js`

**How It Works:**
- Click the floppy-disk icon (`#saveAllTabsBtn`) in the header
- Queries all open tabs via `chrome.tabs.query({})`
- Creates a new category (named with timestamp) in the current workspace
- Populates it with all tab URLs and titles

### 10. Export/Import

**Files:** `storage.js`

**Export Formats:**

1. **JSON Export** (`exportData`):
   ```json
   {
     "version": "1.0",
     "exportDate": "2026-02-15T...",
     "data": {
       "categories": [...],
       "settings": {...}
     }
   }
   ```

2. **HTML Export** (`exportHtml`):
   - Standalone HTML file
   - Self-contained (CSS inline)
   - Responsive design
   - Searchable categories
   - Collapsible categories
   - No JavaScript required

**Import Formats:**

1. **Native Format:** JSON from `exportData()`
2. **TabExtend Format:** Legacy extension import

**Validation:**
- Checks for `categories` array
- Validates structure
- Migrates old formats if needed

---

## Common Maintenance Tasks

### Adding a New Feature

1. **Identify the Module:**
   - UI feature → `newtab.js`
   - Storage feature → `storage.js`
   - Drag behavior → `dragdrop.js`
   - Helper function → `utils.js`

2. **Update Data Model (if needed):**
   - Add fields to `appData` structure
   - Update `storage.js` validation
   - Increment version if breaking change

3. **Add Undo Support (if destructive):**
   ```javascript
   Undo.saveSnapshot('Feature description', appData);
   // ... perform operation
   ```

4. **Test Scenarios:**
   - Empty state
   - Single category/item
   - Multiple categories/items
   - Search while feature active
   - Select mode interaction
   - Undo/redo

### Fixing a Bug

1. **Reproduce:**
   - Identify exact steps
   - Check browser console for errors
   - Test in both light/dark themes

2. **Locate Code:**
   - Use browser DevTools to find event listener
   - Search codebase for function names
   - Check this documentation for file locations

3. **Common Bug Patterns:**
   - **Event delegation broken**: Check if element has required `data-*` attributes
   - **Render not updating**: Call `saveAndRefresh()` after data change
   - **Drag & drop issues**: Check `DragDrop.init()` called after `renderAll()`
   - **Selection issues**: Verify key format `"catId::siteId"`

4. **Testing:**
   - Test the fix in isolation
   - Test related features (might break adjacent code)
   - Test undo/redo if applicable

### Modifying Styles

**Files:** `css/styles.css`, `css/themes.css`

**CSS Architecture:**

1. **CSS Variables (themes.css):**
   ```css
   .theme-light {
     --bg: #f5f5f5;
     --text: #1a1a1a;
     /* ... */
   }
   ```

2. **Component Styles (styles.css):**
   - Organized by component
   - BEM-like naming: `.category-card`, `.site-tile`, etc.
   - State classes: `.dragging`, `.selected`, `.drag-over`

3. **Layout Modes:**
   - `.layout-column`: Default grid layout
   - `.layout-kanban`: Horizontal scrolling

**Important Classes:**

| Class | Purpose |
|-------|---------|
| `.category-card` | Main category container |
| `.sites-list` | List of sites within category |
| `.site-tile` | Individual site tile |
| `.note-tile` | Individual note tile |
| `.dragging` | Element being dragged |
| `.drag-over` | Drop target highlight |
| `.selected` | Selected in multi-select mode |
| `.select-mode` | Body class when select mode active |

### Performance Optimization

**Current Performance:**
- Renders ~100 sites smoothly
- Search is debounced (250ms)
- Drag & drop uses CSS transforms (GPU accelerated)

**If Performance Degrades:**

1. **Lazy Rendering:**
   - Only render visible categories initially
   - Load more on scroll

2. **Virtual Scrolling:**
   - For categories with >50 items
   - Render only visible items

3. **Memoization:**
   - Cache DOM elements
   - Avoid re-rendering unchanged categories

4. **Debounce Everything:**
   - Search: 250ms (already done)
   - Scroll handlers: 100ms
   - Resize handlers: 200ms

---

## Troubleshooting Guide

### Problem: Data Not Saving

**Symptoms:** Changes don't persist after page reload

**Causes:**
1. Chrome storage quota exceeded (100KB limit)
2. `saveAndRefresh()` not called after data change
3. Chrome storage permissions missing

**Solutions:**
```javascript
// Check storage usage
chrome.storage.sync.getBytesInUse('tabManagerData', (bytes) => {
  console.log('Storage used:', bytes, 'bytes');
});

// Always call after changes
saveAndRefresh();  // Not just appData.categories.push(...)
```

### Problem: Drag & Drop Not Working

**Symptoms:** Items can't be dragged or drop does nothing

**Causes:**
1. `DragDrop.init()` not called after `renderAll()`
2. Missing `data-drag-type` attributes
3. Event listeners removed by re-render

**Solutions:**
```javascript
// Always re-init after rendering
renderAll();
DragDrop.init(handleDrop);

// Check elements have attributes
<div data-drag-type="site" data-site-id="..." data-category-id="...">
```

### Problem: Search Not Highlighting

**Symptoms:** Search filters but doesn't highlight matches

**Causes:**
1. `highlightText()` not called in `applySearch()`
2. HTML escaping removing highlight tags
3. `.search-highlight` CSS missing

**Solutions:**
```javascript
// In applySearch(), line 654:
nameEl.innerHTML = Utils.highlightText(site.name, query);  // Not .textContent!
```

### Problem: Undo Not Working

**Symptoms:** Ctrl/Cmd+Z does nothing or shows "Nothing to undo"

**Causes:**
1. `Undo.init()` not called at startup
2. `Undo.saveSnapshot()` not called before operation
3. Snapshot saved after operation (too late)

**Solutions:**
```javascript
// At startup (line 46):
Undo.init(handleUndo);

// Before operation, not after:
Undo.saveSnapshot('Delete item', appData);  // BEFORE
appData.categories.splice(...);             // AFTER
```

### Problem: Select Mode Selecting Wrong Items

**Symptoms:** Clicking one item selects multiple unexpectedly

**Causes:**
1. Range selection triggered instead of toggle
2. Anchor key not reset between categories

**Solutions:**
- Fixed 2026-02-15: Plain click now toggles, Shift+click does range
- If issue persists, check `selectRange()` logic (line 518)

### Problem: Modal Not Closing

**Symptoms:** Modal stays open after save or cancel

**Causes:**
1. `closeModal()` not called
2. `.is-open` class not removed
3. Event propagation not stopped

**Solutions:**
```javascript
// Always call in save/cancel handlers:
closeSiteModal();      // Line 861
closeCategoryModal();  // Line 1105

// Stop event propagation:
e.stopPropagation();
```

---

## Development Workflow

### Setting Up Development Environment

1. **Load Extension:**
   - Open Chrome → `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `/Users/markleeds/tab-manager-extension`

2. **Development Tools:**
   - **Chrome DevTools**: F12 or Cmd+Opt+I
   - **Console**: Check for errors
   - **Network**: Monitor storage API calls
   - **Elements**: Inspect DOM structure

3. **Live Reload:**
   - Chrome doesn't auto-reload extensions
   - After changes: Click reload icon in `chrome://extensions`
   - Or use keyboard shortcut: Cmd+R on extensions page

### Testing Checklist

**Before Committing Changes:**

- [ ] Test in light mode
- [ ] Test in dark mode
- [ ] Test with empty state (no categories)
- [ ] Test with 1 category, 1 item
- [ ] Test with multiple categories
- [ ] Test drag & drop (sites and categories)
- [ ] Test search with various queries
- [ ] Test select mode (single, range, bulk operations)
- [ ] Test undo/redo (Ctrl/Cmd+Z)
- [ ] Test browser import (tabs and bookmarks)
- [ ] Test export/import (JSON and HTML)
- [ ] Test all modals (site, category, settings, picker)
- [ ] Test delete confirmations
- [ ] Test keyboard shortcuts (Cmd+K, ESC, Enter)
- [ ] Check browser console for errors
- [ ] Test with Chrome sync enabled/disabled

### Code Style Guidelines

**JavaScript:**
- Use `'use strict';` in all modules
- Prefer `const` over `let`, avoid `var`
- Use template literals for strings: `` `Hello ${name}` ``
- Comment complex logic with `// --- Section ---`
- Function names: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- No semicolons (already removed in codebase, stay consistent)

**HTML:**
- Semantic elements: `<main>`, `<header>`, `<button>`
- ARIA labels for accessibility: `aria-label`, `aria-hidden`
- Data attributes for JS hooks: `data-modal`, `data-category-id`

**CSS:**
- BEM-like naming: `.block`, `.block__element`, `.block--modifier`
- Use CSS variables for theming
- Mobile-first responsive design
- Transitions: 0.15s-0.2s for UI feedback

### Debugging Tips

1. **Enable Verbose Logging:**
   ```javascript
   // Add to newtab.js boot function:
   window.DEBUG = true;

   // Then add throughout code:
   if (window.DEBUG) console.log('handleDrop:', {type, sourceId, targetId});
   ```

2. **Inspect Storage:**
   ```javascript
   // In browser console:
   chrome.storage.sync.get('tabManagerData', (result) => {
     console.log('Current data:', result);
   });
   ```

3. **Break on Errors:**
   - Chrome DevTools → Sources → Enable "Pause on exceptions"
   - Will pause when any error is thrown

4. **Visualize Data Flow:**
   ```javascript
   // Add to saveAndRefresh():
   function saveAndRefresh() {
     console.trace('saveAndRefresh called from:');  // Shows call stack
     // ... rest of function
   }
   ```

---

## Future Enhancement Ideas

### High Priority

1. **Keyboard Navigation:**
   - Arrow keys to navigate between tiles
   - Tab to focus categories

2. **Categories:**
   - Nested subcategories
   - Category colors/themes
   - Pin categories to top

3. **Search:**
   - Search by tag/label
   - Recent searches dropdown
   - Search operators (category:work, type:note)

### Medium Priority

5. **Import/Export:**
   - Chrome bookmarks import (native format)
   - Firefox bookmarks import
   - CSV export
   - Markdown export (for documentation)

6. **UI/UX:**
   - Grid view alternative to list
   - Compact mode (smaller tiles)
   - Category templates (pre-configured sets)
   - Emoji picker for site icons (like categories)

7. **Notes:**
   - Markdown support in notes
   - Rich text editor (bold, italic, links)
   - Note attachments (images, files)

8. **Sync:**
   - Conflict resolution for multi-device sync
   - Sync status indicator
   - Selective sync (choose what to sync)

### Low Priority (Nice to Have)

9. **Analytics:**
   - Most visited sites tracking
   - Usage statistics dashboard
   - Time spent per category

10. **Collaboration:**
    - Share categories with others (URL export)
    - Public profile page
    - Category marketplace

11. **Advanced:**
    - Browser extension API integration (open site in specific container)
    - Custom JavaScript actions per site
    - Automation rules (if X then Y)
    - Chrome omnibox integration (search from address bar)

### Technical Debt

- [ ] Add TypeScript types for better IDE support
- [ ] Migrate to Web Components for better encapsulation
- [ ] Add unit tests (Jest or Mocha)
- [ ] Add E2E tests (Playwright or Puppeteer)
- [ ] Set up CI/CD pipeline
- [ ] Optimize bundle size (minification, tree-shaking)
- [ ] Add error boundary for graceful failures
- [ ] Implement proper logging system (not console.log)

---

## Appendix A: Event Handlers Reference

### Global Events (Document Level)

| Event | Handler | Location |
|-------|---------|----------|
| `DOMContentLoaded` | Bootstrap app | Line 35 |
| `keydown` (Cmd/Ctrl+K) | Focus search | Line 2088 |
| `keydown` (ESC) | Exit select mode / clear search | Line 2097 |
| `keydown` (Cmd/Ctrl+Z) | Undo (via undo.js) | undo.js Line 89 |
| `click` (modal backdrop) | Close modal | Line 2193 |
| `click` (outside menus) | Close context menus | Line 2335 |

### Element-Specific Events

| Element | Event | Handler | Location |
|---------|-------|---------|----------|
| Search input | `input` | Debounced search | Line 2073 |
| Clear search button | `click` | Clear search | Line 2080 |
| Add category button | `click` | Open category modal | Line 2113 |
| Site tile | `click` | Open URL or toggle selection | Line 276 |
| Note tile | `click` | Toggle selection | Line 395 |
| Category title | `click` | Start inline edit | Line 146 |
| Category icon | `click` | Open category modal | Line 136 |
| Delete category button | `click` | Delete with confirm | Line 183 |
| Delete site button (context) | `click` | Delete with confirm | Line 2328 |
| Select mode button | `click` | Toggle select mode | Line 2391 |
| Move selected button | `click` | Show move menu | Line 2403 |
| Delete selected button | `click` | Delete selected | Line 2397 |

---

## Appendix B: Data Migration Guide

### Version 1.0 → Future Version

If you need to add fields or change structure:

1. **Update `storage.js` validation:**
   ```javascript
   function validateData(data) {
     // Add new field with default
     if (!data.settings.newField) {
       data.settings.newField = defaultValue;
     }
     // ... rest of validation
   }
   ```

2. **Increment version:**
   ```javascript
   // In storage.js
   const CURRENT_VERSION = "1.1";
   ```

3. **Add migration function:**
   ```javascript
   function migrateFrom10To11(data) {
     // Transform old structure to new
     data.categories.forEach(cat => {
       cat.sites.forEach(site => {
         site.newField = deriveFromOldFields(site);
       });
     });
     return data;
   }
   ```

4. **Call migration in `loadData()`:**
   ```javascript
   if (data.version === "1.0") {
     data = migrateFrom10To11(data);
     data.version = "1.1";
   }
   ```

### Export Format Stability

**Breaking Changes:** Must support old formats indefinitely (don't break user exports)

**New Fields:** Always optional, provide defaults

**Removed Fields:** Keep in import logic for backward compatibility

---

## Appendix C: Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| **Option/Alt + 1-9** | Switch to workspace 1-9 (bird's-eye: scroll to workspace) | Global |
| **Cmd/Ctrl + Option/Alt + 1-9** | Switch to workspace 1-9 (alternative) | Global |
| **Option/Alt + 0** | Jump to inbox category (scroll + flash highlight) | Global |
| **Option/Alt + Up/Down** | Move active workspace up/down | Global |
| **Option/Alt + Left/Right** | Scroll categories horizontally | Global |
| **/ or Cmd/Ctrl + K** | Focus search | Global |
| **ESC** | Exit select mode, clear search, close menus | Global |
| **Cmd/Ctrl + Z** | Undo last operation | Global (not in inputs) |
| **Enter** | Toggle selection (select mode) | On focused tile |
| **Space** | Toggle selection (select mode) | On focused tile |
| **Shift + Click** | Select range | Select mode |
| **Shift + Enter/Space** | Select range | Select mode |

---

## Appendix D: Chrome Extension Permissions

**Required Permissions (manifest.json):**

```json
{
  "permissions": [
    "storage",    // Chrome sync storage API
    "tabs",       // Read open tabs for import
    "bookmarks"   // Read bookmarks for import
  ]
}
```

**Why Each Permission:**
- `storage`: Save user data persistently across devices
- `tabs`: "From Browser" feature (import open tabs)
- `bookmarks`: "From Browser" feature (import bookmarks)

**Optional Permissions (could add):**
- `history`: Show recently visited sites
- `topSites`: Show most visited sites
- `downloads`: Better export (save to specific location)

---

## Conclusion

This documentation covers the architecture, structure, and maintenance of Tab Manager Pro. For questions or issues not covered here, consult:

1. **Code comments**: Most complex logic has inline comments
2. **Browser console**: Errors and warnings appear here
3. **Chrome Extension Docs**: https://developer.chrome.com/docs/extensions/
4. **Git history**: See commit messages for context on changes

**Last Updated:** 2026-03-19
**Maintained By:** Claude & User
**License:** (Add your license here)

---

*End of Documentation*
