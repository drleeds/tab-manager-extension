# Tab Manager Pro

A Chrome extension that replaces the default new tab page with a clean, customizable dashboard of your favourite websites, organised into categories.

All data is stored **locally** in your browser. Nothing is sent to any server.

---

## Installation

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `tab-manager-extension` folder.
5. Open a new tab — Tab Manager Pro will appear immediately.

---

## Features

### Categories & Sites
- Create unlimited categories with custom emoji icons
- Add, edit, and delete sites within each category
- Click a site to open it in the current tab
- Right-click a site for more options (open in new tab, edit, move, delete)
- Click a category title to rename it inline
- Click the category emoji to change it

### Drag & Drop
- Reorder sites within a category by dragging
- Move sites between categories by dragging
- Reorder category columns by dragging

### Search
- Real-time search across all sites (name and URL)
- Matching text is highlighted
- Press `Esc` to clear the search

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Focus the search box |
| `Esc` | Clear search / close menus |
| `Enter` (on a site tile) | Open the site |
| `Space` (on a site tile) | Edit the site |

### Settings
- **Theme**: Light or Dark mode (also toggleable via the header icon)
- **Columns**: 2, 3, or 4 column layout
- **Show site count**: Toggle site count badges on category headers
- **Export**: Download all your data as a JSON file
- **Import**: Restore from a previously exported JSON file
- **Reset**: Clear all data and start fresh

### Data Safety
- All data is stored using `chrome.storage.local`
- Changes are auto-saved with a 500 ms debounce
- A "Saved" indicator confirms each save
- Export your data regularly as a backup

---

## Usage Guide

### Adding a Category
1. Click **+ Add Category** in the header.
2. Enter a name and pick an emoji icon.
3. Click **Save Category**.

### Adding a Site
1. Click **Add site** at the bottom of any category card.
2. Enter the URL (name is auto-detected from the domain).
3. Optionally set a custom favicon URL.
4. Click **Save Site**.

### Moving a Site
- **Drag**: Grab the drag handle (⠿) on the left of a site tile and drop it into any category.
- **Context menu**: Right-click → Move to category → pick a destination.

### Import / Export
- **Export**: Settings → Export → saves a `.json` file to your Downloads.
- **Import**: Settings → Import → select a previously exported `.json` file.
  - The imported data fully replaces your current data.

---

## File Structure

```
tab-manager-extension/
├── manifest.json        Chrome extension manifest (MV3)
├── newtab.html          New tab page HTML
├── css/
│   ├── styles.css       All component styles
│   └── themes.css       Light and dark theme CSS variables
├── js/
│   ├── utils.js         Shared helpers (IDs, favicons, debounce, etc.)
│   ├── storage.js       chrome.storage.local wrapper + import/export
│   ├── dragdrop.js      HTML5 drag-and-drop logic
│   └── newtab.js        Main application controller
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Privacy

Tab Manager Pro stores all data exclusively in `chrome.storage.local` on your device. It does not make any network requests except to load favicons from Google's public favicon service (`https://www.google.com/s2/favicons`). No personal data is collected or transmitted.

---

## Troubleshooting

**Extension not showing on new tab**
- Make sure no other "new tab" extension is active. Disable it or set Tab Manager Pro as the override in `chrome://extensions/`.

**Favicons not loading**
- Some favicons may fail to load (e.g., intranet sites). A coloured letter badge is shown as a fallback automatically.
- You can set a custom favicon URL when editing a site.

**Data lost after browser update**
- `chrome.storage.local` data persists across browser updates. If data is lost, restore from an exported JSON backup.

**Import fails**
- Ensure the file is a valid `.json` export from Tab Manager Pro (not a modified or corrupted file).
