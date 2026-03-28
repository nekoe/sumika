// データの保存・読込・エクスポート

const STORAGE_KEY = 'myhome-project-v3';

export function saveProject(state) {
  try {
    const data = {
      version:      3,
      gridCols:     state.gridCols,
      gridRows:     state.gridRows,
      cellSize:     state.cellSize,
      currentFloor: state.currentFloor ?? 0,
      floors:       state.floors,
      compass:      state.compass  ?? 0,
      sunHour:      state.sunHour  ?? 12,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('保存に失敗しました:', e);
  }
}

export function loadProject() {
  try {
    // v3 を試す
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // v2 の旧データを試す
      raw = localStorage.getItem('myhome-project-v2');
    }
    if (!raw) {
      raw = localStorage.getItem('myhome-project-v1');
    }
    if (!raw) return null;
    const data = JSON.parse(raw);

    // v1/v2 形式（floors なし）を v3 形式に変換
    if (!data.floors) {
      const rooms = (data.rooms || []).map(r => ({ zones: [], ...r }));
      data.floors = [
        { rooms, elements: data.elements || [], stairs: [] },
        { rooms: [], elements: [], stairs: [] },
      ];
      data.currentFloor = 0;
    } else {
      // v3: zones フィールド補完
      for (const fl of data.floors) {
        if (fl.rooms) fl.rooms = fl.rooms.map(r => ({ zones: [], ...r }));
        if (!fl.elements) fl.elements = [];
        if (!fl.stairs)   fl.stairs   = [];
      }
    }
    return data;
  } catch (e) {
    return null;
  }
}

export function exportJSON(state) {
  const data = {
    version:      3,
    gridCols:     state.gridCols,
    gridRows:     state.gridRows,
    cellSize:     state.cellSize,
    currentFloor: state.currentFloor ?? 0,
    floors:       state.floors,
    compass:      state.compass  ?? 0,
    sunHour:      state.sunHour  ?? 12,
    exportedAt:   new Date().toISOString(),
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
      // floors 形式
      if (data.floors) {
        for (const fl of data.floors) {
          if (!fl.elements) fl.elements = [];
          if (!fl.stairs)   fl.stairs   = [];
        }
        onSuccess(data);
        return;
      }
      // 旧形式
      if (!data.rooms || !data.gridCols) throw new Error('無効なファイル形式');
      data.floors = [
        { rooms: data.rooms, elements: data.elements || [], stairs: [] },
        { rooms: [], elements: [], stairs: [] },
      ];
      data.currentFloor = 0;
      onSuccess(data);
    } catch (err) {
      onError('ファイルの読み込みに失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
}

export function resetProject() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('myhome-project-v2');
  localStorage.removeItem('myhome-project-v1');
}
