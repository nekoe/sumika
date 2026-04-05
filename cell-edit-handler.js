// セル直接編集のマウスイベントハンドラ

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { updateIrregularRoomBounds } from './room-utils.js';

export function initCellEditHandlers(gridEl, { renderAll, renderPaintPreview, getGrid }) {

  gridEl.addEventListener('mousedown', e => {
    if (!ui.editingRoomId || state.mode !== 'room') return;
    const { col, row } = getGridCell(e);
    const cellKey  = `${col},${row}`;
    const editRoom = state.rooms.find(r => r.id === ui.editingRoomId);
    if (!editRoom) { ui.editingRoomId = null; return; }
    e.preventDefault();
    if (editRoom.cells && editRoom.cells.includes(cellKey) &&
        col >= 0 && row >= 0 && col < state.gridCols && row < state.gridRows) {
      ui.paintMode  = 'remove';
      ui.paintCells = new Set([cellKey]);
    } else {
      ui.paintMode  = 'add';
      ui.paintCells = new Set();
      if (col >= 0 && row >= 0 && col < state.gridCols && row < state.gridRows &&
          getGrid().cells[row][col] === null) {
        ui.paintCells.add(cellKey);
      }
    }
    renderPaintPreview();
  });

  gridEl.addEventListener('mousemove', e => {
    if (!ui.editingRoomId || state.mode !== 'room' || !ui.paintCells) return;
    const { col, row } = getGridCell(e);
    const cellKey  = `${col},${row}`;
    const editRoom = state.rooms.find(r => r.id === ui.editingRoomId);
    if (!editRoom) return;
    if (ui.paintMode === 'remove') {
      if (editRoom.cells && editRoom.cells.includes(cellKey)) ui.paintCells.add(cellKey);
    } else {
      if (col >= 0 && row >= 0 && col < state.gridCols && row < state.gridRows &&
          getGrid().cells[row][col] === null) {
        ui.paintCells.add(cellKey);
      }
    }
    renderPaintPreview();
  });

  document.addEventListener('mouseup', () => {
    if (!ui.editingRoomId || !ui.paintCells) return;
    if (ui.paintCells.size > 0) {
      const editRoom = state.rooms.find(r => r.id === ui.editingRoomId);
      if (editRoom) {
        pushUndo();
        const grid = getGrid();
        if (ui.paintMode === 'remove') {
          const newCells = editRoom.cells.filter(c => !ui.paintCells.has(c));
          if (newCells.length > 0) {
            for (const c of ui.paintCells) {
              const [cc, rr] = c.split(',').map(Number);
              if (grid.cells[rr] && grid.cells[rr][cc] === editRoom.id) grid.cells[rr][cc] = null;
            }
            editRoom.cells = newCells;
            updateIrregularRoomBounds(editRoom);
          }
        } else {
          for (const c of ui.paintCells) {
            if (!editRoom.cells.includes(c)) {
              const [cc, rr] = c.split(',').map(Number);
              grid.cells[rr][cc] = editRoom.id;
              editRoom.cells.push(c);
            }
          }
          updateIrregularRoomBounds(editRoom);
        }
        renderAll();
        saveProject(state);
      }
    }
    ui.paintCells = null;
    ui.paintMode  = null;
    renderPaintPreview();
  });
}

function getGridCell(e) {
  const rect = document.getElementById('grid').getBoundingClientRect();
  return {
    col: Math.floor((e.clientX - rect.left) / state.cellSize),
    row: Math.floor((e.clientY - rect.top)  / state.cellSize),
  };
}
