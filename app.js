import { createGrid, canPlace, canPlaceCells, placeRoom, placeRoomCells, removeRoom, rebuildGrid } from './grid.js';
import { ROOM_TYPES, renderPalette, createRoomData, createIrregularRoomData, getTypeById, calcArea, calcAreaCells } from './rooms.js';
import { initDnd } from './dnd.js';
import { attachResizeHandles } from './resize.js';
import { saveProject, loadProject, exportJSON, importJSON, resetProject } from './storage.js';
import { initToolbar } from './toolbar.js';
import { initWallLayer, renderWallLayer, getEdgeAt, edgeKey, ELEMENT_TOOLS } from './walls.js';
import { renderZones, createZoneData, ZONE_PRESETS } from './zones.js';
import { startWalkthrough } from './walkthrough.js';

// ============================================================
// 状態
// ============================================================
let state = {
  gridCols: 20,
  gridRows: 15,
  cellSize: 44,
  currentFloor: 0,
  floors: [
    { rooms: [], elements: [], stairs: [] },
    { rooms: [], elements: [], stairs: [] },
  ],
  mode: 'room',
  elementTool: 'wall',
  compass: 0,
  sunHour: 12,
  stairConfig: { w: 2, h: 3, dir: 'n' },
};
Object.defineProperty(state, 'rooms',    { get() { return this.floors[this.currentFloor].rooms;    }, set(v) { this.floors[this.currentFloor].rooms    = v; }, enumerable: false });
Object.defineProperty(state, 'elements', { get() { return this.floors[this.currentFloor].elements; }, set(v) { this.floors[this.currentFloor].elements = v; }, enumerable: false });
Object.defineProperty(state, 'stairs',   { get() { return this.floors[this.currentFloor].stairs;   }, set(v) { this.floors[this.currentFloor].stairs   = v; }, enumerable: false });

let grid = null;
let undoStack = [];
let redoStack = [];
let toolbar = null;
let svgEl = null;
let hoveredEdge = null;
let selectedId = null;
let selectedZoneId = null;
let selectedStairId = null;

