import { createGrid, canPlace, canPlaceCells, placeRoom, placeRoomCells, removeRoom, rebuildGrid } from './grid.js';
import { ROOM_TYPES, renderPalette, createRoomData, getTypeById, calcArea, calcAreaCells } from './rooms.js';
import { initDnd } from './dnd.js';
import { attachResizeHandles } from './resize.js';
import { saveProject, loadProject, exportJSON, importJSON, resetProject } from './storage.js';
import { initToolbar } from './toolbar.js';
import { initWallLayer, renderWallLayer, getEdgeAt, edgeKey, ELEMENT_TOOLS } from './walls.js';
import { startWalkthrough } from './walkthrough.js';
import { getFurnitureTypeById } from './furniture.js';

// ============================================================
// 状態
// ============================================================
let state = {
  gridCols: 20,
  gridRows: 15,
  cellSize: 44,
  currentFloor: 0,
  floors: [
    { rooms: [], elements: [], stairs: [], furniture: [] },
    { rooms: [], elements: [], stairs: [], furniture: [] },
  ],
  mode: 'room',
  elementTool: 'wall',
  furnitureType: 'kitchen',
  compass: 0,
  sunHour: 12,
  stairConfig: { w: 2, h: 3, dir: 'n' },
};
Object.defineProperty(state, 'rooms',     { get() { return this.floors[this.currentFloor].rooms;     }, set(v) { this.floors[this.currentFloor].rooms     = v; }, enumerable: false });
Object.defineProperty(state, 'elements',  { get() { return this.floors[this.currentFloor].elements;  }, set(v) { this.floors[this.currentFloor].elements  = v; }, enumerable: false });
Object.defineProperty(state, 'stairs',    { get() { return this.floors[this.currentFloor].stairs;    }, set(v) { this.floors[this.currentFloor].stairs    = v; }, enumerable: false });
Object.defineProperty(state, 'furniture', { get() { return this.floors[this.currentFloor].furniture; }, set(v) { this.floors[this.currentFloor].furniture = v; }, enumerable: false });

let grid = null;
let undoStack = [];
let redoStack = [];
let toolbar = null;
let svgEl = null;
let hoveredEdge = null;
let selectedId = null;
let selectedStairId = null;
let selectedFurnitureId = null;
let multiSelected = new Set();
// 複数選択中の ID 集合（room/stair/furniture）
let multiMoveDragging = false;

