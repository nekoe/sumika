// 右クリックコンテキストメニュー

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { generateId } from './rooms.js';
import { canPlaceCells, placeRoomCells, removeRoom } from './grid.js';
import { updateIrregularRoomBounds } from './room-utils.js';
import { selectRoom } from './selection.js';

// コールバック（app.js から注入）
let _renderAll       = null;
let _renderFurniture = null;
let _renderLandscape = null;
let _renderStairs    = null;
let _updateInspector = null;
let _handleModeChange = null;
let _showToast       = null;

let _menuEl = null;

// ── 初期化 ─────────────────────────────────────────────────────
export function initContextMenu({ renderAll, renderFurniture, renderLandscape, renderStairs, updateInspector, handleModeChange, showToast }) {
  _renderAll        = renderAll;
  _renderFurniture  = renderFurniture;
  _renderLandscape  = renderLandscape;
  _renderStairs     = renderStairs;
  _updateInspector  = updateInspector;
  _handleModeChange = handleModeChange;
  _showToast        = showToast;

  _menuEl = document.createElement('div');
  _menuEl.className = 'context-menu';
  _menuEl.hidden = true;
  document.body.appendChild(_menuEl);

  // 外クリックで非表示
  document.addEventListener('mousedown', e => {
    if (!_menuEl.hidden && !_menuEl.contains(e.target)) _hideMenu();
  });
  // Escape で非表示
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !_menuEl.hidden) { _hideMenu(); e.stopPropagation(); }
  }, { capture: true });
  // スクロールで非表示
  window.addEventListener('scroll', _hideMenu, { capture: true, passive: true });
}

/**
 * wall-handler.js の contextmenu ハンドラから呼ばれる。
 * @param {MouseEvent} e
 * @param {SVGElement} svgEl - 壁レイヤーSVG
 * @param {object|null} doorEl - door モードで辺上のドアが見つかった場合その要素、なければ null
 */
export function showContextMenu(e, svgEl, doorEl) {
  if (doorEl) {
    _showDoorMenu(e, doorEl);
    return;
  }

  // SVGを一時的に透過させてその下の要素を取得
  svgEl.style.pointerEvents = 'none';
  const underEl = document.elementFromPoint(e.clientX, e.clientY);
  svgEl.style.pointerEvents = 'all';

  const target = _detectTarget(underEl);
  if (!target) return; // 空白エリア → 何もしない（Q4）

  _autoSwitchAndSelect(target);

  const items = _buildItems(target);
  if (items.length === 0) return;
  _showMenu(items, e.clientX, e.clientY);
}

// ── ターゲット検出 ─────────────────────────────────────────────
function _detectTarget(el) {
  if (!el) return null;
  const roomCell = el.closest('.room-cell');
  if (roomCell) return { type: 'room', id: roomCell.dataset.roomId };
  const furnBlock = el.closest('.furniture-block');
  if (furnBlock) return { type: 'furniture', id: furnBlock.dataset.id };
  const stairBlock = el.closest('.stair-block');
  if (stairBlock) return { type: 'stair', id: stairBlock.dataset.id };
  const lsBlock = el.closest('.landscape-block');
  if (lsBlock) return { type: 'landscape', id: lsBlock.dataset.id };
  return null;
}

// ── モード自動切替 + 選択（Q1/Q3） ──────────────────────────────
const _TYPE_MODE = { room: 'room', furniture: 'furniture', stair: 'stair', landscape: 'landscape' };
const DIR_CW  = { n: 'e', e: 's', s: 'w', w: 'n' };
const DIR_CCW = { n: 'w', w: 's', s: 'e', e: 'n' };

function _autoSwitchAndSelect(target) {
  const newMode = _TYPE_MODE[target.type];
  if (!newMode) return;

  if (state.mode !== newMode) {
    _handleModeChange?.(newMode);
    ui.toolbar?.setMode(newMode);
  }

  switch (target.type) {
    case 'room':
      selectRoom(target.id);
      break;
    case 'furniture':
      ui.selectedFurnitureId = target.id;
      _renderFurniture?.();
      _updateInspector?.();
      break;
    case 'stair':
      ui.selectedStairId = target.id;
      _renderStairs?.();
      _updateInspector?.();
      break;
    case 'landscape':
      ui.selectedLandscapeId = target.id;
      _renderLandscape?.();
      _updateInspector?.();
      break;
  }
}

