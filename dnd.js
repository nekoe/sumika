// ドラッグ＆ドロップ処理

let dragState = null;

export function initDnd({ gridEl, paletteEl, cellSize, onDropNew, onMove, onDropFurniture }) {
  // --- パレット → グリッド（新規配置）---
  paletteEl.addEventListener('dragstart', e => {
    const item = e.target.closest('.palette-item');
    if (!item) return;
    if (item.dataset.typeId) {
      dragState = { mode: 'new', typeId: item.dataset.typeId };
    } else if (item.dataset.furnTypeId) {
      dragState = { mode: 'furnNew', furnTypeId: item.dataset.furnTypeId };
    } else {
      return;
    }
    e.dataTransfer.effectAllowed = 'copy';
  });

  // --- グリッド上の部屋を移動 ---
  gridEl.addEventListener('dragstart', e => {
    const room = e.target.closest('.room-block');
    if (!room) return;
    const rect = room.getBoundingClientRect();
    const offsetX = Math.floor((e.clientX - rect.left) / cellSize());
    const offsetY = Math.floor((e.clientY - rect.top) / cellSize());
    dragState = { mode: 'move', roomId: room.dataset.id, offsetX, offsetY };
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => room.classList.add('dragging'), 0);
  });

  gridEl.addEventListener('dragend', e => {
    const room = e.target.closest('.room-block');
    if (room) room.classList.remove('dragging');
    clearHighlight(gridEl);
    dragState = null;
  });

  // --- ドロップゾーンのハイライト ---
  gridEl.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragState) return;
    const { col, row } = getGridPos(e, gridEl, cellSize());
    if (dragState.mode === 'move') {
      highlightDropTarget(gridEl, col - (dragState.offsetX || 0), row - (dragState.offsetY || 0), cellSize());
    } else {
      highlightDropTarget(gridEl, col, row, cellSize());
    }
    e.dataTransfer.dropEffect = dragState.mode === 'move' ? 'move' : 'copy';
  });

  gridEl.addEventListener('dragleave', e => {
    if (!gridEl.contains(e.relatedTarget)) clearHighlight(gridEl);
  });

  gridEl.addEventListener('drop', e => {
    e.preventDefault();
    clearHighlight(gridEl);
    if (!dragState) return;
    const { col, row } = getGridPos(e, gridEl, cellSize());
    if (dragState.mode === 'new') {
      onDropNew(dragState.typeId, col, row);
    } else if (dragState.mode === 'furnNew') {
      onDropFurniture?.(dragState.furnTypeId, col, row);
    } else if (dragState.mode === 'move') {
      onMove(dragState.roomId, col - (dragState.offsetX || 0), row - (dragState.offsetY || 0));
    }
    dragState = null;
  });

  // --- タッチ対応（モバイル）---
  initTouchDnd({ gridEl, paletteEl, cellSize, onDropNew, onMove, onDropFurniture });
}

function getGridPos(e, gridEl, cs) {
  const rect = gridEl.getBoundingClientRect();
  return {
    col: Math.max(0, Math.floor((e.clientX - rect.left + gridEl.scrollLeft) / cs)),
    row: Math.max(0, Math.floor((e.clientY - rect.top  + gridEl.scrollTop)  / cs)),
  };
}

let highlightEl = null;
function highlightDropTarget(gridEl, x, y, cs) {
  clearHighlight(gridEl);
  highlightEl = document.createElement('div');
  highlightEl.className = 'drop-highlight';
  highlightEl.style.left = x * cs + 'px';
  highlightEl.style.top  = y * cs + 'px';
  highlightEl.style.width  = cs + 'px';
  highlightEl.style.height = cs + 'px';
  gridEl.appendChild(highlightEl);
}

function clearHighlight(gridEl) {
  if (highlightEl && highlightEl.parentNode === gridEl) {
    gridEl.removeChild(highlightEl);
    highlightEl = null;
  }
}

// --- タッチ DnD ---
function initTouchDnd({ gridEl, paletteEl, cellSize, onDropNew, onMove, onDropFurniture }) {
  let touchDrag = null;
  let ghost = null;

  function createGhost(sourceEl) {
    ghost = sourceEl.cloneNode(true);
    ghost.style.cssText = 'position:fixed;opacity:0.7;pointer-events:none;z-index:9999;';
    ghost.style.width  = sourceEl.offsetWidth  + 'px';
    ghost.style.height = sourceEl.offsetHeight + 'px';
    document.body.appendChild(ghost);
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = x - ghost.offsetWidth  / 2 + 'px';
    ghost.style.top  = y - ghost.offsetHeight / 2 + 'px';
  }

  function removeGhost() {
    if (ghost) { ghost.remove(); ghost = null; }
  }

  paletteEl.addEventListener('touchstart', e => {
    const item = e.target.closest('.palette-item');
    if (!item) return;
    if (item.dataset.typeId) {
      touchDrag = { mode: 'new', typeId: item.dataset.typeId };
    } else if (item.dataset.furnTypeId) {
      touchDrag = { mode: 'furnNew', furnTypeId: item.dataset.furnTypeId };
    } else {
      return;
    }
    createGhost(item);
  }, { passive: true });

  gridEl.addEventListener('touchstart', e => {
    const room = e.target.closest('.room-block');
    if (!room) return;
    e.preventDefault();
    touchDrag = { mode: 'move', roomId: room.dataset.id };
    createGhost(room);
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!touchDrag) return;
    e.preventDefault();
    const t = e.touches[0];
    moveGhost(t.clientX, t.clientY);
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!touchDrag) return;
    const t = e.changedTouches[0];
    removeGhost();
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el && (el === gridEl || gridEl.contains(el))) {
      const rect = gridEl.getBoundingClientRect();
      const cs = cellSize();
      const col = Math.max(0, Math.floor((t.clientX - rect.left) / cs));
      const row = Math.max(0, Math.floor((t.clientY - rect.top)  / cs));
      if (touchDrag.mode === 'new') {
        onDropNew(touchDrag.typeId, col, row);
      } else if (touchDrag.mode === 'furnNew') {
        onDropFurniture?.(touchDrag.furnTypeId, col, row);
      } else {
        onMove(touchDrag.roomId, col, row);
      }
    }
    touchDrag = null;
  });
}
