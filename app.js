// app.js — オーケストレーター

import { state, ui, AUTOSAVE_INTERVAL } from './state.js';
import { createGrid, rebuildGrid, canPlace, canPlaceCells, placeRoomCells, removeRoom } from './grid.js';
import { renderPalette, createRoomData, getTypeById } from './rooms.js';
import { initDnd } from './dnd.js';
import { saveProject, loadProject, exportJSON, importJSON, resetProject } from './storage.js';
import { initToolbar } from './toolbar.js';
import { initWallLayer, renderWallLayer, ELEMENT_TOOLS } from './walls.js';
import { startWalkthrough } from './walkthrough.js';
import { initLandLayer } from './land.js';
import { pushUndo, undo, redo, canUndo, canRedo, resetUndoRedo } from './undo.js';
import { initRotate, rotateFloorPlan } from './rotate.js';
import { exportSVG, exportPNG, handlePrint } from './export.js';
import { initRenderer, renderRooms, renderStairs, renderFurniture, renderLandscape, renderLandLayer, renderSunlightLayer, renderPaintPreview, renderCompassIndicator, applyGridCss } from './render.js';
import { initInspector, updateInspector } from './inspector.js';
import { initSelection, selectRoom, selectAll, toggleMultiSelect, clearMultiSelected, startMultiMoveDrag } from './selection.js';
import { initPaletteRenderer, renderElementPalette, renderStairPalette, renderFurniturePalette, renderLandscapePalette } from './palette-renderer.js';
import { initLandHandlers } from './land-handler.js';
import { initWallHandlers } from './wall-handler.js';
import { initCellEditHandlers } from './cell-edit-handler.js';
import { getFurnitureTypeById } from './furniture.js';
import { getLandscapeTypeById } from './landscape.js';
import { normalizeCells, updateIrregularRoomBounds } from './room-utils.js';

// ============================================================
// 共通ユーティリティ
// ============================================================
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

// ============================================================
// レンダリング（最上位コーディネーター）
// ============================================================
function renderAll() {
  applyGridCss();
  renderRooms();
  renderStairs();
  renderFurniture();
  renderLandscape();
  renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, ui.selectedElementKey);
  renderLandLayer();
  renderSunlightLayer();
  updateInspector();
  ui.toolbar?.updateUndoRedo(canUndo(), canRedo());
}

// ============================================================
// モード切替
// ============================================================
function handleModeChange(mode) {
  state.mode = mode;
  if (mode !== 'room' && mode !== 'stair' && mode !== 'furniture' && mode !== 'land' && mode !== 'landscape') {
    state.elementTool = mode;
  }
  ui.paintCells     = null;
  ui.paintMode      = null;
  ui.editingRoomId  = null;
  renderPaintPreview();
  if (mode !== 'room') selectRoom(null);
  if (mode !== 'stair') { ui.selectedStairId = null; renderStairs(); }
  if (mode !== 'furniture') { ui.selectedFurnitureId = null; renderFurniture(); }
  if (mode !== 'landscape') { ui.selectedLandscapeId = null; renderLandscape(); }
  if (mode !== 'door') ui.selectedElementKey = null;

  const isElement = ELEMENT_TOOLS.some(t => t.id === mode);
  if (mode === 'furniture')    renderFurniturePalette();
  else if (mode === 'stair')   renderStairPalette();
  else if (mode === 'landscape') renderLandscapePalette();
  else if (isElement)          renderElementPalette();
  else                         renderPalette(document.getElementById('palette'));

  document.getElementById('grid').dataset.mode = mode;
  document.getElementById('palette').style.pointerEvents = '';
  if (mode !== 'stair') {
    renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode, ui.selectedElementKey);
  }
  // 土地ドラッグ状態リセット
  ui.landPreview = null;
  ui.landDragIdx = -1;
  ui.landRotating = false;
  ui.landRotateStartPoints = null;
  ui.landMoving = false;
  ui.landMoveStartPos = null;
  ui.landMoveStartPoints = null;
  document.getElementById('grid').style.cursor = '';
  renderLandLayer();
  updateInspector();
}

// ============================================================
// プロジェクトデータ適用（初期化・インポート共用）
// ============================================================
function applyProjectData(data) {
  state.gridCols     = data.gridCols     ?? 20;
  state.gridRows     = data.gridRows     ?? 15;
  state.cellSize     = data.cellSize     ?? 44;
  state.compass      = data.compass      ?? 0;
  state.sunHour      = data.sunHour      ?? 12;
  state.wallColor    = data.wallColor    ?? '#1e293b';
  state.currentFloor = data.currentFloor ?? 0;
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
  state.land      = data.land      ?? { points: [], closed: false };
  state.landscape = data.landscape ?? [];
  state.floors.forEach(f => f.rooms.forEach(r => normalizeCells(r)));
  syncStairsBetweenFloors();
}

