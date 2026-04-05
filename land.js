// land.js - 土地形状描画モジュール
import { CELL_M } from './rooms.js';

export function initLandLayer(gridEl) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'land-layer';
  gridEl.prepend(svg);
  return svg;
}

export function calcCentroid(points) {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

export function rotatePointsAround(points, cx, cy, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return points.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

// ポリゴン内部判定（ray-casting、セル座標）
export function isPointInPolygon(pt, points) {
  const n = points.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function renderLand(svgEl, land, cellSize, gridCols, gridRows, previewPt) {
  svgEl.innerHTML = '';
  svgEl.setAttribute('width',  gridCols * cellSize);
  svgEl.setAttribute('height', gridRows * cellSize);

  const raw = land?.points ?? [];
  const closed = land?.closed ?? false;
  if (raw.length === 0 && !previewPt) return;

  const toP = p => ({ x: p.x * cellSize, y: p.y * cellSize });
  const pts = raw.map(toP);

  if (closed && pts.length >= 3) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('class', 'land-fill');
    svgEl.appendChild(poly);
  }

  const drawPts = [...pts];
  if (!closed && previewPt) drawPts.push(toP(previewPt));
  const N = drawPts.length;
  const edgeCount = closed ? N : N - 1;

  for (let i = 0; i < edgeCount; i++) {
    _drawSegment(svgEl, drawPts[i], drawPts[(i + 1) % N], cellSize);
  }

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', i === 0 ? 7 : 5);
    c.setAttribute('class', i === 0 ? 'land-point land-first' : 'land-point');
    svgEl.appendChild(c);
  }

}

function _drawSegment(svgEl, a, b, cellSize) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
  line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
  line.setAttribute('class', 'land-seg');
  svgEl.appendChild(line);

  const dxC = (b.x - a.x) / cellSize;
  const dyC = (b.y - a.y) / cellSize;
  const lenM = Math.sqrt(dxC * dxC + dyC * dyC) * CELL_M;
  if (lenM < 0.05) return;

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const label = lenM.toFixed(2) + 'm';
  const tw = label.length * 6.5 + 8;

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', mx - tw / 2); bg.setAttribute('y', my - 16);
  bg.setAttribute('width', tw); bg.setAttribute('height', 14);
  bg.setAttribute('rx', 3);
  bg.setAttribute('class', 'land-label-bg');
  svgEl.appendChild(bg);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', mx); text.setAttribute('y', my - 5);
  text.setAttribute('class', 'land-label');
  text.setAttribute('text-anchor', 'middle');
  text.textContent = label;
  svgEl.appendChild(text);
}

export function getLandPos(e, gridEl, cellSize) {
  const rect = gridEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left + gridEl.scrollLeft) / cellSize,
    y: (e.clientY - rect.top  + gridEl.scrollTop)  / cellSize,
  };
}

export function distPx(a, b, cellSize) {
  const dx = (a.x - b.x) * cellSize;
  const dy = (a.y - b.y) * cellSize;
  return Math.sqrt(dx * dx + dy * dy);
}

// 頂点ヒットテスト（クリック/ドラッグ開始検出用）
export function getHitVertex(e, gridEl, cellSize, land, threshold = 10) {
  const pos = getLandPos(e, gridEl, cellSize);
  const pts = land?.points ?? [];
  for (let i = 0; i < pts.length; i++) {
    if (distPx(pos, pts[i], cellSize) <= threshold) return i;
  }
  return -1;
}

export function calcLandArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  // cell² to m²
  return Math.abs(area / 2) * CELL_M * CELL_M;
}
