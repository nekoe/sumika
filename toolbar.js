// ツールバーUI（2行コンパクトレイアウト）
import { ELEMENT_TOOLS } from './walls.js';
import { FURNITURE_TYPES } from './furniture.js';

export function initToolbar({ container, state, onUndo, onRedo, onGridChange, onSave, onExport, onImport, onReset, onModeChange, onFloorChange, onWalkthrough, onCompassChange, onStairConfigChange, onRotate }) {
  const elementToolBtns = ELEMENT_TOOLS.map(t =>
    `<button class="mode-btn el-tool-btn" data-tool="${t.id}" title="${t.label}">${t.icon} ${t.label}</button>`
  ).join('');

  const furnitureBtns = FURNITURE_TYPES.map(t =>
    `<button class="mode-btn furn-type-btn${(state.furnitureType || 'kitchen') === t.id ? ' active' : ''}" data-ftype="${t.id}" title="${t.label}">${t.icon} ${t.label}</button>`
  ).join('');

  const sc = state.stairConfig || { w: 2, h: 3, dir: 'n' };
  const DIRS = [
    { id: 'n', label: '↑北', title: '北向き（上が出口）' },
    { id: 's', label: '↓南', title: '南向き（下が出口）' },
    { id: 'e', label: '→東', title: '東向き' },
    { id: 'w', label: '←西', title: '西向き' },
  ];
  const dirBtns = DIRS.map(d =>
    `<button class="dir-btn${sc.dir === d.id ? ' active' : ''}" data-dir="${d.id}" title="${d.title}">${d.label}</button>`
  ).join('');

  container.innerHTML = `
    <!-- Row 1: メイン操作 -->
    <div class="tb-primary">
      <div class="tb-group">
        <button id="btn-undo" title="元に戻す (Ctrl+Z)" disabled>↩</button>
        <button id="btn-redo" title="やり直す (Ctrl+Y)" disabled>↪</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="floor-btn active" data-floor="0" title="1階を編集">1F</button>
        <button class="floor-btn" data-floor="1" title="2階を編集">2F</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="mode-btn active" data-mode="room" title="部屋配置">🏠 部屋</button>
        <button class="mode-btn" data-mode="stair" title="階段を配置">🪜 階段</button>
        <button class="mode-btn" data-mode="element" title="壁・ドア・窓">🔨 建具</button>
        <button class="mode-btn" data-mode="furniture" title="家具配置">🪑 家具</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button id="btn-rotate-ccw" title="反時計回りに90度回転">↺ 回転</button>
        <button id="btn-rotate-cw"  title="時計回りに90度回転">↻ 回転</button>
      </div>
      <div class="tb-spacer"></div>
      <div class="tb-group">
        <button id="btn-save" class="btn-primary" title="保存 (Ctrl+S)">💾 保存</button>
        <button id="btn-export" title="JSONエクスポート">📤</button>
        <label class="btn" title="JSONインポート">📥<input type="file" id="btn-import" accept=".json" style="display:none"></label>
        <button id="btn-reset" class="btn-danger" title="リセット">🗑️</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button id="btn-walkthrough" class="btn-walkthrough" title="3Dウォークスルー">🚶 3D</button>
      </div>
    </div>

    <!-- Row 2: コンテキスト -->
    <div class="tb-context">
      <!-- 部屋モード: グリッドサイズ -->
      <div id="ctx-room" class="tb-ctx">
        <span class="tb-ctx-label">グリッド:</span>
        <label title="列数">列<input type="range" id="grid-cols" min="10" max="40" value="${state.gridCols}" step="1" style="width:70px"><b id="cols-val">${state.gridCols}</b></label>
        <label title="行数">行<input type="range" id="grid-rows" min="8" max="30" value="${state.gridRows}" step="1" style="width:70px"><b id="rows-val">${state.gridRows}</b></label>
        <label title="マスのピクセルサイズ">サイズ<input type="range" id="cell-size" min="30" max="80" value="${state.cellSize}" step="5" style="width:70px"><b id="size-val">${state.cellSize}px</b></label>
      </div>
      <!-- 階段モード: 形状・向き -->
      <div id="ctx-stair" class="tb-ctx" style="display:none">
        <span class="tb-ctx-label">階段:</span>
        <label title="横幅（マス）">幅<input type="number" id="stair-w" min="1" max="6" value="${sc.w}" style="width:38px"></label>
        <label title="奥行（マス）">奥行<input type="number" id="stair-h" min="1" max="8" value="${sc.h}" style="width:38px"></label>
        <span class="tb-ctx-label">向き:</span>
        ${dirBtns}
      </div>
      <!-- 建具モード: 壁/ドア/窓 -->
      <div id="ctx-element" class="tb-ctx" style="display:none">
        <span class="tb-ctx-label">建具:</span>
        ${elementToolBtns}
      </div>
      <!-- 家具モード: 家具タイプ -->
      <div id="ctx-furniture" class="tb-ctx" style="display:none">
        <span class="tb-ctx-label">家具:</span>
        ${furnitureBtns}
      </div>
      <!-- 常時表示: 採光 -->
      <div class="tb-ctx tb-sun">
        <span class="tb-ctx-label" title="採光シミュレーション">☀️</span>
        <label title="建物の向き（上が指定の方位）"><span id="compass-label">${compassLabel(state.compass ?? 0)}</span><input type="range" id="inp-compass" min="0" max="315" step="45" value="${state.compass ?? 0}" style="width:60px"></label>
        <label title="太陽の時刻"><span id="sunhour-label">${sunHourLabel(state.sunHour ?? 12)}</span><input type="range" id="inp-sunhour" min="6" max="18" step="0.5" value="${state.sunHour ?? 12}" style="width:60px"></label>
      </div>
    </div>
  `;

  // ── undo/redo ─────────────────────────────────────────
  document.getElementById('btn-undo').addEventListener('click', onUndo);
  document.getElementById('btn-redo').addEventListener('click', onRedo);

  // ── 回転 ─────────────────────────────────────────────
  document.getElementById('btn-rotate-ccw').addEventListener('click', () => onRotate?.(-1));
  document.getElementById('btn-rotate-cw').addEventListener('click',  () => onRotate?.(1));

  // ── フロア切替 ─────────────────────────────────────────
  container.querySelectorAll('.floor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.floor-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onFloorChange(+btn.dataset.floor);
    });
  });

  // ── モード切替 ─────────────────────────────────────────
  container.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      _showCtx(mode);
      if (mode === 'element') {
        onModeChange(state.elementTool || 'wall');
      } else {
        onModeChange(mode);
      }
    });
  });

  // ── 建具サブツール ─────────────────────────────────────
  container.querySelectorAll('.el-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.el-tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.elementTool = btn.dataset.tool;
      onModeChange(btn.dataset.tool);
    });
  });
  const firstTool = container.querySelector('.el-tool-btn');
  if (firstTool) firstTool.classList.add('active');

  // ── グリッドサイズ ─────────────────────────────────────
  const colsInput = document.getElementById('grid-cols');
  const rowsInput = document.getElementById('grid-rows');
  const sizeInput = document.getElementById('cell-size');
  const fireGrid = () => onGridChange({ gridCols: +colsInput.value, gridRows: +rowsInput.value, cellSize: +sizeInput.value });

  colsInput.addEventListener('input', () => { document.getElementById('cols-val').textContent = colsInput.value; fireGrid(); });
  rowsInput.addEventListener('input', () => { document.getElementById('rows-val').textContent = rowsInput.value; fireGrid(); });
  sizeInput.addEventListener('input', () => { document.getElementById('size-val').textContent = sizeInput.value + 'px'; fireGrid(); });

  // ── 階段設定 ──────────────────────────────────────────
  document.getElementById('stair-w').addEventListener('change', e => {
    state.stairConfig.w = Math.max(1, Math.min(6, +e.target.value));
    onStairConfigChange?.(state.stairConfig);
  });
  document.getElementById('stair-h').addEventListener('change', e => {
    state.stairConfig.h = Math.max(1, Math.min(8, +e.target.value));
    onStairConfigChange?.(state.stairConfig);
  });
  container.querySelectorAll('.dir-btn[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.stairConfig.dir = btn.dataset.dir;
      onStairConfigChange?.(state.stairConfig);
    });
  });

  // ── ファイル操作 ──────────────────────────────────────
  document.getElementById('btn-save').addEventListener('click', onSave);
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-import').addEventListener('change', e => {
    if (e.target.files[0]) { onImport(e.target.files[0]); e.target.value = ''; }
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('間取りをリセットしますか？この操作は元に戻せません。')) onReset();
  });
  document.getElementById('btn-walkthrough').addEventListener('click', () => onWalkthrough?.());

  // ── 採光 ──────────────────────────────────────────────
  document.getElementById('inp-compass').addEventListener('input', e => {
    state.compass = +e.target.value;
    document.getElementById('compass-label').textContent = compassLabel(state.compass);
    onCompassChange?.();
  });
  document.getElementById('inp-sunhour').addEventListener('input', e => {
    state.sunHour = +e.target.value;
    document.getElementById('sunhour-label').textContent = sunHourLabel(state.sunHour);
    onCompassChange?.();
  });

  // ── キーボードショートカット ──────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); onUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); onRedo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave(); }
  });

  // ── 家具タイプ選択 ────────────────────────────────────
  container.querySelectorAll('.furn-type-btn[data-ftype]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.furn-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.furnitureType = btn.dataset.ftype;
    });
  });

  function _showCtx(mode) {
    document.getElementById('ctx-room').style.display      = mode === 'room' ? 'flex' : 'none';
    document.getElementById('ctx-stair').style.display     = mode === 'stair'     ? 'flex' : 'none';
    document.getElementById('ctx-element').style.display   = mode === 'element'   ? 'flex' : 'none';
    document.getElementById('ctx-furniture').style.display = mode === 'furniture' ? 'flex' : 'none';
  }

  return {
    updateUndoRedo(canUndo, canRedo) {
      document.getElementById('btn-undo').disabled = !canUndo;
      document.getElementById('btn-redo').disabled = !canRedo;
    },
    syncSliders(s) {
      document.getElementById('grid-cols').value = s.gridCols;
      document.getElementById('cols-val').textContent = s.gridCols;
      document.getElementById('grid-rows').value = s.gridRows;
      document.getElementById('rows-val').textContent = s.gridRows;
      document.getElementById('cell-size').value = s.cellSize;
      document.getElementById('size-val').textContent = s.cellSize + 'px';
    },
    syncFloor(fi) {
      container.querySelectorAll('.floor-btn').forEach(b => b.classList.toggle('active', +b.dataset.floor === fi));
    },
    syncStairConfig(sc) {
      const wEl = document.getElementById('stair-w');
      const hEl = document.getElementById('stair-h');
      if (wEl) wEl.value = sc.w;
      if (hEl) hEl.value = sc.h;
      container.querySelectorAll('.dir-btn').forEach(b => b.classList.toggle('active', b.dataset.dir === sc.dir));
    },
    setMode(mode) {
      const isElement = mode !== 'room' && mode !== 'stair' && mode !== 'furniture';
      container.querySelectorAll('.mode-btn[data-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode || (b.dataset.mode === 'element' && isElement));
      });
      _showCtx(isElement ? 'element' : mode);
      if (isElement) {
        container.querySelectorAll('.el-tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === mode));
      }
    },
    syncFurnitureType(ftype) {
      container.querySelectorAll('.furn-type-btn').forEach(b => b.classList.toggle('active', b.dataset.ftype === ftype));
    },
  };
}

function compassLabel(deg) {
  const labels = ['北↑','北東↗','東→','南東↘','南↓','南西↙','西←','北西↖'];
  return labels[Math.round(deg / 45) % 8];
}
function sunHourLabel(h) {
  const hh = Math.floor(h);
  const mm = h % 1 === 0.5 ? '30' : '00';
  return `${hh}:${mm}`;
}
