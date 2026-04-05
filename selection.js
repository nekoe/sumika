// 選択・複数選択・一括移動

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { canPlaceCells, placeRoomCells, removeRoom } from './grid.js';
import { updateIrregularRoomBounds, translateCells } from './room-utils.js';
import { createDragHandler } from './drag.js';

let _renderAll       = null;
let _updateInspector = null;
let _showToast       = null;

export function initSelection({ renderAll, updateInspector, showToast }) {
  _renderAll       = renderAll;
  _updateInspector = updateInspector;
  _showToast       = showToast;
}

// ── 単体選択 ──────────────────────────────────────────────────
export function selectRoom(id) {
  ui.selectedId = id;
  if (id) ui.selectedStairId = null;
  _updateInspector?.();
  document.querySelectorAll('.room-cell').forEach(el =>
    el.classList.toggle('room-cell-selected', el.dataset.roomId === ui.selectedId)
  );
  document.querySelectorAll('.room-label-block').forEach(el =>
    el.classList.toggle('room-label-selected', el.dataset.id === ui.selectedId)
  );
}

// ── 複数選択 ──────────────────────────────────────────────────
export function selectAll() {
  ui.multiSelected = new Set();
  for (const r of state.rooms) ui.multiSelected.add(r.id);
  for (const s of state.stairs) ui.multiSelected.add(s.id);
  for (const f of (state.furniture || [])) ui.multiSelected.add(f.id);
  ui.multiIncludesElements = true;
  ui.multiIncludesAllFloors = true;
  ui.selectedId = null; ui.selectedStairId = null; ui.selectedFurnitureId = null;
  _renderAll?.();
  _showToast?.(`${ui.multiSelected.size}個を選択 — ドラッグで一括移動、Escでキャンセル`);
}

export function toggleMultiSelect(id) {
  if (ui.multiSelected.has(id)) ui.multiSelected.delete(id);
  else ui.multiSelected.add(id);
  ui.selectedId = null; ui.selectedStairId = null; ui.selectedFurnitureId = null;
  _renderAll?.();
  _updateInspector?.();
}

export function clearMultiSelected() {
  if (ui.multiSelected.size === 0) return;
  ui.multiSelected = new Set();
  ui.multiIncludesElements = false;
  ui.multiIncludesAllFloors = false;
  _renderAll?.();
  _updateInspector?.();
}

// ── 複数選択移動 ──────────────────────────────────────────────
export function computeClampedDelta(dx, dy) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ui.multiSelected) {
    const room = state.rooms.find(r => r.id === id);
    if (room) {
      for (const k of room.cells) {
        const [c, r] = k.split(',').map(Number);
        minX = Math.min(minX, c); minY = Math.min(minY, r);
        maxX = Math.max(maxX, c + 1); maxY = Math.max(maxY, r + 1);
      }
      continue;
    }
    const stair = state.stairs.find(s => s.id === id);
    if (stair) {
      minX = Math.min(minX, stair.x); minY = Math.min(minY, stair.y);
      maxX = Math.max(maxX, stair.x + stair.w); maxY = Math.max(maxY, stair.y + stair.h);
      continue;
    }
    const furn = (state.furniture || []).find(f => f.id === id);
    if (furn) {
      minX = Math.min(minX, furn.x); minY = Math.min(minY, furn.y);
      maxX = Math.max(maxX, furn.x + furn.w); maxY = Math.max(maxY, furn.y + furn.h);
    }
  }
  if (minX === Infinity) return { dx: 0, dy: 0 };
  dx = Math.max(-minX, Math.min(state.gridCols - maxX, dx));
  dy = Math.max(-minY, Math.min(state.gridRows - maxY, dy));
  return { dx, dy };
}

export function applyMultiMovePreview(dx, dy) {
  const cs = state.cellSize;
  for (const id of ui.multiSelected) {
    const tx = `translate(${dx*cs}px,${dy*cs}px)`;
    document.querySelectorAll(`.room-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
    document.querySelectorAll(`.room-cell[data-room-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
    document.querySelectorAll(`.room-label-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; });
    document.querySelectorAll(`.stair-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
    document.querySelectorAll(`.furniture-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
  }
  if (ui.multiIncludesElements && ui.svgEl) {
    ui.svgEl.style.transform = `translate(${dx*cs}px,${dy*cs}px)`;
  }
}

export function clearMultiMovePreview() {
  for (const id of ui.multiSelected) {
    document.querySelectorAll(
      `.room-block[data-id="${id}"], .room-cell[data-room-id="${id}"], .room-label-block[data-id="${id}"], .stair-block[data-id="${id}"], .furniture-block[data-id="${id}"]`
    ).forEach(el => { el.style.transform = ''; el.style.zIndex = ''; });
  }
  if (ui.svgEl) ui.svgEl.style.transform = '';
}

export function commitMultiMove(dx, dy) {
  if (dx === 0 && dy === 0) return;
  pushUndo();
  for (const id of ui.multiSelected) {
    const room = state.rooms.find(r => r.id === id);
    if (room) {
      const newCells = translateCells(room.cells, dx, dy);
      removeRoom(ui.grid, room.id);
      room.cells = newCells;
      updateIrregularRoomBounds(room);
      placeRoomCells(ui.grid, room.id, newCells);
      continue;
    }
    const stair = state.stairs.find(s => s.id === id);
    if (stair) {
      const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
      const paired = state.floors[otherFloorIdx].stairs.find(s => s.x === stair.x && s.y === stair.y);
      stair.x += dx; stair.y += dy;
      if (paired) { paired.x = stair.x; paired.y = stair.y; }
      continue;
    }
    const furn = (state.furniture || []).find(f => f.id === id);
    if (furn) { furn.x += dx; furn.y += dy; }
  }
  if (ui.multiIncludesElements) {
    for (const el of (state.elements || [])) { el.col += dx; el.row += dy; }
  }
  if (ui.multiIncludesAllFloors) {
    const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
    const otherFloor = state.floors[otherFloorIdx];
    for (const room of (otherFloor.rooms || [])) {
      room.cells = room.cells.map(k => {
        const [c, r] = k.split(',').map(Number);
        return `${c+dx},${r+dy}`;
      });
      updateIrregularRoomBounds(room);
    }
    for (const el of (otherFloor.elements || [])) { el.col += dx; el.row += dy; }
    for (const furn of (otherFloor.furniture || [])) { furn.x += dx; furn.y += dy; }
  }
  _renderAll?.();
  saveProject(state);
}

export function startMultiMoveDrag(e) {
  const cs = state.cellSize;
  const startMX = e.clientX, startMY = e.clientY;
  let moved = false;
  let lastDx = 0, lastDy = 0;
  ui.multiMoveDragging = true;

  createDragHandler({
    onMove: mv => {
      const rawDx = Math.round((mv.clientX - startMX) / cs);
      const rawDy = Math.round((mv.clientY - startMY) / cs);
      if (rawDx === 0 && rawDy === 0) return;
      moved = true;
      const { dx, dy } = computeClampedDelta(rawDx, rawDy);
      if (dx === lastDx && dy === lastDy) return;
      lastDx = dx; lastDy = dy;
      applyMultiMovePreview(dx, dy);
    },
    onUp: mv => {
      ui.multiMoveDragging = false;
      clearMultiMovePreview();
      if (!moved) { clearMultiSelected(); return; }
      const rawDx = Math.round((mv.clientX - startMX) / cs);
      const rawDy = Math.round((mv.clientY - startMY) / cs);
      const { dx, dy } = computeClampedDelta(rawDx, rawDy);
      commitMultiMove(dx, dy);
    },
  });
}
