// 壁・建具SVGレイヤーのマウスイベントハンドラ

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { getEdgeAt, edgeKey, renderWallLayer } from './walls.js';

export function initWallHandlers(svgEl, { getGridEl, updateInspector }) {

  // 消しゴムドラッグ開始
  svgEl.addEventListener('mousedown', e => {
    if (state.mode !== 'eraser') return;
    e.preventDefault();
    const edge = getEdgeAt(e, getGridEl(), state.cellSize);
    if (!edge) return;
    pushUndo();
    ui.eraserDragging = true;
    eraseAtEdge(edge, svgEl);
  });

  document.addEventListener('mouseup', () => {
    if (!ui.eraserDragging) return;
    ui.eraserDragging = false;
    saveProject(state);
  });

  svgEl.addEventListener('mousemove', e => {
    if (state.mode === 'room' || state.mode === 'stair' || state.mode === 'furniture' || state.mode === 'land') return;
    ui.hoveredEdge = getEdgeAt(e, getGridEl(), state.cellSize);
    if (state.mode === 'eraser') {
      if (ui.eraserDragging) eraseAtEdge(ui.hoveredEdge, svgEl);
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode, ui.selectedElementKey);
      return;
    }
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, ui.selectedElementKey);
  });

  svgEl.addEventListener('mouseleave', () => {
    ui.hoveredEdge = null;
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode, ui.selectedElementKey);
  });

  svgEl.addEventListener('click', e => {
    if (state.mode === 'room' || state.mode === 'stair' || state.mode === 'eraser') return;
    const edge = getEdgeAt(e, getGridEl(), state.cellSize);
    if (!edge) {
      // 空白エリアクリック → 選択解除
      if (ui.selectedElementKey) {
        ui.selectedElementKey = null;
        renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, null);
        updateInspector();
      }
      return;
    }
    const key = edgeKey(edge.col, edge.row, edge.dir);
    const existing = state.elements.find(el => edgeKey(el.col, el.row, el.dir) === key);
    // 既存ドアを同じツールでクリック → 選択/選択解除
    if (existing && existing.type === 'door' && state.mode === 'door') {
      ui.selectedElementKey = ui.selectedElementKey === key ? null : key;
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, ui.selectedElementKey);
      updateInspector();
      return;
    }
    // その他は通常の配置/消去/置換
    ui.selectedElementKey = null;
    handleElementClick(edge, svgEl);
  });

  svgEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.mode !== 'door') return;
    const edge = getEdgeAt(e, getGridEl(), state.cellSize);
    if (!edge) return;
    const key = edgeKey(edge.col, edge.row, edge.dir);
    const el  = state.elements.find(el => edgeKey(el.col, el.row, el.dir) === key && el.type === 'door');
    if (el) {
      pushUndo();
      el.flip = !el.flip;
      renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, ui.selectedElementKey);
      saveProject(state);
    }
  });
}

function eraseAtEdge(edge, svgEl) {
  if (!edge) return;
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const idx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);
  if (idx === -1) return;
  if (ui.selectedElementKey === key) ui.selectedElementKey = null;
  state.elements.splice(idx, 1);
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode, ui.selectedElementKey);
  updateInspector();
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
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, ui.selectedElementKey);
  updateInspector();
  saveProject(state);
}
