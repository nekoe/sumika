// グリッドエンジン - 純粋なロジック、DOM操作なし

export function createGrid(cols, rows) {
  return {
    cols,
    rows,
    cells: Array.from({ length: rows }, () => new Array(cols).fill(null)),
  };
}

export function canPlace(grid, x, y, w, h, excludeId = null) {
  if (x < 0 || y < 0 || x + w > grid.cols || y + h > grid.rows) return false;
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      const cell = grid.cells[r][c];
      if (cell !== null && cell !== excludeId) return false;
    }
  }
  return true;
}

export function placeRoom(grid, id, x, y, w, h) {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      grid.cells[r][c] = id;
    }
  }
}

export function removeRoom(grid, id) {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cells[r][c] === id) grid.cells[r][c] = null;
    }
  }
}

export function rebuildGrid(grid, rooms) {
  grid.cells = Array.from({ length: grid.rows }, () => new Array(grid.cols).fill(null));
  for (const room of rooms) {
    placeRoom(grid, room.id, room.x, room.y, room.w, room.h);
  }
}
