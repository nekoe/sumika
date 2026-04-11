// データの保存・読込・エクスポート

const INDEX_KEY  = 'sumika-projects-index';
const projectKey = id => `sumika-project-${id}`;

// ── モジュール内部状態 ────────────────────────────────────────────
let _currentProjectId = null;
let _lastSavedJSON    = null;

// ── シリアライズ（saveProject / exportJSON 共用）─────────────────
function _serializeState(state) {
  return {
    version:      3,
    gridCols:     state.gridCols,
    gridRows:     state.gridRows,
    cellSize:     state.cellSize,
    currentFloor: state.currentFloor ?? 0,
    floors:       state.floors,
    compass:      state.compass     ?? 0,
    sunHour:      state.sunHour     ?? 12,
    wallColor:    state.wallColor   ?? '#1e293b',
    stairConfig:  state.stairConfig ?? { w: 2, h: 3, dir: 'n' },
    land:         state.land        ?? { points: [], closed: false },
    landscape:    state.landscape   ?? [],
  };
}

// floors の正規化（loadProjectData / loadLegacyProject 共用）
function _normalizeFloors(data) {
  if (!data.floors) {
    const rooms = data.rooms || [];
    data.floors = [
      { rooms, elements: data.elements || [], stairs: [] },
      { rooms: [], elements: [], stairs: [] },
    ];
    data.currentFloor = 0;
  } else {
    for (const fl of data.floors) {
      if (!fl.elements)  fl.elements  = [];
      if (!fl.stairs)    fl.stairs    = [];
      if (!fl.furniture) fl.furniture = [];
    }
  }
  return data;
}

// ── 現在プロジェクトID管理 ────────────────────────────────────────
export function setCurrentProjectId(id) { _currentProjectId = id; }
export function getCurrentProjectId()   { return _currentProjectId; }

// ── 未保存変更チェック ────────────────────────────────────────────
export function hasUnsavedChanges(state) {
  if (!_lastSavedJSON) return true; // 一度も保存できていなければ未保存扱い
  return _lastSavedJSON !== JSON.stringify(_serializeState(state));
}

// ── プロジェクト一覧 ─────────────────────────────────────────────
export function loadProjectIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function _saveProjectIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

// ── プロジェクトデータ保存・読込 ─────────────────────────────────
export function saveProject(state) {
  if (!_currentProjectId) return;
  try {
    const json = JSON.stringify(_serializeState(state));
    localStorage.setItem(projectKey(_currentProjectId), json);
    _lastSavedJSON = json;
    // index の updatedAt を更新
    const index = loadProjectIndex();
    const entry = index.find(p => p.id === _currentProjectId);
    if (entry) {
      entry.updatedAt = new Date().toISOString();
      _saveProjectIndex(index);
    }
  } catch (e) {
    console.warn('保存に失敗しました:', e);
  }
}

export function loadProjectData(id) {
  try {
    const raw = localStorage.getItem(projectKey(id));
    if (!raw) return null;
    return _normalizeFloors(JSON.parse(raw));
  } catch { return null; }
}

// ── CRUD ─────────────────────────────────────────────────────────
function _newId() {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createProject(name) {
  const id  = _newId();
  const now = new Date().toISOString();
  const index = loadProjectIndex();
  index.unshift({ id, name, createdAt: now, updatedAt: now });
  _saveProjectIndex(index);
  return id;
}

export function deleteProject(id) {
  const index = loadProjectIndex().filter(p => p.id !== id);
  _saveProjectIndex(index);
  localStorage.removeItem(projectKey(id));
}

export function renameProject(id, newName) {
  const index = loadProjectIndex();
  const entry = index.find(p => p.id === id);
  if (entry) {
    entry.name = newName;
    _saveProjectIndex(index);
  }
}

export function duplicateProject(id, newName) {
  const raw     = localStorage.getItem(projectKey(id));
  const newId   = _newId();
  const now     = new Date().toISOString();
  const index   = loadProjectIndex();
  const origIdx = index.findIndex(p => p.id === id);
  const insertAt = origIdx < 0 ? index.length : origIdx + 1;
  index.splice(insertAt, 0, { id: newId, name: newName, createdAt: now, updatedAt: now });
  _saveProjectIndex(index);
  if (raw) localStorage.setItem(projectKey(newId), raw);
  return newId;
}

// ── 旧形式読み込み（マイグレーション用、起動時1回のみ）──────────
export function loadLegacyProject() {
  try {
    const keys = ['sumika-project-v3', 'myhome-project-v3', 'myhome-project-v2', 'myhome-project-v1'];
    const raw = keys.map(k => localStorage.getItem(k)).find(Boolean);
    if (!raw) return null;
    return _normalizeFloors(JSON.parse(raw));
  } catch { return null; }
}

export function removeLegacyKeys() {
  ['sumika-project-v3', 'myhome-project-v3', 'myhome-project-v2', 'myhome-project-v1']
    .forEach(k => localStorage.removeItem(k));
}

// ── エクスポート ─────────────────────────────────────────────────
export function exportJSON(state) {
  const data = { ..._serializeState(state), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `間取り_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── インポート ───────────────────────────────────────────────────
export function importJSON(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.floors && (!data.rooms || !data.gridCols)) throw new Error('無効なファイル形式');
      onSuccess(_normalizeFloors(data));
    } catch (err) {
      onError('ファイルの読み込みに失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
}
