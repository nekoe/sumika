import { createGrid, canPlace, placeRoom, removeRoom, rebuildGrid } from './grid.js';
import { ROOM_TYPES, renderPalette, createRoomData, getTypeById, calcArea } from './rooms.js';
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
  rooms: [],
  elements: [],       // 壁・ドア・窓
  mode: 'room',       // 'room' | 'wall' | 'door' | 'window'
  elementTool: 'wall',
  compass: 0,         // 方位（0=北が上）
  sunHour: 12,        // 時刻（6〜18）
};
let grid = null;
let undoStack = [];
let redoStack = [];
let toolbar = null;
let svgEl = null;
let hoveredEdge = null;
let selectedId = null;
let selectedZoneId = null;
let selectedElementId = null;

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const saved = loadProject();
  if (saved) {
    state.gridCols  = saved.gridCols  ?? 20;
    state.gridRows  = saved.gridRows  ?? 15;
    state.cellSize  = saved.cellSize  ?? 44;
    state.rooms     = saved.rooms     ?? [];
    state.elements  = saved.elements  ?? [];
    state.compass   = saved.compass   ?? 0;
    state.sunHour   = saved.sunHour   ?? 12;
  }

  grid  = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);

  renderPalette(document.getElementById('palette'));

  svgEl = initWallLayer(document.getElementById('grid'));

  toolbar = initToolbar({
    container: document.getElementById('toolbar'),
    state,
    onUndo:       undo,
    onRedo:       redo,
    onGridChange: handleGridChange,
    onModeChange: handleModeChange,
    onSave:       () => { saveProject(state); showToast('保存しました'); },
    onExport:     () => exportJSON(state),
    onImport:     file => importJSON(file, data => {
      pushUndo();
      Object.assign(state, data);
      grid = createGrid(state.gridCols, state.gridRows);
      rebuildGrid(grid, state.rooms);
      renderAll();
      toolbar.syncSliders(state);
      showToast('読み込みました');
    }, msg => alert(msg)),
    onWalkthrough:   () => startWalkthrough(state),
    onCompassChange: () => { renderCompassIndicator(); saveProject(state); },
    onReset: () => {
      pushUndo();
      state.rooms    = [];
      state.elements = [];
      resetProject();
      rebuildGrid(grid, state.rooms);
      renderAll();
    },
  });

  initDnd({
    gridEl:     document.getElementById('grid'),
    paletteEl:  document.getElementById('palette'),
    cellSize:   () => state.cellSize,
    onDropNew:  handleDropNew,
    onMove:     handleMove,
  });

  // グリッドクリックで選択解除 / 壁・建具配置
  document.getElementById('grid').addEventListener('click', e => {
    if (state.mode !== 'room') return;
    if (!e.target.closest('.room-block')) {
      selectRoom(null);
    }
  });

  // 壁・建具モード: SVGレイヤーのイベント
  svgEl.addEventListener('mousemove', e => {
    if (state.mode === 'room') return;
    hoveredEdge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  });
  svgEl.addEventListener('mouseleave', () => {
    hoveredEdge = null;
    renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
  });
  svgEl.addEventListener('click', e => {
    if (state.mode === 'room') return;
    const edge = getEdgeAt(e, document.getElementById('grid'), state.cellSize);
    if (!edge) return;
    handleElementClick(edge, e);
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

  setInterval(() => saveProject(state), 5000);
});

// ============================================================
// モード切替
// ============================================================
function handleModeChange(mode) {
  state.mode = mode;
  if (mode !== 'room') state.elementTool = mode;
  const gridEl = document.getElementById('grid');
  gridEl.dataset.mode = mode;
  // パレットのdrag無効化
  document.getElementById('palette').style.pointerEvents = mode === 'room' ? '' : 'none';
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, null, state.mode);
}

