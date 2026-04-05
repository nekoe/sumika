// Undo / Redo 管理

import { state } from './state.js';

const undoStack = [];
const redoStack = [];

function snapshotState() {
  return JSON.stringify({
    floors:       state.floors,
    currentFloor: state.currentFloor,
    gridCols:     state.gridCols,
    gridRows:     state.gridRows,
    cellSize:     state.cellSize,
    stairConfig:  state.stairConfig,
    land:         state.land,       // Undo バグ修正: 土地も対象
    wallColor:    state.wallColor,  // Undo バグ修正: 壁色も対象
    compass:      state.compass,
    sunHour:      state.sunHour,
  });
}

function restoreSnapshot(snap) {
  const d = JSON.parse(snap);
  state.floors       = d.floors;
  state.currentFloor = d.currentFloor;
  state.gridCols     = d.gridCols;
  state.gridRows     = d.gridRows;
  state.cellSize     = d.cellSize;
  state.land         = d.land      ?? { points: [], closed: false };
  state.wallColor    = d.wallColor ?? '#1e293b';
  state.compass      = d.compass   ?? 0;
  state.sunHour      = d.sunHour   ?? 12;
  if (d.stairConfig) state.stairConfig = d.stairConfig;
}

export function pushUndo() {
  undoStack.push(snapshotState());
  redoStack.length = 0;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function resetUndoRedo() {
  undoStack.length = 0;
  redoStack.length = 0;
}

/**
 * @param {() => void} [onDone] - 状態復元後に呼ぶコールバック（grid再構築 + renderAll など）
 */
export function undo(onDone) {
  if (!undoStack.length) return;
  redoStack.push(snapshotState());
  restoreSnapshot(undoStack.pop());
  onDone?.();
}

export function redo(onDone) {
  if (!redoStack.length) return;
  undoStack.push(snapshotState());
  restoreSnapshot(redoStack.pop());
  onDone?.();
}
