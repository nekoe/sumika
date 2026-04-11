// 複数プロジェクト管理UI

import { state, ui } from './state.js';
import {
  saveProject, loadProjectData, loadProjectIndex,
  setCurrentProjectId,
  createProject, deleteProject, renameProject, duplicateProject,
  hasUnsavedChanges,
} from './storage.js';
import { resetUndoRedo } from './undo.js';

// app.js から注入されるコールバック
let _applyProjectData = null;
let _rebuildAndSync   = null;
let _showToast        = null;

export function initProjectManager({ applyProjectData, rebuildAndSync, showToast }) {
  _applyProjectData = applyProjectData;
  _rebuildAndSync   = rebuildAndSync;
  _showToast        = showToast;
}

// ── モーダル開閉 ─────────────────────────────────────────────────
let _overlay  = null;
let _sortBy   = 'updatedAt'; // 'updatedAt' | 'createdAt'
let _onEscKey = null;

export function openProjectModal() {
  _overlay?.remove();
  _overlay = document.createElement('div');
  _overlay.id = 'project-modal-overlay';
  document.body.appendChild(_overlay);
  _renderModal();
}

function _closeModal() {
  _overlay?.remove();
  _overlay = null;
  if (_onEscKey) {
    document.removeEventListener('keydown', _onEscKey, { capture: true });
    _onEscKey = null;
  }
}

// ── モーダルHTML生成 ─────────────────────────────────────────────
function _renderModal() {
  if (!_overlay) return;
  const sorted = _getSortedIndex();
  const curId  = ui.currentProjectId;

  _overlay.innerHTML = `
    <div class="pm-modal" role="dialog" aria-modal="true" aria-label="プロジェクト管理">
      <div class="pm-header">
        <h2>📁 プロジェクト管理</h2>
        <button class="pm-close btn-icon" title="閉じる">✕</button>
      </div>
      <div class="pm-toolbar">
        <span class="pm-sort-label">並び替え:</span>
        <button class="pm-sort-btn${_sortBy === 'updatedAt' ? ' active' : ''}" data-sort="updatedAt">更新順</button>
        <button class="pm-sort-btn${_sortBy === 'createdAt' ? ' active' : ''}" data-sort="createdAt">作成順</button>
      </div>
      <ul class="pm-list">
        ${sorted.map(p => `
          <li class="pm-item${p.id === curId ? ' pm-current' : ''}" data-id="${_esc(p.id)}">
            <span class="pm-item-name">${_esc(p.name)}</span>
            ${p.id === curId ? '<span class="pm-item-cur-label">編集中</span>' : ''}
            <span class="pm-item-date">${_fmtDate(p.updatedAt)}</span>
            <div class="pm-item-actions">
              <button class="pm-btn-rename btn-icon" data-id="${_esc(p.id)}" title="リネーム">✏️</button>
              <button class="pm-btn-dup btn-icon" data-id="${_esc(p.id)}" title="複製">📋</button>
              <button class="pm-btn-del btn-icon" data-id="${_esc(p.id)}" title="削除"
                ${sorted.length <= 1 ? 'disabled' : ''}>🗑️</button>
            </div>
          </li>
        `).join('')}
      </ul>
      <div class="pm-footer">
        <div id="pm-new-form" class="pm-new-form" hidden>
          <input id="pm-new-name" type="text" class="pm-input" placeholder="プロジェクト名" maxlength="40" autocomplete="off">
          <button id="pm-new-ok" class="btn-primary">作成</button>
          <button id="pm-new-cancel">キャンセル</button>
        </div>
        <button id="pm-btn-new" class="btn-primary pm-btn-new">＋ 新規作成</button>
      </div>
    </div>
  `;

  _bindEvents();
}

function _bindEvents() {
  // 閉じるボタン
  _overlay.querySelector('.pm-close').addEventListener('click', _closeModal);

  // 外側クリックで閉じる
  _overlay.addEventListener('mousedown', e => { if (e.target === _overlay) _closeModal(); });

  // ESC キー
  if (_onEscKey) document.removeEventListener('keydown', _onEscKey, { capture: true });
  _onEscKey = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      _closeModal();
    }
  };
  document.addEventListener('keydown', _onEscKey, { capture: true });

  // 並び替え
  _overlay.querySelectorAll('.pm-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _sortBy = btn.dataset.sort;
      _renderModal();
    });
  });

  // プロジェクト切替（名前クリック）
  _overlay.querySelectorAll('.pm-item:not(.pm-current) .pm-item-name').forEach(el => {
    el.addEventListener('click', () => _switchProject(el.closest('.pm-item').dataset.id));
  });

  // リネーム
  _overlay.querySelectorAll('.pm-btn-rename').forEach(btn => {
    btn.addEventListener('click', () => _startRename(btn.dataset.id));
  });

  // 複製
  _overlay.querySelectorAll('.pm-btn-dup').forEach(btn => {
    btn.addEventListener('click', () => _duplicateProject(btn.dataset.id));
  });

  // 削除
  _overlay.querySelectorAll('.pm-btn-del:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => _deleteProject(btn.dataset.id));
  });

  // 新規作成ボタン
  _overlay.querySelector('#pm-btn-new').addEventListener('click', () => {
    _overlay.querySelector('#pm-new-form').hidden = false;
    _overlay.querySelector('#pm-btn-new').hidden  = true;
    _overlay.querySelector('#pm-new-name').focus();
  });
  _overlay.querySelector('#pm-new-ok').addEventListener('click', _createNewProject);
  _overlay.querySelector('#pm-new-cancel').addEventListener('click', () => {
    _overlay.querySelector('#pm-new-form').hidden = true;
    _overlay.querySelector('#pm-btn-new').hidden  = false;
  });
  _overlay.querySelector('#pm-new-name').addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); _createNewProject(); }
    if (e.key === 'Escape') {
      _overlay.querySelector('#pm-new-form').hidden = true;
      _overlay.querySelector('#pm-btn-new').hidden  = false;
    }
  });
}