// 不定形描画
let paintTypeId = null;
let paintCells  = null;
let paintCanvas = null;

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const saved = loadProject();
  if (saved) {
    state.gridCols      = saved.gridCols      ?? 20;
    state.gridRows      = saved.gridRows      ?? 15;
    state.cellSize      = saved.cellSize      ?? 44;
    state.compass       = saved.compass       ?? 0;
    state.sunHour       = saved.sunHour       ?? 12;
    state.currentFloor  = saved.currentFloor  ?? 0;
    if (saved.stairConfig) state.stairConfig = saved.stairConfig;
    if (saved.floors) {
      state.floors = saved.floors.map(f => ({
        rooms:    f.rooms    ?? [],
        elements: f.elements ?? [],
        stairs:   f.stairs   ?? [],
      }));
      while (state.floors.length < 2) state.floors.push({ rooms: [], elements: [], stairs: [] });
    } else {
      state.floors[0].rooms    = saved.rooms    ?? [];
      state.floors[0].elements = saved.elements ?? [];
    }
    // 旧データ移行：片フロアにしかない階段を両フロアへ同期
    syncStairsBetweenFloors();
  }

  grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);

  renderPalette(document.getElementById('palette'));
  svgEl = initWallLayer(document.getElementById('grid'));

  paintCanvas = document.createElement('canvas');
  paintCanvas.id = 'paint-canvas';
  document.getElementById('grid').appendChild(paintCanvas);

  toolbar = initToolbar({
    container:           document.getElementById('toolbar'),
    state,
    onUndo:              undo,
    onRedo:              redo,
    onGridChange:        handleGridChange,
    onModeChange:        handleModeChange,
    onFloorChange:       handleFloorChange,
    onStairConfigChange: cfg => { state.stairConfig = cfg; },
    onSave:              () => { saveProject(state); showToast('保存しました'); },
    onExport:            () => exportJSON(state),
    onImport:            file => importJSON(file, data => {
      pushUndo();
      state.gridCols      = data.gridCols     ?? state.gridCols;
      state.gridRows      = data.gridRows     ?? state.gridRows;
      state.cellSize      = data.cellSize     ?? state.cellSize;
      state.compass       = data.compass      ?? 0;
      state.sunHour       = data.sunHour      ?? 12;
      state.currentFloor  = data.currentFloor ?? 0;
      if (data.stairConfig) state.stairConfig = data.stairConfig;
      if (data.floors) {
        state.floors = data.floors.map(f => ({
          rooms:    f.rooms    ?? [],
          elements: f.elements ?? [],
          stairs:   f.stairs   ?? [],
        }));
        while (state.floors.length < 2) state.floors.push({ rooms: [], elements: [], stairs: [] });
      } else {
        state.floors[0].rooms    = data.rooms    ?? [];
        state.floors[0].elements = data.elements ?? [];
      }
      grid = createGrid(state.gridCols, state.gridRows);
      rebuildGrid(grid, state.rooms);
      renderAll();
      toolbar.syncSliders(state);
      toolbar.syncFloor(state.currentFloor);
      toolbar.syncStairConfig(state.stairConfig);
      showToast('読み込みました');
    }, msg => alert(msg)),
    onWalkthrough:   () => startWalkthrough(state),
    onCompassChange: () => { renderCompassIndicator(); saveProject(state); },
    onReset: () => {
      pushUndo();
      state.floors = [
        { rooms: [], elements: [], stairs: [] },
        { rooms: [], elements: [], stairs: [] },
      ];
      state.currentFloor = 0;
      resetProject();
      rebuildGrid(grid, state.rooms);
      renderAll();
      toolbar.syncFloor(0);
    },
  });

  initDnd({
    gridEl:    document.getElementById('grid'),
    paletteEl: document.getElementById('palette'),
    cellSize:  () => state.cellSize,
    onDropNew: handleDropNew,
    onMove:    handleMove,
  });

  // パレットクリック（不定形モード用）
  document.getElementById('palette').addEventListener('click', e => {
    if (state.mode !== 'freeroom') return;
    const item = e.target.closest('.palette-item');
    if (!item) return;
    paintTypeId = item.dataset.typeId;
    document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('paint-active'));
    item.classList.add('paint-active');
    showToast(`${getTypeById(paintTypeId).label} を描画中 — ドラッグして形を描いてください`);
  });

  // グリッドクリック
  document.getElementById('grid').addEventListener('click', e => {
    if (state.mode === 'stair') {
      const sb = e.target.closest('.stair-block');
      if (sb) {
        // 既存の階段をクリック → 選択
        const id = sb.dataset.id;
        selectedStairId = (selectedStairId === id) ? null : id;
        updateInspector();
        renderStairs();
        return;
      }
      // 空きエリアをクリック → 配置
      const { col, row } = getGridCell(e);
      handleStairPlace(col, row);
      return;
    }
    if (state.mode === 'freeroom') return;
    if (state.mode !== 'room') return;
    if (!e.target.closest('.room-block') && !e.target.closest('.room-cell')) {
      selectRoom(null);
      selectedStairId = null;
    }
  });

  // 不定形描画イベント
  document.getElementById('grid').addEventListener('mousedown', e => {
    if (state.mode !== 'freeroom') return;
    if (!paintTypeId) { showToast('左のパレットで部屋タイプを選んでください'); return; }
    e.preventDefault();
    paintCells = new Set();
    const { col, row } = getGridCell(e);
    tryPaintCell(col, row);
    renderPaintPreview();
  });
  document.getElementById('grid').addEventListener('mousemove', e => {
    if (state.mode !== 'freeroom' || !paintCells) return;
    const { col, row } = getGridCell(e);
    tryPaintCell(col, row);
    renderPaintPreview();
  });
  document.addEventListener('mouseup', () => {
    if (state.mode !== 'freeroom' || !paintCells) return;
    if (paintCells.size > 0) confirmPaint();
    paintCells = null;
    renderPaintPreview();
  });

  // 壁・建具モード
  svgEl.addEventListener('mousemove', e => {
    if (state.mode === 'room' || state.mode === 'stair' || state.mode === 'freeroom') return;
    hoveredEdge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  });
  svgEl.addEventListener('mouseleave', () => {
    hoveredEdge = null;
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
  });
  svgEl.addEventListener('click', e => {
    if (state.mode === 'room' || state.mode === 'stair' || state.mode === 'freeroom') return;
    const edge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    if (!edge) return;
    handleElementClick(edge);
  });
  svgEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.mode !== 'door') return;
    const edge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    if (!edge) return;
    const key = edgeKey(edge.col, edge.row, edge.dir);
    const el = state.elements.find(el => edgeKey(el.col, el.row, el.dir) === key && el.type === 'door');
    if (el) {
      pushUndo();
      el.flip = !el.flip;
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
      saveProject(state);
    }
  });

  renderAll();
  renderCompassIndicator();
  toolbar.syncSliders(state);
  toolbar.updateUndoRedo(false, false);
  toolbar.syncFloor(state.currentFloor);
  toolbar.syncStairConfig(state.stairConfig);

  setInterval(() => saveProject(state), 5000);
});

// ============================================================
// ユーティリティ
// ============================================================
function getGridCell(e) {
  const gridEl   = document.getElementById('grid');
  const rect     = gridEl.getBoundingClientRect();
  const scrollEl = gridEl.parentElement;
  return {
    col: Math.floor((e.clientX - rect.left  + scrollEl.scrollLeft) / state.cellSize),
    row: Math.floor((e.clientY - rect.top   + scrollEl.scrollTop)  / state.cellSize),
  };
}

// ============================================================
// 不定形描画
// ============================================================
function tryPaintCell(col, row) {
  if (col < 0 || row < 0 || col >= state.gridCols || row >= state.gridRows) return;
  if (grid.cells[row][col] !== null) return;
  paintCells.add(`${col},${row}`);
}

function confirmPaint() {
  const cells = [...paintCells];
  if (!cells.length) return;
  pushUndo();
  const room = createIrregularRoomData(paintTypeId, cells);
  state.rooms.push(room);
  placeRoomCells(grid, room.id, cells);
  selectRoom(room.id);
  renderAll();
  saveProject(state);
}

function renderPaintPreview() {
  if (!paintCanvas) return;
  const cs = state.cellSize;
  paintCanvas.width  = state.gridCols * cs;
  paintCanvas.height = state.gridRows * cs;
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  if (!paintCells || !paintCells.size) return;
  const type = getTypeById(paintTypeId);
  ctx.fillStyle   = type.color + 'cc';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth   = 2;
  for (const key of paintCells) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillRect(c*cs, r*cs, cs, cs);
    ctx.strokeRect(c*cs+1, r*cs+1, cs-2, cs-2);
  }
}

