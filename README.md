# Tab Manager Pro

A Chrome extension that replaces the default new tab page with a powerful, customizable dashboard for organizing your favourite websites, notes, and bookmarks into categories and workspaces.

All data is stored **locally** in your browser via `chrome.storage.sync`. Nothing is sent to any server.

---

## Installation

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `tab-manager-extension` folder.
5. Open a new tab — Tab Manager Pro will appear immediately.

---

## Features

### Workspaces
- Organize categories into separate workspace groups (e.g., "Work", "Personal")
- Switch between workspaces via the header dropdown or keyboard shortcuts
- Create, rename, duplicate, and delete workspaces
- Move or copy categories between workspaces

### Bird's-Eye View
- Toggle an all-workspaces panoramic view showing every workspace stacked vertically
- Each workspace section has its own horizontal row of category cards
- Collapsible workspace sections with click-to-set-active behaviour
- Keyboard navigation: scroll to workspaces, move active indicator, horizontal scroll

### Categories & Sites
- Create unlimited categories with custom emoji icons
- Add, edit, and delete sites within each category
- Add multiple URLs at once (one per line)
- Click a site to open it in a new tab
- Right-click a site for a full context menu (open, copy URL, edit, move, copy to category, delete)
- Click a category title to rename it inline
- Click the category emoji to change it
- Collapse/expand categories via the header chevron (state persists)
- Sort sites alphabetically within a category
- Toggle between list view and grid/tile view per category
- Deduplicate URLs within a category

### Notes
- Create standalone text notes (without a URL) inside any category
- Attach notes to URL sites as supplementary text
- Note previews shown inline; click to expand/collapse
- URLs within notes are automatically clickable

### Drag & Drop
- Reorder sites within a category by dragging
- Move sites between categories by dragging
- Reorder category columns by dragging

### Search
- Real-time search across all workspaces — matches site names, URLs, note text, and category names
- When a category name matches, all its sites are shown
- Matching text is highlighted
- Press `Esc` to clear the search

### Multi-Select Mode
- Select multiple sites for bulk operations
- Shift+click for range selection; category checkbox to select all in a category
- Bulk actions: Move, Copy, Delete, Copy URLs, Consolidate duplicates, Refresh Names, Fetch Descriptions

### Quick Add
- Click the Tab Manager Pro icon in the browser toolbar to save the current page to your inbox category with one click

### Save All Open Tabs
- Click the floppy-disk icon in the header to snapshot all open browser tabs into a new category

### Import from Browser
- Import sites from currently open tabs or Chrome bookmarks
- Filter, search, and select which items to import
- Already-saved sites are marked to avoid duplicates

### Undo
- Press `Cmd/Ctrl + Z` to undo destructive operations (delete, move, reorder)
- Snapshot-based: restores the full state before the operation

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Option/Alt + 1`–`9` | Switch to workspace 1–9 (bird's-eye: scroll to workspace) |
| `Option/Alt + 0` | Jump to inbox category (scroll + flash highlight) |
| `Option/Alt + Up/Down` | Move active workspace up/down |
| `Option/Alt + Left/Right` | Scroll categories horizontally |
| `/` or `Cmd/Ctrl + K` | Focus the search box |
| `Cmd/Ctrl + Z` | Undo last destructive operation |
| `Esc` | Clear search / close menus / exit select mode |

On Windows, use `Alt` instead of `Option` and `Ctrl` instead of `Cmd`.

### Settings
- **Theme**: Light or Dark mode (also toggleable via the header icon)
- **Columns**: 2, 3, or 4 column layout
- **Layout Mode**: Column (default) or Kanban (horizontal scroll)
- **Show site count**: Toggle site count badges on category headers
- **Quick Add inbox**: Choose which category receives one-click saves
- **Export JSON**: Download all data as a JSON backup
- **Export HTML**: Download a readable HTML page of all saved sites
- **Import**: Restore from a previously exported JSON file
- **Reset**: Clear all data and start fresh

### Data Safety
- All data is stored using `chrome.storage.sync`
- Changes are auto-saved with a 300ms debounce
- A "Saved" indicator confirms each save
- Export your data regularly as a backup

---

## File Structure

```
tab-manager-extension/
├── manifest.json        Chrome extension manifest (MV3)
├── newtab.html          New tab page HTML
├── help.html            User guide (opened via ? button)
├── CLAUDE.md            Project guide for AI-assisted development
├── DOCUMENTATION.md     Technical documentation for developers
├── README.md            This file
├── js/
│   ├── newtab.js        Main application controller (~5000 lines)
│   ├── storage.js       Chrome storage wrapper + import/export
│   ├── utils.js         Shared helpers (IDs, favicons, debounce, etc.)
│   ├── dragdrop.js      HTML5 drag-and-drop logic
│   ├── undo.js          Snapshot-based undo system
│   └── background.js    Service worker for Quick Add
├── css/
│   ├── styles.css       All component styles
│   └── themes.css       Light and dark theme CSS variables
├── icons/               Extension icons (16, 48, 128px)
└── images/              Screenshots for help.html
```

---

## Privacy

Tab Manager Pro stores all data exclusively in `chrome.storage.sync` on your device. It does not make any network requests except to load favicons from Google's public favicon service (`https://www.google.com/s2/favicons`). No personal data is collected or transmitted.

---

## Troubleshooting

**Extension not showing on new tab**
- Make sure no other "new tab" extension is active. Disable it or set Tab Manager Pro as the override in `chrome://extensions/`.

**Favicons not loading**
- Some favicons may fail to load (e.g., intranet sites). A coloured letter badge is shown as a fallback automatically.
- You can set a custom favicon URL when editing a site.

**Data lost after browser update**
- `chrome.storage.sync` data persists across browser updates. If data is lost, restore from an exported JSON backup.

**Import fails**
- Ensure the file is a valid `.json` export from Tab Manager Pro (not a modified or corrupted file).