// ── アクション ───────────────────────────────────────────────────
function _switchProject(id) {
  if (id === ui.currentProjectId) return;

  if (hasUnsavedChanges(state)) {
    if (!confirm('保存されていない変更があります。このまま切り替えますか？\n（現在のプロジェクトは最後の自動保存の状態に戻ります）')) return;
  }

  _doSwitch(id);
  _closeModal();
}

// 確認なしで切り替える（削除後の自動切替など内部用）
function _doSwitch(id) {
  const data = loadProjectData(id);
  resetUndoRedo();
  _applyProjectData(data ?? { gridCols: state.gridCols, gridRows: state.gridRows, cellSize: state.cellSize });
  setCurrentProjectId(id);
  ui.currentProjectId = id;
  _rebuildAndSync();

  const entry = loadProjectIndex().find(p => p.id === id);
  const name  = entry?.name ?? '';
  _updateProjectBtn(name);
  _showToast?.(`「${name}」を開きました`);
}

function _startRename(id) {
  const item   = _overlay.querySelector(`.pm-item[data-id="${id}"]`);
  if (!item) return;
  const nameEl = item.querySelector('.pm-item-name');
  const orig   = nameEl.textContent;

  const input  = document.createElement('input');
  input.type      = 'text';
  input.value     = orig;
  input.className = 'pm-input pm-rename-input';
  input.maxLength = 40;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const name = input.value.trim();
    if (name && name !== orig) {
      renameProject(id, name);
      if (id === ui.currentProjectId) _updateProjectBtn(name);
      _showToast?.('リネームしました');
    }
    _renderModal();
  };
  input.addEventListener('blur',   commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.removeEventListener('blur', commit); commit(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); _renderModal(); }
  });
}

function _duplicateProject(id) {
  const orig = loadProjectIndex().find(p => p.id === id);
  if (!orig) return;
  duplicateProject(id, `${orig.name} のコピー`);
  _showToast?.('複製しました');
  _renderModal();
}

function _deleteProject(id) {
  const index = loadProjectIndex();
  if (index.length <= 1) return;
  const entry = index.find(p => p.id === id);
  if (!confirm(`「${entry?.name ?? 'このプロジェクト'}」を削除しますか？この操作は元に戻せません。`)) return;
  deleteProject(id);
  if (id === ui.currentProjectId) {
    const remaining = loadProjectIndex();
    if (remaining.length > 0) {
      _doSwitch(remaining[0].id); // 確認不要（削除直後の自動切替）
      _renderModal();
    }
  } else {
    _renderModal();
  }
}

function _createNewProject() {
  const input = _overlay?.querySelector('#pm-new-name');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  // 現在のプロジェクトを先に保存
  saveProject(state);

  const newId = createProject(name);
  resetUndoRedo();
  _applyProjectData({
    gridCols:  state.gridCols,
    gridRows:  state.gridRows,
    cellSize:  state.cellSize,
    floors:    [
      { rooms: [], elements: [], stairs: [], furniture: [] },
      { rooms: [], elements: [], stairs: [], furniture: [] },
    ],
    land:      { points: [], closed: false },
    landscape: [],
  });
  setCurrentProjectId(newId);
  ui.currentProjectId = newId;
  saveProject(state); // 空の初期状態を保存
  _rebuildAndSync();
  _updateProjectBtn(name);
  _showToast?.(`「${name}」を作成しました`);
  _closeModal();
}

// ── ユーティリティ ───────────────────────────────────────────────
function _getSortedIndex() {
  return [...loadProjectIndex()].sort((a, b) => new Date(b[_sortBy]) - new Date(a[_sortBy]));
}

function _updateProjectBtn(name) {
  const el = document.getElementById('project-name');
  if (el) el.textContent = name;
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
