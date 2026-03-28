// zones.js - 部屋内ゾーン（サブスペース）

let zoneCounter = 0;

export function generateZoneId() {
  return `zone_${Date.now()}_${zoneCounter++}`;
}

export const ZONE_PRESETS = [
  { label: '土間',       color: '#CFD8DC' },
  { label: '押し入れ',   color: '#D7CCC8' },
  { label: 'クローゼット', color: '#F5F5F5' },
  { label: 'パントリー', color: '#FFF9C4' },
  { label: 'ユーティリティ', color: '#E0F7FA' },
  { label: 'ワークスペース', color: '#E8EAF6' },
  { label: '床の間',     color: '#FFF8E1' },
  { label: 'カウンター', color: '#EFEBE9' },
];

export function createZoneData(label = '土間', color = '#CFD8DC') {
  return {
    id: generateZoneId(),
    label,
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    color,
  };
}

// ゾーンDIVをroom-block内にレンダリング
export function renderZones(roomEl, room, cs, { onSelectZone, onZoneUpdate }) {
  roomEl.querySelectorAll('.zone-block').forEach(el => el.remove());
  if (!room.zones) return;

  for (const zone of room.zones) {
    const el = createZoneElement(zone, room, cs, { onSelectZone, onZoneUpdate });
    roomEl.appendChild(el);
  }
}

function createZoneElement(zone, room, cs, { onSelectZone, onZoneUpdate }) {
  const el = document.createElement('div');
  el.className = 'zone-block';
  el.dataset.id = zone.id;
  el.style.left   = zone.x * cs + 'px';
  el.style.top    = zone.y * cs + 'px';
  el.style.width  = zone.w * cs + 'px';
  el.style.height = zone.h * cs + 'px';
  el.style.backgroundColor = zone.color;
  el.innerHTML = `<span class="zone-label">${zone.label}</span>`;

  // クリック → ゾーン選択
  el.addEventListener('click', e => {
    e.stopPropagation();
    onSelectZone(zone.id);
  });

  // ドラッグで移動（mousedown/mousemove）
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.zone-resize-handle')) return;
    e.stopPropagation();
    e.preventDefault();
    startZoneDrag(e, el, zone, room, cs, onZoneUpdate);
  });

  // リサイズハンドル（SE方向のみシンプルに）
  const handle = document.createElement('div');
  handle.className = 'zone-resize-handle';
  el.appendChild(handle);
  handle.addEventListener('mousedown', e => {
    e.stopPropagation();
    e.preventDefault();
    startZoneResize(e, el, zone, room, cs, onZoneUpdate);
  });

  return el;
}

function startZoneDrag(e, el, zone, room, cs, onZoneUpdate) {
  const startMouseX = e.clientX;
  const startMouseY = e.clientY;
  const startX = zone.x;
  const startY = zone.y;

  el.style.opacity = '0.7';

  const onMove = ev => {
    const dx = Math.round((ev.clientX - startMouseX) / cs);
    const dy = Math.round((ev.clientY - startMouseY) / cs);
    const newX = Math.max(0, Math.min(room.w - zone.w, startX + dx));
    const newY = Math.max(0, Math.min(room.h - zone.h, startY + dy));
    el.style.left = newX * cs + 'px';
    el.style.top  = newY * cs + 'px';
    zone.x = newX;
    zone.y = newY;
  };

  const onUp = () => {
    el.style.opacity = '';
    onZoneUpdate(zone);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startZoneResize(e, el, zone, room, cs, onZoneUpdate) {
  const startMouseX = e.clientX;
  const startMouseY = e.clientY;
  const startW = zone.w;
  const startH = zone.h;

  const onMove = ev => {
    const dw = Math.round((ev.clientX - startMouseX) / cs);
    const dh = Math.round((ev.clientY - startMouseY) / cs);
    zone.w = Math.max(1, Math.min(room.w - zone.x, startW + dw));
    zone.h = Math.max(1, Math.min(room.h - zone.y, startH + dh));
    el.style.width  = zone.w * cs + 'px';
    el.style.height = zone.h * cs + 'px';
  };

  const onUp = () => {
    onZoneUpdate(zone);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
