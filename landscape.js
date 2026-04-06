// 外構・植栽ブロックのタイプ定義

export const LANDSCAPE_TYPES = [
  { id: 'parking',  label: '駐車場',    icon: '🚗', color: '#d1d5db', defaultW: 2, defaultH: 3, minW: 1, minH: 1 },
  { id: 'garden',   label: '庭・芝生',  icon: '🌿', color: '#bbf7d0', defaultW: 3, defaultH: 3, minW: 1, minH: 1 },
  { id: 'tree',     label: '植栽・樹木', icon: '🌳', color: '#86efac', defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  { id: 'terrace',  label: 'テラス',    icon: '🪨', color: '#e5e7eb', defaultW: 2, defaultH: 2, minW: 1, minH: 1 },
];

export function getLandscapeTypeById(id) {
  return LANDSCAPE_TYPES.find(t => t.id === id) ?? LANDSCAPE_TYPES[0];
}
