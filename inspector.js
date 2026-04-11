// インスペクターパネル（選択状態に応じて切り替え）

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import { ELEMENT_TOOLS, renderWallLayer } from './walls.js';
import { getTypeById, calcAreaCells, CELL_M } from './rooms.js';
import { getFurnitureTypeById } from './furniture.js';
import { getLandscapeTypeById } from './landscape.js';
import { selectAll, clearMultiSelected } from './selection.js';
import { removeRoom } from './grid.js';
import { escText } from './room-utils.js';
import { calcLandArea } from './land.js';

let _renderAll      = null;
let _renderFurniture = null;
let _renderLandscape = null;
let _showToast       = null;
let _handleModeChange = null;
let _onLandCopy      = null;
let _onLandPaste     = null;
let _onLandClear     = null;

export function initInspector({ renderAll, renderFurniture, renderLandscape, showToast, handleModeChange, onLandCopy, onLandPaste, onLandClear }) {
  _renderAll        = renderAll;
  _renderFurniture  = renderFurniture;
  _renderLandscape  = renderLandscape;
  _showToast        = showToast;
  _handleModeChange = handleModeChange;
  _onLandCopy       = onLandCopy;
  _onLandPaste      = onLandPaste;
  _onLandClear      = onLandClear;
}

export function updateInspector() {
  const panel = document.getElementById('inspector');
  if (!panel) return;

  if (ui.multiSelected.size >= 2) { renderMultiSelectInspector(panel); _appendAreaFooter(panel); return; }

  if (ELEMENT_TOOLS.some(t => t.id === state.mode)) {
    if (ui.selectedElementKey && state.mode === 'door') {
      const el = state.elements.find(e => `${e.dir}:${e.col}:${e.row}` === ui.selectedElementKey);
      if (el) { renderDoorInspector(panel, el); _appendAreaFooter(panel); return; }
    }
    renderElementInspector(panel); _appendAreaFooter(panel); return;
  }

  if (ui.selectedStairId && state.mode === 'stair') {
    const stair = state.stairs.find(s => s.id === ui.selectedStairId);
    if (stair) { renderStairInspector(panel, stair); _appendAreaFooter(panel); return; }
  }

  if (ui.selectedFurnitureId && state.mode === 'furniture') {
    const furn = (state.furniture || []).find(f => f.id === ui.selectedFurnitureId);
    if (furn) { renderFurnitureInspector(panel, furn); _appendAreaFooter(panel); return; }
  }

  if (ui.selectedLandscapeId && state.mode === 'landscape') {
    const ls = (state.landscape || []).find(l => l.id === ui.selectedLandscapeId);
    if (ls) { renderLandscapeInspector(panel, ls); _appendAreaFooter(panel); return; }
  }

  const room = state.rooms.find(r => r.id === ui.selectedId);
  if (!room) { renderAreaSummary(panel); _appendAreaFooter(panel); return; }
  renderIrregularRoomInspector(panel, room);
  _appendAreaFooter(panel);
}

