import { createGrid, canPlace, canPlaceCells, placeRoomCells, removeRoom, rebuildGrid } from './grid.js';
import { renderPalette, createRoomData, getTypeById, calcAreaCells, CELL_M } from './rooms.js';
import { initDnd } from './dnd.js';
import { attachResizeHandles } from './resize.js';
import { saveProject, loadProject, exportJSON, importJSON, resetProject } from './storage.js';
import { initToolbar } from './toolbar.js';
import { initWallLayer, renderWallLayer, getEdgeAt, edgeKey, ELEMENT_TOOLS } from './walls.js';
import { startWalkthrough } from './walkthrough.js';
import { getFurnitureTypeById } from './furniture.js';
import { initLandLayer, renderLand, getLandPos, distPx, calcLandArea, getHitVertex, calcCentroid, rotatePointsAround, isPointInPolygon } from './land.js';

const AUTOSAVE_INTERVAL = 5000; // ms

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
  wallColor: '#1e293b',
  furnitureType: 'kitchen',
  compass: 0,
  sunHour: 12,
  stairConfig: { w: 2, h: 3, dir: 'n' },
  land: { points: [], closed: false },
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
let landSvg = null;
let landPreview = null;
let landDragIdx = -1;   // ドラッグ中の頂点インデックス（-1=なし）
let landDragged = false; // ドラッグが発生したか（click誤発火防止）
let landRotating = false;          // 回転ハンドルドラッグ中
let landRotateCenter = null;       // 回転中心（セル座標）
let landRotateStartAngle = 0;      // ドラッグ開始時の角度
let landRotateStartPoints = null;  // ドラッグ開始時の頂点スナップショット
let landMoving = false;            // ポリゴン移動ドラッグ中
let landMoveStartPos = null;       // 移動開始時のマウス座標（セル）
let landMoveStartPoints = null;    // 移動開始時の頂点スナップショット
let landMoved = false;             // 移動が発生したか
let hoveredEdge = null;
let selectedId = null;
let selectedStairId = null;
let selectedFurnitureId = null;
let multiSelected = new Set();
let eraserDragging = false; // 消しゴムドラッグ中

// 複数選択中の ID 集合（room/stair/furniture）
let multiMoveDragging = false;
let multiIncludesElements = false;   // 全選択時に建具も移動対象に含める
let multiIncludesAllFloors = false;  // 全選択時に全フロアを移動対象に含める

// セル編集
let paintCells    = null;
let paintMode     = null;   // 'add' | 'remove'
let paintCanvas   = null;
let editingRoomId = null;   // セル編集中の部屋ID