// ============================================================
// レンダリング
// ============================================================
function renderAll() {
  applyGridCss();
  renderRooms();
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
  // SVGサイズも更新
  if (svgEl) {
    svgEl.setAttribute('width',  state.gridCols * cs);
    svgEl.setAttribute('height', state.gridRows * cs);
  }
}

function renderRooms() {
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('.room-block').forEach(el => el.remove());
  for (const room of state.rooms) {
    const el = createRoomElement(room);
    gridEl.appendChild(el);
  }
}

function createRoomElement(room) {
  const cs = state.cellSize;
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcArea(room.w, room.h);

  const el = document.createElement('div');
  el.className = 'room-block' + (room.id === selectedId ? ' selected' : '');
  el.dataset.id = room.id;
  el.dataset.x  = room.x;
  el.dataset.y  = room.y;
  el.dataset.w  = room.w;
  el.dataset.h  = room.h;
  el.draggable = (state.mode === 'room');
  el.style.cssText = `left:${room.x*cs}px;top:${room.y*cs}px;width:${room.w*cs}px;height:${room.h*cs}px;background-color:${room.color};`;

  el.innerHTML = `
    <div class="room-inner">
      <div class="room-icon">${type.icon}</div>
      <div class="room-label" title="${room.label}">${room.label}</div>
      <div class="room-area">${tatami}畳 <span class="room-sqm">(${sqm}㎡)</span></div>
    </div>
  `;

  // ゾーンを描画
  if (room.zones && room.zones.length > 0) {
    renderZones(el, room, cs, {
      onSelectZone: (zoneId) => { selectRoom(room.id); selectZone(zoneId); },
      onZoneUpdate: () => { saveProject(state); renderAll(); },
    });
  }

  el.addEventListener('click', e => {
    if (e.target.closest('.resize-handle') || e.target.closest('.zone-block')) return;
    e.stopPropagation();
    selectRoom(room.id);
    selectZone(null);
  });

  el.querySelector('.room-label').addEventListener('dblclick', e => {
    e.stopPropagation();
    startLabelEdit(el, room);
  });

  attachResizeHandles(el, () => state.cellSize, (id, newGeom) => handleResize(id, newGeom));

  return el;
}

function startLabelEdit(el, room) {
  const labelEl = el.querySelector('.room-label');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = room.label;
  input.className = 'label-edit-input';
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    pushUndo();
    room.label = input.value.trim() || room.label;
    renderAll();
    saveProject(state);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') renderAll();
  });
}

// ============================================================
// 部屋操作
// ============================================================
function handleDropNew(typeId, col, row) {
  const room = createRoomData(typeId, col, row);
  if (!canPlace(grid, col, row, room.w, room.h)) {
    const pos = findFreePosition(grid, room.w, room.h);
    if (!pos) { showToast('空きスペースがありません', 'error'); return; }
    room.x = pos.x;
    room.y = pos.y;
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
  if (!room) return;
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
  if (!room) return;
  const x = Math.max(0, newGeom.x);
  const y = Math.max(0, newGeom.y);
  const w = Math.max(1, Math.min(newGeom.w, state.gridCols - x));
  const h = Math.max(1, Math.min(newGeom.h, state.gridRows - y));
  if (!canPlace(grid, x, y, w, h, roomId)) return;
  removeRoom(grid, roomId);
  room.x = x; room.y = y; room.w = w; room.h = h;
  // ゾーンをはみ出さないようにクランプ
  if (room.zones) {
    for (const z of room.zones) {
      z.x = Math.min(z.x, room.w - z.w);
      z.y = Math.min(z.y, room.h - z.h);
      z.w = Math.min(z.w, room.w - z.x);
      z.h = Math.min(z.h, room.h - z.y);
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
  state.rooms = state.rooms.filter(r => r.x + r.w <= gridCols && r.y + r.h <= gridRows);
  // はみ出た要素を削除
  state.elements = state.elements.filter(e =>
    e.col >= 0 && e.col < gridCols && e.row >= 0 && e.row < gridRows
  );
  grid = createGrid(gridCols, gridRows);
  rebuildGrid(grid, state.rooms);
  renderAll();
}

function findFreePosition(grid, w, h) {
  for (let r = 0; r <= grid.rows - h; r++) {
    for (let c = 0; c <= grid.cols - w; c++) {
      if (canPlace(grid, c, r, w, h)) return { x: c, y: r };
    }
  }
  return null;
}

// ============================================================
// 壁・建具操作
// ============================================================
function handleElementClick(edge, e) {
  const key = edgeKey(edge.col, edge.row, edge.dir);
  const existIdx = state.elements.findIndex(el => edgeKey(el.col, el.row, el.dir) === key);

  pushUndo();
  if (existIdx !== -1) {
    const exist = state.elements[existIdx];
    if (exist.type === state.mode) {
      // 同じ種類 → 削除
      state.elements.splice(existIdx, 1);
    } else {
      // 異なる種類 → 置き換え
      state.elements[existIdx] = { id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir };
    }
  } else {
    // 新規追加
    state.elements.push({ id: key, type: state.mode, col: edge.col, row: edge.row, dir: edge.dir });
  }
  renderWallLayer(svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, hoveredEdge, state.mode);
  saveProject(state);
}

// ============================================================
// 選択・ゾーン管理
// ============================================================
function selectRoom(id) {
  if (selectedId !== id) selectedZoneId = null;
  selectedId = id;
  updateInspector();
  // room-block の selected クラスを更新（全再描画を避けるため直接操作）
  document.querySelectorAll('.room-block').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === selectedId);
  });
}