// ── 複数選択 ──────────────────────────────────────────────────
function renderMultiSelectInspector(panel) {
  const rooms  = state.rooms.filter(r => ui.multiSelected.has(r.id));
  const stairs = state.stairs.filter(s => ui.multiSelected.has(s.id));
  const furns  = (state.furniture || []).filter(f => ui.multiSelected.has(f.id));
  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">🔲</span>
      <span class="inspector-title">複数選択</span>
    </div>
    <div class="inspector-info">
      <strong>${ui.multiSelected.size}個</strong>を選択中<br>
      <span style="font-size:11px;color:#888">
        部屋${rooms.length} ／ 階段${stairs.length} ／ 家具${furns.length}
      </span><br>
      <span style="font-size:11px;color:#888">ドラッグで一括移動</span>
    </div>
    <button id="btn-multi-all"   class="btn-secondary btn-full" style="margin-top:8px">全選択 (Ctrl+A)</button>
    <button id="btn-multi-clear" class="btn-secondary btn-full" style="margin-top:4px">選択解除 (Esc)</button>
  `;
  document.getElementById('btn-multi-all').addEventListener('click', selectAll);
  document.getElementById('btn-multi-clear').addEventListener('click', clearMultiSelected);
}

// ── ドア（選択中）──────────────────────────────────────────────
function renderDoorInspector(panel, el) {
  const isH = el.dir === 'h';
  const flip = el.flip || false;
  const labelA = isH ? '左' : '上';
  const labelB = isH ? '右' : '下';

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">🚪</span>
      <span class="inspector-title">ドア（選択中）</span>
    </div>
    <div class="inspector-row">
      <label class="inspector-label">蝶番</label>
      <div class="door-flip-btns">
        <button class="door-flip-btn ${!flip ? 'active' : ''}" data-flip="false">${labelA}</button>
        <button class="door-flip-btn ${flip  ? 'active' : ''}" data-flip="true">${labelB}</button>
      </div>
    </div>
    <button id="btn-del-this-door" class="btn-danger btn-full" style="margin-top:10px">🗑️ このドアを削除</button>
  `;

  panel.querySelectorAll('.door-flip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newFlip = btn.dataset.flip === 'true';
      if (el.flip === newFlip) return;
      pushUndo();
      el.flip = newFlip;
      renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, ui.selectedElementKey);
      saveProject(state);
      renderDoorInspector(panel, el);
      _appendAreaFooter(panel);
    });
  });

  document.getElementById('btn-del-this-door')?.addEventListener('click', () => {
    pushUndo();
    const key = ui.selectedElementKey;
    state.elements = state.elements.filter(e => `${e.dir}:${e.col}:${e.row}` !== key);
    ui.selectedElementKey = null;
    renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode, null);
    saveProject(state);
    renderElementInspector(panel);
    _appendAreaFooter(panel);
  });
}

