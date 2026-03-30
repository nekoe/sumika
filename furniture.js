// 家具タイプ定義

export const FURNITURE_TYPES = [
  { id: 'kitchen', label: 'キッチン', icon: '🍳', color: '#e2e8e0', defaultW: 3, defaultH: 1, minW: 1, minH: 1 },
  { id: 'chair',   label: '椅子',     icon: '🪑', color: '#fef3c7', defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  { id: 'table',   label: 'テーブル', icon: '🪵', color: '#fde8c8', defaultW: 2, defaultH: 2, minW: 1, minH: 1 },
  { id: 'washer',  label: '洗濯機',   icon: '🫧', color: '#e0f2fe', defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  { id: 'sink',    label: '洗面台',   icon: '🪥', color: '#f0fdfa', defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  { id: 'fridge',  label: '冷蔵庫',   icon: '🧊', color: '#f1f5f9', defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  { id: 'custom',  label: 'カスタム', icon: '📦', color: '#f3f4f6', defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
];

export function getFurnitureTypeById(id) {
  return FURNITURE_TYPES.find(t => t.id === id) ?? FURNITURE_TYPES[0];
}
