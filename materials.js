// 床材・壁材マスタ定義

export const FLOOR_MATERIALS = [
  { id: 'auto',     label: '自動' },        // 部屋タイプに従う
  { id: 'flooring', label: 'フローリング' },
  { id: 'tile',     label: 'タイル' },
  { id: 'tatami',   label: '畳' },
  { id: 'mortar',   label: '土間' },
  { id: 'carpet',   label: 'カーペット' },
  { id: 'marble',   label: '大理石' },
];

export function getFloorMaterialLabel(id) {
  return FLOOR_MATERIALS.find(m => m.id === (id ?? 'auto'))?.label ?? '自動';
}