// ── 建具 ──────────────────────────────────────────────────────
function renderElementInspector(panel) {
  const els = state.elements;
  const buildTools = ELEMENT_TOOLS.filter(t => !t.eraser);
  const counts = {};
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
    <div class="inspector-info" style="margin-bottom:6px">合計 <strong>${total}</strong> 個</div>
    <div class="el-insp-list">${rows}</div>
    <button id="btn-del-all-elements" class="btn-danger btn-full" style="margin-top:10px" ${total === 0 ? 'disabled' : ''}>
      🗑️ 全建具を削除
    </button>
  `;

  panel.querySelectorAll('.el-insp-del[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type  = btn.dataset.type;
      const label = ELEMENT_TOOLS.find(t => t.id === type)?.label ?? type;
      if (!confirm(`現在のフロアの「${label}」をすべて削除しますか？`)) return;
      pushUndo();
      state.elements = state.elements.filter(e => e.type !== type);
      renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode);
      saveProject(state);
      renderElementInspector(panel);
    });
  });
  document.getElementById('btn-del-all-elements')?.addEventListener('click', () => {
    if (!confirm('現在のフロアの建具をすべて削除しますか？')) return;
    pushUndo();
    state.elements = [];
    renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode);
    saveProject(state);
    renderElementInspector(panel);
  });
}

// ── 面積サマリー（何も選択していない時）──────────────────────
function renderAreaSummary(panel) {
  const emptyMsg = (() => {
    const m = state.mode;
    if (m === 'stair')     return ['階段をクリックして選択', 'パレットから階段をドラッグして配置'];
    if (m === 'furniture') return ['家具をクリックして選択', 'パレットから家具をドラッグして配置'];
    if (m === 'land')      return ['クリックで頂点追加', '始点クリックで閉じる / Escでキャンセル'];
    if (m === 'landscape') return ['外構ブロックをクリックして選択', 'パレットから外構・植栽をドラッグして配置'];
    if (ELEMENT_TOOLS.some(t => t.id === m)) return ['グリッド上の辺をクリックして配置', '消しゴムで建具を削除'];
    return ['部屋をクリックして選択', 'パレットから部屋をドラッグして配置<br>選択後「✏️ セルを編集」で形を変更'];
  })();

  panel.innerHTML = `
    <div class="inspector-empty">
      <p>${emptyMsg[0]}</p>
      <p class="hint">${emptyMsg[1]}</p>
    </div>
    ${state.mode === 'land' ? `
    <div class="land-actions">
      <button id="insp-land-copy"  title="土地形状をコピー">📋 コピー</button>
      <button id="insp-land-paste" title="コピーした土地形状を貼り付け">📥 ペースト</button>
      <button id="insp-land-clear" class="btn-danger" title="土地をクリア">🗑 クリア</button>
    </div>` : ''}`;

  if (state.mode === 'land') {
    panel.querySelector('#insp-land-copy') ?.addEventListener('click', () => _onLandCopy?.());
    panel.querySelector('#insp-land-paste')?.addEventListener('click', () => _onLandPaste?.());
    panel.querySelector('#insp-land-clear')?.addEventListener('click', () => _onLandClear?.());
  }
}

// ── 面積フッター（常時表示）────────────────────────────────────
function _appendAreaFooter(panel) {
  const rows = state.floors.map((fl, fi) => {
    const rooms = fl.rooms || [];
    const cellCount = rooms.reduce((s, r) => s + r.cells.length, 0);
    const tsubo = (cellCount / 4).toFixed(2);
    const sqm   = (cellCount * CELL_M * CELL_M).toFixed(1);
    return { fi, count: rooms.length, tsubo, sqm };
  });
  const totalTsubo    = rows.reduce((s, r) => s + parseFloat(r.tsubo), 0).toFixed(2);
  const totalSqm      = rows.reduce((s, r) => s + parseFloat(r.sqm),   0).toFixed(1);
  const landM2        = calcLandArea(state.land?.points ?? []);

  // 建ぺい率 = 1F面積 / 土地面積、容積率 = 全階延べ床面積 / 土地面積
  const floor1Sqm     = parseFloat(rows[0]?.sqm ?? 0);
  const totalFloorSqm = parseFloat(totalSqm);
  const kenpei = landM2 > 0 ? (floor1Sqm    / landM2 * 100).toFixed(1) : null;
  const yoseki = landM2 > 0 ? (totalFloorSqm / landM2 * 100).toFixed(1) : null;

  const footer = document.createElement('div');
  footer.className = 'area-footer';
  footer.innerHTML = `
    <div class="area-summary">
      <div class="area-summary-title">土地面積</div>
      ${landM2 > 0 ? `
        <div class="area-row area-total">
          <span class="area-val"><b>${(landM2 / 3.305785).toFixed(1)}</b>坪</span>
          <span class="area-sqm">${landM2.toFixed(1)}㎡</span>
        </div>
        <div class="area-row">
          <span class="area-floor">建ぺい率</span>
          <span class="area-val">${kenpei}%</span>
        </div>
        <div class="area-row">
          <span class="area-floor">容積率</span>
          <span class="area-val">${yoseki}%</span>
        </div>` : '<p class="hint">土地未設定</p>'}
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
  panel.appendChild(footer);
}

