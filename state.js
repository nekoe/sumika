// アプリケーション状態（シングルトン）

export const AUTOSAVE_INTERVAL = 5000; // ms

// ── プロジェクトデータ（永続化対象）────────────────────────────
export const state = {
  gridCols: 20,
  gridRows: 15,
  cellSize: 44,
  currentFloor: 0,
  floors: [
    { rooms: [], elements: [], stairs: [], furniture: [] },
    { rooms: [], elements: [], stairs: [], furniture: [] },
  ],
  mode: 'room',
  elementTool: 'wall',
  wallColor: '#1e293b',
  furnitureType: 'kitchen',
  compass: 0,
  sunHour: 12,
  stairConfig: { w: 2, h: 3, dir: 'n' },
  land:      { points: [], closed: false },
  landscape: [],
};

// 仮想プロパティ：currentFloor に基づいて floors[] を参照
Object.defineProperty(state, 'rooms',     { get() { return this.floors[this.currentFloor].rooms;     }, set(v) { this.floors[this.currentFloor].rooms     = v; }, enumerable: false });
Object.defineProperty(state, 'elements',  { get() { return this.floors[this.currentFloor].elements;  }, set(v) { this.floors[this.currentFloor].elements  = v; }, enumerable: false });
Object.defineProperty(state, 'stairs',    { get() { return this.floors[this.currentFloor].stairs;    }, set(v) { this.floors[this.currentFloor].stairs    = v; }, enumerable: false });
Object.defineProperty(state, 'furniture', { get() { return this.floors[this.currentFloor].furniture; }, set(v) { this.floors[this.currentFloor].furniture = v; }, enumerable: false });

// ── 一時的な UI 状態（永続化しない）──────────────────────────
export const ui = {
  grid: null,
  toolbar: null,
  svgEl: null,
  landSvg: null,
  paintCanvas: null,
  // 選択
  selectedId: null,
  selectedStairId: null,
  selectedFurnitureId: null,
  multiSelected: new Set(),
  multiMoveDragging: false,
  multiIncludesElements: false,
  multiIncludesAllFloors: false,
  // セル編集
  paintCells: null,
  paintMode: null,
  editingRoomId: null,
  // 土地ドラッグ
  landPreview: null,
  landDragIdx: -1,
  landDragged: false,
  landRotating: false,
  landRotated: false,
  landRotateCenter: null,
  landRotateStartAngle: 0,
  landRotateStartPoints: null,
  landMoving: false,
  landMoveStartPos: null,
  landMoveStartPoints: null,
  landMoved: false,
  // 建具
  hoveredEdge: null,
  eraserDragging: false,
  selectedElementKey: null,
  // 外構
  selectedLandscapeId: null,
};