function selectZone(zoneId) {
  selectedZoneId = zoneId;
  updateInspector();
}

function updateInspector() {
  const panel = document.getElementById('inspector');
  const room = state.rooms.find(r => r.id === selectedId);

  if (!room) {
    panel.innerHTML = `
      <div class="inspector-empty">
        <p>部屋をクリックして選択</p>
        <p class="hint">パレットから部屋をグリッドへ<br>ドラッグして配置できます</p>
      </div>`;
    return;
  }

  // ゾーンが選択されている場合はゾーンインスペクター
  if (selectedZoneId) {
    const zone = (room.zones || []).find(z => z.id === selectedZoneId);
    if (zone) { renderZoneInspector(panel, room, zone); return; }
  }

  renderRoomInspector(panel, room);
}

// ============================================================
// コンパスインジケーター（グリッド右下）
// ============================================================
function renderCompassIndicator() {
  const wrapper = document.getElementById('canvas-wrapper');
  let ind = document.getElementById('compass-indicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'compass-indicator';
    wrapper.appendChild(ind);
  }
  const deg = state.compass ?? 0;
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const label = dirs[Math.round(deg / 45) % 8];
  const hour = state.sunHour ?? 12;
  const hh = Math.floor(hour), mm = hour % 1 === 0.5 ? '30' : '00';
  ind.innerHTML = `
    <div class="ci-rose" style="transform:rotate(${deg}deg)">
      <div class="ci-n">N</div>
      <div class="ci-arrow"></div>
    </div>
    <div class="ci-label">${label} / ${hh}:${mm}</div>
  `;
}

