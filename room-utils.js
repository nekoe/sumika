// 部屋データのユーティリティ（render.js / selection.js 双方から利用）

/**
 * HTML/SVG 属性・テキストノード用エスケープ
 */
export function escText(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


/**
 * セル座標を (dx, dy) だけ平行移動する
 */
export function translateCells(cells, dx, dy) {
  return cells.map(k => {
    const [c, r] = k.split(',').map(Number);
    return `${c + dx},${r + dy}`;
  });
}

/**
 * 不規則形状部屋の cells から x/y/w/h を再計算する
 */
export function updateIrregularRoomBounds(room) {
  if (!room.cells || !room.cells.length) return;
  const cols = room.cells.map(k => +k.split(',')[0]);
  const rows = room.cells.map(k => +k.split(',')[1]);
  room.x = Math.min(...cols);
  room.y = Math.min(...rows);
  room.w = Math.max(...cols) - room.x + 1;
  room.h = Math.max(...rows) - room.y + 1;
}

/**
 * 部屋の cells が完全な矩形かどうか判定する
 */
export function isRectRoom(room) {
  if (!room.cells || !room.cells.length) return true;
  if (room.cells.length !== room.w * room.h) return false;
  const cellSet = new Set(room.cells);
  for (let r = room.y; r < room.y + room.h; r++)
    for (let c = room.x; c < room.x + room.w; c++)
      if (!cellSet.has(`${c},${r}`)) return false;
  return true;
}

/**
 * 旧矩形データをセルベースに変換し、isDoma を補完する
 */
export function normalizeCells(room) {
  if (!room.cells || room.cells.length === 0) {
    room.cells = [];
    for (let r = room.y; r < room.y + room.h; r++)
      for (let c = room.x; c < room.x + room.w; c++)
        room.cells.push(`${c},${r}`);
  }
  if (room.isDoma === undefined) {
    room.isDoma = (room.typeId === 'doma' || room.typeId === 'genkan');
  }
  return room;
}
