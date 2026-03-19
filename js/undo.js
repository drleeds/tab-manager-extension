/**
 * undo.js
 * Simple snapshot-based undo system.
 * Saves a complete copy of appData before each operation.
 * Keyboard shortcut: Ctrl+Z / Cmd+Z
 */

'use strict';

const Undo = (() => {
  // History stack: [{ data, description }, ...]
  let history = [];
  const MAX_STACK = 2; // Keep only 1-2 undo levels

  /**
   * Save a snapshot of current appData before an operation.
   * @param {string} description - What action is being performed (e.g., "Move item", "Delete category")
   * @param {object} data - The appData object to snapshot
   */
  function saveSnapshot(description, data) {
    // Deep clone the data
    const snapshot = JSON.parse(JSON.stringify(data));
    history.push({ data: snapshot, description });

    // Limit stack size
    if (history.length > MAX_STACK) {
      history.shift();
    }
  }

  /**
   * Undo the last operation by restoring the previous snapshot.
   * @returns {object|null} - The restored data, or null if nothing to undo
   */
  function undo() {
    if (history.length === 0) {
      showToast('Nothing to undo');
      return null;
    }

    const { data, description } = history.pop();
    showToast(`Undone: ${description}`);
    return data;
  }

  /**
   * Check if undo is available.
   * @returns {boolean}
   */
  function canUndo() {
    return history.length > 0;
  }

  /**
   * Clear undo history (useful after import/reset).
   */
  function clearHistory() {
    history = [];
  }

  /**
   * Show a toast notification.
   * @param {string} message
   */
  function showToast(message) {
    const toast = document.getElementById('undoToast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  /**
   * Initialize keyboard listener for Ctrl+Z / Cmd+Z.
   * @param {Function} undoCallback - Function to call when undo is triggered
   */
  function init(undoCallback) {
    document.addEventListener('keydown', (e) => {
      // Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        // Don't trigger if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          return;
        }

        e.preventDefault();
        if (canUndo()) {
          undoCallback();
        } else {
          showToast('Nothing to undo');
        }
      }
    });
  }

  return {
    saveSnapshot,
    undo,
    canUndo,
    clearHistory,
    init
  };
})();