// ── 階段 ──────────────────────────────────────────────────────
function renderStairInspector(panel, stair) {
  const ARROWS = { n: '↑北', s: '↓南', e: '→東', w: '←西' };
  const fn = state.currentFloor + 1;
  const on = (state.currentFloor === 0 ? 1 : 0) + 1;
  const otherFloorIdx = state.currentFloor === 0 ? 1 : 0;
  const otherFloor    = state.floors[otherFloorIdx];
  const otherHas = otherFloor.stairs.some(s => s.x === stair.x && s.y === stair.y);

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">🪜</span>
      <span class="inspector-title">階段</span>
    </div>
    <div class="inspector-field">
      <label>向き（2F側）</label>
      <div class="dir-row">
        ${['n','s','e','w'].map(d =>
          `<button class="dir-btn${stair.dir===d?' active':''}" data-dir="${d}">${ARROWS[d]}</button>`
        ).join('')}
      </div>
    </div>
    <div class="inspector-info">
      ${fn}F ↔ ${on}F &nbsp;
      <span style="color:${otherHas ? '#16a34a' : '#dc2626'}">${otherHas ? '✓ 対応済み' : '⚠ 対応なし'}</span>
    </div>
    <button id="si-delete" class="btn-danger btn-full" style="margin-top:8px">階段を削除</button>
  `;

  const getPaired = () => otherFloor.stairs.find(s => s.x === stair.x && s.y === stair.y);

  panel.querySelectorAll('.dir-btn[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo();
      stair.dir = btn.dataset.dir;
      const p = getPaired(); if (p) p.dir = stair.dir;
      _renderAll?.(); saveProject(state);
    });
  });
  document.getElementById('si-delete').addEventListener('click', () => {
    pushUndo();
    const p = getPaired();
    state.stairs = state.stairs.filter(s => s.id !== stair.id);
    if (p) otherFloor.stairs = otherFloor.stairs.filter(s => s.id !== p.id);
    ui.selectedStairId = null;
    _renderAll?.(); saveProject(state);
  });
}

// ── 家具 ──────────────────────────────────────────────────────
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
      <div class="inspector-row">
        <label class="inspector-label">向き</label>
        <div class="furn-dir-btns">
          ${['n','s','e','w'].map(d => {
            const arrow = { n:'▲', s:'▼', e:'▶', w:'◀' }[d];
            const label = { n:'北', s:'南', e:'東', w:'西' }[d];
            const active = (furn.dir ?? 's') === d ? ' active' : '';
            return `<button class="furn-dir-btn${active}" data-dir="${d}" title="${label}">${arrow}</button>`;
          }).join('')}
        </div>
      </div>
    </div>
    <button id="fi-delete" class="btn-danger btn-full" style="margin-top:8px">家具を削除</button>`;

  const commit = () => {
    const newLabel = panel.querySelector('#furn-insp-label')?.value.trim() || label;
    const newIcon  = panel.querySelector('#furn-insp-icon')?.value || icon;
    const newColor = panel.querySelector('#furn-insp-color')?.value || color;
    pushUndo();
    furn.label = newLabel; furn.icon = newIcon; furn.color = newColor;
    _renderFurniture?.();
    renderFurnitureInspector(panel, furn);
    saveProject(state);
  };

  panel.querySelectorAll('.furn-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo();
      furn.dir = btn.dataset.dir;
      _renderFurniture?.();
      renderFurnitureInspector(panel, furn);
      saveProject(state);
    });
  });

  panel.querySelector('#furn-insp-label').addEventListener('change', commit);
  panel.querySelector('#furn-insp-icon').addEventListener('change', commit);
  panel.querySelector('#furn-insp-color').addEventListener('input', e => {
    furn.color = e.target.value;
    const block = document.querySelector(`.furniture-block[data-id="${furn.id}"]`);
    if (block) block.style.backgroundColor = e.target.value;
  });
  panel.querySelector('#furn-insp-color').addEventListener('change', commit);

  document.getElementById('fi-delete').addEventListener('click', () => {
    pushUndo();
    state.furniture = (state.furniture || []).filter(f => f.id !== furn.id);
    ui.selectedFurnitureId = null;
    _renderFurniture?.(); _renderAll?.(); saveProject(state);
  });
}

