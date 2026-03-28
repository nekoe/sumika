// データの保存・読込・エクスポート

const STORAGE_KEY = 'myhome-project-v2';

export function saveProject(state) {
  try {
    const data = {
      version: 2,
      gridCols: state.gridCols,
      gridRows: state.gridRows,
      cellSize: state.cellSize,
      rooms: state.rooms,
      elements: state.elements || [],
      compass:  state.compass  ?? 0,
      sunHour:  state.sunHour  ?? 12,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('保存に失敗しました:', e);
  }
}

export function loadProject() {
  try {
    // v2 を試す
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // v1 の旧データを試す
      raw = localStorage.getItem('myhome-project-v1');
    }
    if (!raw) return null;
    const data = JSON.parse(raw);
    // zones フィールドの移行
    if (data.rooms) {
      data.rooms = data.rooms.map(r => ({ zones: [], ...r }));
    }
    if (!data.elements) data.elements = [];
    return data;
  } catch (e) {
    return null;
  }
}

export function exportJSON(state) {
  const data = {
    version: 2,
    gridCols: state.gridCols,
    gridRows: state.gridRows,
    cellSize: state.cellSize,
    rooms: state.rooms,
    elements: state.elements || [],
    compass:  state.compass  ?? 0,
    sunHour:  state.sunHour  ?? 12,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `間取り_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.rooms || !data.gridCols) throw new Error('無効なファイル形式');
      if (!data.elements) data.elements = [];
      onSuccess(data);
    } catch (err) {
      onError('ファイルの読み込みに失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
}

export function resetProject() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('myhome-project-v1');
}
