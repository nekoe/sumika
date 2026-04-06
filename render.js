// レンダリング: 部屋・階段・家具・グリッド・土地・コンパス

import { state, ui } from './state.js';
import { renderLand } from './land.js';
import { renderWallLayer } from './walls.js';
import { attachResizeHandles, calcResize } from './resize.js';
import { getTypeById, calcAreaCells } from './rooms.js';
import { getFurnitureTypeById } from './furniture.js';
import { getLandscapeTypeById } from './landscape.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { createDragHandler } from './drag.js';
import { canPlaceCells, placeRoomCells, removeRoom } from './grid.js';
import { isRectRoom, updateIrregularRoomBounds, translateCells } from './room-utils.js';
import {
  selectRoom, toggleMultiSelect, clearMultiSelected, selectAll,
} from './selection.js';
import { updateInspector } from './inspector.js';

let _renderAll        = null;
let _handleModeChange = null;

export function initRenderer({ renderAll, handleModeChange }) {
  _renderAll        = renderAll;
  _handleModeChange = handleModeChange;
}

// ── グリッドCSS ────────────────────────────────────────────────
export function applyGridCss() {
  const gridEl = document.getElementById('grid');
  const cs = state.cellSize;
  gridEl.style.width  = state.gridCols * cs + 'px';
  gridEl.style.height = state.gridRows * cs + 'px';
  gridEl.style.backgroundSize = `${cs}px ${cs}px`;
  document.documentElement.style.setProperty('--cell-size', cs + 'px');
  if (ui.svgEl) {
    ui.svgEl.setAttribute('width',  state.gridCols * cs);
    ui.svgEl.setAttribute('height', state.gridRows * cs);
  }
  if (ui.landSvg) {
    ui.landSvg.setAttribute('width',  state.gridCols * cs);
    ui.landSvg.setAttribute('height', state.gridRows * cs);
  }
  if (ui.paintCanvas) {
    ui.paintCanvas.width  = state.gridCols * cs;
    ui.paintCanvas.height = state.gridRows * cs;
  }
}

// ── 土地レイヤー ───────────────────────────────────────────────
export function renderLandLayer() {
  if (!ui.landSvg) return;
  renderLand(ui.landSvg, state.land, state.cellSize, state.gridCols, state.gridRows, ui.landPreview);
}

// ── コンパスインジケーター ──────────────────────────────────────
export function renderCompassIndicator() {
  const gridEl = document.getElementById('grid');
  let ind = document.getElementById('compass-indicator');
  if (!ind) { ind = document.createElement('div'); ind.id = 'compass-indicator'; gridEl.appendChild(ind); }
  const deg = state.compass ?? 0;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const label = `${dirs[Math.round(deg / 45) % 8]} ${deg}°`;
  const hour = state.sunHour ?? 12;
  const hh = Math.floor(hour), mm = hour % 1 === 0.5 ? '30' : '00';
  ind.innerHTML = `
    <div class="ci-rose" style="transform:rotate(${deg}deg)"><div class="ci-n">N</div><div class="ci-arrow"></div></div>
    <div class="ci-label">${label} / ${hh}:${mm}</div>`;
}

// ── セル編集プレビュー ─────────────────────────────────────────
export function renderPaintPreview() {
  if (!ui.paintCanvas) return;
  const cs = state.cellSize;
  ui.paintCanvas.width  = state.gridCols * cs;
  ui.paintCanvas.height = state.gridRows * cs;
  const ctx = ui.paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, ui.paintCanvas.width, ui.paintCanvas.height);
  if (!ui.paintCells || !ui.paintCells.size || !ui.editingRoomId) return;
  if (ui.paintMode === 'remove') {
    ctx.fillStyle   = 'rgba(239,68,68,0.45)';
    ctx.strokeStyle = '#dc2626';
  } else {
    const editRoom = state.rooms.find(r => r.id === ui.editingRoomId);
    ctx.fillStyle   = (editRoom?.color ?? '#cccccc') + 'cc';
    ctx.strokeStyle = '#16a34a';
  }
  ctx.lineWidth = 2;
  for (const key of ui.paintCells) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillRect(c*cs, r*cs, cs, cs);
    ctx.strokeRect(c*cs+1, r*cs+1, cs-2, cs-2);
  }
}