// ── 外構・植栽 ────────────────────────────────────────────────
function renderLandscapeInspector(panel, ls) {
  const ltype = getLandscapeTypeById(ls.typeId);
  const label = ls.label ?? ltype.label;
  const icon  = ls.icon  ?? ltype.icon;
  const color = ls.color ?? ltype.color;

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${icon}</span>
      <span class="inspector-title">${escText(label)}</span>
    </div>
    <div class="inspector-body">
      <div class="inspector-row">
        <label class="inspector-label">名前</label>
        <input id="ls-insp-label" type="text" value="${escText(label)}" class="inspector-input" style="flex:1">
      </div>
      <div class="inspector-row">
        <label class="inspector-label">アイコン</label>
        <input id="ls-insp-icon" type="text" value="${escText(icon)}" class="inspector-input" style="width:60px;font-size:18px;text-align:center">
      </div>
      <div class="inspector-row">
        <label class="inspector-label">色</label>
        <input id="ls-insp-color" type="color" value="${color}" style="width:44px;height:28px;padding:0;border:none;cursor:pointer">
      </div>
    </div>
    <button id="ls-delete" class="btn-danger btn-full" style="margin-top:8px">削除</button>`;

  const commit = () => {
    const newLabel = panel.querySelector('#ls-insp-label')?.value.trim() || label;
    const newIcon  = panel.querySelector('#ls-insp-icon')?.value || icon;
    const newColor = panel.querySelector('#ls-insp-color')?.value || color;
    pushUndo();
    ls.label = newLabel; ls.icon = newIcon; ls.color = newColor;
    _renderLandscape?.();
    renderLandscapeInspector(panel, ls);
    _appendAreaFooter(panel);
    saveProject(state);
  };

  panel.querySelector('#ls-insp-label').addEventListener('change', commit);
  panel.querySelector('#ls-insp-icon').addEventListener('change', commit);
  panel.querySelector('#ls-insp-color').addEventListener('input', e => {
    ls.color = e.target.value;
    const block = document.querySelector(`.landscape-block[data-id="${ls.id}"]`);
    if (block) block.style.backgroundColor = e.target.value;
  });
  panel.querySelector('#ls-insp-color').addEventListener('change', commit);

  document.getElementById('ls-delete').addEventListener('click', () => {
    pushUndo();
    state.landscape = (state.landscape || []).filter(l => l.id !== ls.id);
    ui.selectedLandscapeId = null;
    _renderLandscape?.(); _renderAll?.(); saveProject(state);
  });
}

// ── 部屋 ──────────────────────────────────────────────────────
const ICON_PICKER_EMOJIS = [
  '🏠','🛋️','🍳','🍽️','🔥','🛏️','🧸','📚','🛁','🚽','🚿','🚪','👟','➡️','📦','🚗','🌿','⬜','✏️',
  '🪟','🪑','🛒','🧺','🖥️','🎮','🎵','🎨','🧘','🏋️','🌱','🌊','🔑','💡','🔧','🪴','🐾','🍷','☕','🎁',
];

function renderIrregularRoomInspector(panel, room) {
  const type = getTypeById(room.typeId);
  const { tatami, sqm } = calcAreaCells(room.cells);
  const isEditing    = ui.editingRoomId === room.id;
  const isVoid       = type.isVoid;
  const currentIcon  = room.icon ?? type.icon;
  const iconBtns = ICON_PICKER_EMOJIS.map(em =>
    `<button class="icon-pick-btn${em === currentIcon ? ' active' : ''}" data-emoji="${em}">${em}</button>`
  ).join('');

  panel.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-icon">${currentIcon}</span>
      <span class="inspector-title">${room.label}${isVoid ? ' <span class="badge-void">吹き抜け</span>' : ''}</span>
    </div>
    <div class="inspector-field"><label>部屋名</label><input type="text" id="inp-label" value="${escText(room.label)}"></div>
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

  document.getElementById('inp-label').addEventListener('change', e => {
    pushUndo(); room.label = e.target.value; _renderAll?.(); saveProject(state);
  });
  document.getElementById('inp-color').addEventListener('input', e => {
    room.color = e.target.value;
    document.querySelectorAll(`.room-cell[data-room-id="${room.id}"]`).forEach(el => el.style.backgroundColor = room.color);
  });
  document.getElementById('inp-color').addEventListener('change', () => { pushUndo(); _renderAll?.(); saveProject(state); });
  document.getElementById('inp-isdoma').addEventListener('change', e => {
    pushUndo(); room.isDoma = e.target.checked; saveProject(state);
  });
  panel.querySelectorAll('.icon-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo(); room.icon = btn.dataset.emoji; _renderAll?.(); saveProject(state);
    });
  });
  document.getElementById('btn-edit-cells').addEventListener('click', () => {
    if (ui.editingRoomId === room.id) {
      ui.editingRoomId = null;
    } else {
      ui.editingRoomId = room.id;
      _showToast?.(`「${room.label}」のセルを編集中 — ドラッグで追加、既存セルをドラッグで削除`);
    }
    _renderAll?.();
    updateInspector();
  });
  document.getElementById('btn-delete-room').addEventListener('click', () => {
    if (ui.editingRoomId === room.id) ui.editingRoomId = null;
    pushUndo();
    removeRoom(ui.grid, room.id);
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    ui.selectedId = null; _renderAll?.(); saveProject(state);
  });
}

function rgbToHex(color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#')) return color;
  const d = document.createElement('div'); d.style.color = color; document.body.appendChild(d);
  const comp = getComputedStyle(d).color; document.body.removeChild(d);
  const m = comp.match(/\d+/g);
  if (!m) return '#ffffff';
  return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
}