// ============================================================
// 階段フロア間同期（旧データ移行・共通ユーティリティ）
// ============================================================
function syncStairsBetweenFloors() {
  const f0 = state.floors[0], f1 = state.floors[1];
  if (!f0 || !f1) return;
  // f0 にあって f1 にない階段を f1 へ mirror コピー
  for (const s of f0.stairs) {
    if (!f1.stairs.some(t => t.x === s.x && t.y === s.y)) {
      f1.stairs.push({ ...s, id: s.id + '_pair', mirror: true });
    }
  }
  // f1 にあって f0 にない階段を f0 へコピー（mirror なし）
  for (const s of f1.stairs) {
    if (!f0.stairs.some(t => t.x === s.x && t.y === s.y)) {
      f0.stairs.push({ ...s, id: s.id + '_pair', mirror: false });
    }
  }
  // 既存の f1 階段のうち f0 と対応するものを mirror に更新
  for (const s of f1.stairs) {
    if (f0.stairs.some(t => t.x === s.x && t.y === s.y)) {
      s.mirror = true;
    }
  }
  // f0 の階段は mirror でない
  for (const s of f0.stairs) {
    s.mirror = false;
  }
}

// ============================================================
// フロア切替
// ============================================================
function handleFloorChange(floorIdx) {
  pushUndo();
  state.currentFloor = floorIdx;
  selectedStairId    = null;
  grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);
  selectRoom(null);
  renderAll();
  toolbar.syncFloor(floorIdx);
  showToast(`${floorIdx + 1}F を編集中`);
}

// ============================================================
// モード切替
// ============================================================
function handleModeChange(mode) {
  state.mode = mode;
  if (mode !== 'room' && mode !== 'stair' && mode !== 'freeroom') state.elementTool = mode;
  if (mode !== 'freeroom') {
    paintCells = null;
    renderPaintPreview();
    document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('paint-active'));
  }
  if (mode !== 'stair') selectedStairId = null;
  const gridEl = document.getElementById('grid');
  gridEl.dataset.mode = mode;
  document.getElementById('palette').style.pointerEvents = (mode === 'room' || mode === 'freeroom') ? '' : 'none';
  document.querySelectorAll('.palette-item').forEach(el => el.draggable = (mode === 'room'));
  if (mode !== 'stair' && mode !== 'freeroom') {
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
  }
  updateInspector();
}

// ============================================================
// レンダリング
// ============================================================
function renderAll() {
  applyGridCss();
  renderRooms();
  renderStairs();
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  updateInspector();
  toolbar?.updateUndoRedo(undoStack.length > 0, redoStack.length > 0);
}

function applyGridCss() {
  const gridEl = document.getElementById('grid');
  const cs = state.cellSize;
  gridEl.style.width  = state.gridCols * cs + 'px';
  gridEl.style.height = state.gridRows * cs + 'px';
  gridEl.style.backgroundSize = `${cs}px ${cs}px`;
  document.documentElement.style.setProperty('--cell-size', cs + 'px');
  if (svgEl) {
    svgEl.setAttribute('width',  state.gridCols * cs);
    svgEl.setAttribute('height', state.gridRows * cs);
  }
  if (paintCanvas) {
    paintCanvas.width  = state.gridCols * cs;
    paintCanvas.height = state.gridRows * cs;
  }
}

function renderRooms() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.room-block, .room-cell, .room-label-block').forEach(el => el.remove());
  for (const room of state.rooms) {
    if (room.cells) appendIrregularRoom(gridEl, room);
    else            gridEl.appendChild(createRoomElement(room));
  }
}

function appendIrregularRoom(gridEl, room) {
  const cs = state.cellSize;
  const isSelected = room.id === selectedId;
  const type = getTypeById(room.typeId);
  for (const key of room.cells) {
    const [col, row] = key.split(',').map(Number);
    const cell = document.createElement('div');
    cell.className = 'room-cell' + (isSelected ? ' room-cell-selected' : '') + (type.isVoid ? ' room-cell-void' : '');
    cell.dataset.roomId = room.id;
    cell.style.cssText = `left:${col*cs}px;top:${row*cs}px;width:${cs}px;height:${cs}px;background:${room.color};`;
    cell.addEventListener('click', e => { e.stopPropagation(); selectRoom(room.id); selectZone(null); });
    gridEl.appendChild(cell);
  }
  const { tatami, sqm } = calcAreaCells(room.cells);
  const label = document.createElement('div');
  label.className = 'room-label-block';
  label.dataset.id = room.id;
  label.style.cssText = `left:${room.x*cs}px;top:${room.y*cs}px;width:${room.w*cs}px;height:${room.h*cs}px;`;
  label.innerHTML = `
    <div class="room-inner">
      <div class="room-icon">${type.icon}</div>
      <div class="room-label" title="${room.label}">${room.label}</div>
      <div class="room-area">${tatami}畳 <span class="room-sqm">(${sqm}㎡)</span></div>
    </div>`;
  label.querySelector('.room-label').addEventListener('dblclick', e => {
    e.stopPropagation(); startLabelEditIrregular(label, room);
  });
  gridEl.appendChild(label);
}