// ── 部屋 ──────────────────────────────────────────────────────
export function renderRooms() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.room-block, .room-cell, .room-label-block').forEach(el => el.remove());
  for (const room of state.rooms) appendIrregularRoom(gridEl, room);
}

export function appendIrregularRoom(gridEl, room) {
  const cs = state.cellSize;
  const isSelected     = room.id === ui.selectedId;
  const isEditing      = ui.editingRoomId === room.id;
  const isRoomMultiSel = ui.multiSelected.has(room.id);
  const type = getTypeById(room.typeId);

  for (const key of room.cells) {
    const [col, row] = key.split(',').map(Number);
    const cell = document.createElement('div');
    cell.className = 'room-cell'
      + (isSelected      ? ' room-cell-selected' : '')
      + (type.isVoid     ? ' room-cell-void'     : '')
      + (isEditing       ? ' room-cell-editing'  : '')
      + (isRoomMultiSel  ? ' multi-selected'     : '');
    cell.dataset.roomId = room.id;
    cell.style.cssText = `left:${col*cs}px;top:${row*cs}px;width:${cs}px;height:${cs}px;background:${room.color};`;

    cell.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      if (ui.multiSelected.size > 0) return;
      if (ui.editingRoomId === room.id) return;
      if (state.mode !== 'room') {
        _handleModeChange?.('room'); ui.toolbar?.setMode('room');
        selectRoom(room.id); return;
      }
      e.preventDefault(); e.stopPropagation();
      selectRoom(room.id);
      startRoomMoveDrag(e, room);
    });

    cell.addEventListener('click', e => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { toggleMultiSelect(room.id); return; }
      if (ui.multiSelected.size > 0) { clearMultiSelected(); return; }
    });
    gridEl.appendChild(cell);
  }

  const { tatami } = calcAreaCells(room.cells);
  const label = document.createElement('div');
  label.className = 'room-label-block'
    + (isSelected     ? ' room-label-selected' : '')
    + (isRoomMultiSel ? ' multi-selected'      : '');
  label.dataset.id = room.id;
  label.dataset.x = room.x; label.dataset.y = room.y;
  label.dataset.w = room.w; label.dataset.h = room.h;
  label.style.cssText = `left:${room.x*cs}px;top:${room.y*cs}px;width:${room.w*cs}px;height:${room.h*cs}px;`;
  const icon = room.icon ?? type.icon;
  label.innerHTML = `
    <div class="room-top-strip">
      <span class="room-label" title="${room.label}">${room.label}</span>
      <span class="room-area">${tatami}畳</span>
    </div>
    <div class="room-inner">
      <div class="room-icon">${icon}</div>
    </div>`;
  label.querySelector('.room-top-strip .room-label').addEventListener('dblclick', e => {
    e.stopPropagation(); startLabelEdit(label, room);
  });
  if (isRectRoom(room)) addCornerHandles(label, room);
  gridEl.appendChild(label);
}

function startLabelEdit(labelDiv, room) {
  const labelEl = labelDiv.querySelector('.room-label');
  if (!labelEl) return;
  const input = document.createElement('input');
  input.type = 'text'; input.value = room.label; input.className = 'label-edit-input';
  labelEl.replaceWith(input); input.focus(); input.select();
  const commit = () => { pushUndo(); room.label = input.value.trim() || room.label; _renderAll?.(); saveProject(state); };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') _renderAll?.();
  });
}

