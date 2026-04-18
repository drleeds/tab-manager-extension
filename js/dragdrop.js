/**
 * dragdrop.js
 * Drag-and-drop for site tiles (within and between categories)
 * and for category cards (reordering columns).
 *
 * Uses the HTML5 Drag-and-Drop API with a custom ghost element
 * for better visual feedback than the browser's default.
 */

'use strict';

const DragDrop = (() => {

  // State shared across drag events
  let state = {
    type: null,          // 'site' | 'category'
    sourceId: null,      // id of dragged item
    sourceCatId: null,   // category id (sites only)
    ghostEl: null,       // custom ghost element
    onDrop: null         // callback(type, sourceId, sourceCatId, targetId, targetCatId)
  };

  // -------------------------------------------------------
  // Initialise drag-and-drop for the whole page.
  // Call once after initial render. Re-attaches via event
  // delegation so dynamically added elements are covered.
  // -------------------------------------------------------
  function init(dropCallback) {
    state.onDrop = dropCallback;

    // Remove any prior listeners
    document.removeEventListener('dragstart', onDragStart, true);
    document.removeEventListener('dragend',   onDragEnd,   true);
    document.removeEventListener('dragover',  onDragOver,  true);
    document.removeEventListener('dragleave', onDragLeave, true);
    document.removeEventListener('drop',      onDrop,      true);

    document.addEventListener('dragstart', onDragStart, true);
    document.addEventListener('dragend',   onDragEnd,   true);
    document.addEventListener('dragover',  onDragOver,  true);
    document.addEventListener('dragleave', onDragLeave, true);
    document.addEventListener('drop',      onDrop,      true);
  }

  // -------------------------------------------------------
  // Enable dragging for a site tile element
  // -------------------------------------------------------
  function makeSiteDraggable(el, siteId, categoryId) {
    el.setAttribute('draggable', 'true');
    el.dataset.siteId = siteId;
    el.dataset.categoryId = categoryId;
    el.dataset.dragType = 'site';
  }

  // -------------------------------------------------------
  // Enable dragging for a category card element
  // -------------------------------------------------------
  function makeCategoryDraggable(el, categoryId) {
    el.setAttribute('draggable', 'true');
    el.dataset.categoryId = categoryId;
    el.dataset.dragType = 'category';
  }

  // -------------------------------------------------------
  // Event: dragstart
  // -------------------------------------------------------
  function onDragStart(e) {
    const handle = e.target.closest('[data-drag-handle]');
    const dragTarget = handle
      ? handle.closest('[data-drag-type]')
      : e.target.closest('[data-drag-type]');

    if (!dragTarget) return;

    state.type        = dragTarget.dataset.dragType;
    state.sourceId    = dragTarget.dataset.categoryId;
    state.sourceCatId = dragTarget.dataset.categoryId;

    if (state.type === 'site') {
      state.sourceId    = dragTarget.dataset.siteId;
      state.sourceCatId = dragTarget.dataset.categoryId;
    }

    // Pause live tab auto-refresh during drag
    if (typeof liveTabsDragPaused !== 'undefined') {
      liveTabsDragPaused = true;
    }

    // Create custom ghost — prefer explicit name/label, fall back to note text snippet
    let label = dragTarget.querySelector('.site-name, .note-tile-label, .category-title')?.textContent?.trim() || '';
    if (!label) {
      const noteText = dragTarget.querySelector('.note-tile-text')?.textContent?.trim() || '';
      label = noteText.length > 40 ? noteText.slice(0, 40) + '…' : noteText || '(note)';
    }
    state.ghostEl = document.createElement('div');
    state.ghostEl.className = 'drag-ghost';
    state.ghostEl.textContent = label;
    document.body.appendChild(state.ghostEl);
    e.dataTransfer.setDragImage(state.ghostEl, -8, -8);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.sourceId); // required for Firefox

    // Visual feedback on source element
    requestAnimationFrame(() => {
      dragTarget.classList.add(state.type === 'site' ? 'dragging' : 'dragging-card');
    });
  }

  // -------------------------------------------------------
  // Event: dragend
  // -------------------------------------------------------
  function onDragEnd(e) {
    // Remove ghost
    if (state.ghostEl) {
      state.ghostEl.remove();
      state.ghostEl = null;
    }

    // Clear all drag visual states
    document.querySelectorAll('.dragging, .dragging-card, .drag-over, .drag-over-empty, .site-drop-indicator.visible')
      .forEach(el => {
        el.classList.remove('dragging', 'dragging-card', 'drag-over', 'drag-over-empty');
        if (el.classList.contains('site-drop-indicator')) {
          el.classList.remove('visible');
        }
      });

    // Resume live tab auto-refresh after drag ends
    if (typeof liveTabsDragPaused !== 'undefined') {
      liveTabsDragPaused = false;
    }

    state.type = state.sourceId = state.sourceCatId = null;
  }

  // -------------------------------------------------------
  // Event: dragover
  // -------------------------------------------------------
  function onDragOver(e) {
    if (!state.type) return;

    // --- Site dragging ---
    if (state.type === 'site') {
      const targetTile = e.target.closest('.site-tile, .note-tile');
      const targetList = e.target.closest('.sites-list');
      const targetCard = e.target.closest('.category-card');

      if (targetTile && targetTile.dataset.siteId !== state.sourceId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearSiteDropIndicators();
        const indicator = targetTile.previousElementSibling;
        if (indicator && indicator.classList.contains('site-drop-indicator')) {
          indicator.classList.add('visible');
        }
        return;
      }

      if (targetList) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const catId = targetCard?.dataset.categoryId;
        if (catId && catId !== state.sourceCatId &&
            targetList.querySelectorAll('.site-tile, .note-tile').length === 0) {
          targetList.classList.add('drag-over-empty');
        }
        return;
      }

      if (targetCard) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    }

    // --- Category dragging ---
    if (state.type === 'category') {
      const targetCard = e.target.closest('.category-card');
      if (targetCard && targetCard.dataset.categoryId !== state.sourceId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.category-card.drag-over').forEach(el => el.classList.remove('drag-over'));
        targetCard.classList.add('drag-over');
      }
    }
  }

  // -------------------------------------------------------
  // Event: dragleave
  // -------------------------------------------------------
  function onDragLeave(e) {
    const targetList = e.target.closest('.sites-list');
    if (targetList) {
      // Only remove if leaving the list entirely (not entering a child)
      if (!targetList.contains(e.relatedTarget)) {
        targetList.classList.remove('drag-over-empty');
      }
    }
    const targetCard = e.target.closest('.category-card');
    if (targetCard && !targetCard.contains(e.relatedTarget)) {
      targetCard.classList.remove('drag-over');
    }
  }

  // -------------------------------------------------------
  // Event: drop
  // -------------------------------------------------------
  function onDrop(e) {
    if (!state.type || !state.onDrop) return;

    if (state.type === 'site') {
      const targetTile = e.target.closest('.site-tile, .note-tile');
      const targetCard = e.target.closest('.category-card');

      if (!targetCard) return;

      const targetCatId = targetCard.dataset.categoryId;
      const targetSiteId = targetTile?.dataset.siteId || null;

      e.preventDefault();
      state.onDrop('site', state.sourceId, state.sourceCatId, targetSiteId, targetCatId);
    }

    if (state.type === 'category') {
      const targetCard = e.target.closest('.category-card');
      if (!targetCard) return;
      const targetCatId = targetCard.dataset.categoryId;
      if (targetCatId === state.sourceId) return;

      e.preventDefault();
      state.onDrop('category', state.sourceId, null, targetCatId, null);
    }
  }

  // -------------------------------------------------------
  // Clear all visible site drop indicators
  // -------------------------------------------------------
  function clearSiteDropIndicators() {
    document.querySelectorAll('.site-drop-indicator.visible')
      .forEach(el => el.classList.remove('visible'));
  }

  return { init, makeSiteDraggable, makeCategoryDraggable };
})();
