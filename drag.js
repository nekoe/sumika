// マウスドラッグの共通ファクトリ
//
// 使用例:
//   createDragHandler({
//     onMove: e => { /* ドラッグ中 */ },
//     onUp:   e => { /* ドロップ時 */ },
//   });

export function createDragHandler({ onMove, onUp } = {}) {
  const handleMove = e => onMove?.(e);
  const handleUp   = e => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup',   handleUp);
    onUp?.(e);
  };
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup',   handleUp);
}
