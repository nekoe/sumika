// 壁・建具SVGレイヤーのマウスイベントハンドラ

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { getEdgeAt, edgeKey, renderWallLayer } from './walls.js';

// initWallHandlers で設定されるコールバック（モジュールスコープで保持）
let _updateInspector = () => {};
let _getGridEl = () => null;

// 壁ドラッグ描画の状態
let wallDragging = false;
let wallDragStart = null;
let wallDragStartX = 0;
let wallDragStartY = 0;
let wallDragPreviewEdges = [];
let dragJustCommitted = false;

export function initWallHandlers(svgEl, { getGridEl, updateInspector }) {
  _updateInspector = updateInspector;
  _getGridEl = getGridEl;

  // ── mousedown ──
  svgEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    if (state.mode === 'eraser') {
      e.preventDefault();
      const edge = getEdgeAt(e, _getGridEl(), state.cellSize);
      if (!edge) return;
      pushUndo();
      ui.eraserDragging = true;
      eraseAtEdge(edge, svgEl);
      return;
    }

    if (isPassThrough()) return;

    const edge = getEdgeAt(e, _getGridEl(), state.cellSize);
    if (!edge) return;
    e.preventDefault();
    wallDragging = true;
    wallDragStart = edge;
    wallDragStartX = e.clientX;
    wallDragStartY = e.clientY;
    wallDragPreviewEdges = [edge];
  });

  // ── SVG mousemove: ホバープレビュー（ドラッグ中はdocumentレベルで処理）──
  svgEl.addEventListener('mousemove', e => {
    if (isPassThrough() || wallDragging) return;
    ui.hoveredEdge = getEdgeAt(e, _getGridEl(), state.cellSize);

    if (state.mode === 'eraser') {
      if (ui.eraserDragging) eraseAtEdge(ui.hoveredEdge, svgEl);
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
        null, state.mode, ui.selectedElementKey);
      return;
    }

    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
      ui.hoveredEdge, state.mode, ui.selectedElementKey);
  });

  // ── document mousemove: ドラッグプレビュー（SVG外でも機能）──
  document.addEventListener('mousemove', e => {
    if (!wallDragging || !wallDragStart) return;
    const rect = _getGridEl().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    wallDragPreviewEdges = collectEdgesTo(wallDragStart, px, py);
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
      null, state.mode, ui.selectedElementKey, wallDragPreviewEdges);
  });

  // ── mouseleave ──
  svgEl.addEventListener('mouseleave', () => {
    if (wallDragging) return;
    ui.hoveredEdge = null;
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
      null, state.mode, ui.selectedElementKey);
  });

  // ── document mouseup: ドラッグ確定 ──
  document.addEventListener('mouseup', e => {
    // 消しゴム終了
    if (ui.eraserDragging) {
      ui.eraserDragging = false;
      saveProject(state);
      return;
    }

    if (!wallDragging) return;

    const dx = e.clientX - wallDragStartX;
    const dy = e.clientY - wallDragStartY;
    const isDrag = Math.hypot(dx, dy) > 5 && wallDragPreviewEdges.length > 1;

    if (isDrag) {
      // ドラッグ確定: 複数辺を一括配置
      pushUndo();
      for (const edge of wallDragPreviewEdges) {
        applyEdge(edge);
      }
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
        null, state.mode, ui.selectedElementKey);
      _updateInspector();
      saveProject(state);
      // 直後のclickイベントを抑制
      dragJustCommitted = true;
      setTimeout(() => { dragJustCommitted = false; }, 10);
    }

    wallDragging = false;
    wallDragStart = null;
    wallDragPreviewEdges = [];
  });

  // ── click: 単一配置・ドア選択 ──
  svgEl.addEventListener('click', e => {
    if (dragJustCommitted) return;
    if (isPassThrough() || state.mode === 'eraser') return;

    const edge = getEdgeAt(e, _getGridEl(), state.cellSize);
    if (!edge) {
      if (ui.selectedElementKey) {
        ui.selectedElementKey = null;
        renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
          ui.hoveredEdge, state.mode, null);
        _updateInspector();
      }
      return;
    }

    const key = edgeKey(edge.col, edge.row, edge.dir);
    const existing = state.elements.find(el => edgeKey(el.col, el.row, el.dir) === key);
    if (existing && existing.type === 'door' && state.mode === 'door') {
      ui.selectedElementKey = ui.selectedElementKey === key ? null : key;
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
        ui.hoveredEdge, state.mode, ui.selectedElementKey);
      _updateInspector();
      return;
    }

    ui.selectedElementKey = null;
    handleElementClick(edge, svgEl);
  });

  // ── contextmenu: ドアflip ──
  svgEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.mode !== 'door') return;
    const edge = getEdgeAt(e, _getGridEl(), state.cellSize);
    if (!edge) return;
    const key = edgeKey(edge.col, edge.row, edge.dir);
    const el = state.elements.find(el => edgeKey(el.col, el.row, el.dir) === key && el.type === 'door');
    if (el) {
      pushUndo();
      el.flip = !el.flip;
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
        ui.hoveredEdge, state.mode, ui.selectedElementKey);
      saveProject(state);
    }
  });
}