// セル編集
let paintCells    = null;
let paintMode     = null;   // 'add' | 'remove'
let paintCanvas   = null;
let editingRoomId = null;   // セル編集中の部屋ID

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
        rooms:     f.rooms     ?? [],
        elements:  f.elements  ?? [],
        stairs:    f.stairs    ?? [],
        furniture: f.furniture ?? [],
      }));
      while (state.floors.length < 2) state.floors.push({ rooms: [], elements: [], stairs: [], furniture: [] });
    } else {
      state.floors[0].rooms    = saved.rooms    ?? [];
      state.floors[0].elements = saved.elements ?? [];
    }
    // 旧データ移行：矩形部屋をセルベースに変換
    state.floors.forEach(f => f.rooms.forEach(r => normalizeCells(r)));
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
          rooms:     f.rooms     ?? [],
          elements:  f.elements  ?? [],
          stairs:    f.stairs    ?? [],
          furniture: f.furniture ?? [],
        }));
        while (state.floors.length < 2) state.floors.push({ rooms: [], elements: [], stairs: [], furniture: [] });
      } else {
        state.floors[0].rooms    = data.rooms    ?? [];
        state.floors[0].elements = data.elements ?? [];
      }
      // 旧データ移行：矩形部屋をセルベースに変換
      state.floors.forEach(f => f.rooms.forEach(r => normalizeCells(r)));
      grid = createGrid(state.gridCols, state.gridRows);
      rebuildGrid(grid, state.rooms);
      renderAll();
      toolbar.syncSliders(state);
      toolbar.syncFloor(state.currentFloor);
      toolbar.syncStairConfig(state.stairConfig);
      showToast('読み込みました');
    }, msg => alert(msg)),
    onRotate:        (dir) => rotateFloorPlan(dir > 0),
    onWalkthrough:   () => startWalkthrough(state),
    onCompassChange: () => { renderCompassIndicator(); saveProject(state); },
    onReset: () => {
      pushUndo();
      state.floors = [
        { rooms: [], elements: [], stairs: [], furniture: [] },
        { rooms: [], elements: [], stairs: [], furniture: [] },
      ];
      state.currentFloor = 0;
      multiSelected = new Set();
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
    if (state.mode === 'furniture') {
      if (e.target.closest('.furniture-block')) return; // furniture block itself handles click
      // 空きエリアをクリック → 配置
      const { col, row } = getGridCell(e);
      handleFurniturePlace(col, row);
      return;
    }
    if (state.mode !== 'room') return;
    if (!e.target.closest('.room-block') && !e.target.closest('.room-cell') && !e.target.closest('.stair-block') && !e.target.closest('.furniture-block')) {
      if (multiSelected.size > 0) { clearMultiSelected(); return; }
      selectRoom(null);
      selectedStairId = null;
    }
  });

  // キーボード操作（削除・編集終了）
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFurnitureId && state.mode === 'furniture') {
      pushUndo();
      state.furniture = state.furniture.filter(f => f.id !== selectedFurnitureId);
      selectedFurnitureId = null;
      renderFurniture();
      saveProject(state);
    }
    if (e.key === 'Escape') {
      if (multiSelected.size > 0) { clearMultiSelected(); return; }
      if (editingRoomId) {
        editingRoomId = null;
        renderAll();
        updateInspector();
      }
    }
  });

  // セル編集（editingRoomId が設定されているとき）
  document.getElementById('grid').addEventListener('mousedown', e => {
    if (!editingRoomId || state.mode !== 'room') return;
    const { col, row } = getGridCell(e);
    const cellKey = `${col},${row}`;
    const editRoom = state.rooms.find(r => r.id === editingRoomId);
    if (!editRoom) { editingRoomId = null; return; }
    e.preventDefault();
    if (editRoom.cells && editRoom.cells.includes(cellKey)) {
      paintMode = 'remove';
      paintCells = new Set([cellKey]);
    } else {
      paintMode = 'add';
      paintCells = new Set();
      if (col >= 0 && row >= 0 && col < state.gridCols && row < state.gridRows &&
          grid.cells[row][col] === null) {
        paintCells.add(cellKey);
      }
    }
    renderPaintPreview();
  });
  document.getElementById('grid').addEventListener('mousemove', e => {
    if (!editingRoomId || state.mode !== 'room' || !paintCells) return;
    const { col, row } = getGridCell(e);
    const cellKey = `${col},${row}`;
    const editRoom = state.rooms.find(r => r.id === editingRoomId);
    if (!editRoom) return;
    if (paintMode === 'remove') {
      if (editRoom.cells && editRoom.cells.includes(cellKey)) paintCells.add(cellKey);
    } else {
      if (col >= 0 && row >= 0 && col < state.gridCols && row < state.gridRows &&
          grid.cells[row][col] === null) {
        paintCells.add(cellKey);
      }
    }
    renderPaintPreview();
  });
  document.addEventListener('mouseup', () => {
    if (!editingRoomId || !paintCells) return;
    if (paintCells.size > 0) {
      const editRoom = state.rooms.find(r => r.id === editingRoomId);
      if (editRoom) {
        pushUndo();
        if (paintMode === 'remove') {
          const newCells = editRoom.cells.filter(c => !paintCells.has(c));
          if (newCells.length > 0) {
            for (const c of paintCells) {
              const [cc, rr] = c.split(',').map(Number);
              if (grid.cells[rr] && grid.cells[rr][cc] === editRoom.id) grid.cells[rr][cc] = null;
            }
            editRoom.cells = newCells;
            updateIrregularRoomBounds(editRoom);
          }
        } else {
          for (const c of paintCells) {
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
    paintCells = null;
    paintMode  = null;
    renderPaintPreview();
  });

  // 複数選択ドラッグ（キャプチャフェーズで各要素のハンドラより先に処理）
  document.getElementById('grid').addEventListener('mousedown', e => {
    if (multiSelected.size === 0) return;
    if (e.ctrlKey || e.metaKey) return; // Ctrl+Click はトグル処理に任せる
    if (e.target.closest('.resize-handle') || e.target.closest('.furn-delete')) return;
    let clickedId = null;
    const rb = e.target.closest('.room-block');
    const rc = e.target.closest('.room-cell');
    const rl = e.target.closest('.room-label-block');
    const sb = e.target.closest('.stair-block');
    const fb = e.target.closest('.furniture-block');
    if (rb)       clickedId = rb.dataset.id;
    else if (rc)  clickedId = rc.dataset.roomId;
    else if (rl)  clickedId = rl.dataset.id;
    else if (sb)  clickedId = sb.dataset.id;
    else if (fb)  clickedId = fb.dataset.id;
    if (!clickedId || !multiSelected.has(clickedId)) return;
    e.preventDefault();
    e.stopPropagation();
    startMultiMoveDrag(e);
  }, { capture: true });

  // 壁・建具モード
  svgEl.addEventListener('mousemove', e => {
    if (state.mode === 'room' || state.mode === 'stair') return;
    hoveredEdge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  });
  svgEl.addEventListener('mouseleave', () => {
    hoveredEdge = null;
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
  });
  svgEl.addEventListener('click', e => {
    if (state.mode === 'room' || state.mode === 'stair') return;
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
// セル編集ユーティリティ
// ============================================================
function updateIrregularRoomBounds(room) {
  if (!room.cells || !room.cells.length) return;
  const cols = room.cells.map(k => +k.split(',')[0]);
  const rows = room.cells.map(k => +k.split(',')[1]);
  room.x = Math.min(...cols);
  room.y = Math.min(...rows);
  room.w = Math.max(...cols) - room.x + 1;
  room.h = Math.max(...rows) - room.y + 1;
}

// 部屋のセルが完全な矩形かどうか判定
function isRectRoom(room) {
  if (!room.cells || !room.cells.length) return true;
  if (room.cells.length !== room.w * room.h) return false;
  const cellSet = new Set(room.cells);
  for (let r = room.y; r < room.y + room.h; r++)
    for (let c = room.x; c < room.x + room.w; c++)
      if (!cellSet.has(`${c},${r}`)) return false;
  return true;
}

// 選択部屋のドラッグ移動
function startRoomMoveDrag(e, room) {
  const cs = state.cellSize;
  const startMX = e.clientX, startMY = e.clientY;
  let lastDx = 0, lastDy = 0;
  let moved = false;

  const cols = room.cells.map(k => +k.split(',')[0]);
  const rows = room.cells.map(k => +k.split(',')[1]);
  const minC = Math.min(...cols), minR = Math.min(...rows);
  const maxC = Math.max(...cols), maxR = Math.max(...rows);

  const onMove = mv => {
    const rawDx = Math.round((mv.clientX - startMX) / cs);
    const rawDy = Math.round((mv.clientY - startMY) / cs);
    const dx = Math.max(-minC, Math.min(state.gridCols - 1 - maxC, rawDx));
    const dy = Math.max(-minR, Math.min(state.gridRows - 1 - maxR, rawDy));
    if (dx === lastDx && dy === lastDy) return;
    moved = true;
    lastDx = dx; lastDy = dy;
    const tx = `translate(${dx*cs}px,${dy*cs}px)`;
    document.querySelectorAll(`.room-cell[data-room-id="${room.id}"]`).forEach(el => {
      el.style.transform = tx; el.style.zIndex = '50';
    });
    document.querySelectorAll(`.room-label-block[data-id="${room.id}"]`).forEach(el => {
      el.style.transform = tx; el.style.zIndex = '50';
    });
  };

  const onUp = mv => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.querySelectorAll(`.room-cell[data-room-id="${room.id}"], .room-label-block[data-id="${room.id}"]`).forEach(el => {
      el.style.transform = ''; el.style.zIndex = '';
    });
    if (!moved || (lastDx === 0 && lastDy === 0)) return;
    const newCells = room.cells.map(k => {
      const [c, r] = k.split(',').map(Number);
      return `${c+lastDx},${r+lastDy}`;
    });
    if (!canPlaceCells(grid, newCells, room.id)) return;
    pushUndo();
    removeRoom(grid, room.id);
    room.cells = newCells;
    updateIrregularRoomBounds(room);
    placeRoomCells(grid, room.id, newCells);
    renderAll();
    saveProject(state);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// 矩形部屋の四隅リサイズハンドル
function addCornerHandles(labelEl, room) {
  const CORNERS = ['nw', 'ne', 'se', 'sw'];
  const CURSORS  = { nw: 'nw-resize', ne: 'ne-resize', se: 'se-resize', sw: 'sw-resize' };
  for (const dir of CORNERS) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${dir}`;
    handle.style.cursor = CURSORS[dir];
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const cs = state.cellSize;
      const startX = e.clientX, startY = e.clientY;
      const origX = room.x, origY = room.y, origW = room.w, origH = room.h;
      let moved = false;

      const onMove = mv => {
        const dx = Math.round((mv.clientX - startX) / cs);
        const dy = Math.round((mv.clientY - startY) / cs);
        if (dx === 0 && dy === 0) return;
        moved = true;
        const g = calcCornerResize(dir, origX, origY, origW, origH, dx, dy);
        const cx = Math.max(0, g.x), cy = Math.max(0, g.y);
        const cw = Math.max(1, Math.min(g.w, state.gridCols - cx));
        const ch = Math.max(1, Math.min(g.h, state.gridRows - cy));
        labelEl.style.left   = `${cx * cs}px`; labelEl.style.top    = `${cy * cs}px`;
        labelEl.style.width  = `${cw * cs}px`; labelEl.style.height = `${ch * cs}px`;
      };

      const onUp = mv => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!moved) return;
        const dx = Math.round((mv.clientX - startX) / cs);
        const dy = Math.round((mv.clientY - startY) / cs);
        const g = calcCornerResize(dir, origX, origY, origW, origH, dx, dy);
        commitRoomResize(room, g.x, g.y, g.w, g.h);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    labelEl.appendChild(handle);
  }
}

function calcCornerResize(dir, x, y, w, h, dx, dy) {
  let nx = x, ny = y, nw = w, nh = h;
  if (dir.includes('e')) nw = Math.max(1, w + dx);
  if (dir.includes('s')) nh = Math.max(1, h + dy);
  if (dir.includes('w')) { nw = Math.max(1, w - dx); nx = x + (w - nw); }
  if (dir.includes('n')) { nh = Math.max(1, h - dy); ny = y + (h - nh); }
  return { x: nx, y: ny, w: nw, h: nh };
}

function commitRoomResize(room, x, y, w, h) {
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = Math.max(1, Math.min(w, state.gridCols - x));
  h = Math.max(1, Math.min(h, state.gridRows - y));
  const newCells = [];
  for (let r = y; r < y + h; r++)
    for (let c = x; c < x + w; c++)
      newCells.push(`${c},${r}`);
  if (!canPlaceCells(grid, newCells, room.id)) { renderAll(); return; }
  pushUndo();
  removeRoom(grid, room.id);
  room.x = x; room.y = y; room.w = w; room.h = h;
  room.cells = newCells;
  placeRoomCells(grid, room.id, newCells);
  renderAll();
  saveProject(state);
}

// 旧データ（矩形形式）をセルベースに変換
function normalizeCells(room) {
  if (room.cells && room.cells.length > 0) return room;
  const cells = [];
  for (let r = room.y; r < room.y + room.h; r++)
    for (let c = room.x; c < room.x + room.w; c++)
      cells.push(`${c},${r}`);
  room.cells = cells;
  return room;
}

function renderPaintPreview() {
  if (!paintCanvas) return;
  const cs = state.cellSize;
  paintCanvas.width  = state.gridCols * cs;
  paintCanvas.height = state.gridRows * cs;
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  if (!paintCells || !paintCells.size || !editingRoomId) return;
  if (paintMode === 'remove') {
    ctx.fillStyle   = 'rgba(239,68,68,0.45)';
    ctx.strokeStyle = '#dc2626';
  } else {
    const editRoom = state.rooms.find(r => r.id === editingRoomId);
    ctx.fillStyle   = (editRoom?.color ?? '#cccccc') + 'cc';
    ctx.strokeStyle = '#16a34a';
  }
  ctx.lineWidth = 2;
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
  multiSelected      = new Set();
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
  if (mode !== 'room' && mode !== 'stair' && mode !== 'furniture') state.elementTool = mode;
  paintCells = null;
  paintMode  = null;
  editingRoomId = null;
  renderPaintPreview();
  if (mode !== 'stair') selectedStairId = null;
  if (mode !== 'furniture') {
    selectedFurnitureId = null;
    renderFurniture();
  }
  const gridEl = document.getElementById('grid');
  gridEl.dataset.mode = mode;
  document.getElementById('palette').style.pointerEvents = mode === 'room' ? '' : 'none';
  document.querySelectorAll('.palette-item').forEach(el => el.draggable = (mode === 'room'));
  if (mode !== 'stair') {
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
  renderFurniture();
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
    appendIrregularRoom(gridEl, room);
  }
}

function appendIrregularRoom(gridEl, room) {
  const cs = state.cellSize;
  const isSelected = room.id === selectedId;
  const isEditing = editingRoomId === room.id;
  const isRoomMultiSel = multiSelected.has(room.id);
  const type = getTypeById(room.typeId);

  for (const key of room.cells) {
    const [col, row] = key.split(',').map(Number);
    const cell = document.createElement('div');
    cell.className = 'room-cell'
      + (isSelected ? ' room-cell-selected' : '')
      + (type.isVoid ? ' room-cell-void' : '')
      + (isEditing ? ' room-cell-editing' : '')
      + (isRoomMultiSel ? ' multi-selected' : '');
    cell.dataset.roomId = room.id;
    cell.style.cssText = `left:${col*cs}px;top:${row*cs}px;width:${cs}px;height:${cs}px;background:${room.color};`;

    // 選択されている部屋はドラッグで移動（編集モード・複数選択中を除く）
    cell.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      if (multiSelected.size > 0) return;
      if (state.mode !== 'room') return;
      if (editingRoomId === room.id) return;
      if (selectedId !== room.id) return; // まず選択させる
      e.preventDefault();
      e.stopPropagation();
      startRoomMoveDrag(e, room);
    });

    cell.addEventListener('click', e => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { toggleMultiSelect(room.id); return; }
      if (multiSelected.size > 0) { clearMultiSelected(); return; }
      selectRoom(room.id);
    });
    gridEl.appendChild(cell);
  }

  const { tatami, sqm } = calcAreaCells(room.cells);
  const label = document.createElement('div');
  label.className = 'room-label-block'
    + (isSelected ? ' room-label-selected' : '')
    + (isRoomMultiSel ? ' multi-selected' : '');
  label.dataset.id = room.id;
  label.dataset.x = room.x; label.dataset.y = room.y;
  label.dataset.w = room.w; label.dataset.h = room.h;
  label.style.cssText = `left:${room.x*cs}px;top:${room.y*cs}px;width:${room.w*cs}px;height:${room.h*cs}px;`;
  label.innerHTML = `
    <div class="room-top-strip">
      <span class="room-label" title="${room.label}">${room.label}</span>
      <span class="room-area">${tatami}畳<span class="room-sqm"> (${sqm}㎡)</span></span>
    </div>
    <div class="room-inner">
      <div class="room-icon">${type.icon}</div>
    </div>`;
  label.querySelector('.room-top-strip .room-label').addEventListener('dblclick', e => {
    e.stopPropagation(); startLabelEditIrregular(label, room);
  });

  // 矩形の場合：四隅のリサイズハンドル（選択時にCSSで表示）
  if (isRectRoom(room)) {
    addCornerHandles(label, room);
  }

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
    div.className = 'stair-block' + (isSelected ? ' stair-selected' : '') + (multiSelected.has(s.id) ? ' multi-selected' : '');
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
          if (mv.ctrlKey || mv.metaKey) { toggleMultiSelect(s.id); return; }
          if (multiSelected.size > 0) { clearMultiSelected(); return; }
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

// ============================================================
// 家具
// ============================================================
function renderFurniture() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.furniture-block').forEach(el => el.remove());
  const cs = state.cellSize;
  for (const furn of (state.furniture || [])) {
    const ftype = getFurnitureTypeById(furn.typeId);
    const div = document.createElement('div');
    const isSelected = furn.id === selectedFurnitureId;
    div.className = 'furniture-block' + (isSelected ? ' selected' : '') + (multiSelected.has(furn.id) ? ' multi-selected' : '');
    div.dataset.id = furn.id;
    div.dataset.x  = furn.x; div.dataset.y = furn.y;
    div.dataset.w  = furn.w; div.dataset.h = furn.h;
    div.style.cssText = `left:${furn.x*cs}px;top:${furn.y*cs}px;width:${furn.w*cs}px;height:${furn.h*cs}px;background-color:${ftype.color};`;
    div.innerHTML = `
      <span class="furn-icon">${ftype.icon}</span>
      <span class="furn-label">${ftype.label}</span>
      <button class="furn-delete" title="削除">×</button>`;

    // 削除ボタン
    div.querySelector('.furn-delete').addEventListener('click', e => {
      e.stopPropagation();
      pushUndo();
      state.furniture = state.furniture.filter(f => f.id !== furn.id);
      selectedFurnitureId = null;
      renderFurniture();
      saveProject(state);
    });

    // クリックで選択
    div.addEventListener('click', e => {
      if (e.target.closest('.resize-handle')) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { toggleMultiSelect(furn.id); return; }
      if (multiSelected.size > 0) { clearMultiSelected(); return; }
      if (state.mode !== 'furniture') return;
      selectedFurnitureId = (selectedFurnitureId === furn.id) ? null : furn.id;
      renderFurniture();
    });

    // ドラッグで移動
    div.addEventListener('mousedown', e => {
      if (state.mode !== 'furniture') return;
      if (e.target.closest('.resize-handle') || e.target.closest('.furn-delete')) return;
      e.stopPropagation();
      e.preventDefault();
      const origX = furn.x, origY = furn.y;
      const startMX = e.clientX, startMY = e.clientY;
      let moved = false;
      const onMove = mv => {
        const dx = Math.round((mv.clientX - startMX) / cs);
        const dy = Math.round((mv.clientY - startMY) / cs);
        if (dx === 0 && dy === 0) return;
        moved = true;
        const nx = Math.max(0, Math.min(state.gridCols - furn.w, origX + dx));
        const ny = Math.max(0, Math.min(state.gridRows - furn.h, origY + dy));
        div.style.left = `${nx * cs}px`;
        div.style.top  = `${ny * cs}px`;
      };
      const onUp = mv => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!moved) return;
        const dx = Math.round((mv.clientX - startMX) / cs);
        const dy = Math.round((mv.clientY - startMY) / cs);
        const nx = Math.max(0, Math.min(state.gridCols - furn.w, origX + dx));
        const ny = Math.max(0, Math.min(state.gridRows - furn.h, origY + dy));
        if (nx !== origX || ny !== origY) {
          pushUndo();
          furn.x = nx; furn.y = ny;
          div.dataset.x = nx; div.dataset.y = ny;
          saveProject(state);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // リサイズ開始時に1回 undo を記録
    div.addEventListener('mousedown', e => {
      if (e.target.closest('.resize-handle')) pushUndo();
    });

    // リサイズハンドル（resize.js 流用）— 要素を再生成せずインライン更新
    attachResizeHandles(div, () => state.cellSize, (id, g) => {
      const f = state.furniture.find(f => f.id === id);
      if (!f) return;
      const ftype2 = getFurnitureTypeById(f.typeId);
      const x = Math.max(0, g.x);
      const y = Math.max(0, g.y);
      const w = Math.max(ftype2.minW, Math.min(g.w, state.gridCols - x));
      const h = Math.max(ftype2.minH, Math.min(g.h, state.gridRows - y));
      f.x = x; f.y = y; f.w = w; f.h = h;
      const cs = state.cellSize;
      const el = document.querySelector(`.furniture-block[data-id="${id}"]`);
      if (el) {
        el.style.left   = `${x * cs}px`; el.style.top    = `${y * cs}px`;
        el.style.width  = `${w * cs}px`; el.style.height = `${h * cs}px`;
        el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
      }
      saveProject(state);
    });

    gridEl.appendChild(div);
  }
}

function handleFurniturePlace(col, row) {
  const ftype = getFurnitureTypeById(state.furnitureType);
  const x = Math.min(Math.max(0, col), state.gridCols - ftype.defaultW);
  const y = Math.min(Math.max(0, row), state.gridRows - ftype.defaultH);
  pushUndo();
  const newFurn = {
    id:     `furn-${Date.now()}`,
    typeId: ftype.id,
    x, y,
    w: ftype.defaultW,
    h: ftype.defaultH,
  };
  state.furniture.push(newFurn);
  selectedFurnitureId = newFurn.id;
  renderFurniture();
  saveProject(state);
}

function createRoomElement(room) {
  const cs = state.cellSize;
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcArea(room.w, room.h);
  const el = document.createElement('div');
  const isMultiSel = multiSelected.has(room.id);
  el.className = 'room-block' + (room.id === selectedId ? ' selected' : '') + (type.isVoid ? ' room-void' : '') + (isMultiSel ? ' multi-selected' : '');
  el.dataset.id     = room.id;
  el.dataset.typeId = room.typeId;
  el.dataset.x = room.x; el.dataset.y = room.y;
  el.dataset.w = room.w; el.dataset.h = room.h;
  el.draggable = (state.mode === 'room') && multiSelected.size === 0;
  el.style.cssText = `left:${room.x*cs}px;top:${room.y*cs}px;width:${room.w*cs}px;height:${room.h*cs}px;background-color:${room.color};`;
  el.innerHTML = `
    <div class="room-inner">
      <div class="room-icon">${type.icon}</div>
      <div class="room-label" title="${room.label}">${room.label}</div>
      <div class="room-area">${tatami}畳 <span class="room-sqm">(${sqm}㎡)</span></div>
    </div>`;
  el.addEventListener('click', e => {
    if (e.target.closest('.resize-handle')) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) { toggleMultiSelect(room.id); return; }
    if (multiSelected.size > 0) { clearMultiSelected(); return; }
    selectRoom(room.id);
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
  const type = getTypeById(typeId);
  col = Math.max(0, Math.min(col, state.gridCols - type.defaultW));
  row = Math.max(0, Math.min(row, state.gridRows - type.defaultH));
  const room = createRoomData(typeId, col, row);
  if (!canPlaceCells(grid, room.cells)) {
    const pos = findFreePosition(grid, room.w, room.h);
    if (!pos) { showToast('空きスペースがありません', 'error'); return; }
    room.x = pos.x; room.y = pos.y;
    const cells = [];
    for (let r = pos.y; r < pos.y + room.h; r++)
      for (let c = pos.x; c < pos.x + room.w; c++)
        cells.push(`${c},${r}`);
    room.cells = cells;
  }
  pushUndo();
  state.rooms.push(room);
  placeRoomCells(grid, room.id, room.cells);
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
    fl.elements  = fl.elements.filter(e => e.col >= 0 && e.col < gridCols && e.row >= 0 && e.row < gridRows);
    fl.stairs    = fl.stairs.filter(s => s.x+s.w <= gridCols && s.y+s.h <= gridRows);
    if (fl.furniture) fl.furniture = fl.furniture.filter(f => f.x+f.w <= gridCols && f.y+f.h <= gridRows);
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

// ============================================================
// 回転
// ============================================================
function rotateFloorPlan(cw) {
  pushUndo();
  const oldCols = state.gridCols;
  const oldRows = state.gridRows;
  state.gridCols = oldRows;
  state.gridRows = oldCols;

  for (const fl of state.floors) {
    fl.rooms     = fl.rooms.map(r => _rotRoom(r, cw, oldCols, oldRows));
    fl.elements  = fl.elements.map(el => _rotEl(el, cw, oldCols, oldRows));
    fl.stairs    = fl.stairs.map(s => _rotStair(s, cw, oldCols, oldRows));
    if (fl.furniture) fl.furniture = fl.furniture.map(f => _rotRect(f, cw, oldCols, oldRows));
  }

  grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);
  renderAll();
  toolbar.syncSliders(state);
  saveProject(state);
}

function _rotRect(r, cw, oldCols, oldRows) {
  const o = { ...r };
  if (cw) { o.x = oldRows - r.y - r.h; o.y = r.x; }
  else    { o.x = r.y;                  o.y = oldCols - r.x - r.w; }
  o.w = r.h; o.h = r.w;
  return o;
}

function _rotRoom(r, cw, oldCols, oldRows) {
  const o = { ...r };
  if (r.cells) {
    o.cells = r.cells.map(key => {
      const [c, ro] = key.split(',').map(Number);
      return cw ? `${oldRows - 1 - ro},${c}` : `${ro},${oldCols - 1 - c}`;
    });
    const cs2 = o.cells.map(k => +k.split(',')[0]);
    const rs2 = o.cells.map(k => +k.split(',')[1]);
    o.x = Math.min(...cs2); o.y = Math.min(...rs2);
    o.w = Math.max(...cs2) - o.x + 1; o.h = Math.max(...rs2) - o.y + 1;
  } else {
    if (cw) { o.x = oldRows - r.y - r.h; o.y = r.x; }
    else    { o.x = r.y;                  o.y = oldCols - r.x - r.w; }
    o.w = r.h; o.h = r.w;
  }
  return o;
}

function _rotEl(el, cw, oldCols, oldRows) {
  const o = { ...el };
  if (cw) {
    if (el.dir === 'h') { o.dir = 'v'; o.col = oldRows - el.row;     o.row = el.col; }
    else                { o.dir = 'h'; o.col = oldRows - el.row - 1; o.row = el.col; }
  } else {
    if (el.dir === 'h') { o.dir = 'v'; o.col = el.row; o.row = oldCols - el.col - 1; }
    else                { o.dir = 'h'; o.col = el.row; o.row = oldCols - el.col; }
  }
  o.id = edgeKey(o.col, o.row, o.dir);
  return o;
}

function _rotStair(s, cw, oldCols, oldRows) {
  const CW  = { n:'e', e:'s', s:'w', w:'n' };
  const CCW = { n:'w', w:'s', s:'e', e:'n' };
  const o = { ...s };
  if (cw) { o.x = oldRows - s.y - s.h; o.y = s.x; o.dir = CW[s.dir  || 'n']; }
  else    { o.x = s.y;                  o.y = oldCols - s.x - s.w; o.dir = CCW[s.dir || 'n']; }
  o.w = s.h; o.h = s.w;
  return o;
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
  updateInspector();
  saveProject(state);
}

// ============================================================
// 選択管理
// ============================================================
function selectRoom(id) {
  selectedId = id;
  if (id) selectedStairId = null;
  updateInspector();
  document.querySelectorAll('.room-cell').forEach(el => el.classList.toggle('room-cell-selected', el.dataset.roomId === selectedId));
  document.querySelectorAll('.room-label-block').forEach(el => el.classList.toggle('room-label-selected', el.dataset.id === selectedId));
}

// ============================================================
// 複数選択
// ============================================================
function selectAll() {
  multiSelected = new Set();
  for (const r of state.rooms) multiSelected.add(r.id);
  for (const s of state.stairs) multiSelected.add(s.id);
  for (const f of (state.furniture || [])) multiSelected.add(f.id);
  selectedId = null; selectedStairId = null; selectedFurnitureId = null;
  renderAll();
  showToast(`${multiSelected.size}個を選択 — ドラッグで一括移動、Escでキャンセル`);
}

function toggleMultiSelect(id) {
  if (multiSelected.has(id)) multiSelected.delete(id);
  else multiSelected.add(id);
  selectedId = null; selectedStairId = null; selectedFurnitureId = null;
  renderAll();
  updateInspector();
}

function clearMultiSelected() {
  if (multiSelected.size === 0) return;
  multiSelected = new Set();
  renderAll();
  updateInspector();
}

function computeClampedDelta(dx, dy) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of multiSelected) {
    const room = state.rooms.find(r => r.id === id);
    if (room) {
      if (room.cells) {
        for (const k of room.cells) {
          const [c, r] = k.split(',').map(Number);
          minX = Math.min(minX, c); minY = Math.min(minY, r);
          maxX = Math.max(maxX, c + 1); maxY = Math.max(maxY, r + 1);
        }
      } else {
        minX = Math.min(minX, room.x); minY = Math.min(minY, room.y);
        maxX = Math.max(maxX, room.x + room.w); maxY = Math.max(maxY, room.y + room.h);
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

function applyMultiMovePreview(dx, dy) {
  const cs = state.cellSize;
  for (const id of multiSelected) {
    const tx = `translate(${dx*cs}px,${dy*cs}px)`;
    document.querySelectorAll(`.room-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
    document.querySelectorAll(`.room-cell[data-room-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
    document.querySelectorAll(`.room-label-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; });
    document.querySelectorAll(`.stair-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
    document.querySelectorAll(`.furniture-block[data-id="${id}"]`).forEach(el => { el.style.transform = tx; el.style.zIndex = '100'; });
  }
}

function clearMultiMovePreview() {
  for (const id of multiSelected) {
    document.querySelectorAll(`.room-block[data-id="${id}"], .room-cell[data-room-id="${id}"], .room-label-block[data-id="${id}"], .stair-block[data-id="${id}"], .furniture-block[data-id="${id}"]`).forEach(el => {
      el.style.transform = '';
      el.style.zIndex = '';
    });
  }
}

function commitMultiMove(dx, dy) {
  if (dx === 0 && dy === 0) return;
  pushUndo();
  for (const id of multiSelected) {
    const room = state.rooms.find(r => r.id === id);
    if (room) {
      if (room.cells) {
        const newCells = room.cells.map(k => {
          const [c, r] = k.split(',').map(Number);
          return `${c+dx},${r+dy}`;
        });
        removeRoom(grid, room.id);
        room.cells = newCells;
        updateIrregularRoomBounds(room);
        placeRoomCells(grid, room.id, newCells);
      } else {
        removeRoom(grid, room.id);
        room.x += dx; room.y += dy;
        placeRoom(grid, room.id, room.x, room.y, room.w, room.h);
      }
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
  renderAll();
  saveProject(state);
}

function startMultiMoveDrag(e) {
  const cs = state.cellSize;
  const startMX = e.clientX, startMY = e.clientY;
  let moved = false;
  let lastDx = 0, lastDy = 0;
  multiMoveDragging = true;

  const onMove = mv => {
    const rawDx = Math.round((mv.clientX - startMX) / cs);
    const rawDy = Math.round((mv.clientY - startMY) / cs);
    if (rawDx === 0 && rawDy === 0) return;
    moved = true;
    const { dx, dy } = computeClampedDelta(rawDx, rawDy);
    if (dx === lastDx && dy === lastDy) return;
    lastDx = dx; lastDy = dy;
    applyMultiMovePreview(dx, dy);
  };
  const onUp = mv => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    multiMoveDragging = false;
    clearMultiMovePreview();
    if (!moved) { clearMultiSelected(); return; }
    const rawDx = Math.round((mv.clientX - startMX) / cs);
    const rawDy = Math.round((mv.clientY - startMY) / cs);
    const { dx, dy } = computeClampedDelta(rawDx, rawDy);
    commitMultiMove(dx, dy);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================
// インスペクター
// ============================================================
function updateInspector() {
  const panel = document.getElementById('inspector');

  // 複数選択中（2個以上）
  if (multiSelected.size >= 2) {
    renderMultiSelectInspector(panel);
    return;
  }

  // 建具モード
  if (state.mode === 'wall' || state.mode === 'lowwall' || state.mode === 'door' || state.mode === 'window') {
    renderElementInspector(panel);
    return;
  }

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
  renderIrregularRoomInspector(panel, room);
}

// ── 複数選択インスペクター ────────────────────────────────
function renderMultiSelectInspector(panel) {
  const rooms  = state.rooms.filter(r => multiSelected.has(r.id));
  const stairs = state.stairs.filter(s => multiSelected.has(s.id));
  const furns  = (state.furniture || []).filter(f => multiSelected.has(f.id));
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">🔲</span>
      <span class="inspector-title">複数選択</span>
    </div>
    <div class="inspector-info">
      <strong>${multiSelected.size}個</strong>を選択中<br>
      <span style="font-size:11px;color:#888">
        部屋${rooms.length} ／ 階段${stairs.length} ／ 家具${furns.length}
      </span><br>
      <span style="font-size:11px;color:#888">ドラッグで一括移動</span>
    </div>
    <button id="btn-multi-all" class="btn-secondary btn-full" style="margin-top:8px">全選択 (Ctrl+A)</button>
    <button id="btn-multi-clear" class="btn-secondary btn-full" style="margin-top:4px">選択解除 (Esc)</button>
  `;
  document.getElementById('btn-multi-all').addEventListener('click', selectAll);
  document.getElementById('btn-multi-clear').addEventListener('click', clearMultiSelected);
}

// ── 建具インスペクター ────────────────────────────────────
function renderElementInspector(panel) {
  const els = state.elements;
  const counts = {};
  for (const t of ELEMENT_TOOLS) counts[t.id] = els.filter(e => e.type === t.id).length;
  const total = els.length;

  const rows = ELEMENT_TOOLS.map(t => `
    <div class="el-insp-row">
      <span class="el-insp-icon">${t.icon}</span>
      <span class="el-insp-label">${t.label}</span>
      <span class="el-insp-count">${counts[t.id]}</span>
      <button class="btn-danger el-insp-del" data-type="${t.id}" ${counts[t.id] === 0 ? 'disabled' : ''}>削除</button>
    </div>`).join('');

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">🔨</span>
      <span class="inspector-title">建具</span>
    </div>
    <div class="inspector-info" style="margin-bottom:6px">
      合計 <strong>${total}</strong> 個
    </div>
    <div class="el-insp-list">${rows}</div>
    <button id="btn-del-all-elements" class="btn-danger btn-full" style="margin-top:10px" ${total === 0 ? 'disabled' : ''}>
      🗑️ 全建具を削除
    </button>
  `;

  panel.querySelectorAll('.el-insp-del[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const label = ELEMENT_TOOLS.find(t => t.id === type)?.label ?? type;
      if (!confirm(`現在のフロアの「${label}」をすべて削除しますか？`)) return;
      pushUndo();
      state.elements = state.elements.filter(e => e.type !== type);
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
      saveProject(state);
      renderElementInspector(panel);
    });
  });

  document.getElementById('btn-del-all-elements')?.addEventListener('click', () => {
    if (!confirm('現在のフロアの建具をすべて削除しますか？')) return;
    pushUndo();
    state.elements = [];
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
    saveProject(state);
    renderElementInspector(panel);
  });
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
      <p class="hint">パレットから部屋をドラッグして配置<br>選択後「✏️ セルを編集」で形を変更</p>
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
    <div class="inspector-info"><strong>${tatami}畳</strong>（${sqm}㎡）<br><span style="font-size:11px;color:#888">${room.w}×${room.h}マス</span></div>` : `
    <div class="inspector-info"><strong>${tatami}畳</strong>（${sqm}㎡）<br><span style="font-size:11px;color:#888">吹き抜け（面積に含まず）</span></div>`}
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
  }

  document.getElementById('btn-delete-room').addEventListener('click', () => {
    pushUndo(); removeRoom(grid, room.id);
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    selectedId = null;
    renderAll(); saveProject(state);
  });
}

// ── 部屋インスペクター ────────────────────────────────────
function renderIrregularRoomInspector(panel, room) {
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcAreaCells(room.cells);
  const isEditing = editingRoomId === room.id;
  const isVoid = type.isVoid;
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${type.icon}</span>
      <span class="inspector-title">${room.label}${isVoid ? ' <span class="badge-void">吹き抜け</span>' : ''}</span>
    </div>
    <div class="inspector-field"><label>部屋名</label><input type="text" id="inp-label" value="${escHtml(room.label)}"></div>
    <div class="inspector-field"><label>色</label><input type="color" id="inp-color" value="${rgbToHex(room.color)}"></div>
    <div class="inspector-info"><strong>${tatami}畳</strong>（${sqm}㎡）<br><span style="font-size:11px;color:#888">${room.cells.length}マス</span></div>
    <button id="btn-edit-cells" class="${isEditing ? 'btn-primary' : 'btn-secondary'} btn-full" style="margin-top:6px">${isEditing ? '✅ 編集完了' : '✏️ セルを編集'}</button>
    <div id="edit-cells-hint" style="font-size:11px;color:#64748b;margin:4px 0 0;display:${isEditing ? 'block' : 'none'}">ドラッグ: マスを追加<br>既存のマスをドラッグ: 削除</div>
    <button id="btn-delete-room" class="btn-danger btn-full" style="margin-top:8px">この部屋を削除</button>
  `;
  document.getElementById('inp-label').addEventListener('change', e => { pushUndo(); room.label = e.target.value; renderAll(); saveProject(state); });
  document.getElementById('inp-color').addEventListener('input', e => {
    room.color = e.target.value;
    document.querySelectorAll(`.room-cell[data-room-id="${room.id}"]`).forEach(el => el.style.backgroundColor = room.color);
  });
  document.getElementById('inp-color').addEventListener('change', () => { pushUndo(); renderAll(); saveProject(state); });
  document.getElementById('btn-edit-cells').addEventListener('click', () => {
    if (editingRoomId === room.id) {
      editingRoomId = null;
    } else {
      editingRoomId = room.id;
      showToast(`「${room.label}」のセルを編集中 — ドラッグで追加、既存セルをドラッグで削除`);
    }
    renderAll();
    updateInspector();
  });
  document.getElementById('btn-delete-room').addEventListener('click', () => {
    if (editingRoomId === room.id) editingRoomId = null;
    pushUndo(); removeRoom(grid, room.id);
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    selectedId = null; renderAll(); saveProject(state);
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
  multiSelected = new Set();
  grid = createGrid(state.gridCols, state.gridRows); rebuildGrid(grid, state.rooms);
  renderAll(); toolbar.syncSliders(state); toolbar.syncFloor(state.currentFloor); toolbar.syncStairConfig(state.stairConfig);
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotState()); restoreSnapshot(redoStack.pop());
  multiSelected = new Set();
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
