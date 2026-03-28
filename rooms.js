// 部屋のマスタデータとDOM生成

export const CELL_M = 0.91; // 1グリッドセル = 0.91m

export const ROOM_TYPES = [
  { id: 'ldk',      label: 'LDK',        defaultW: 6, defaultH: 4, color: '#FFF3E0', icon: '🍳' },
  { id: 'living',   label: 'リビング',   defaultW: 5, defaultH: 4, color: '#E8F5E9', icon: '🛋️' },
  { id: 'dining',   label: 'ダイニング', defaultW: 4, defaultH: 3, color: '#FFF9C4', icon: '🍽️' },
  { id: 'kitchen',  label: 'キッチン',   defaultW: 3, defaultH: 3, color: '#FCE4EC', icon: '🔥' },
  { id: 'bedroom',  label: '主寝室',     defaultW: 4, defaultH: 3, color: '#E3F2FD', icon: '🛏️' },
  { id: 'child',    label: '子供部屋',   defaultW: 3, defaultH: 3, color: '#F3E5F5', icon: '🧸' },
  { id: 'study',    label: '書斎',       defaultW: 3, defaultH: 3, color: '#E8EAF6', icon: '📚' },
  { id: 'bathroom', label: '浴室',       defaultW: 2, defaultH: 2, color: '#E0F7FA', icon: '🛁' },
  { id: 'toilet',   label: 'トイレ',     defaultW: 1, defaultH: 2, color: '#E8F5E9', icon: '🚽' },
  { id: 'washroom', label: '洗面所',     defaultW: 2, defaultH: 2, color: '#E1F5FE', icon: '🚿' },
  { id: 'genkan',   label: '玄関',       defaultW: 2, defaultH: 2, color: '#FFF8E1', icon: '🚪', isDoma: true },
  { id: 'doma',     label: '土間',       defaultW: 2, defaultH: 2, color: '#D6D0C8', icon: '👟', isDoma: true },
  { id: 'corridor', label: '廊下',       defaultW: 1, defaultH: 4, color: '#F5F5F5', icon: '➡️' },
  { id: 'storage',  label: '納戸/WIC',   defaultW: 2, defaultH: 2, color: '#EFEBE9', icon: '📦' },
  { id: 'garage',   label: '駐車場',     defaultW: 3, defaultH: 4, color: '#ECEFF1', icon: '🚗' },
  { id: 'balcony',  label: 'バルコニー', defaultW: 4, defaultH: 2, color: '#F1F8E9', icon: '🌿' },
  { id: 'void',     label: '吹き抜け',   defaultW: 4, defaultH: 4, color: '#dbeafe', icon: '⬜', isVoid: true },
  { id: 'custom',   label: 'カスタム',   defaultW: 3, defaultH: 3, color: '#FFFFFF', icon: '✏️' },
];

export function calcArea(w, h) {
  const area = w * h;
  return {
    tatami: (area / 2).toFixed(1),
    sqm:    (area * CELL_M * CELL_M).toFixed(1),
  };
}

export function calcAreaCells(cells) {
  const count = cells.length;
  return {
    tatami: (count / 2).toFixed(1),
    sqm:    (count * CELL_M * CELL_M).toFixed(1),
  };
}

export function getTypeById(typeId) {
  return ROOM_TYPES.find(t => t.id === typeId) || ROOM_TYPES[ROOM_TYPES.length - 1];
}

export function renderPalette(container) {
  container.innerHTML = '';
  for (const type of ROOM_TYPES) {
    const item = document.createElement('div');
    item.className = 'palette-item' + (type.isVoid ? ' palette-item-void' : '');
    item.draggable = true;
    item.dataset.typeId = type.id;
    item.style.backgroundColor = type.color;
    item.innerHTML = `
      <span class="palette-icon">${type.icon}</span>
      <span class="palette-label">${type.label}</span>
    `;
    container.appendChild(item);
  }
}

let roomCounter = 0;
export function generateId() {
  return `room_${Date.now()}_${roomCounter++}`;
}

export function createRoomData(typeId, x, y) {
  const type = getTypeById(typeId);
  const cells = [];
  for (let r = y; r < y + type.defaultH; r++)
    for (let c = x; c < x + type.defaultW; c++)
      cells.push(`${c},${r}`);
  return {
    id: generateId(),
    typeId,
    label: type.label,
    x, y,
    w: type.defaultW,
    h: type.defaultH,
    color: type.color,
    cells,
    isDoma: type.isDoma ?? false,
  };
}

export function createIrregularRoomData(typeId, cells) {
  const cols = cells.map(k => +k.split(',')[0]);
  const rows = cells.map(k => +k.split(',')[1]);
  const x = Math.min(...cols);
  const y = Math.min(...rows);
  const w = Math.max(...cols) - x + 1;
  const h = Math.max(...rows) - y + 1;
  const type = getTypeById(typeId);
  return {
    id: generateId(),
    typeId,
    label: type.label,
    x, y, w, h,
    color: type.color,
    cells,
    zones: [],
    isDoma: type.isDoma ?? false,
  };
}