// ── メニュー項目定義 ───────────────────────────────────────────
function _buildItems(target) {
  switch (target.type) {
    case 'room':
      return [
        { label: '✏️ セルを編集',  action: () => _actionEditCells(target.id) },
        { label: '📋 複製',         action: () => _actionDuplicateRoom(target.id) },
        { separator: true },
        { label: '🗑️ 削除', danger: true, action: () => _actionDeleteRoom(target.id) },
      ];
    case 'furniture':
      return [
        { label: '↻ 右に回転', action: () => _actionRotateFurniture(target.id,  1) },
        { label: '↺ 左に回転', action: () => _actionRotateFurniture(target.id, -1) },
        { label: '📋 複製',     action: () => _actionDuplicateFurniture(target.id) },
        { separator: true },
        { label: '🗑️ 削除', danger: true, action: () => _actionDeleteFurniture(target.id) },
      ];
    case 'stair':
      return [
        { label: '🗑️ 削除', danger: true, action: () => _actionDeleteStair(target.id) },
      ];
    case 'landscape':
      return [
        { label: '📋 複製',  action: () => _actionDuplicateLandscape(target.id) },
        { separator: true },
        { label: '🗑️ 削除', danger: true, action: () => _actionDeleteLandscape(target.id) },
      ];
    default:
      return [];
  }
}

// ── ドア用メニュー ─────────────────────────────────────────────
function _showDoorMenu(e, doorEl) {
  if (state.mode !== 'door') {
    _handleModeChange?.('door');
    ui.toolbar?.setMode('door');
  }
  const key = `${doorEl.dir}:${doorEl.col}:${doorEl.row}`;
  ui.selectedElementKey = key;
  _updateInspector?.();

  _showMenu([
    { label: '🔄 蝶番を反転', action: () => _actionFlipDoor(doorEl) },
    { separator: true },
    { label: '🗑️ 削除', danger: true, action: () => _actionDeleteDoor(key) },
  ], e.clientX, e.clientY);
}

// ── メニューDOM生成・表示 ─────────────────────────────────────
function _showMenu(items, clientX, clientY) {
  _menuEl.innerHTML = '';
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    if (item.separator) {
      li.className = 'ctx-sep';
    } else {
      if (item.danger) li.classList.add('ctx-danger');
      li.textContent = item.label;
      li.addEventListener('mousedown', e => e.stopPropagation()); // 外クリック判定を妨げない
      li.addEventListener('click', () => { _hideMenu(); item.action(); });
    }
    ul.appendChild(li);
  }
  _menuEl.appendChild(ul);
  _menuEl.hidden = false;

  // ビューポート内に収める
  _menuEl.style.left = '0';
  _menuEl.style.top  = '0';
  _menuEl.style.visibility = 'hidden';
  const mw = _menuEl.offsetWidth, mh = _menuEl.offsetHeight;
  _menuEl.style.visibility = '';
  const x = Math.min(clientX, window.innerWidth  - mw - 4);
  const y = Math.min(clientY, window.innerHeight - mh - 4);
  _menuEl.style.left = `${Math.max(0, x)}px`;
  _menuEl.style.top  = `${Math.max(0, y)}px`;
}

function _hideMenu() {
  if (_menuEl) _menuEl.hidden = true;
}

// ── アクション: 部屋 ──────────────────────────────────────────
function _actionDeleteRoom(id) {
  pushUndo();
  removeRoom(ui.grid, id);
  state.rooms = state.rooms.filter(r => r.id !== id);
  ui.selectedId = null;
  _renderAll?.();
  saveProject(state);
}

function _actionEditCells(id) {
  ui.editingRoomId = ui.editingRoomId === id ? null : id;
  if (ui.editingRoomId) {
    const room = state.rooms.find(r => r.id === id);
    if (room) _showToast?.(`「${room.label}」のセルを編集中 — ドラッグで追加、既存セルをドラッグで削除`);
  }
  _renderAll?.();
  _updateInspector?.();
}