function syncStairsBetweenFloors() {
  const f0 = state.floors[0], f1 = state.floors[1];
  if (!f0 || !f1) return;
  for (const s of f0.stairs) {
    if (!f1.stairs.some(t => t.x === s.x && t.y === s.y))
      f1.stairs.push({ ...s, id: s.id + '_pair', mirror: true });
  }
  for (const s of f1.stairs) {
    if (!f0.stairs.some(t => t.x === s.x && t.y === s.y))
      f0.stairs.push({ ...s, id: s.id + '_pair', mirror: false });
  }
  for (const s of f1.stairs) {
    if (f0.stairs.some(t => t.x === s.x && t.y === s.y)) s.mirror = true;
  }
  for (const s of f0.stairs) s.mirror = false;
}

// ============================================================
// フロア切替
// ============================================================
function handleFloorChange(floorIdx) {
  pushUndo();
  state.currentFloor      = floorIdx;
  ui.selectedStairId      = null;
  ui.selectedFurnitureId  = null;
  ui.multiSelected        = new Set();
  ui.grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(ui.grid, state.rooms);
  selectRoom(null);
  renderAll();
  ui.toolbar.syncFloor(floorIdx);
  showToast(`${floorIdx + 1}F を編集中`);
}

// ============================================================
// 部屋・家具・階段の配置ハンドラ
// ============================================================
function findFreePosition(grid, w, h) {
  for (let r = 0; r <= grid.rows - h; r++)
    for (let c = 0; c <= grid.cols - w; c++)
      if (canPlace(grid, c, r, w, h)) return { x: c, y: r };
  return null;
}