function renderStairs() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.stair-block').forEach(el => el.remove());
  const cs = state.cellSize;
  const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
  const ARROWS = { n: '↑', s: '↓', e: '→', w: '←' };
  for (const s of state.stairs) {
    const div = document.createElement('div');
    const isSelected = s.id === selectedStairId;
    div.className = 'stair-block' + (isSelected ? ' stair-selected' : '');
    div.dataset.id = s.id;
    div.style.cssText = `left:${s.x*cs}px;top:${s.y*cs}px;width:${s.w*cs}px;height:${s.h*cs}px;`;
    const paired = state.floors[otherFloorIdx].stairs.some(os => os.x === s.x && os.y === s.y);
    const arrow  = ARROWS[s.dir || 'n'];
    const fn = state.currentFloor + 1, on = otherFloorIdx + 1;
    div.innerHTML = `<span class="stair-icon">🪜</span><span class="stair-dir">${arrow}</span><span class="stair-label">${fn}F↔${on}F${paired ? '' : ' ⚠'}</span>`;
    div.title = `階段 ${fn}F↔${on}F / ${s.w}×${s.h}マス / 向き:${arrow}${paired ? '' : '\n⚠ 対応する階段がありません'}`;

    // ドラッグで移動
    div.addEventListener('mousedown', e => {
      if (state.mode !== 'stair') return;
      e.stopPropagation();
      e.preventDefault();
      const rect   = gridEl.getBoundingClientRect();
      const origX  = s.x, origY = s.y;
      const startMX = e.clientX, startMY = e.clientY;
      let moved = false;

      const onMove = mv => {
        const dx = Math.round((mv.clientX - startMX) / cs);
        const dy = Math.round((mv.clientY - startMY) / cs);
        if (dx === 0 && dy === 0) return;
        moved = true;
        const nx = Math.max(0, Math.min(state.gridCols - s.w, origX + dx));
        const ny = Math.max(0, Math.min(state.gridRows - s.h, origY + dy));
        div.style.left = `${nx * cs}px`;
        div.style.top  = `${ny * cs}px`;
      };
      const onUp = mv => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!moved) {
          // クリックとして扱う（選択）
          selectedStairId = (selectedStairId === s.id) ? null : s.id;
          updateInspector();
          renderStairs();
          return;
        }
        const dx = Math.round((mv.clientX - startMX) / cs);
        const dy = Math.round((mv.clientY - startMY) / cs);
        const nx = Math.max(0, Math.min(state.gridCols - s.w, origX + dx));
        const ny = Math.max(0, Math.min(state.gridRows - s.h, origY + dy));
        if (nx !== origX || ny !== origY) {
          pushUndo();
          const otherFl = state.floors[state.currentFloor === 0 ? 1 : 0];
          const paired  = otherFl.stairs.find(os => os.x === s.x && os.y === s.y);
          s.x = nx; s.y = ny;
          if (paired) { paired.x = nx; paired.y = ny; }
          selectedStairId = s.id;
          renderAll();
          saveProject(state);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    div.addEventListener('click', e => e.stopPropagation());
    gridEl.appendChild(div);
  }
}

function createRoomElement(room) {
  const cs = state.cellSize;
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcArea(room.w, room.h);
  const el = document.createElement('div');
  el.className = 'room-block' + (room.id === selectedId ? ' selected' : '') + (type.isVoid ? ' room-void' : '');
  el.dataset.id     = room.id;
  el.dataset.typeId = room.typeId;
  el.dataset.x = room.x; el.dataset.y = room.y;
  el.dataset.w = room.w; el.dataset.h = room.h;
  el.draggable = (state.mode === 'room');
  el.style.cssText = `left:${room.x*cs}px;top:${room.y*cs}px;width:${room.w*cs}px;height:${room.h*cs}px;background-color:${room.color};`;
  el.innerHTML = `
    <div class="room-inner">
      <div class="room-icon">${type.icon}</div>
      <div class="room-label" title="${room.label}">${room.label}</div>
      <div class="room-area">${tatami}畳 <span class="room-sqm">(${sqm}㎡)</span></div>
    </div>`;
  if (room.zones && room.zones.length > 0) {
    renderZones(el, room, cs, {
      onSelectZone: (zoneId) => { selectRoom(room.id); selectZone(zoneId); },
      onZoneUpdate: () => { saveProject(state); renderAll(); },
    });
  }
  el.addEventListener('click', e => {
    if (e.target.closest('.resize-handle') || e.target.closest('.zone-block')) return;
    e.stopPropagation();
    selectRoom(room.id); selectZone(null);
  });
  el.querySelector('.room-label').addEventListener('dblclick', e => { e.stopPropagation(); startLabelEdit(el, room); });
  attachResizeHandles(el, () => state.cellSize, (id, g) => handleResize(id, g));
  return el;
}

function startLabelEdit(el, room) {
  const labelEl = el.querySelector('.room-label');
  const input = document.createElement('input');
  input.type = 'text'; input.value = room.label; input.className = 'label-edit-input';
  labelEl.replaceWith(input); input.focus(); input.select();
  const commit = () => { pushUndo(); room.label = input.value.trim() || room.label; renderAll(); saveProject(state); };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') renderAll(); });
}

function startLabelEditIrregular(labelDiv, room) {
  const labelEl = labelDiv.querySelector('.room-label');
  if (!labelEl) return;
  const input = document.createElement('input');
  input.type = 'text'; input.value = room.label; input.className = 'label-edit-input';
  labelEl.replaceWith(input); input.focus(); input.select();
  const commit = () => { pushUndo(); room.label = input.value.trim() || room.label; renderAll(); saveProject(state); };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') renderAll(); });
}

// ============================================================
// 部屋操作
// ============================================================
function handleDropNew(typeId, col, row) {
  const room = createRoomData(typeId, col, row);
  if (!canPlace(grid, col, row, room.w, room.h)) {
    const pos = findFreePosition(grid, room.w, room.h);
    if (!pos) { showToast('空きスペースがありません', 'error'); return; }
    room.x = pos.x; room.y = pos.y;
  }
  pushUndo();
  state.rooms.push(room);
  placeRoom(grid, room.id, room.x, room.y, room.w, room.h);
  selectRoom(room.id);
  renderAll();
  saveProject(state);
}

function handleMove(roomId, newX, newY) {
  const room = state.rooms.find(r => r.id === roomId);
  if (!room || room.cells) return;
  newX = Math.max(0, Math.min(newX, state.gridCols - room.w));
  newY = Math.max(0, Math.min(newY, state.gridRows - room.h));
  if (!canPlace(grid, newX, newY, room.w, room.h, roomId)) return;
  pushUndo();
  removeRoom(grid, roomId);
  room.x = newX; room.y = newY;
  placeRoom(grid, roomId, newX, newY, room.w, room.h);
  renderAll();
  saveProject(state);
}

function handleResize(roomId, newGeom) {
  const room = state.rooms.find(r => r.id === roomId);
  if (!room || room.cells) return;
  const x = Math.max(0, newGeom.x);
  const y = Math.max(0, newGeom.y);
  const w = Math.max(1, Math.min(newGeom.w, state.gridCols - x));
  const h = Math.max(1, Math.min(newGeom.h, state.gridRows - y));
  if (!canPlace(grid, x, y, w, h, roomId)) return;
  removeRoom(grid, roomId);
  room.x = x; room.y = y; room.w = w; room.h = h;
  if (room.zones) {
    for (const z of room.zones) {
      z.x = Math.min(z.x, room.w-z.w); z.y = Math.min(z.y, room.h-z.h);
      z.w = Math.min(z.w, room.w-z.x); z.h = Math.min(z.h, room.h-z.y);
    }
  }
  placeRoom(grid, roomId, room.x, room.y, room.w, room.h);
  renderAll();
  saveProject(state);
}

function handleGridChange({ gridCols, gridRows, cellSize }) {
  state.gridCols = gridCols;
  state.gridRows = gridRows;
  state.cellSize = cellSize;
  for (const fl of state.floors) {
    fl.rooms = fl.rooms.filter(r => {
      if (r.cells) {
        r.cells = r.cells.filter(k => { const [c, ro] = k.split(',').map(Number); return c < gridCols && ro < gridRows; });
        if (!r.cells.length) return false;
        const cs2 = r.cells.map(k => +k.split(',')[0]);
        const rs2 = r.cells.map(k => +k.split(',')[1]);
        r.x = Math.min(...cs2); r.y = Math.min(...rs2);
        r.w = Math.max(...cs2)-r.x+1; r.h = Math.max(...rs2)-r.y+1;
        return true;
      }
      return r.x+r.w <= gridCols && r.y+r.h <= gridRows;
    });
    fl.elements = fl.elements.filter(e => e.col >= 0 && e.col < gridCols && e.row >= 0 && e.row < gridRows);
    fl.stairs   = fl.stairs.filter(s => s.x+s.w <= gridCols && s.y+s.h <= gridRows);
  }
  grid = createGrid(gridCols, gridRows);
  rebuildGrid(grid, state.rooms);
  renderAll();
}

function handleStairPlace(col, row) {
  const { w, h, dir } = state.stairConfig;
  const x = Math.min(Math.max(0, col), state.gridCols - w);
  const y = Math.min(Math.max(0, row), state.gridRows - h);
  const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
  const otherFloor    = state.floors[otherFloorIdx];
  const existIdx      = state.stairs.findIndex(s => s.x === x && s.y === y);
  pushUndo();
  if (existIdx !== -1) {
    // 削除：対応フロアも同期削除
    state.stairs.splice(existIdx, 1);
    const oi = otherFloor.stairs.findIndex(s => s.x === x && s.y === y);
    if (oi !== -1) otherFloor.stairs.splice(oi, 1);
  } else {
    // 配置：対応フロアにも同期配置
    const newStair = { id: `stair-${Date.now()}`, x, y, w, h, dir };
    state.stairs.push(newStair);
    selectedStairId = newStair.id;
    const oi = otherFloor.stairs.findIndex(s => s.x === x && s.y === y);
    if (oi !== -1) {
      Object.assign(otherFloor.stairs[oi], { x, y, w, h, dir });
    } else {
      otherFloor.stairs.push({ id: `stair-${Date.now() + 1}`, x, y, w, h, dir, mirror: otherFloorIdx === 1 });
    }
  }
  renderAll();
  saveProject(state);
}

function findFreePosition(grid, w, h) {
  for (let r = 0; r <= grid.rows - h; r++)
    for (let c = 0; c <= grid.cols - w; c++)
      if (canPlace(grid, c, r, w, h)) return { x: c, y: r };
  return null;
}

// ============================================================
// 壁・建具
// ============================================================
function handleElementClick(edge) {
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const existIdx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  pushUndo();
  if (existIdx !== -1) {
    const exist = state.elements[existIdx];
    if (exist.type === state.mode) state.elements.splice(existIdx, 1);
    else state.elements[existIdx] = { id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir };
  } else {
    state.elements.push({ id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir });
  }
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  saveProject(state);
}

// ============================================================
// 選択管理
// ============================================================
function selectRoom(id) {
  if (selectedId !== id) selectedZoneId = null;
  selectedId = id;
  if (id) selectedStairId = null;
  updateInspector();
  document.querySelectorAll('.room-block').forEach(el => el.classList.toggle('selected', el.dataset.id === selectedId));
  document.querySelectorAll('.room-cell').forEach(el => el.classList.toggle('room-cell-selected', el.dataset.roomId === selectedId));
}

function selectZone(zoneId) {
  selectedZoneId = zoneId;
  updateInspector();
}

// ============================================================
// インスペクター
// ============================================================
function updateInspector() {
  const panel = document.getElementById('inspector');

  // 階段選択中
  if (selectedStairId && state.mode === 'stair') {
    const stair = state.stairs.find(s => s.id === selectedStairId);
    if (stair) { renderStairInspector(panel, stair); return; }
  }

  const room = state.rooms.find(r => r.id === selectedId);
  if (!room) {
    renderAreaSummary(panel);
    return;
  }
  if (selectedZoneId) {
    const zone = (room.zones || []).find(z => z.id === selectedZoneId);
    if (zone) { renderZoneInspector(panel, room, zone); return; }
  }
  if (room.cells) renderIrregularRoomInspector(panel, room);
  else            renderRoomInspector(panel, room);
}

// ── 間取り概要（選択なし時）────────────────────────────────
function renderAreaSummary(panel) {
  const rows = state.floors.map((fl, fi) => {
    const rooms = (fl.rooms || []).filter(r => !getTypeById(r.typeId).isVoid);
    const cells = rooms.reduce((s, r) => s + (r.cells ? r.cells.length : r.w * r.h), 0);
    const tsubo = (cells / 4).toFixed(2);
    const sqm   = (cells * 0.91 * 0.91).toFixed(1);
    return { fi, count: rooms.length, tsubo, sqm };
  });
  const totalTsubo = rows.reduce((s, r) => s + parseFloat(r.tsubo), 0).toFixed(2);
  const totalSqm   = rows.reduce((s, r) => s + parseFloat(r.sqm),   0).toFixed(1);

  panel.innerHTML = `
    <div class="inspector-empty">
      <p>部屋をクリックして選択</p>
      <p class="hint">パレットから部屋をドラッグ、<br>または「不定形」モードで自由描画</p>
    </div>
    <div class="area-summary">
      <div class="area-summary-title">間取り面積</div>
      ${rows.map(r => r.count > 0 ? `
        <div class="area-row">
          <span class="area-floor">${r.fi+1}F</span>
          <span>${r.count}部屋</span>
          <span class="area-val"><b>${r.tsubo}</b>坪</span>
          <span class="area-sqm">${r.sqm}㎡</span>
        </div>` : '').join('')}
      ${rows.some(r => r.count > 0) ? `
        <div class="area-row area-total">
          <span class="area-floor">計</span>
          <span>${rows.reduce((s,r)=>s+r.count,0)}部屋</span>
          <span class="area-val"><b>${totalTsubo}</b>坪</span>
          <span class="area-sqm">${totalSqm}㎡</span>
        </div>` : '<p class="hint">まだ部屋がありません</p>'}
    </div>`;
}

// ── 階段インスペクター ────────────────────────────────────
function renderStairInspector(panel, stair) {
  const ARROWS = { n: '↑北', s: '↓南', e: '→東', w: '←西' };
  const fn = state.currentFloor + 1;
  const on = (state.currentFloor === 0 ? 1 : 0) + 1;
  const otherHas = state.floors[state.currentFloor === 0 ? 1 : 0].stairs.some(s => s.x === stair.x && s.y === stair.y);
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">🪜</span>
      <span class="inspector-title">階段</span>
    </div>
    <div class="inspector-field"><label>幅（マス）</label><input type="number" id="si-w" value="${stair.w}" min="1" max="6"></div>
    <div class="inspector-field"><label>奥行（マス）</label><input type="number" id="si-h" value="${stair.h}" min="1" max="8"></div>
    <div class="inspector-field">
      <label>向き（2F側）</label>
      <div class="dir-row">
        ${['n','s','e','w'].map(d => `<button class="dir-btn${stair.dir===d?' active':''}" data-dir="${d}">${ARROWS[d]}</button>`).join('')}
      </div>
    </div>
    <div class="inspector-info">
      ${fn}F ↔ ${on}F &nbsp;
      <span style="color:${otherHas?'#16a34a':'#dc2626'}">${otherHas ? '✓ 対応済み' : '⚠ 対応なし'}</span>
    </div>
    <button id="si-delete" class="btn-danger btn-full" style="margin-top:8px">階段を削除</button>
  `;

  const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
  const otherFloor    = state.floors[otherFloorIdx];
  const getPaired = () => otherFloor.stairs.find(s => s.x === stair.x && s.y === stair.y);

  document.getElementById('si-w').addEventListener('change', e => {
    pushUndo();
    stair.w = Math.max(1, Math.min(6, +e.target.value));
    const p = getPaired(); if (p) p.w = stair.w;
    state.stairConfig.w = stair.w;
    toolbar.syncStairConfig(state.stairConfig);
    renderAll(); saveProject(state);
  });
  document.getElementById('si-h').addEventListener('change', e => {
    pushUndo();
    stair.h = Math.max(1, Math.min(8, +e.target.value));
    const p = getPaired(); if (p) p.h = stair.h;
    state.stairConfig.h = stair.h;
    toolbar.syncStairConfig(state.stairConfig);
    renderAll(); saveProject(state);
  });
  panel.querySelectorAll('.dir-btn[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo();
      stair.dir = btn.dataset.dir;
      const p = getPaired(); if (p) p.dir = stair.dir;
      state.stairConfig.dir = stair.dir;
      toolbar.syncStairConfig(state.stairConfig);
      renderAll(); saveProject(state);
    });
  });
  document.getElementById('si-delete').addEventListener('click', () => {
    pushUndo();
    const p = getPaired();
    state.stairs = state.stairs.filter(s => s.id !== stair.id);
    if (p) otherFloor.stairs = otherFloor.stairs.filter(s => s.id !== p.id);
    selectedStairId = null;
    renderAll(); saveProject(state);
  });
}

// ── 矩形部屋インスペクター ────────────────────────────────
function renderRoomInspector(panel, room) {
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcArea(room.w, room.h);
  const zones = room.zones || [];
  const isVoid = type.isVoid;

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${type.icon}</span>
      <span class="inspector-title">${room.label}${isVoid ? ' <span class="badge-void">吹き抜け</span>' : ''}</span>
    </div>
    <div class="inspector-field"><label>部屋名</label><input type="text" id="inp-label" value="${escHtml(room.label)}"></div>
    <div class="inspector-field"><label>色</label><input type="color" id="inp-color" value="${rgbToHex(room.color)}"></div>
    ${!isVoid ? `
    <div class="inspector-field"><label>幅（マス）</label><input type="number" id="inp-w" value="${room.w}" min="1" max="${state.gridCols}"></div>
    <div class="inspector-field"><label>高さ（マス）</label><input type="number" id="inp-h" value="${room.h}" min="1" max="${state.gridRows}"></div>
    <div class="inspector-info"><strong>${tatami}畳</strong>（${sqm}㎡）<br><span style="font-size:11px;color:#888">${room.w}×${room.h}マス</span></div>
    <div class="inspector-section-title">ゾーン（サブスペース）</div>
    <div id="zone-list">${zones.map(z=>`
      <div class="zone-list-item" data-zone-id="${z.id}">
        <span class="zone-list-color" style="background:${z.color}"></span>
        <span class="zone-list-label">${escHtml(z.label)}</span>
        <button class="zone-del-btn" data-zone-id="${z.id}">×</button>
      </div>`).join('')}</div>
    <div class="inspector-field" style="margin-top:6px">
      <label>追加するゾーン</label>
      <select id="zone-preset">${ZONE_PRESETS.map(p=>`<option value="${p.label}" data-color="${p.color}">${p.label}</option>`).join('')}</select>
    </div>
    <button id="btn-add-zone" class="btn-secondary btn-full">＋ ゾーンを追加</button>` : `
    <div class="inspector-info"><strong>${tatami}畳</strong>（${sqm}㎡）<br><span style="font-size:11px;color:#888">吹き抜け（面積に含まず）</span></div>
    `}
    <button id="btn-delete-room" class="btn-danger btn-full" style="margin-top:8px">この部屋を削除</button>
  `;

  document.getElementById('inp-label').addEventListener('change', e => { pushUndo(); room.label = e.target.value; renderAll(); saveProject(state); });
  document.getElementById('inp-color').addEventListener('input', e => {
    room.color = e.target.value;
    const el = document.querySelector(`.room-block[data-id="${room.id}"]`);
    if (el) el.style.backgroundColor = room.color;
  });
  document.getElementById('inp-color').addEventListener('change', () => { pushUndo(); saveProject(state); });

  if (!isVoid) {
    document.getElementById('inp-w').addEventListener('change', e => { handleResize(room.id, { x:room.x, y:room.y, w:Math.max(1,+e.target.value), h:room.h }); });
    document.getElementById('inp-h').addEventListener('change', e => { handleResize(room.id, { x:room.x, y:room.y, w:room.w, h:Math.max(1,+e.target.value) }); });
    panel.querySelectorAll('.zone-list-item').forEach(item => {
      item.addEventListener('click', e => { if (e.target.closest('.zone-del-btn')) return; selectZone(item.dataset.zoneId); });
    });
    panel.querySelectorAll('.zone-del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); pushUndo();
        room.zones = (room.zones||[]).filter(z => z.id !== btn.dataset.zoneId);
        if (selectedZoneId === btn.dataset.zoneId) selectedZoneId = null;
        renderAll(); saveProject(state);
      });
    });
    document.getElementById('btn-add-zone').addEventListener('click', () => {
      const sel = document.getElementById('zone-preset');
      pushUndo();
      if (!room.zones) room.zones = [];
      const zone = createZoneData(sel.value, sel.selectedOptions[0].dataset.color||'#E0E0E0');
      zone.w = Math.min(2, room.w); zone.h = Math.min(2, room.h);
      room.zones.push(zone);
      selectZone(zone.id); renderAll(); saveProject(state);
    });
  }

  document.getElementById('btn-delete-room').addEventListener('click', () => {
    pushUndo(); removeRoom(grid, room.id);
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    selectedId = null; selectedZoneId = null;
    renderAll(); saveProject(state);
  });
}

