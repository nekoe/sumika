// 部屋のリサイズハンドル

const HANDLES = [
  { dir: 'nw', cursor: 'nw-resize' },
  { dir: 'n',  cursor: 'n-resize'  },
  { dir: 'ne', cursor: 'ne-resize' },
  { dir: 'e',  cursor: 'e-resize'  },
  { dir: 'se', cursor: 'se-resize' },
  { dir: 's',  cursor: 's-resize'  },
  { dir: 'sw', cursor: 'sw-resize' },
  { dir: 'w',  cursor: 'w-resize'  },
];

export function attachResizeHandles(roomEl, getCellSize, onResize) {
  for (const h of HANDLES) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${h.dir}`;
    handle.style.cursor = h.cursor;
    handle.dataset.dir = h.dir;
    roomEl.appendChild(handle);

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      startResize(e, roomEl, h.dir, getCellSize, onResize);
    });

    handle.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      startResizeTouch(e, roomEl, h.dir, getCellSize, onResize);
    }, { passive: false });
  }
}

function startResize(e, roomEl, dir, getCellSize, onResize) {
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = parseInt(roomEl.dataset.w);
  const startH = parseInt(roomEl.dataset.h);
  const startRX = parseInt(roomEl.dataset.x);
  const startRY = parseInt(roomEl.dataset.y);

  const onMove = ev => {
    const cs = getCellSize();
    const dx = Math.round((ev.clientX - startX) / cs);
    const dy = Math.round((ev.clientY - startY) / cs);
    const result = calcResize(dir, startRX, startRY, startW, startH, dx, dy);
    onResize(roomEl.dataset.id, result);
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResizeTouch(e, roomEl, dir, getCellSize, onResize) {
  const touch = e.touches[0];
  const startX = touch.clientX;
  const startY = touch.clientY;
  const startW = parseInt(roomEl.dataset.w);
  const startH = parseInt(roomEl.dataset.h);
  const startRX = parseInt(roomEl.dataset.x);
  const startRY = parseInt(roomEl.dataset.y);

  const onMove = ev => {
    const t = ev.touches[0];
    const cs = getCellSize();
    const dx = Math.round((t.clientX - startX) / cs);
    const dy = Math.round((t.clientY - startY) / cs);
    const result = calcResize(dir, startRX, startRY, startW, startH, dx, dy);
    onResize(roomEl.dataset.id, result);
  };

  const onEnd = () => {
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  };

  document.addEventListener('touchmove', onMove, { passive: true });
  document.addEventListener('touchend', onEnd);
}

export function calcResize(dir, x, y, w, h, dx, dy) {
  let newX = x, newY = y, newW = w, newH = h;

  if (dir.includes('e')) newW = Math.max(1, w + dx);
  if (dir.includes('s')) newH = Math.max(1, h + dy);
  if (dir.includes('w')) {
    newW = Math.max(1, w - dx);
    newX = x + (w - newW);
  }
  if (dir.includes('n')) {
    newH = Math.max(1, h - dy);
    newY = y + (h - newH);
  }

  return { x: newX, y: newY, w: newW, h: newH };
}