function _actionDuplicateRoom(id) {
  const orig = state.rooms.find(r => r.id === id);
  if (!orig) return;

  // 複製先候補: 右・下・左・上 の順で空きを探す
  const offsets = [[2,0],[0,2],[-2,0],[0,-2],[4,0],[0,4],[2,2]];
  let newCells = null;
  for (const [dx, dy] of offsets) {
    const candidate = orig.cells.map(k => {
      const [c, r] = k.split(',').map(Number);
      return `${c + dx},${r + dy}`;
    });
    if (canPlaceCells(ui.grid, candidate)) { newCells = candidate; break; }
  }
  if (!newCells) {
    _showToast?.('複製できる空きスペースがありません', 'error');
    return;
  }

  pushUndo();
  const dup = { ...orig, id: generateId(), cells: newCells };
  updateIrregularRoomBounds(dup);
  state.rooms.push(dup);
  placeRoomCells(ui.grid, dup.id, newCells);
  selectRoom(dup.id);
  _renderAll?.();
  saveProject(state);
}

// ── アクション: 家具 ──────────────────────────────────────────
function _actionDeleteFurniture(id) {
  pushUndo();
  state.furniture = (state.furniture || []).filter(f => f.id !== id);
  ui.selectedFurnitureId = null;
  _renderFurniture?.();
  _updateInspector?.();
  saveProject(state);
}

function _actionRotateFurniture(id, direction) {
  const furn = (state.furniture || []).find(f => f.id === id);
  if (!furn) return;
  pushUndo();
  furn.dir = direction > 0 ? DIR_CW[furn.dir ?? 'n'] : DIR_CCW[furn.dir ?? 'n'];
  _renderFurniture?.();
  _updateInspector?.();
  saveProject(state);
}

function _actionDuplicateFurniture(id) {
  const orig = (state.furniture || []).find(f => f.id === id);
  if (!orig) return;
  pushUndo();
  const dx = 2;
  const dup = {
    ...orig,
    id: `furn-${Date.now()}`,
    x: Math.min(orig.x + dx, state.gridCols - orig.w),
    y: orig.y,
  };
  state.furniture = [...(state.furniture || []), dup];
  ui.selectedFurnitureId = dup.id;
  _renderFurniture?.();
  _updateInspector?.();
  saveProject(state);
}

// ── アクション: 階段 ──────────────────────────────────────────
function _actionDeleteStair(id) {
  pushUndo();
  const stair = state.stairs.find(s => s.id === id);
  if (stair) {
    const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
    const otherFloor    = state.floors[otherFloorIdx];
    const paired = otherFloor.stairs.find(s => s.x === stair.x && s.y === stair.y);
    state.stairs = state.stairs.filter(s => s.id !== stair.id);
    if (paired) otherFloor.stairs = otherFloor.stairs.filter(s => s.id !== paired.id);
  }
  ui.selectedStairId = null;
  _renderAll?.();
  saveProject(state);
}

// ── アクション: 外構 ──────────────────────────────────────────
function _actionDeleteLandscape(id) {
  pushUndo();
  state.landscape = (state.landscape || []).filter(l => l.id !== id);
  ui.selectedLandscapeId = null;
  _renderLandscape?.();
  _updateInspector?.();
  saveProject(state);
}

function _actionDuplicateLandscape(id) {
  const orig = (state.landscape || []).find(l => l.id === id);
  if (!orig) return;
  pushUndo();
  const dup = {
    ...orig,
    id: `ls-${Date.now()}`,
    x: Math.min(orig.x + 2, state.gridCols - (orig.w || 2)),
    y: orig.y,
  };
  state.landscape = [...(state.landscape || []), dup];
  ui.selectedLandscapeId = dup.id;
  _renderLandscape?.();
  _updateInspector?.();
  saveProject(state);
}

// ── アクション: ドア ──────────────────────────────────────────
function _actionFlipDoor(doorEl) {
  pushUndo();
  doorEl.flip = !doorEl.flip;
  _renderAll?.();
  saveProject(state);
}

function _actionDeleteDoor(key) {
  pushUndo();
  state.elements = state.elements.filter(el => `${el.dir}:${el.col}:${el.row}` !== key);
  ui.selectedElementKey = null;
  _renderAll?.();
  saveProject(state);
}