// ── 不定形部屋インスペクター ──────────────────────────────
function renderIrregularRoomInspector(panel, room) {
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcAreaCells(room.cells);
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${type.icon}</span>
      <span class="inspector-title">${room.label} <span style="font-size:10px;background:#e0f2fe;color:#0369a1;padding:1px 5px;border-radius:4px">不定形</span></span>
    </div>
    <div class="inspector-field"><label>部屋名</label><input type="text" id="inp-label" value="${escHtml(room.label)}"></div>
    <div class="inspector-field"><label>色</label><input type="color" id="inp-color" value="${rgbToHex(room.color)}"></div>
    <div class="inspector-info"><strong>${tatami}畳</strong>（${sqm}㎡）<br><span style="font-size:11px;color:#888">${room.cells.length}マス（不定形）</span></div>
    <button id="btn-delete-room" class="btn-danger btn-full" style="margin-top:8px">この部屋を削除</button>
  `;
  document.getElementById('inp-label').addEventListener('change', e => { pushUndo(); room.label = e.target.value; renderAll(); saveProject(state); });
  document.getElementById('inp-color').addEventListener('input', e => {
    room.color = e.target.value;
    document.querySelectorAll(`.room-cell[data-room-id="${room.id}"]`).forEach(el => el.style.backgroundColor = room.color);
  });
  document.getElementById('inp-color').addEventListener('change', () => { pushUndo(); renderAll(); saveProject(state); });
  document.getElementById('btn-delete-room').addEventListener('click', () => {
    pushUndo(); removeRoom(grid, room.id);
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    selectedId = null; renderAll(); saveProject(state);
  });
}

// ── ゾーンインスペクター ──────────────────────────────────
function renderZoneInspector(panel, room, zone) {
  panel.innerHTML = `
    <div class="inspector-header">
      <button id="btn-zone-back" style="font-size:18px;background:none;border:none;cursor:pointer">←</button>
      <span class="inspector-title">ゾーン編集</span>
    </div>
    <div class="inspector-field"><label>ゾーン名</label><input type="text" id="zone-inp-label" value="${escHtml(zone.label)}"></div>
    <div class="inspector-field"><label>色</label><input type="color" id="zone-inp-color" value="${rgbToHex(zone.color)}"></div>
    <div class="inspector-field"><label>X位置</label><input type="number" id="zone-inp-x" value="${zone.x}" min="0" max="${room.w-zone.w}"></div>
    <div class="inspector-field"><label>Y位置</label><input type="number" id="zone-inp-y" value="${zone.y}" min="0" max="${room.h-zone.h}"></div>
    <div class="inspector-field"><label>幅</label><input type="number" id="zone-inp-w" value="${zone.w}" min="1" max="${room.w}"></div>
    <div class="inspector-field"><label>高さ</label><input type="number" id="zone-inp-h" value="${zone.h}" min="1" max="${room.h}"></div>
    <div class="inspector-info"><strong>${(zone.w*zone.h/2).toFixed(1)}畳</strong></div>
    <button id="btn-delete-zone" class="btn-danger btn-full" style="margin-top:8px">ゾーンを削除</button>
  `;
  document.getElementById('btn-zone-back').addEventListener('click', () => selectZone(null));
  const fields = [
    ['zone-inp-label','label',String],
    ['zone-inp-x','x',v=>Math.max(0,Math.min(+v,room.w-zone.w))],
    ['zone-inp-y','y',v=>Math.max(0,Math.min(+v,room.h-zone.h))],
    ['zone-inp-w','w',v=>Math.max(1,Math.min(+v,room.w-zone.x))],
    ['zone-inp-h','h',v=>Math.max(1,Math.min(+v,room.h-zone.y))],
  ];
  for (const [id,prop,conv] of fields) {
    document.getElementById(id)?.addEventListener('change', e => { pushUndo(); zone[prop]=conv(e.target.value); renderAll(); saveProject(state); });
  }
  document.getElementById('zone-inp-color').addEventListener('input', e => {
    zone.color = e.target.value;
    const el = document.querySelector(`.zone-block[data-id="${zone.id}"]`);
    if (el) el.style.backgroundColor = zone.color;
  });
  document.getElementById('zone-inp-color').addEventListener('change', () => { pushUndo(); saveProject(state); });
  document.getElementById('btn-delete-zone').addEventListener('click', () => {
    pushUndo(); room.zones = (room.zones||[]).filter(z=>z.id!==zone.id); selectedZoneId=null; renderAll(); saveProject(state);
  });
}

// ============================================================
// コンパスインジケーター
// ============================================================
function renderCompassIndicator() {
  const wrapper = document.getElementById('canvas-wrapper');
  let ind = document.getElementById('compass-indicator');
  if (!ind) { ind = document.createElement('div'); ind.id = 'compass-indicator'; wrapper.appendChild(ind); }
  const deg = state.compass ?? 0;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const label = dirs[Math.round(deg/45)%8];
  const hour = state.sunHour ?? 12;
  const hh = Math.floor(hour), mm = hour%1===0.5?'30':'00';
  ind.innerHTML = `
    <div class="ci-rose" style="transform:rotate(${deg}deg)"><div class="ci-n">N</div><div class="ci-arrow"></div></div>
    <div class="ci-label">${label} / ${hh}:${mm}</div>`;
}

// ============================================================
// Undo / Redo
// ============================================================
function snapshotState() {
  return JSON.stringify({ floors: state.floors, currentFloor: state.currentFloor, gridCols: state.gridCols, gridRows: state.gridRows, cellSize: state.cellSize, stairConfig: state.stairConfig });
}
function restoreSnapshot(snap) {
  const d = JSON.parse(snap);
  state.floors = d.floors; state.currentFloor = d.currentFloor;
  state.gridCols = d.gridCols; state.gridRows = d.gridRows; state.cellSize = d.cellSize;
  if (d.stairConfig) state.stairConfig = d.stairConfig;
}
function pushUndo() { undoStack.push(snapshotState()); redoStack = []; }
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotState()); restoreSnapshot(undoStack.pop());
  grid = createGrid(state.gridCols, state.gridRows); rebuildGrid(grid, state.rooms);
  renderAll(); toolbar.syncSliders(state); toolbar.syncFloor(state.currentFloor); toolbar.syncStairConfig(state.stairConfig);
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotState()); restoreSnapshot(redoStack.pop());
  grid = createGrid(state.gridCols, state.gridRows); rebuildGrid(grid, state.rooms);
  renderAll(); toolbar.syncSliders(state); toolbar.syncFloor(state.currentFloor); toolbar.syncStairConfig(state.stairConfig);
}

// ============================================================
// ユーティリティ
// ============================================================
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}
function rgbToHex(color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#')) return color;
  const d = document.createElement('div'); d.style.color = color; document.body.appendChild(d);
  const comp = getComputedStyle(d).color; document.body.removeChild(d);
  const m = comp.match(/\d+/g);
  if (!m) return '#ffffff';
  return '#' + m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join('');
}
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