function handleDropNew(typeId, col, row) {
  const type = getTypeById(typeId);
  col = Math.max(0, Math.min(col, state.gridCols - type.defaultW));
  row = Math.max(0, Math.min(row, state.gridRows - type.defaultH));
  const room = createRoomData(typeId, col, row);
  if (!canPlaceCells(ui.grid, room.cells)) {
    const pos = findFreePosition(ui.grid, room.w, room.h);
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
  placeRoomCells(ui.grid, room.id, room.cells);
  selectRoom(room.id);
  renderAll();
  saveProject(state);
}

function handleStairDropNew(col, row) {
  const { w, h, dir } = state.stairConfig;
  const x = Math.min(Math.max(0, col), state.gridCols - w);
  const y = Math.min(Math.max(0, row), state.gridRows - h);
  const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
  const otherFloor    = state.floors[otherFloorIdx];
  pushUndo();
  const newStair = { id: `stair-${Date.now()}`, x, y, w, h, dir };
  state.stairs.push(newStair);
  ui.selectedStairId = newStair.id;
  const oi = otherFloor.stairs.findIndex(s => s.x === x && s.y === y);
  if (oi !== -1) {
    Object.assign(otherFloor.stairs[oi], { x, y, w, h, dir });
  } else {
    otherFloor.stairs.push({ id: `stair-${Date.now() + 1}`, x, y, w, h, dir, mirror: otherFloorIdx === 1 });
  }
  if (state.mode !== 'stair') { handleModeChange('stair'); ui.toolbar?.setMode('stair'); }
  renderAll();
  saveProject(state);
}

function handleFurnitureDropNew(typeId, col, row) {
  const ftype = getFurnitureTypeById(typeId);
  const x = Math.min(Math.max(0, col), state.gridCols - ftype.defaultW);
  const y = Math.min(Math.max(0, row), state.gridRows - ftype.defaultH);
  pushUndo();
  const newFurn = { id: `furn-${Date.now()}`, typeId: ftype.id, x, y, w: ftype.defaultW, h: ftype.defaultH, dir: 's' };
  state.furniture.push(newFurn);
  ui.selectedFurnitureId = newFurn.id;
  if (state.mode !== 'furniture') { handleModeChange('furniture'); ui.toolbar?.setMode('furniture'); }
  renderFurniture();
  updateInspector();
  saveProject(state);
}

function handleLandscapeDropNew(typeId, col, row) {
  const ltype = getLandscapeTypeById(typeId);
  const x = Math.min(Math.max(0, col), state.gridCols - ltype.defaultW);
  const y = Math.min(Math.max(0, row), state.gridRows - ltype.defaultH);
  pushUndo();
  const newLs = { id: `ls-${Date.now()}`, typeId: ltype.id, x, y, w: ltype.defaultW, h: ltype.defaultH };
  state.landscape.push(newLs);
  ui.selectedLandscapeId = newLs.id;
  if (state.mode !== 'landscape') { handleModeChange('landscape'); ui.toolbar?.setMode('landscape'); }
  renderLandscape();
  updateInspector();
  saveProject(state);
}

function handleGridChange({ gridCols, gridRows, cellSize }) {
  state.gridCols = gridCols; state.gridRows = gridRows; state.cellSize = cellSize;
  for (const fl of state.floors) {
    fl.rooms = fl.rooms.filter(r => {
      if (r.cells) {
        r.cells = r.cells.filter(k => { const [c, ro] = k.split(',').map(Number); return c < gridCols && ro < gridRows; });
        if (!r.cells.length) return false;
        updateIrregularRoomBounds(r);
        return true;
      }
      return r.x+r.w <= gridCols && r.y+r.h <= gridRows;
    });
    fl.elements  = fl.elements.filter(e => e.col >= 0 && e.col < gridCols && e.row >= 0 && e.row < gridRows);
    fl.stairs    = fl.stairs.filter(s => s.x+s.w <= gridCols && s.y+s.h <= gridRows);
    if (fl.furniture) fl.furniture = fl.furniture.filter(f => f.x+f.w <= gridCols && f.y+f.h <= gridRows);
  }
  state.landscape = state.landscape.filter(l => l.x+l.w <= gridCols && l.y+l.h <= gridRows);
  ui.grid = createGrid(gridCols, gridRows);
  rebuildGrid(ui.grid, state.rooms);
  renderAll();
}

// ============================================================
// DOMContentLoaded
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // プロジェクトデータ読み込み
  const saved = loadProject();
  if (saved) applyProjectData(saved);

  // グリッド初期化
  ui.grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(ui.grid, state.rooms);

  // DOM要素初期化
  renderPalette(document.getElementById('palette'));
  ui.svgEl       = initWallLayer(document.getElementById('grid'));
  ui.landSvg     = initLandLayer(document.getElementById('grid'));
  ui.paintCanvas = document.createElement('canvas');
  ui.paintCanvas.id = 'paint-canvas';
  document.getElementById('grid').appendChild(ui.paintCanvas);
  ui.sunlightCanvas = document.createElement('canvas');
  ui.sunlightCanvas.id = 'sunlight-canvas';
  document.getElementById('grid').appendChild(ui.sunlightCanvas);

  // ── モジュール初期化 ────────────────────────────────────
  initSelection({ renderAll, updateInspector, showToast });
  initRenderer({ renderAll, handleModeChange });
  const landActions = {
    onLandCopy: () => {
      const land = state.land;
      if (!land?.points?.length) { alert('コピーする土地形状がありません。'); return; }
      localStorage.setItem('sumika_land_clipboard', JSON.stringify(land));
      alert('土地形状をコピーしました。');
    },
    onLandPaste: () => {
      const raw = localStorage.getItem('sumika_land_clipboard');
      if (!raw) { alert('クリップボードに土地形状がありません。'); return; }
      try {
        const land = JSON.parse(raw);
        if (!Array.isArray(land?.points)) throw new Error();
        pushUndo();
        state.land = land;
        ui.landPreview = null;
        renderLandLayer();
        saveProject(state);
      } catch { alert('土地形状の読み込みに失敗しました。'); }
    },
    onLandClear: () => {
      pushUndo();
      state.land = { points: [], closed: false };
      ui.landPreview = null;
      renderLandLayer();
      saveProject(state);
    },
  };
  initInspector({ renderAll, renderFurniture, renderLandscape, showToast, handleModeChange, ...landActions });
  initPaletteRenderer({ handleModeChange });
  initRotate({ renderAll, syncSliders: s => ui.toolbar?.syncSliders(s) });

  // ── グリッド再構築 + ツールバー同期ヘルパー ─────────────
  const rebuildAndSync = () => {
    ui.grid = createGrid(state.gridCols, state.gridRows);
    rebuildGrid(ui.grid, state.rooms);
    renderAll();
    ui.toolbar?.syncSliders(state);
    ui.toolbar?.syncFloor(state.currentFloor);
    ui.toolbar?.syncWallColor(state.wallColor);
  };

  // ── Undo コールバック ────────────────────────────────────
  const undoCallback = () => {
    ui.multiSelected = new Set();
    rebuildAndSync();
  };

  // ── ツールバー ───────────────────────────────────────────
  ui.toolbar = initToolbar({
    container:    document.getElementById('toolbar'),
    state,
    onUndo:       () => undo(undoCallback),
    onRedo:       () => redo(undoCallback),
    onGridChange: handleGridChange,
    onModeChange: handleModeChange,
    onFloorChange: handleFloorChange,
    onSave:       () => { saveProject(state); showToast('保存しました'); },
    onExport:     () => exportJSON(state),
    onImport:     file => importJSON(file, data => {
      resetUndoRedo();
      applyProjectData(data);
      rebuildAndSync();
      renderCompassIndicator();
      showToast('読み込みました');
    }, msg => alert(msg)),
    onRotate:     dir => rotateFloorPlan(dir > 0),
    onWalkthrough: () => startWalkthrough(state),
    onPrint:      () => handlePrint(),
    onExportSVG:  () => exportSVG(),
    onExportPNG:  () => exportPNG(),
    onCompassChange: () => { renderCompassIndicator(); renderSunlightLayer(); saveProject(state); },
    onSunlightToggle: () => {
      ui.sunlightVisible = !ui.sunlightVisible;
      ui.toolbar?.setSunlight(ui.sunlightVisible);
      renderSunlightLayer();
    },
    onReset: () => {
      pushUndo();
      state.floors = [
        { rooms: [], elements: [], stairs: [], furniture: [] },
        { rooms: [], elements: [], stairs: [], furniture: [] },
      ];
      state.currentFloor = 0;
      state.landscape = [];
      ui.multiSelected = new Set();
      ui.selectedLandscapeId = null;
      resetProject();
      ui.grid = createGrid(state.gridCols, state.gridRows);
      rebuildGrid(ui.grid, state.rooms);
      renderAll();
      ui.toolbar.syncFloor(0);
    },
  });

  // ── DnD ─────────────────────────────────────────────────
  initDnd({
    gridEl:           document.getElementById('grid'),
    paletteEl:        document.getElementById('palette'),
    cellSize:         () => state.cellSize,
    onDropNew:        handleDropNew,
    onMove:           () => {},
    onDropFurniture:  handleFurnitureDropNew,
    onDropStair:      handleStairDropNew,
    onDropLandscape:  handleLandscapeDropNew,
  });

  // ── イベントハンドラ（各モジュールへ委譲）───────────────
  initLandHandlers(document.getElementById('grid'), { renderLandLayer });
  initWallHandlers(ui.svgEl, { getGridEl: () => document.getElementById('grid'), updateInspector });
  initCellEditHandlers(document.getElementById('grid'), {
    renderAll, renderPaintPreview, getGrid: () => ui.grid,
  });

  // ── グリッドクリック（部屋モード選択解除）───────────────
  document.getElementById('grid').addEventListener('click', e => {
    if (state.mode !== 'room') return;
    if (ui.editingRoomId) return; // セル編集中は選択をクリアしない
    if (!e.target.closest('.room-block') && !e.target.closest('.room-cell') &&
        !e.target.closest('.stair-block') && !e.target.closest('.furniture-block')) {
      if (ui.multiSelected.size > 0) { clearMultiSelected(); return; }
      selectRoom(null);
      ui.selectedStairId = null;
    }
  });

  // ── 複数選択ドラッグ（キャプチャフェーズ）───────────────
  document.getElementById('grid').addEventListener('mousedown', e => {
    if (ui.multiSelected.size === 0) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.target.closest('.resize-handle') || e.target.closest('.furn-delete')) return;
    let clickedId = null;
    const rb = e.target.closest('.room-block');
    const rc = e.target.closest('.room-cell');
    const rl = e.target.closest('.room-label-block');
    const sb = e.target.closest('.stair-block');
    const fb = e.target.closest('.furniture-block');
    if (rb) clickedId = rb.dataset.id;
    else if (rc) clickedId = rc.dataset.roomId;
    else if (rl) clickedId = rl.dataset.id;
    else if (sb) clickedId = sb.dataset.id;
    else if (fb) clickedId = fb.dataset.id;
    if (!clickedId || !ui.multiSelected.has(clickedId)) return;
    e.preventDefault(); e.stopPropagation();
    startMultiMoveDrag(e);
  }, { capture: true });

  // ── キーボードショートカット ─────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (ui.selectedId && state.mode === 'room') {
        pushUndo();
        removeRoom(ui.grid, ui.selectedId);
        state.rooms = state.rooms.filter(r => r.id !== ui.selectedId);
        ui.selectedId = null;
        renderAll();
        saveProject(state);
        return;
      }
      if (ui.selectedStairId && state.mode === 'stair') {
        pushUndo();
        const stair = state.stairs.find(s => s.id === ui.selectedStairId);
        if (stair) {
          const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
          const otherFloor = state.floors[otherFloorIdx];
          const paired = otherFloor.stairs.find(s => s.x === stair.x && s.y === stair.y);
          state.stairs = state.stairs.filter(s => s.id !== stair.id);
          if (paired) otherFloor.stairs = otherFloor.stairs.filter(s => s.id !== paired.id);
        }
        ui.selectedStairId = null;
        renderAll();
        saveProject(state);
        return;
      }
      if (ui.selectedFurnitureId && state.mode === 'furniture') {
        pushUndo();
        state.furniture = state.furniture.filter(f => f.id !== ui.selectedFurnitureId);
        ui.selectedFurnitureId = null;
        renderFurniture();
        saveProject(state);
        return;
      }
      if (ui.selectedElementKey && state.mode === 'door') {
        pushUndo();
        const key = ui.selectedElementKey;
        state.elements = state.elements.filter(el => `${el.dir}:${el.col}:${el.row}` !== key);
        ui.selectedElementKey = null;
        renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode, null);
        updateInspector();
        saveProject(state);
        return;
      }
      if (ui.selectedLandscapeId && state.mode === 'landscape') {
        pushUndo();
        state.landscape = state.landscape.filter(l => l.id !== ui.selectedLandscapeId);
        ui.selectedLandscapeId = null;
        renderLandscape();
        updateInspector();
        saveProject(state);
        return;
      }
    }
    if (e.key === 'Escape' && state.mode === 'land' && !state.land?.closed) {
      state.land = { points: [], closed: false };
      ui.landPreview = null;
      renderLandLayer();
      saveProject(state);
      return;
    }
    if (e.key === 'Escape') {
      if (ui.multiSelected.size > 0) { clearMultiSelected(); return; }
      if (ui.editingRoomId) {
        ui.editingRoomId = null;
        renderAll();
        updateInspector();
      }
    }
  });

  // ── ズーム（Ctrl+ホイール / ピンチ）────────────────────────
  const ZOOM_MIN = 24, ZOOM_MAX = 96, ZOOM_STEP = 4;
  const canvasWrapper = document.getElementById('canvas-wrapper');

  function applyZoom(newSize, pivotX, pivotY) {
    const oldSize = state.cellSize;
    newSize = Math.round(newSize / ZOOM_STEP) * ZOOM_STEP;
    newSize = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newSize));
    if (newSize === oldSize) return;

    // ピボット点周辺のスクロール位置を維持
    const ratio = newSize / oldSize;
    const scrollLeft = canvasWrapper.scrollLeft;
    const scrollTop  = canvasWrapper.scrollTop;
    const wrapRect   = canvasWrapper.getBoundingClientRect();
    // ピボットのcanvasWrapper内座標（スクロール込み）
    const px = (pivotX - wrapRect.left) + scrollLeft;
    const py = (pivotY - wrapRect.top)  + scrollTop;

    state.cellSize = newSize;
    renderAll();
    ui.toolbar.syncSliders(state);

    // スクロール補正: ピボット点が画面上の同じ位置に来るよう調整
    canvasWrapper.scrollLeft = px * ratio - (pivotX - wrapRect.left);
    canvasWrapper.scrollTop  = py * ratio - (pivotY - wrapRect.top);

    saveProject(state);
  }

  // Ctrl+ホイール
  canvasWrapper.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    applyZoom(state.cellSize + delta, e.clientX, e.clientY);
  }, { passive: false });

  // ピンチ（タッチ）
  let pinchDist0 = null, pinchSize0 = null, pinchMidX = 0, pinchMidY = 0;
  canvasWrapper.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      pinchDist0 = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      pinchSize0 = state.cellSize;
      pinchMidX  = (t0.clientX + t1.clientX) / 2;
      pinchMidY  = (t0.clientY + t1.clientY) / 2;
    }
  }, { passive: true });
  canvasWrapper.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || pinchDist0 === null) return;
    e.preventDefault();
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    applyZoom(pinchSize0 * (dist / pinchDist0), pinchMidX, pinchMidY);
  }, { passive: false });
  canvasWrapper.addEventListener('touchend', () => { pinchDist0 = null; });

  // ── 初期レンダリング ─────────────────────────────────────
  renderAll();
  renderLandLayer();
  renderCompassIndicator();
  ui.toolbar.syncSliders(state);
  ui.toolbar.updateUndoRedo(false, false);
  ui.toolbar.syncFloor(state.currentFloor);

  setInterval(() => saveProject(state), AUTOSAVE_INTERVAL);
});
