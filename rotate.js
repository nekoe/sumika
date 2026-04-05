// 間取り90度回転

import { state, ui } from './state.js';
import { createGrid, rebuildGrid } from './grid.js';
import { edgeKey } from './walls.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';

let _renderAll = null;
let _syncSliders = null;

export function initRotate({ renderAll, syncSliders }) {
  _renderAll    = renderAll;
  _syncSliders  = syncSliders;
}

export function rotateFloorPlan(cw) {
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

  ui.grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(ui.grid, state.rooms);
  _renderAll?.();
  _syncSliders?.(state);
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
  const CW  = { n: 'e', e: 's', s: 'w', w: 'n' };
  const CCW = { n: 'w', w: 's', s: 'e', e: 'n' };
  const o = { ...s };
  if (cw) { o.x = oldRows - s.y - s.h; o.y = s.x;             o.dir = CW[s.dir  || 'n']; }
  else    { o.x = s.y;                  o.y = oldCols - s.x - s.w; o.dir = CCW[s.dir || 'n']; }
  o.w = s.h; o.h = s.w;
  return o;
}