// ============================================================
// 初期化
// ============================================================
// フロアデータをstateに適用する共通処理（初期化・インポート共用）
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
    // 旧フォーマット（floors なし）を移行
    state.floors[0].rooms    = data.rooms    ?? [];
    state.floors[0].elements = data.elements ?? [];
  }
  state.land = data.land ?? { points: [], closed: false };
  state.floors.forEach(f => f.rooms.forEach(r => normalizeCells(r)));
  syncStairsBetweenFloors();
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = loadProject();
  if (saved) applyProjectData(saved);

  grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);

  renderPalette(document.getElementById('palette'));
  svgEl = initWallLayer(document.getElementById('grid'));
  landSvg = initLandLayer(document.getElementById('grid'));

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
      undoStack = [];
      redoStack = [];
      applyProjectData(data);
      grid = createGrid(state.gridCols, state.gridRows);
      rebuildGrid(grid, state.rooms);
      renderAll();
      toolbar.syncSliders(state);
      toolbar.syncFloor(state.currentFloor);
      toolbar.syncStairConfig(state.stairConfig);
      toolbar.syncWallColor(state.wallColor);
      renderCompassIndicator();
      showToast('読み込みました');
    }, msg => alert(msg)),
    onRotate:        (dir) => rotateFloorPlan(dir > 0),
    onWalkthrough:   () => startWalkthrough(state),
    onPrint:         () => handlePrint(),
    onExportSVG:     () => exportSVG(),
    onExportPNG:     () => exportPNG(),
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
        landPreview = null;
        renderLandLayer();
        saveProject(state);
      } catch { alert('土地形状の読み込みに失敗しました。'); }
    },
    onLandClear: () => {
      pushUndo();
      state.land = { points: [], closed: false };
      landPreview = null;
      renderLandLayer();
      saveProject(state);
    },
    onWallColorChange: (color) => {
      state.wallColor = color;
      state.elements.forEach(el => { el.color = color; });
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
      saveProject(state);
    },
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
    if (e.key === 'Escape' && state.mode === 'land' && !state.land?.closed) {
      // 描画中（未完成）のみキャンセル。閉じたポリゴンはそのまま保持
      state.land = { points: [], closed: false };
      landPreview = null;
      renderLandLayer();
      saveProject(state);
      return;
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
  svgEl.addEventListener('mousedown', e => {
    if (state.mode !== 'eraser') return;
    e.preventDefault();
    const edge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    if (!edge) return;
    pushUndo();
    eraserDragging = true;
    eraseAtEdge(edge);
  });
  document.addEventListener('mouseup', () => {
    if (!eraserDragging) return;
    eraserDragging = false;
    saveProject(state);
  });
  svgEl.addEventListener('mousemove', e => {
    if (state.mode === 'room' || state.mode === 'stair') return;
    hoveredEdge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    if (state.mode === 'eraser') {
      if (eraserDragging) eraseAtEdge(hoveredEdge);
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
      return;
    }
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  });
  svgEl.addEventListener('mouseleave', () => {
    hoveredEdge = null;
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
  });
  svgEl.addEventListener('click', e => {
    if (state.mode === 'room' || state.mode === 'stair' || state.mode === 'eraser') return;
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

  // 土地描画モード
  const gridElForLand = document.getElementById('grid');

  // 頂点ドラッグ・回転・移動 開始
  gridElForLand.addEventListener('mousedown', e => {
    if (state.mode !== 'land') return;
    const cs = state.cellSize;
    const pos = getLandPos(e, gridElForLand, cs);

    // 頂点ヒット判定（頂点操作が最優先）
    const idx = getHitVertex(e, gridElForLand, cs, state.land);
    if (idx !== -1) {
      e.preventDefault();
      pushUndo();
      // 赤い頂点（idx===0）かつ閉じたポリゴン → 回転
      if (idx === 0 && state.land?.closed && (state.land.points?.length ?? 0) >= 3) {
        const c = calcCentroid(state.land.points);
        landRotating = true;
        landRotateCenter = c;
        landRotateStartAngle = Math.atan2(pos.y - c.y, pos.x - c.x);
        landRotateStartPoints = state.land.points.map(p => ({ ...p }));
      } else {
        // その他の頂点 → 頂点移動
        landDragIdx = idx;
        landDragged = false;
      }
      return;
    }

    // ポリゴン内部クリック → 全体移動
    if (state.land?.closed && (state.land.points?.length ?? 0) >= 3) {
      if (isPointInPolygon(pos, state.land.points)) {
        e.preventDefault();
        pushUndo();
        landMoving = true;
        landMoveStartPos = pos;
        landMoveStartPoints = state.land.points.map(p => ({ ...p }));
        landMoved = false;
      }
    }
  });

  // ドラッグ終了
  document.addEventListener('mouseup', () => {
    if (landRotating) {
      landRotating = false;
      landRotateStartPoints = null;
      saveProject(state);
      return;
    }
    if (landMoving) {
      landMoving = false;
      landMoveStartPos = null;
      landMoveStartPoints = null;
      if (landMoved) saveProject(state);
      landMoved = false;
      return;
    }
    if (landDragIdx < 0) return;
    landDragIdx = -1;
    if (landDragged) saveProject(state);
    landDragged = false;
  });

  gridElForLand.addEventListener('mousemove', e => {
    if (state.mode !== 'land') return;
    const cs = state.cellSize;

    // 回転ドラッグ中
    if (landRotating && landRotateStartPoints) {
      const pos = getLandPos(e, gridElForLand, cs);
      const angle = Math.atan2(pos.y - landRotateCenter.y, pos.x - landRotateCenter.x);
      const delta = angle - landRotateStartAngle;
      state.land = {
        ...state.land,
        points: rotatePointsAround(landRotateStartPoints, landRotateCenter.x, landRotateCenter.y, delta),
      };
      renderLandLayer();
      return;
    }

    // ポリゴン移動ドラッグ中
    if (landMoving && landMoveStartPoints) {
      const pos = getLandPos(e, gridElForLand, cs);
      const dx = pos.x - landMoveStartPos.x;
      const dy = pos.y - landMoveStartPos.y;
      state.land = {
        ...state.land,
        points: landMoveStartPoints.map(p => ({ x: p.x + dx, y: p.y + dy })),
      };
      landMoved = true;
      renderLandLayer();
      return;
    }

    // 頂点ドラッグ中
    if (landDragIdx >= 0) {
      const pos = getLandPos(e, gridElForLand, cs);
      const pts = [...(state.land?.points ?? [])];
      pts[landDragIdx] = pos;
      state.land = { ...state.land, points: pts };
      landDragged = true;
      renderLandLayer();
      return;
    }

    // カーソル変更（頂点・ポリゴン内部ホバー時）
    const pos2 = getLandPos(e, gridElForLand, cs);
    const hitIdx = getHitVertex(e, gridElForLand, cs, state.land);
    if (hitIdx === 0 && state.land?.closed) {
      gridElForLand.style.cursor = 'crosshair'; // 赤い頂点 → 回転
    } else if (hitIdx > 0) {
      gridElForLand.style.cursor = 'grab';       // その他の頂点 → 移動
    } else if (state.land?.closed && isPointInPolygon(pos2, state.land.points ?? [])) {
      gridElForLand.style.cursor = 'move';       // ポリゴン内部 → 全体移動
    } else {
      gridElForLand.style.cursor = '';
    }

    // 描画中プレビュー
    if (!state.land?.closed && (state.land?.points?.length ?? 0) > 0) {
      landPreview = getLandPos(e, gridElForLand, state.cellSize);
    } else {
      landPreview = null;
    }
    renderLandLayer();
  });

  gridElForLand.addEventListener('mouseleave', e => {
    if (state.mode !== 'land') return;
    gridElForLand.style.cursor = '';
    landPreview = null;
    renderLandLayer();
  });

  gridElForLand.addEventListener('click', e => {
    if (state.mode !== 'land') return;
    if (landDragged) { landDragged = false; return; } // ドラッグ後のclick誤発火を無視
    if (state.land?.closed) return;
    const pos = getLandPos(e, gridElForLand, state.cellSize);
    const land = state.land ?? { points: [], closed: false };
    if (land.points.length >= 3 && distPx(pos, land.points[0], state.cellSize) < 12) {
      pushUndo();
      state.land = { ...land, closed: true };
      landPreview = null;
      renderLandLayer();
      saveProject(state);
      return;
    }
    pushUndo();
    state.land = { ...land, points: [...land.points, pos] };
    renderLandLayer();
    saveProject(state);
  });

  renderAll();
  renderLandLayer();
  renderCompassIndicator();
  toolbar.syncSliders(state);
  toolbar.updateUndoRedo(false, false);
  toolbar.syncFloor(state.currentFloor);
  toolbar.syncStairConfig(state.stairConfig);

  setInterval(() => saveProject(state), AUTOSAVE_INTERVAL);
});

// ============================================================
// ユーティリティ
// ============================================================
function getGridCell(e) {
  const rect = document.getElementById('grid').getBoundingClientRect();
  return {
    col: Math.floor((e.clientX - rect.left) / state.cellSize),
    row: Math.floor((e.clientY - rect.top)  / state.cellSize),
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
  const CORNERS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CURSORS  = { nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize', e: 'e-resize', se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize' };
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

// 旧データ（矩形形式）をセルベースに変換し、isDoma を補完
function normalizeCells(room) {
  if (!room.cells || room.cells.length === 0) {
    room.cells = [];
    for (let r = room.y; r < room.y + room.h; r++)
      for (let c = room.x; c < room.x + room.w; c++)
        room.cells.push(`${c},${r}`);
  }
  if (room.isDoma === undefined) {
    room.isDoma = (room.typeId === 'doma' || room.typeId === 'genkan');
  }
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
  if (mode !== 'room' && mode !== 'stair' && mode !== 'furniture' && mode !== 'land') state.elementTool = mode;
  paintCells = null;
  paintMode  = null;
  editingRoomId = null;
  renderPaintPreview();
  if (mode !== 'room') selectRoom(null);
  if (mode !== 'stair') { selectedStairId = null; renderStairs(); }
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
  landPreview = null;
  landDragIdx = -1;
  landRotating = false;
  landRotateStartPoints = null;
  landMoving = false;
  landMoveStartPos = null;
  landMoveStartPoints = null;
  document.getElementById('grid').style.cursor = '';
  renderLandLayer();
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
  renderLandLayer();
  updateInspector();
  toolbar?.updateUndoRedo(undoStack.length > 0, redoStack.length > 0);
}

function renderLandLayer() {
  if (!landSvg) return;
  renderLand(landSvg, state.land, state.cellSize, state.gridCols, state.gridRows, landPreview);
  if (state.land?.closed && state.land.points.length >= 3) {
    toolbar?.updateLandArea(calcLandArea(state.land.points));
  } else {
    toolbar?.updateLandArea(0);
  }
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
  if (landSvg) {
    landSvg.setAttribute('width',  state.gridCols * cs);
    landSvg.setAttribute('height', state.gridRows * cs);
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

    // カーソル下の部屋をそのままドラッグで移動（編集モード・複数選択中を除く）
    cell.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      if (multiSelected.size > 0) return;
      if (editingRoomId === room.id) return;
      if (state.mode !== 'room') {
        handleModeChange('room'); toolbar.setMode('room');
        selectRoom(room.id);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      selectRoom(room.id);
      startRoomMoveDrag(e, room);
    });

    cell.addEventListener('click', e => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { toggleMultiSelect(room.id); return; }
      if (multiSelected.size > 0) { clearMultiSelected(); return; }
      // mousedown で selectRoom 済みのため通常クリックは何もしない
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
      e.stopPropagation();
      if (state.mode !== 'stair') {
        handleModeChange('stair'); toolbar.setMode('stair');
        selectedStairId = s.id;
        updateInspector(); renderStairs();
        return;
      }
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
    const displayColor = furn.color ?? ftype.color;
    const displayIcon  = furn.icon  ?? ftype.icon;
    const displayLabel = furn.label ?? ftype.label;
    const div = document.createElement('div');
    const isSelected = furn.id === selectedFurnitureId;
    div.className = 'furniture-block' + (isSelected ? ' selected' : '') + (multiSelected.has(furn.id) ? ' multi-selected' : '');
    div.dataset.id = furn.id;
    div.dataset.x  = furn.x; div.dataset.y = furn.y;
    div.dataset.w  = furn.w; div.dataset.h = furn.h;
    div.style.cssText = `left:${furn.x*cs}px;top:${furn.y*cs}px;width:${furn.w*cs}px;height:${furn.h*cs}px;background-color:${displayColor};`;
    div.innerHTML = `
      <span class="furn-icon">${displayIcon}</span>
      <span class="furn-label">${displayLabel}</span>
      <button class="furn-delete" title="削除">×</button>`;

    // 削除ボタン
    div.querySelector('.furn-delete').addEventListener('click', e => {
      e.stopPropagation();
      pushUndo();
      state.furniture = state.furniture.filter(f => f.id !== furn.id);
      selectedFurnitureId = null;
      renderFurniture();
      updateInspector();
      saveProject(state);
    });

    // クリックで選択
    div.addEventListener('click', e => {
      if (e.target.closest('.resize-handle')) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) { toggleMultiSelect(furn.id); return; }
      if (multiSelected.size > 0) { clearMultiSelected(); return; }
      if (state.mode !== 'furniture') {
        handleModeChange('furniture'); toolbar.setMode('furniture');
      }
      selectedFurnitureId = (selectedFurnitureId === furn.id) ? null : furn.id;
      renderFurniture();
      updateInspector();
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

function startLabelEdit(labelDiv, room) {
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

// dnd.js の onMove コールバック。全部屋はセルベースのため実質未使用
function handleMove(roomId, newX, newY) {
  const room = state.rooms.find(r => r.id === roomId);
  if (!room) return;
  // セルベース部屋の移動は startRoomMoveDrag で処理
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
  o.cells = r.cells.map(key => {
    const [c, ro] = key.split(',').map(Number);
    return cw ? `${oldRows - 1 - ro},${c}` : `${ro},${oldCols - 1 - c}`;
  });
  const cs2 = o.cells.map(k => +k.split(',')[0]);
  const rs2 = o.cells.map(k => +k.split(',')[1]);
  o.x = Math.min(...cs2); o.y = Math.min(...rs2);
  o.w = Math.max(...cs2) - o.x + 1; o.h = Math.max(...rs2) - o.y + 1;
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
function eraseAtEdge(edge) {
  if (!edge) return;
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const idx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  if (idx === -1) return;
  state.elements.splice(idx, 1);
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
  updateInspector();
}

function handleElementClick(edge) {
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const existIdx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  pushUndo();
  if (existIdx !== -1) {
    const exist = state.elements[existIdx];
    if (exist.type === state.mode) state.elements.splice(existIdx, 1);
    else state.elements[existIdx] = { id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir, color: state.wallColor };
  } else {
    state.elements.push({ id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir, color: state.wallColor });
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
  multiIncludesElements = true;
  multiIncludesAllFloors = true;
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
  multiIncludesElements = false;
  multiIncludesAllFloors = false;
  renderAll();
  updateInspector();
}

function computeClampedDelta(dx, dy) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of multiSelected) {
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
  if (multiIncludesElements && svgEl) {
    svgEl.style.transform = `translate(${dx*cs}px,${dy*cs}px)`;
  }
}

function clearMultiMovePreview() {
  for (const id of multiSelected) {
    document.querySelectorAll(`.room-block[data-id="${id}"], .room-cell[data-room-id="${id}"], .room-label-block[data-id="${id}"], .stair-block[data-id="${id}"], .furniture-block[data-id="${id}"]`).forEach(el => {
      el.style.transform = '';
      el.style.zIndex = '';
    });
  }
  if (svgEl) svgEl.style.transform = '';
}

function commitMultiMove(dx, dy) {
  if (dx === 0 && dy === 0) return;
  pushUndo();
  for (const id of multiSelected) {
    const room = state.rooms.find(r => r.id === id);
    if (room) {
      const newCells = room.cells.map(k => {
        const [c, r] = k.split(',').map(Number);
        return `${c+dx},${r+dy}`;
      });
      removeRoom(grid, room.id);
      room.cells = newCells;
      updateIrregularRoomBounds(room);
      placeRoomCells(grid, room.id, newCells);
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
  if (multiIncludesElements) {
    for (const el of (state.elements || [])) {
      el.col += dx;
      el.row += dy;
    }
  }
  if (multiIncludesAllFloors) {
    const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
    const otherFloor = state.floors[otherFloorIdx];
    for (const room of (otherFloor.rooms || [])) {
      room.cells = room.cells.map(k => {
        const [c, r] = k.split(',').map(Number);
        return `${c+dx},${r+dy}`;
      });
      updateIrregularRoomBounds(room);
    }
    for (const el of (otherFloor.elements || [])) {
      el.col += dx;
      el.row += dy;
    }
    for (const furn of (otherFloor.furniture || [])) {
      furn.x += dx;
      furn.y += dy;
    }
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

  // 建具モード（ELEMENT_TOOLS に含まれる全種別）
  if (ELEMENT_TOOLS.some(t => t.id === state.mode)) {
    renderElementInspector(panel);
    return;
  }

  // 階段選択中
  if (selectedStairId && state.mode === 'stair') {
    const stair = state.stairs.find(s => s.id === selectedStairId);
    if (stair) { renderStairInspector(panel, stair); return; }
  }

  // 家具選択中
  if (selectedFurnitureId && state.mode === 'furniture') {
    const furn = (state.furniture || []).find(f => f.id === selectedFurnitureId);
    if (furn) { renderFurnitureInspector(panel, furn); return; }
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
  const buildTools = ELEMENT_TOOLS.filter(t => !t.eraser);
  for (const t of buildTools) counts[t.id] = els.filter(e => e.type === t.id).length;
  const total = els.length;

  const rows = buildTools.map(t => `
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
// ============================================================
// PDF出力
// ============================================================
function handlePrint() {
  const gridEl = document.getElementById('grid');
  const gridW  = state.gridCols * state.cellSize;
  const gridH  = state.gridRows * state.cellSize;

  // A4縦 印刷可能域（余白込み）: 約680 × 960px
  const printW = 680, printH = 960;
  const scale  = Math.min(printW / gridW, printH / gridH, 1);

  // ヘッダー内容を設定
  const headerEl = document.getElementById('print-header');
  const floorLabel = `${state.currentFloor + 1}F`;
  const rooms = state.rooms.filter(r => r.typeId !== 'garage');
  const cellCount = rooms.reduce((s, r) => s + (r.cells?.length ?? 0), 0);
  const sqm   = (cellCount * CELL_M * CELL_M).toFixed(1);
  const tsubo = (cellCount / 4).toFixed(2);
  const dateStr = new Date().toLocaleDateString('ja-JP');
  headerEl.innerHTML =
    `<b>間取り図</b>&ensp;${floorLabel}&ensp;` +
    `延床面積: <b>${sqm}㎡</b>（${tsubo}坪）&ensp;` +
    `<span class="print-date">${dateStr}</span>`;

  // グリッドをスケール（印刷後に復元）
  gridEl.style.transformOrigin = 'top left';
  gridEl.style.transform  = `scale(${scale})`;
  gridEl.style.marginRight  = `${gridW  * (scale - 1)}px`;
  gridEl.style.marginBottom = `${gridH * (scale - 1)}px`;

  document.body.classList.add('printing');

  const restore = () => {
    gridEl.style.transform    = '';
    gridEl.style.marginRight  = '';
    gridEl.style.marginBottom = '';
    headerEl.innerHTML = '';
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

// ============================================================
// SVG/PNGエクスポート共通
// ============================================================
function buildSVGString() {
  const cs = state.cellSize;
  const W  = state.gridCols * cs;
  const H  = state.gridRows * cs;

  const DIRS_LABEL = { n: '↑', s: '↓', e: '→', w: '←' };

  // 埋め込みCSS（壁・ドア・窓・土地の描画スタイル）
  const css = `
    .el-wall { stroke: #1e293b; stroke-width: 5; stroke-linecap: round; }
    .el-lowwall line { stroke: #64748b; stroke-width: 2; stroke-linecap: round; }
    .el-door-gap { stroke: #fff; stroke-width: 6; }
    .el-door-panel { stroke: #7c3aed; stroke-width: 2; }
    .el-door-arc { stroke: #7c3aed; stroke-width: 1.5; fill: none; }
    .el-window line:nth-child(1), .el-window line:nth-child(3) { stroke: #0ea5e9; stroke-width: 2; }
    .el-window line:nth-child(2) { stroke: #0ea5e9; stroke-width: 4; }
    .el-window-tall line:nth-child(1), .el-window-tall line:nth-child(3) { stroke: #0284c7; stroke-width: 2; }
    .el-window-tall line:nth-child(2) { stroke: #0284c7; stroke-width: 6; }
    .el-window-low line:nth-child(1), .el-window-low line:nth-child(3) { stroke: #38bdf8; stroke-width: 1.5; stroke-dasharray: 4 2; }
    .el-window-low line:nth-child(2) { stroke: #38bdf8; stroke-width: 3; }
    .land-fill { fill: rgba(34,197,94,0.12); stroke: none; }
    .land-seg { stroke: #16a34a; stroke-width: 2; }
    .land-point { fill: #16a34a; stroke: #fff; stroke-width: 1.5; }
    .land-first { fill: #dc2626; }
    .land-label-bg { fill: rgba(255,255,255,0.9); }
    .land-label { font-size: 11px; fill: #166534; font-family: sans-serif; }
  `;

  let inner = '';

  // 白背景
  inner += `<rect width="${W}" height="${H}" fill="#fff"/>`;

  // グリッド線
  inner += `<g stroke="#e2e8f0" stroke-width="0.5">`;
  for (let c = 0; c <= state.gridCols; c++) {
    inner += `<line x1="${c*cs}" y1="0" x2="${c*cs}" y2="${H}"/>`;
  }
  for (let r = 0; r <= state.gridRows; r++) {
    inner += `<line x1="0" y1="${r*cs}" x2="${W}" y2="${r*cs}"/>`;
  }
  inner += `</g>`;

  // 土地ポリゴン (fill)
  const land = state.land;
  if (land?.closed && land.points.length >= 3) {
    const ptStr = land.points.map(p => `${p.x * cs},${p.y * cs}`).join(' ');
    inner += `<polygon points="${ptStr}" class="land-fill"/>`;
  }

  // 部屋セル・ラベル・階段
  const allFloorData = state.floors;
  for (let fi = 0; fi < allFloorData.length; fi++) {
    const fl = allFloorData[fi];
    const opacity = fi === state.currentFloor ? 1 : 0.35;
    for (const room of (fl.rooms || [])) {
      const type = getTypeById(room.typeId);
      const color = room.color || type.color;
      for (const key of (room.cells || [])) {
        const [col, row] = key.split(',').map(Number);
        inner += `<rect x="${col*cs}" y="${row*cs}" width="${cs}" height="${cs}" fill="${color}" opacity="${opacity}"/>`;
      }
      if (fi === state.currentFloor) {
        const rx = room.x * cs, ry = room.y * cs;
        const rw = room.w * cs, rh = room.h * cs;
        const cx = rx + rw / 2, cy = ry + rh / 2;
        const icon = room.icon ?? type.icon;
        const { tatami } = calcAreaCells(room.cells);
        const STRIP_H = 16;
        inner += `<rect x="${rx}" y="${ry}" width="${rw}" height="${STRIP_H}" fill="rgba(255,255,255,0.55)"/>`;
        inner += `<text x="${rx + 5}" y="${ry + 11}" font-size="10" font-weight="600" font-family="sans-serif" fill="rgba(0,0,0,0.8)">${escSVG(room.label)}</text>`;
        inner += `<text x="${rx + rw - 5}" y="${ry + 11}" text-anchor="end" font-size="10" font-family="sans-serif" fill="#6b7280">${escSVG(tatami)}畳</text>`;
        inner += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="20" font-family="sans-serif">${escSVG(icon)}</text>`;
      }
    }
    for (const s of (fl.stairs || [])) {
      const opacity2 = fi === state.currentFloor ? 1 : 0.3;
      inner += `<rect x="${s.x*cs}" y="${s.y*cs}" width="${s.w*cs}" height="${s.h*cs}" fill="url(#stair-stripe)" stroke="#b8a080" stroke-width="1" stroke-dasharray="4 3" opacity="${opacity2}" rx="2"/>`;
      if (fi === state.currentFloor) {
        const scx = (s.x + s.w / 2) * cs;
        const scy = (s.y + s.h / 2) * cs;
        const arrow = DIRS_LABEL[s.dir || 'n'];
        inner += `<text x="${scx}" y="${scy + 5}" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#475569">🪜${escSVG(arrow)}</text>`;
      }
    }
  }

  // 家具（カレントフロア）
  for (const furn of (state.furniture || [])) {
    const ftype = getFurnitureTypeById(furn.typeId);
    inner += `<rect x="${furn.x*cs}" y="${furn.y*cs}" width="${furn.w*cs}" height="${furn.h*cs}" fill="${ftype.color}" stroke="#cbd5e1" stroke-width="0.5" rx="2"/>`;
    const fcx = (furn.x + furn.w / 2) * cs;
    const fcy = (furn.y + furn.h / 2) * cs;
    inner += `<text x="${fcx}" y="${fcy - 4}" text-anchor="middle" font-size="14" font-family="sans-serif">${escSVG(ftype.icon)}</text>`;
    inner += `<text x="${fcx}" y="${fcy + 11}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#475569">${escSVG(ftype.label)}</text>`;
  }

  // 壁・ドア・窓レイヤー
  if (svgEl) {
    const wallClone = svgEl.cloneNode(true);
    wallClone.querySelectorAll('.el-preview').forEach(n => n.remove());
    wallClone.removeAttribute('width');
    wallClone.removeAttribute('height');
    wallClone.removeAttribute('style');
    inner += `<g id="wall-layer">${wallClone.innerHTML}</g>`;
  }

  // 土地レイヤー（セグメント・ラベル・頂点のみ）
  if (landSvg) {
    const landClone = landSvg.cloneNode(true);
    landClone.querySelectorAll('.land-fill').forEach(n => n.remove());
    landClone.removeAttribute('width');
    landClone.removeAttribute('height');
    landClone.removeAttribute('style');
    inner += `<g id="land-lines">${landClone.innerHTML}</g>`;
  }

  // コンパスインジケーター（グリッド左上）
  const compassDeg = state.compass ?? 0;
  const COMPASS_LABELS = ['北↑','北東↗','東→','南東↘','南↓','南西↙','西←','北西↖'];
  const compassText = COMPASS_LABELS[Math.round(compassDeg / 45) % 8];
  inner += `
    <g transform="translate(10,10)">
      <rect width="36" height="36" rx="18" fill="rgba(255,255,255,0.85)" stroke="#e2e8f0" stroke-width="1"/>
      <text x="18" y="23" text-anchor="middle" font-size="18" font-family="sans-serif" transform="rotate(${compassDeg},18,18)">↑</text>
      <title>方位: ${escSVG(compassText)}</title>
    </g>`;

  const defs = `
  <defs>
    <style><![CDATA[${css}]]></style>
    <pattern id="stair-stripe" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="10" fill="rgba(180,160,130,0.3)"/>
      <rect x="4" width="6" height="10" fill="rgba(240,232,220,0.3)"/>
    </pattern>
  </defs>`;

  return { svgStr: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs}
  ${inner}
</svg>`, W, H };
}

function exportSVG() {
  const { svgStr } = buildSVGString();
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `madori_${state.currentFloor + 1}F_${new Date().toISOString().slice(0,10)}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPNG() {
  const { svgStr, W, H } = buildSVGString();
  const blob   = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(blob);
  const img    = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(svgUrl);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `madori_${state.currentFloor + 1}F_${new Date().toISOString().slice(0,10)}.png`;
    a.click();
  };
  img.src = svgUrl;
}

function escSVG(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 家具インスペクター ────────────────────────────────────
function renderFurnitureInspector(panel, furn) {
  const ftype = getFurnitureTypeById(furn.typeId);
  const label = furn.label ?? ftype.label;
  const icon  = furn.icon  ?? ftype.icon;
  const color = furn.color ?? ftype.color;

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${icon}</span>
      <span class="inspector-title">${label}</span>
    </div>
    <div class="inspector-body">
      <div class="inspector-row">
        <label class="inspector-label">名前</label>
        <input id="furn-insp-label" type="text" value="${label}" class="inspector-input" style="flex:1">
      </div>
      <div class="inspector-row">
        <label class="inspector-label">アイコン</label>
        <input id="furn-insp-icon" type="text" value="${icon}" class="inspector-input" style="width:60px;font-size:18px;text-align:center">
      </div>
      <div class="inspector-row">
        <label class="inspector-label">色</label>
        <input id="furn-insp-color" type="color" value="${color}" style="width:44px;height:28px;padding:0;border:none;cursor:pointer">
      </div>
    </div>`;

  const commit = () => {
    const newLabel = panel.querySelector('#furn-insp-label')?.value.trim() || label;
    const newIcon  = panel.querySelector('#furn-insp-icon')?.value || icon;
    const newColor = panel.querySelector('#furn-insp-color')?.value || color;
    pushUndo();
    furn.label = newLabel;
    furn.icon  = newIcon;
    furn.color = newColor;
    renderFurniture();
    renderFurnitureInspector(panel, furn);
    saveProject(state);
  };

  panel.querySelector('#furn-insp-label').addEventListener('change', commit);
  panel.querySelector('#furn-insp-icon').addEventListener('change', commit);
  panel.querySelector('#furn-insp-color').addEventListener('input', e => {
    furn.color = e.target.value;
    const block = document.querySelector(`.furniture-block[data-id="${furn.id}"]`);
    if (block) block.style.backgroundColor = e.target.value;
  });
  panel.querySelector('#furn-insp-color').addEventListener('change', commit);
}

function renderAreaSummary(panel) {
  const rows = state.floors.map((fl, fi) => {
    const rooms = (fl.rooms || []).filter(r => r.typeId !== 'garage');
    const cellCount = rooms.reduce((s, r) => s + r.cells.length, 0);
    const tsubo = (cellCount / 4).toFixed(2);
    const sqm   = (cellCount * CELL_M * CELL_M).toFixed(1);
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

const ICON_PICKER_EMOJIS = [
  '🏠','🛋️','🍳','🍽️','🔥','🛏️','🧸','📚','🛁','🚽','🚿','🚪','👟','➡️','📦','🚗','🌿','⬜','✏️',
  '🪟','🪑','🛒','🧺','🖥️','🎮','🎵','🎨','🧘','🏋️','🌱','🌊','🔑','💡','🔧','🪴','🐾','🍷','☕','🎁',
];

// ── 部屋インスペクター ────────────────────────────────────
function renderIrregularRoomInspector(panel, room) {
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcAreaCells(room.cells);
  const isEditing = editingRoomId === room.id;
  const isVoid = type.isVoid;
  const currentIcon = room.icon ?? type.icon;
  const iconBtns = ICON_PICKER_EMOJIS.map(em =>
    `<button class="icon-pick-btn${em === currentIcon ? ' active' : ''}" data-emoji="${em}">${em}</button>`
  ).join('');
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${currentIcon}</span>
      <span class="inspector-title">${room.label}${isVoid ? ' <span class="badge-void">吹き抜け</span>' : ''}</span>
    </div>
    <div class="inspector-field"><label>部屋名</label><input type="text" id="inp-label" value="${escHtml(room.label)}"></div>
    <div class="inspector-field"><label>色</label><input type="color" id="inp-color" value="${rgbToHex(room.color)}"></div>
    <div class="inspector-field" style="flex-direction:column;align-items:flex-start;gap:4px">
      <label>アイコン</label>
      <div class="icon-picker">${iconBtns}</div>
    </div>
    <div class="inspector-field">
      <label for="inp-isdoma" title="土間：床を15cm下げて段差を描画">土間（床下げ）</label>
      <input type="checkbox" id="inp-isdoma" ${room.isDoma ? 'checked' : ''}>
    </div>
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
  document.getElementById('inp-isdoma').addEventListener('change', e => {
    pushUndo();
    room.isDoma = e.target.checked;
    saveProject(state);
  });
  panel.querySelectorAll('.icon-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo();
      room.icon = btn.dataset.emoji;
      renderAll();
      saveProject(state);
    });
  });
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
  const gridEl = document.getElementById('grid');
  let ind = document.getElementById('compass-indicator');
  if (!ind) { ind = document.createElement('div'); ind.id = 'compass-indicator'; gridEl.appendChild(ind); }
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