// ── ヘルパー関数 ─────────────────────────────────────────────

function isPassThrough() {
  return ['room', 'stair', 'furniture', 'land', 'landscape'].includes(state.mode);
}

/**
 * 開始辺の dir に軸を固定し、ドラッグ先座標(px, py)までの辺を列挙する
 * - dir='h': row を固定して col を変化させる（横方向の連続辺）
 * - dir='v': col を固定して row を変化させる（縦方向の連続辺）
 */
function collectEdgesTo(startEdge, px, py) {
  const cs = state.cellSize;
  const { dir, col: startCol, row: startRow } = startEdge;
  const edges = [];

  if (dir === 'h') {
    const endCol = Math.min(Math.max(0, Math.floor(px / cs)), state.gridCols - 1);
    const colMin = Math.min(startCol, endCol);
    const colMax = Math.max(startCol, endCol);
    for (let col = colMin; col <= colMax; col++) {
      edges.push({ dir: 'h', col, row: startRow });
    }
  } else {
    const endRow = Math.min(Math.max(0, Math.floor(py / cs)), state.gridRows - 1);
    const rowMin = Math.min(startRow, endRow);
    const rowMax = Math.max(startRow, endRow);
    for (let row = rowMin; row <= rowMax; row++) {
      edges.push({ dir: 'v', col: startCol, row });
    }
  }
  return edges;
}

/**
 * ドラッグ配置: 同種はスキップ、異種は置換、なければ追加（トグルしない）
 */
function applyEdge(edge) {
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const existIdx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  if (existIdx !== -1) {
    if (state.elements[existIdx].type === state.mode) return;
    state.elements[existIdx] = { id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir, color: state.wallColor };
  } else {
    state.elements.push({ id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir, color: state.wallColor });
  }
}

function eraseAtEdge(edge, svgEl) {
  if (!edge) return;
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const idx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  if (idx === -1) return;
  if (ui.selectedElementKey === key) ui.selectedElementKey = null;
  state.elements.splice(idx, 1);
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
    null, state.mode, ui.selectedElementKey);
  _updateInspector();
}

function handleElementClick(edge, svgEl) {
  const key      = edgeKey(edge.col, edge.row, edge.dir);
  const existIdx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  pushUndo();
  if (existIdx !== -1) {
    const exist = state.elements[existIdx];
    if (exist.type === state.mode) state.elements.splice(existIdx, 1);
    else state.elements[existIdx] = { id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir, color: state.wallColor };
  } else {
    state.elements.push({ id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir, color: state.wallColor });
  }
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows,
    ui.hoveredEdge, state.mode, ui.selectedElementKey);
  _updateInspector();
  saveProject(state);
}
