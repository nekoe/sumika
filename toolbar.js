// ツールバーUI
import { ELEMENT_TOOLS } from './walls.js';

export function initToolbar({ container, state, onUndo, onRedo, onGridChange, onSave, onExport, onImport, onReset, onModeChange, onWalkthrough }) {
  const elementToolBtns = ELEMENT_TOOLS.map(t =>
    `<button class="mode-btn el-tool-btn" data-tool="${t.id}" title="${t.label}" style="display:none">${t.icon} ${t.label}</button>`
  ).join('');

  container.innerHTML = `
    <div class="toolbar-group">
      <button id="btn-undo" title="元に戻す (Ctrl+Z)" disabled>↩ 元に戻す</button>
      <button id="btn-redo" title="やり直す (Ctrl+Y)" disabled>↪ やり直す</button>
    </div>
    <div class="toolbar-group">
      <span class="toolbar-label">モード:</span>
      <button class="mode-btn active" data-mode="room">🏠 部屋配置</button>
      <button class="mode-btn" data-mode="element">🔨 壁・建具</button>
    </div>
    <div class="toolbar-group" id="element-tools" style="display:none">
      ${elementToolBtns}
    </div>
    <div class="toolbar-group">
      <label>幅（列数）
        <input type="range" id="grid-cols" min="10" max="40" value="${state.gridCols}" step="1">
        <span id="cols-val">${state.gridCols}</span>
      </label>
      <label>高さ（行数）
        <input type="range" id="grid-rows" min="8" max="30" value="${state.gridRows}" step="1">
        <span id="rows-val">${state.gridRows}</span>
      </label>
      <label>マスサイズ
        <input type="range" id="cell-size" min="30" max="80" value="${state.cellSize}" step="5">
        <span id="size-val">${state.cellSize}px</span>
      </label>
    </div>
    <div class="toolbar-group">
      <button id="btn-save" class="btn-primary">💾 保存</button>
      <button id="btn-export">📤 エクスポート</button>
      <label class="btn" title="JSONファイルを読み込む">
        📥 インポート
        <input type="file" id="btn-import" accept=".json" style="display:none">
      </label>
      <button id="btn-reset" class="btn-danger">🗑️ リセット</button>
    </div>
    <div class="toolbar-group">
      <button id="btn-walkthrough" class="btn-walkthrough">🚶 3Dウォークスルー</button>
    </div>
  `;

  // undo/redo
  document.getElementById('btn-undo').addEventListener('click', onUndo);
  document.getElementById('btn-redo').addEventListener('click', onRedo);

  // モード切替
  container.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isElement = btn.dataset.mode === 'element';
      document.getElementById('element-tools').style.display = isElement ? 'flex' : 'none';
      onModeChange(isElement ? state.elementTool || 'wall' : 'room');
    });
  });

  // 建具ツール切替
  container.querySelectorAll('.el-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.el-tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.elementTool = btn.dataset.tool;
      onModeChange(btn.dataset.tool);
    });
  });
  // 初期アクティブ
  const firstTool = container.querySelector('.el-tool-btn');
  if (firstTool) firstTool.classList.add('active');

  // グリッドサイズ変更
  const colsInput = document.getElementById('grid-cols');
  const rowsInput = document.getElementById('grid-rows');
  const sizeInput = document.getElementById('cell-size');

  colsInput.addEventListener('input', () => {
    document.getElementById('cols-val').textContent = colsInput.value;
    onGridChange({ gridCols: +colsInput.value, gridRows: +rowsInput.value, cellSize: +sizeInput.value });
  });
  rowsInput.addEventListener('input', () => {
    document.getElementById('rows-val').textContent = rowsInput.value;
    onGridChange({ gridCols: +colsInput.value, gridRows: +rowsInput.value, cellSize: +sizeInput.value });
  });
  sizeInput.addEventListener('input', () => {
    document.getElementById('size-val').textContent = sizeInput.value + 'px';
    onGridChange({ gridCols: +colsInput.value, gridRows: +rowsInput.value, cellSize: +sizeInput.value });
  });

  // 保存・エクスポート・インポート・リセット
  document.getElementById('btn-save').addEventListener('click', onSave);
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-import').addEventListener('change', e => {
    if (e.target.files[0]) { onImport(e.target.files[0]); e.target.value = ''; }
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('間取りをリセットしますか？この操作は元に戻せません。')) onReset();
  });
  document.getElementById('btn-walkthrough').addEventListener('click', () => onWalkthrough?.());

  // キーボードショートカット
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); onUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); onRedo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave(); }
    // Delete キーは app.js 側で処理
  });

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
    setMode(mode) {
      // room or element tool id
      const isElement = mode !== 'room';
      container.querySelectorAll('.mode-btn[data-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === (isElement ? 'element' : 'room'));
      });
      document.getElementById('element-tools').style.display = isElement ? 'flex' : 'none';
      if (isElement) {
        container.querySelectorAll('.el-tool-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.tool === mode);
        });
      }
    }
  };
}
