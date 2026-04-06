// SVG / PNG / PDF 出力

import { state, ui } from './state.js';
import { getTypeById, calcAreaCells, CELL_M } from './rooms.js';
import { getFurnitureTypeById } from './furniture.js';
import { getLandscapeTypeById } from './landscape.js';
import { escText } from './room-utils.js';

export function buildSVGString() {
  const cs = state.cellSize;
  const W  = state.gridCols * cs;
  const H  = state.gridRows * cs;

  const DIRS_LABEL = { n: '↑', s: '↓', e: '→', w: '←' };

  const css = `
    .el-wall { stroke: #1e293b; stroke-width: 5; stroke-linecap: round; }
    .el-lowwall line { stroke: #64748b; stroke-width: 2; stroke-linecap: round; }
    .el-door-gap { stroke: #fff; stroke-width: 6; }
    .el-door-panel { stroke: #7c3aed; stroke-width: 2; }
    .el-door-arc { stroke: #7c3aed; stroke-width: 1.5; fill: none; }
    .el-window line:nth-child(1), .el-window line:nth-child(3) { stroke: #0ea5e9; stroke-width: 2; }
    .el-window line:nth-child(2) { stroke: #0ea5e9; stroke-width: 4; }
    .el-window-tall line:nth-child(1), .el-window-tall line:nth-child(3) { stroke: #0284c7; stroke-width: 2; }
    .el-window-tall line:nth-child(2) { stroke: #0284c7; stroke-width: 6; }
    .el-window-low line:nth-child(1), .el-window-low line:nth-child(3) { stroke: #38bdf8; stroke-width: 1.5; stroke-dasharray: 4 2; }
    .el-window-low line:nth-child(2) { stroke: #38bdf8; stroke-width: 3; }
    .land-fill { fill: rgba(34,197,94,0.12); stroke: none; }
    .land-seg { stroke: #16a34a; stroke-width: 2; }
    .land-point { fill: #16a34a; stroke: #fff; stroke-width: 1.5; }
    .land-first { fill: #dc2626; }
    .land-label-bg { fill: rgba(255,255,255,0.9); }
    .land-label { font-size: 11px; fill: #166534; font-family: sans-serif; }
  `;

  let inner = '';

  // 白背景
  inner += `<rect width="${W}" height="${H}" fill="#fff"/>`;

  // グリッド線
  inner += `<g stroke="#e2e8f0" stroke-width="0.5">`;
  for (let c = 0; c <= state.gridCols; c++) inner += `<line x1="${c*cs}" y1="0" x2="${c*cs}" y2="${H}"/>`;
  for (let r = 0; r <= state.gridRows; r++) inner += `<line x1="0" y1="${r*cs}" x2="${W}" y2="${r*cs}"/>`;
  inner += `</g>`;

  // 土地ポリゴン (fill)
  const land = state.land;
  if (land?.closed && land.points.length >= 3) {
    const ptStr = land.points.map(p => `${p.x * cs},${p.y * cs}`).join(' ');
    inner += `<polygon points="${ptStr}" class="land-fill"/>`;
  }

  // 部屋セル・ラベル・階段（カレントフロア）
  const fl = state.floors[state.currentFloor];
  for (const room of (fl.rooms || [])) {
    const type = getTypeById(room.typeId);
    const color = room.color || type.color;
    for (const key of (room.cells || [])) {
      const [col, row] = key.split(',').map(Number);
      inner += `<rect x="${col*cs}" y="${row*cs}" width="${cs}" height="${cs}" fill="${color}"/>`;
    }
    const rx = room.x * cs, ry = room.y * cs;
    const rw = room.w * cs, rh = room.h * cs;
    const cx = rx + rw / 2, cy = ry + rh / 2;
    const icon = room.icon ?? type.icon;
    const { tatami } = calcAreaCells(room.cells);
    const STRIP_H = 16;
    inner += `<rect x="${rx}" y="${ry}" width="${rw}" height="${STRIP_H}" fill="rgba(255,255,255,0.55)"/>`;
    inner += `<text x="${rx + 5}" y="${ry + 11}" font-size="10" font-weight="600" font-family="sans-serif" fill="rgba(0,0,0,0.8)">${escText(room.label)}</text>`;
    inner += `<text x="${rx + rw - 5}" y="${ry + 11}" text-anchor="end" font-size="10" font-family="sans-serif" fill="#6b7280">${escText(tatami)}畳</text>`;
    inner += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="20" font-family="sans-serif">${escText(icon)}</text>`;
  }
  for (const s of (fl.stairs || [])) {
    inner += `<rect x="${s.x*cs}" y="${s.y*cs}" width="${s.w*cs}" height="${s.h*cs}" fill="url(#stair-stripe)" stroke="#b8a080" stroke-width="1" stroke-dasharray="4 3" rx="2"/>`;
    const scx = (s.x + s.w / 2) * cs;
    const scy = (s.y + s.h / 2) * cs;
    const arrow = DIRS_LABEL[s.dir || 'n'];
    inner += `<text x="${scx}" y="${scy + 5}" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#475569">🪜${escText(arrow)}</text>`;
  }

  // 外構・植栽ブロック
  for (const ls of (state.landscape || [])) {
    const ltype = getLandscapeTypeById(ls.typeId);
    const lsColor = ls.color ?? ltype.color;
    const lsIcon  = ls.icon  ?? ltype.icon;
    const lsLabel = ls.label ?? ltype.label;
    inner += `<rect x="${ls.x*cs}" y="${ls.y*cs}" width="${ls.w*cs}" height="${ls.h*cs}" fill="${escText(lsColor)}" stroke="#94a3b8" stroke-width="0.5" rx="2" opacity="0.75"/>`;
    const lcx = (ls.x + ls.w / 2) * cs;
    const lcy = (ls.y + ls.h / 2) * cs;
    inner += `<text x="${lcx}" y="${lcy - 4}" text-anchor="middle" font-size="14" font-family="sans-serif">${escText(lsIcon)}</text>`;
    inner += `<text x="${lcx}" y="${lcy + 11}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#475569">${escText(lsLabel)}</text>`;
  }

  // 家具（カレントフロア）
  for (const furn of (state.furniture || [])) {
    const ftype = getFurnitureTypeById(furn.typeId);
    const furnColor = furn.color ?? ftype.color;
    const furnIcon  = furn.icon  ?? ftype.icon;
    const furnLabel = furn.label ?? ftype.label;
    inner += `<rect x="${furn.x*cs}" y="${furn.y*cs}" width="${furn.w*cs}" height="${furn.h*cs}" fill="${furnColor}" stroke="#cbd5e1" stroke-width="0.5" rx="2"/>`;
    const fcx = (furn.x + furn.w / 2) * cs;
    const fcy = (furn.y + furn.h / 2) * cs;
    inner += `<text x="${fcx}" y="${fcy - 4}" text-anchor="middle" font-size="14" font-family="sans-serif">${escText(furnIcon)}</text>`;
    inner += `<text x="${fcx}" y="${fcy + 11}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#475569">${escText(furnLabel)}</text>`;
  }

  // 壁・ドア・窓レイヤー
  if (ui.svgEl) {
    const wallClone = ui.svgEl.cloneNode(true);
    wallClone.querySelectorAll('.el-preview').forEach(n => n.remove());
    const ser = new XMLSerializer();
    const wallContent = Array.from(wallClone.childNodes).map(n => ser.serializeToString(n)).join('');
    inner += `<g id="wall-layer">${wallContent}</g>`;
  }

  // 土地レイヤー（セグメント・ラベル・頂点のみ）
  if (ui.landSvg) {
    const landClone = ui.landSvg.cloneNode(true);
    landClone.querySelectorAll('.land-fill').forEach(n => n.remove());
    const ser2 = new XMLSerializer();
    const landContent = Array.from(landClone.childNodes).map(n => ser2.serializeToString(n)).join('');
    inner += `<g id="land-lines">${landContent}</g>`;
  }

  // コンパスインジケーター（グリッド左上）
  const compassDeg = state.compass ?? 0;
  const COMPASS_LABELS = ['北↑', '北東↗', '東→', '南東↘', '南↓', '南西↙', '西←', '北西↖'];
  const compassText = `${COMPASS_LABELS[Math.round(compassDeg / 45) % 8]} ${compassDeg}°`;
  inner += `
    <g transform="translate(8,8)">
      <rect width="44" height="44" rx="22" fill="rgba(255,255,255,0.85)" stroke="#e2e8f0" stroke-width="1"/>
      <g transform="rotate(${compassDeg},22,22)">
        <polygon points="22,16 15,38 22,32 29,38" fill="#ef4444" opacity="0.85"/>
        <text x="22" y="12" text-anchor="middle" font-size="11" font-weight="700" font-family="sans-serif" fill="#ef4444">N</text>
      </g>
      <title>方位: ${escText(compassText)}</title>
    </g>
    <text x="30" y="60" text-anchor="middle" font-size="9" font-family="sans-serif" fill="rgba(30,41,59,0.75)" font-weight="600">${escText(compassText)}</text>`;

  const defs = `
  <defs>
    <style><![CDATA[${css}]]></style>
    <pattern id="stair-stripe" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="10" fill="rgba(180,160,130,0.3)"/>
      <rect x="4" width="6" height="10" fill="rgba(240,232,220,0.3)"/>
    </pattern>
  </defs>`;

  return {
    svgStr: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs}
  ${inner}
</svg>`,
    W,
    H,
  };
}

export function exportSVG() {
  const { svgStr } = buildSVGString();
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `madori_${state.currentFloor + 1}F_${new Date().toISOString().slice(0, 10)}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPNG() {
  const { svgStr, W, H } = buildSVGString();
  const blob   = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(blob);
  const img    = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(svgUrl);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `madori_${state.currentFloor + 1}F_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };
  img.src = svgUrl;
}

export function handlePrint() {
  const gridEl  = document.getElementById('grid');
  const gridW   = state.gridCols * state.cellSize;
  const gridH   = state.gridRows * state.cellSize;
  const printW  = 680, printH = 960; // A4縦 印刷可能域
  const scale   = Math.min(printW / gridW, printH / gridH, 1);

  const headerEl = document.getElementById('print-header');
  const floorLabel = `${state.currentFloor + 1}F`;
  const rooms = state.rooms.filter(r => r.typeId !== 'garage');
  const cellCount = rooms.reduce((s, r) => s + (r.cells?.length ?? 0), 0);
  const sqm   = (cellCount * CELL_M * CELL_M).toFixed(1);
  const tsubo = (cellCount / 4).toFixed(2);
  const dateStr = new Date().toLocaleDateString('ja-JP');
  headerEl.innerHTML =
    `<b>間取り図</b>&ensp;${floorLabel}&ensp;` +
    `延床面積: <b>${sqm}㎡</b>（${tsubo}坪）&ensp;` +
    `<span class="print-date">${dateStr}</span>`;

  gridEl.style.transformOrigin = 'top left';
  gridEl.style.transform       = `scale(${scale})`;
  gridEl.style.marginRight     = `${gridW  * (scale - 1)}px`;
  gridEl.style.marginBottom    = `${gridH * (scale - 1)}px`;
  document.body.classList.add('printing');

  const restore = () => {
    gridEl.style.transform    = '';
    gridEl.style.marginRight  = '';
    gridEl.style.marginBottom = '';
    headerEl.innerHTML = '';
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