function renderRoomInspector(panel, room) {
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcArea(room.w, room.h);
  const zones = room.zones || [];

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${type.icon}</span>
      <span class="inspector-title">${room.label}</span>
    </div>
    <div class="inspector-field">
      <label>部屋名</label>
      <input type="text" id="inp-label" value="${escHtml(room.label)}">
    </div>
    <div class="inspector-field">
      <label>色</label>
      <input type="color" id="inp-color" value="${rgbToHex(room.color)}">
    </div>
    <div class="inspector-field">
      <label>幅（マス）</label>
      <input type="number" id="inp-w" value="${room.w}" min="1" max="${state.gridCols}">
    </div>
    <div class="inspector-field">
      <label>高さ（マス）</label>
      <input type="number" id="inp-h" value="${room.h}" min="1" max="${state.gridRows}">
    </div>
    <div class="inspector-info">
      <strong>${tatami}畳</strong>（${sqm}㎡）<br>
      <span style="font-size:11px;color:#888">${room.w} × ${room.h} マス</span>
    </div>

    <div class="inspector-section-title">ゾーン（サブスペース）</div>
    <div id="zone-list">
      ${zones.map(z => `
        <div class="zone-list-item" data-zone-id="${z.id}">
          <span class="zone-list-color" style="background:${z.color}"></span>
          <span class="zone-list-label">${escHtml(z.label)}</span>
          <button class="zone-del-btn" data-zone-id="${z.id}" title="削除">×</button>
        </div>
      `).join('')}
    </div>
    <div class="inspector-field" style="margin-top:6px">
      <label>追加するゾーン</label>
      <select id="zone-preset">
        ${ZONE_PRESETS.map(p => `<option value="${p.label}" data-color="${p.color}">${p.label}</option>`).join('')}
      </select>
    </div>
    <button id="btn-add-zone" class="btn-secondary btn-full">＋ ゾーンを追加</button>
    <button id="btn-delete-room" class="btn-danger btn-full" style="margin-top:8px">この部屋を削除</button>
  `;

  document.getElementById('inp-label').addEventListener('change', e => {
    pushUndo(); room.label = e.target.value; renderAll(); saveProject(state);
  });
  document.getElementById('inp-color').addEventListener('input', e => {
    room.color = e.target.value;
    const el = document.querySelector(`.room-block[data-id="${room.id}"]`);
    if (el) el.style.backgroundColor = room.color;
  });
  document.getElementById('inp-color').addEventListener('change', () => { pushUndo(); saveProject(state); });
  document.getElementById('inp-w').addEventListener('change', e => {
    handleResize(room.id, { x: room.x, y: room.y, w: Math.max(1, +e.target.value), h: room.h });
  });
  document.getElementById('inp-h').addEventListener('change', e => {
    handleResize(room.id, { x: room.x, y: room.y, w: room.w, h: Math.max(1, +e.target.value) });
  });

  // ゾーンリスト: クリックで選択
  panel.querySelectorAll('.zone-list-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.zone-del-btn')) return;
      selectZone(item.dataset.zoneId);
    });
  });
  // ゾーン削除
  panel.querySelectorAll('.zone-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pushUndo();
      room.zones = (room.zones || []).filter(z => z.id !== btn.dataset.zoneId);
      if (selectedZoneId === btn.dataset.zoneId) selectedZoneId = null;
      renderAll();
      saveProject(state);
    });
  });
  // ゾーン追加
  document.getElementById('btn-add-zone').addEventListener('click', () => {
    const sel = document.getElementById('zone-preset');
    const opt = sel.selectedOptions[0];
    const label = sel.value;
    const color = opt.dataset.color || '#E0E0E0';
    pushUndo();
    if (!room.zones) room.zones = [];
    const zone = createZoneData(label, color);
    // 部屋内に収まる位置
    zone.w = Math.min(2, room.w);
    zone.h = Math.min(2, room.h);
    room.zones.push(zone);
    selectZone(zone.id);
    renderAll();
    saveProject(state);
  });

  document.getElementById('btn-delete-room').addEventListener('click', () => {
    pushUndo();
    removeRoom(grid, room.id);
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    selectedId = null;
    selectedZoneId = null;
    renderAll();
    saveProject(state);
  });
}

function renderZoneInspector(panel, room, zone) {
  panel.innerHTML = `
    <div class="inspector-header">
      <button id="btn-zone-back" title="部屋に戻る" style="font-size:18px;background:none;border:none;cursor:pointer">←</button>
      <span class="inspector-title">ゾーン編集</span>
    </div>
    <div class="inspector-field">
      <label>ゾーン名</label>
      <input type="text" id="zone-inp-label" value="${escHtml(zone.label)}">
    </div>
    <div class="inspector-field">
      <label>色</label>
      <input type="color" id="zone-inp-color" value="${rgbToHex(zone.color)}">
    </div>
    <div class="inspector-field">
      <label>X位置（マス）</label>
      <input type="number" id="zone-inp-x" value="${zone.x}" min="0" max="${room.w - zone.w}">
    </div>
    <div class="inspector-field">
      <label>Y位置（マス）</label>
      <input type="number" id="zone-inp-y" value="${zone.y}" min="0" max="${room.h - zone.h}">
    </div>
    <div class="inspector-field">
      <label>幅（マス）</label>
      <input type="number" id="zone-inp-w" value="${zone.w}" min="1" max="${room.w}">
    </div>
    <div class="inspector-field">
      <label>高さ（マス）</label>
      <input type="number" id="zone-inp-h" value="${zone.h}" min="1" max="${room.h}">
    </div>
    <div class="inspector-info">
      <strong>${(zone.w * zone.h / 2).toFixed(1)}畳</strong>（${(zone.w * zone.h * 0.83).toFixed(1)}㎡）
    </div>
    <button id="btn-delete-zone" class="btn-danger btn-full" style="margin-top:8px">ゾーンを削除</button>
  `;

  document.getElementById('btn-zone-back').addEventListener('click', () => selectZone(null));

  const fields = [
    ['zone-inp-label', 'label', String],
    ['zone-inp-x', 'x', v => Math.max(0, Math.min(+v, room.w - zone.w))],
    ['zone-inp-y', 'y', v => Math.max(0, Math.min(+v, room.h - zone.h))],
    ['zone-inp-w', 'w', v => Math.max(1, Math.min(+v, room.w - zone.x))],
    ['zone-inp-h', 'h', v => Math.max(1, Math.min(+v, room.h - zone.y))],
  ];
  for (const [id, prop, conv] of fields) {
    document.getElementById(id)?.addEventListener('change', e => {
      pushUndo(); zone[prop] = conv(e.target.value); renderAll(); saveProject(state);
    });
  }
  document.getElementById('zone-inp-color').addEventListener('input', e => {
    zone.color = e.target.value;
    const el = document.querySelector(`.zone-block[data-id="${zone.id}"]`);
    if (el) el.style.backgroundColor = zone.color;
  });
  document.getElementById('zone-inp-color').addEventListener('change', () => { pushUndo(); saveProject(state); });
  document.getElementById('btn-delete-zone').addEventListener('click', () => {
    pushUndo();
    room.zones = (room.zones || []).filter(z => z.id !== zone.id);
    selectedZoneId = null;
    renderAll();
    saveProject(state);
  });
}

// ============================================================
// Undo/Redo
// ============================================================
function pushUndo() {
  undoStack.push(JSON.stringify({ rooms: state.rooms, elements: state.elements, gridCols: state.gridCols, gridRows: state.gridRows, cellSize: state.cellSize }));
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify({ rooms: state.rooms, elements: state.elements, gridCols: state.gridCols, gridRows: state.gridRows, cellSize: state.cellSize }));
  const prev = JSON.parse(undoStack.pop());
  Object.assign(state, prev);
  grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);
  renderAll();
  toolbar.syncSliders(state);
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify({ rooms: state.rooms, elements: state.elements, gridCols: state.gridCols, gridRows: state.gridRows, cellSize: state.cellSize }));
  const next = JSON.parse(redoStack.pop());
  Object.assign(state, next);
  grid = createGrid(state.gridCols, state.gridRows);
  rebuildGrid(grid, state.rooms);
  renderAll();
  toolbar.syncSliders(state);
}

// ============================================================
// ユーティリティ
// ============================================================
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2200);
}

function rgbToHex(color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#')) return color;
  const d = document.createElement('div');
  d.style.color = color;
  document.body.appendChild(d);
  const comp = getComputedStyle(d).color;
  document.body.removeChild(d);
  const m = comp.match(/\d+/g);
  if (!m) return '#ffffff';
  return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