function addCornerHandles(labelEl, room) {
  const CORNERS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CURSORS  = { nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize', se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize' };
  for (const dir of CORNERS) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${dir}`;
    handle.style.cursor = CURSORS[dir];
    handle.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const cs = state.cellSize;
      const startX = e.clientX, startY = e.clientY;
      const origX = room.x, origY = room.y, origW = room.w, origH = room.h;
      let moved = false;
      createDragHandler({
        onMove: mv => {
          const dx = Math.round((mv.clientX - startX) / cs);
          const dy = Math.round((mv.clientY - startY) / cs);
          if (dx === 0 && dy === 0) return;
          moved = true;
          const g = calcResize(dir, origX, origY, origW, origH, dx, dy);
          const cx = Math.max(0, g.x), cy = Math.max(0, g.y);
          const cw = Math.max(1, Math.min(g.w, state.gridCols - cx));
          const ch = Math.max(1, Math.min(g.h, state.gridRows - cy));
          labelEl.style.left   = `${cx * cs}px`; labelEl.style.top    = `${cy * cs}px`;
          labelEl.style.width  = `${cw * cs}px`; labelEl.style.height = `${ch * cs}px`;
        },
        onUp: mv => {
          if (!moved) return;
          const dx = Math.round((mv.clientX - startX) / cs);
          const dy = Math.round((mv.clientY - startY) / cs);
          const g = calcResize(dir, origX, origY, origW, origH, dx, dy);
          commitRoomResize(room, g.x, g.y, g.w, g.h);
        },
      });
    });
    labelEl.appendChild(handle);
  }
}

function commitRoomResize(room, x, y, w, h) {
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.max(1, Math.min(w, state.gridCols - x));
  h = Math.max(1, Math.min(h, state.gridRows - y));
  const newCells = [];
  for (let r = y; r < y + h; r++)
    for (let c = x; c < x + w; c++)
      newCells.push(`${c},${r}`);
  if (!canPlaceCells(ui.grid, newCells, room.id)) { _renderAll?.(); return; }
  pushUndo();
  removeRoom(ui.grid, room.id);
  room.x = x; room.y = y; room.w = w; room.h = h;
  room.cells = newCells;
  placeRoomCells(ui.grid, room.id, newCells);
  _renderAll?.();
  saveProject(state);
}

export function startRoomMoveDrag(e, room) {
  const cs = state.cellSize;
  const startMX = e.clientX, startMY = e.clientY;
  let lastDx = 0, lastDy = 0;
  let moved = false;

  const cols = room.cells.map(k => +k.split(',')[0]);
  const rows = room.cells.map(k => +k.split(',')[1]);
  const minC = Math.min(...cols), minR = Math.min(...rows);
  const maxC = Math.max(...cols), maxR = Math.max(...rows);

  createDragHandler({
    onMove: mv => {
      const rawDx = Math.round((mv.clientX - startMX) / cs);
      const rawDy = Math.round((mv.clientY - startMY) / cs);
      const dx = Math.max(-minC, Math.min(state.gridCols - 1 - maxC, rawDx));
      const dy = Math.max(-minR, Math.min(state.gridRows - 1 - maxR, rawDy));
      if (dx === lastDx && dy === lastDy) return;
      moved = true; lastDx = dx; lastDy = dy;
      const tx = `translate(${dx*cs}px,${dy*cs}px)`;
      document.querySelectorAll(`.room-cell[data-room-id="${room.id}"]`).forEach(el => {
        el.style.transform = tx; el.style.zIndex = '50';
      });
      document.querySelectorAll(`.room-label-block[data-id="${room.id}"]`).forEach(el => {
        el.style.transform = tx; el.style.zIndex = '50';
      });
    },
    onUp: mv => {
      document.querySelectorAll(
        `.room-cell[data-room-id="${room.id}"], .room-label-block[data-id="${room.id}"]`
      ).forEach(el => { el.style.transform = ''; el.style.zIndex = ''; });
      if (!moved || (lastDx === 0 && lastDy === 0)) return;
      const rawDx = Math.round((mv.clientX - startMX) / cs);
      const rawDy = Math.round((mv.clientY - startMY) / cs);
      const dx = Math.max(-minC, Math.min(state.gridCols - 1 - maxC, rawDx));
      const dy = Math.max(-minR, Math.min(state.gridRows - 1 - maxR, rawDy));
      const newCells = translateCells(room.cells, dx, dy);
      if (!canPlaceCells(ui.grid, newCells, room.id)) { _renderAll?.(); return; }
      pushUndo();
      removeRoom(ui.grid, room.id);
      room.cells = newCells;
      updateIrregularRoomBounds(room);
      placeRoomCells(ui.grid, room.id, newCells);
      _renderAll?.();
      saveProject(state);
    },
  });
}

// ── 階段 ──────────────────────────────────────────────────────
export function renderStairs() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.stair-block').forEach(el => el.remove());
  const cs = state.cellSize;
  const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
  const ARROWS = { n: '↑', s: '↓', e: '→', w: '←' };

  for (const s of state.stairs) {
    const div = document.createElement('div');
    const isSelected = s.id === ui.selectedStairId;
    div.className = 'stair-block' + (isSelected ? ' stair-selected' : '') + (ui.multiSelected.has(s.id) ? ' multi-selected' : '');
    div.dataset.id = s.id;
    div.dataset.x = s.x; div.dataset.y = s.y;
    div.dataset.w = s.w; div.dataset.h = s.h;
    div.style.cssText = `left:${s.x*cs}px;top:${s.y*cs}px;width:${s.w*cs}px;height:${s.h*cs}px;`;
    const paired = state.floors[otherFloorIdx].stairs.some(os => os.x === s.x && os.y === s.y);
    const arrow  = ARROWS[s.dir || 'n'];
    const fn = state.currentFloor + 1, on = otherFloorIdx + 1;
    div.innerHTML = `<span class="stair-icon">🪜</span><span class="stair-dir">${arrow}</span><span class="stair-label">${fn}F↔${on}F${paired ? '' : ' ⚠'}</span>`;
    div.title = `階段 ${fn}F↔${on}F / ${s.w}×${s.h}マス / 向き:${arrow}${paired ? '' : '\n⚠ 対応する階段がありません'}`;

    div.addEventListener('mousedown', e => {
      if (e.target.closest('.resize-handle')) { pushUndo(); return; }
      e.stopPropagation();
      if (state.mode !== 'stair') {
        if (ui.editingRoomId) return;
        _handleModeChange?.('stair'); ui.toolbar?.setMode('stair');
        ui.selectedStairId = s.id;
        updateInspector(); renderStairs(); return;
      }
      e.preventDefault();
      const origX = s.x, origY = s.y;
      const startMX = e.clientX, startMY = e.clientY;
      let moved = false;
      createDragHandler({
        onMove: mv => {
          const dx = Math.round((mv.clientX - startMX) / cs);
          const dy = Math.round((mv.clientY - startMY) / cs);
          const nx = Math.max(0, Math.min(state.gridCols - s.w, origX + dx));
          const ny = Math.max(0, Math.min(state.gridRows - s.h, origY + dy));
          div.style.left = `${nx * cs}px`;
          div.style.top  = `${ny * cs}px`;
          if (dx !== 0 || dy !== 0) moved = true;
        },
        onUp: mv => {
          if (!moved) {
            if (mv.ctrlKey || mv.metaKey) { toggleMultiSelect(s.id); return; }
            if (ui.multiSelected.size > 0) { clearMultiSelected(); return; }
            ui.selectedStairId = (ui.selectedStairId === s.id) ? null : s.id;
            updateInspector(); renderStairs(); return;
          }
          const dx = Math.round((mv.clientX - startMX) / cs);
          const dy = Math.round((mv.clientY - startMY) / cs);
          const nx = Math.max(0, Math.min(state.gridCols - s.w, origX + dx));
          const ny = Math.max(0, Math.min(state.gridRows - s.h, origY + dy));
          div.style.left = `${nx * cs}px`;
          div.style.top  = `${ny * cs}px`;
          if (nx !== origX || ny !== origY) {
            pushUndo();
            const otherFl = state.floors[state.currentFloor === 0 ? 1 : 0];
            const pairedStair = otherFl.stairs.find(os => os.x === s.x && os.y === s.y);
            s.x = nx; s.y = ny;
            if (pairedStair) { pairedStair.x = nx; pairedStair.y = ny; }
            div.dataset.x = nx; div.dataset.y = ny;
            ui.selectedStairId = s.id;
            saveProject(state);
          }
        },
      });
    });

    div.addEventListener('click', e => e.stopPropagation());
    div.addEventListener('dragstart', e => e.preventDefault());

    attachResizeHandles(div, () => state.cellSize, (id, g) => {
      const stair = state.stairs.find(st => st.id === id);
      if (!stair) return;
      const x = Math.max(0, g.x);
      const y = Math.max(0, g.y);
      const w = Math.max(1, Math.min(g.w, state.gridCols - x));
      const h = Math.max(1, Math.min(g.h, state.gridRows - y));
      stair.x = x; stair.y = y; stair.w = w; stair.h = h;
      const otherFl = state.floors[state.currentFloor === 0 ? 1 : 0];
      const pairId  = stair.id.endsWith('_pair') ? stair.id.replace('_pair', '') : stair.id + '_pair';
      const pairedStair = otherFl.stairs.find(os => os.id === pairId)
                       || otherFl.stairs.find(os => os.x === x && os.y === y);
      if (pairedStair) { pairedStair.x = x; pairedStair.y = y; pairedStair.w = w; pairedStair.h = h; }
      const el = document.querySelector(`.stair-block[data-id="${id}"]`);
      if (el) {
        el.style.left = `${x*cs}px`; el.style.top  = `${y*cs}px`;
        el.style.width = `${w*cs}px`; el.style.height = `${h*cs}px`;
        el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
      }
      saveProject(state);
    });

    gridEl.appendChild(div);
  }
}

// ── 家具 ──────────────────────────────────────────────────────
export function renderFurniture() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.furniture-block').forEach(el => el.remove());
  const cs = state.cellSize;

  for (const furn of (state.furniture || [])) {
    const ftype = getFurnitureTypeById(furn.typeId);
    const displayColor = furn.color ?? ftype.color;
    const displayIcon  = furn.icon  ?? ftype.icon;
    const displayLabel = furn.label ?? ftype.label;
    const div = document.createElement('div');
    const isSelected = furn.id === ui.selectedFurnitureId;
    div.className = 'furniture-block' + (isSelected ? ' selected' : '') + (ui.multiSelected.has(furn.id) ? ' multi-selected' : '');
    div.dataset.id = furn.id;
    div.dataset.x  = furn.x; div.dataset.y = furn.y;
    div.dataset.w  = furn.w; div.dataset.h = furn.h;
    div.style.cssText = `left:${furn.x*cs}px;top:${furn.y*cs}px;width:${furn.w*cs}px;height:${furn.h*cs}px;background-color:${displayColor};`;
    div.innerHTML = `
      <span class="furn-icon">${displayIcon}</span>
      <span class="furn-label">${displayLabel}</span>`;

    div.addEventListener('click', e => {
      if (e.target.closest('.resize-handle')) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { toggleMultiSelect(furn.id); return; }
      if (ui.multiSelected.size > 0) { clearMultiSelected(); return; }
      if (state.mode !== 'furniture') {
        if (ui.editingRoomId) return;
        _handleModeChange?.('furniture'); ui.toolbar?.setMode('furniture');
      }
      ui.selectedFurnitureId = (ui.selectedFurnitureId === furn.id) ? null : furn.id;
      renderFurniture();
      updateInspector();
    });

    div.addEventListener('mousedown', e => {
      if (state.mode !== 'furniture') return;
      if (e.target.closest('.resize-handle')) { pushUndo(); return; }
      e.stopPropagation(); e.preventDefault();
      const origX = furn.x, origY = furn.y;
      const startMX = e.clientX, startMY = e.clientY;
      let moved = false;
      createDragHandler({
        onMove: mv => {
          const dx = Math.round((mv.clientX - startMX) / cs);
          const dy = Math.round((mv.clientY - startMY) / cs);
          const nx = Math.max(0, Math.min(state.gridCols - furn.w, origX + dx));
          const ny = Math.max(0, Math.min(state.gridRows - furn.h, origY + dy));
          div.style.left = `${nx * cs}px`;
          div.style.top  = `${ny * cs}px`;
          if (dx !== 0 || dy !== 0) moved = true;
        },
        onUp: mv => {
          if (!moved) return;
          const dx = Math.round((mv.clientX - startMX) / cs);
          const dy = Math.round((mv.clientY - startMY) / cs);
          const nx = Math.max(0, Math.min(state.gridCols - furn.w, origX + dx));
          const ny = Math.max(0, Math.min(state.gridRows - furn.h, origY + dy));
          div.style.left = `${nx * cs}px`;
          div.style.top  = `${ny * cs}px`;
          if (nx !== origX || ny !== origY) {
            pushUndo();
            furn.x = nx; furn.y = ny;
            div.dataset.x = nx; div.dataset.y = ny;
            saveProject(state);
          }
        },
      });
    });

    attachResizeHandles(div, () => state.cellSize, (id, g) => {
      const f = state.furniture.find(f => f.id === id);
      if (!f) return;
      const ftype2 = getFurnitureTypeById(f.typeId);
      const x = Math.max(0, g.x);
      const y = Math.max(0, g.y);
      const w = Math.max(ftype2.minW, Math.min(g.w, state.gridCols - x));
      const h = Math.max(ftype2.minH, Math.min(g.h, state.gridRows - y));
      f.x = x; f.y = y; f.w = w; f.h = h;
      const el = document.querySelector(`.furniture-block[data-id="${id}"]`);
      if (el) {
        el.style.left  = `${x*cs}px`; el.style.top    = `${y*cs}px`;
        el.style.width = `${w*cs}px`; el.style.height = `${h*cs}px`;
        el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
      }
      saveProject(state);
    });

    gridEl.appendChild(div);
  }
}

// ── 外構・植栽 ────────────────────────────────────────────────
export function renderLandscape() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.landscape-block').forEach(el => el.remove());
  const cs = state.cellSize;

  for (const ls of (state.landscape || [])) {
    const ltype = getLandscapeTypeById(ls.typeId);
    const displayColor = ls.color ?? ltype.color;
    const displayIcon  = ls.icon  ?? ltype.icon;
    const displayLabel = ls.label ?? ltype.label;
    const div = document.createElement('div');
    const isSelected = ls.id === ui.selectedLandscapeId;
    div.className = 'landscape-block' + (isSelected ? ' selected' : '');
    div.dataset.id = ls.id;
    div.dataset.x  = ls.x; div.dataset.y = ls.y;
    div.dataset.w  = ls.w; div.dataset.h = ls.h;
    div.style.cssText = `left:${ls.x*cs}px;top:${ls.y*cs}px;width:${ls.w*cs}px;height:${ls.h*cs}px;background-color:${displayColor};`;
    div.innerHTML = `
      <span class="landscape-icon">${displayIcon}</span>
      <span class="landscape-label">${displayLabel}</span>`;

    // 階段と同じパターン: mousedown で常に stopPropagation し、モード切替も mousedown 内で処理
    div.addEventListener('mousedown', e => {
      if (e.target.closest('.resize-handle')) { pushUndo(); return; }
      e.stopPropagation();
      // landscape モード以外 → モード切替 + 選択して終了
      if (state.mode !== 'landscape') {
        if (ui.editingRoomId) return;
        _handleModeChange?.('landscape'); ui.toolbar?.setMode('landscape');
        ui.selectedLandscapeId = ls.id;
        renderLandscape();
        updateInspector();
        return;
      }
      // landscape モード内 → ドラッグ移動、onUp で選択トグル
      e.preventDefault();
      const origX = ls.x, origY = ls.y;
      const startMX = e.clientX, startMY = e.clientY;
      let moved = false;
      createDragHandler({
        onMove: mv => {
          const dx = Math.round((mv.clientX - startMX) / cs);
          const dy = Math.round((mv.clientY - startMY) / cs);
          const nx = Math.max(0, Math.min(state.gridCols - ls.w, origX + dx));
          const ny = Math.max(0, Math.min(state.gridRows - ls.h, origY + dy));
          div.style.left = `${nx * cs}px`;
          div.style.top  = `${ny * cs}px`;
          if (dx !== 0 || dy !== 0) moved = true;
        },
        onUp: mv => {
          if (!moved) {
            ui.selectedLandscapeId = (ui.selectedLandscapeId === ls.id) ? null : ls.id;
            renderLandscape();
            updateInspector();
            return;
          }
          const dx = Math.round((mv.clientX - startMX) / cs);
          const dy = Math.round((mv.clientY - startMY) / cs);
          const nx = Math.max(0, Math.min(state.gridCols - ls.w, origX + dx));
          const ny = Math.max(0, Math.min(state.gridRows - ls.h, origY + dy));
          if (nx !== origX || ny !== origY) {
            pushUndo();
            ls.x = nx; ls.y = ny;
            div.dataset.x = nx; div.dataset.y = ny;
            div.style.left = `${nx * cs}px`;
            div.style.top  = `${ny * cs}px`;
            saveProject(state);
          }
        },
      });
    });
    div.addEventListener('click', e => e.stopPropagation());

    attachResizeHandles(div, () => state.cellSize, (id, g) => {
      const l = state.landscape.find(l => l.id === id);
      if (!l) return;
      const ltype2 = getLandscapeTypeById(l.typeId);
      const x = Math.max(0, g.x);
      const y = Math.max(0, g.y);
      const w = Math.max(ltype2.minW, Math.min(g.w, state.gridCols - x));
      const h = Math.max(ltype2.minH, Math.min(g.h, state.gridRows - y));
      l.x = x; l.y = y; l.w = w; l.h = h;
      const el = document.querySelector(`.landscape-block[data-id="${id}"]`);
      if (el) {
        el.style.left  = `${x*cs}px`; el.style.top    = `${y*cs}px`;
        el.style.width = `${w*cs}px`; el.style.height = `${h*cs}px`;
        el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
      }
      saveProject(state);
    });

    gridEl.appendChild(div);
  }
}
