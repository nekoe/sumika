// walls.js - 壁・ドア・窓のSVGレイヤー

export const ELEMENT_TOOLS = [
  { id: 'wall',    label: '壁',    icon: '▬', color: '#1e293b' },
  { id: 'lowwall', label: '腰壁',  icon: '▭', color: '#64748b' },
  { id: 'door',    label: 'ドア',  icon: '🚪', color: '#92400e' },
  { id: 'window',  label: '窓',    icon: '🪟', color: '#0ea5e9' },
];

// エッジの一意キー: "h:col:row" or "v:col:row"
export function edgeKey(col, row, dir) {
  return `${dir}:${col}:${row}`;
}
export function parseEdgeKey(key) {
  const [dir, col, row] = key.split(':');
  return { dir, col: +col, row: +row };
}

// SVGレイヤーをグリッド内に生成
export function initWallLayer(gridEl) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'wall-layer';
  gridEl.appendChild(svg);
  return svg;
}

// マウス位置からエッジを取得（しきい値20%以内のとき有効）
export function getEdgeAt(e, gridEl, cs) {
  const rect = gridEl.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  return pixelToEdge(px, py, cs);
}

function pixelToEdge(px, py, cs) {
  const col = Math.floor(px / cs);
  const row = Math.floor(py / cs);
  const fx = (px - col * cs) / cs;
  const fy = (py - row * cs) / cs;

  const THRESH = 0.22;
  const dTop = fy, dBot = 1 - fy, dLeft = fx, dRight = 1 - fx;
  const dMin = Math.min(dTop, dBot, dLeft, dRight);
  if (dMin > THRESH) return null;

  if (dMin === dTop)   return { dir: 'h', col, row };
  if (dMin === dBot)   return { dir: 'h', col, row: row + 1 };
  if (dMin === dLeft)  return { dir: 'v', col, row };
                       return { dir: 'v', col: col + 1, row };
}

// SVGに全要素をレンダリング
export function renderWallLayer(svgEl, elements, cs, cols, rows, hoveredEdge, mode) {
  svgEl.innerHTML = '';
  svgEl.setAttribute('width', cols * cs);
  svgEl.setAttribute('height', rows * cs);
  const passThrough = mode === 'room' || mode === 'stair' || mode === 'furniture';
  svgEl.style.pointerEvents = passThrough ? 'none' : 'all';
  svgEl.style.cursor = passThrough ? 'default' : 'crosshair';

  for (const el of elements) {
    renderElement(svgEl, el, cs);
  }

  if (hoveredEdge && mode !== 'room') {
    const exists = elements.some(e =>
      e.col === hoveredEdge.col && e.row === hoveredEdge.row && e.dir === hoveredEdge.dir
    );
    renderHoverPreview(svgEl, hoveredEdge, cs, exists);
  }
}

function edgeCoords(col, row, dir, cs) {
  return dir === 'h'
    ? { x1: col * cs, y1: row * cs, x2: (col + 1) * cs, y2: row * cs }
    : { x1: col * cs, y1: row * cs, x2: col * cs, y2: (row + 1) * cs };
}

function svgLine(parent, x1, y1, x2, y2, cls) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', x1); el.setAttribute('y1', y1);
  el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  el.setAttribute('class', cls);
  parent.appendChild(el);
  return el;
}

function renderElement(svgEl, el, cs) {
  if (el.type === 'wall')    renderWall(svgEl, el.col, el.row, el.dir, cs);
  if (el.type === 'lowwall') renderLowWall(svgEl, el.col, el.row, el.dir, cs);
  if (el.type === 'door')    renderDoor(svgEl, el.col, el.row, el.dir, cs, el.flip || false);
  if (el.type === 'window')  renderWindow(svgEl, el.col, el.row, el.dir, cs);
}

function renderWall(svgEl, col, row, dir, cs) {
  const c = edgeCoords(col, row, dir, cs);
  svgLine(svgEl, c.x1, c.y1, c.x2, c.y2, 'el-wall');
}

function renderLowWall(svgEl, col, row, dir, cs) {
  const c = edgeCoords(col, row, dir, cs);
  // 腰壁：細い二重線で「低い壁」を表現
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'el-lowwall');
  const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  if (dir === 'h') {
    l1.setAttribute('x1', c.x1); l1.setAttribute('y1', c.y1 - 2);
    l1.setAttribute('x2', c.x2); l1.setAttribute('y2', c.y2 - 2);
    l2.setAttribute('x1', c.x1); l2.setAttribute('y1', c.y1 + 2);
    l2.setAttribute('x2', c.x2); l2.setAttribute('y2', c.y2 + 2);
  } else {
    l1.setAttribute('x1', c.x1 - 2); l1.setAttribute('y1', c.y1);
    l1.setAttribute('x2', c.x2 - 2); l1.setAttribute('y2', c.y2);
    l2.setAttribute('x1', c.x1 + 2); l2.setAttribute('y1', c.y1);
    l2.setAttribute('x2', c.x2 + 2); l2.setAttribute('y2', c.y2);
  }
  g.appendChild(l1);
  g.appendChild(l2);
  svgEl.appendChild(g);
}

function renderDoor(svgEl, col, row, dir, cs, flip) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'el-door');
  const x = col * cs, y = row * cs;

  // ギャップ（白線でグリッド線を消す）
  const gap = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  if (dir === 'h') {
    gap.setAttribute('x1', x);   gap.setAttribute('y1', y);
    gap.setAttribute('x2', x+cs); gap.setAttribute('y2', y);
  } else {
    gap.setAttribute('x1', x); gap.setAttribute('y1', y);
    gap.setAttribute('x2', x); gap.setAttribute('y2', y+cs);
  }
  gap.setAttribute('class', 'el-door-gap');
  g.appendChild(gap);

  // ドア扉線 + 弧
  const panel = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  const arc   = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arc.setAttribute('fill', 'none');

  if (dir === 'h') {
    if (!flip) {
      // 蝶番:左、扉:上へ
      panel.setAttribute('x1', x);   panel.setAttribute('y1', y);
      panel.setAttribute('x2', x);   panel.setAttribute('y2', y - cs);
      arc.setAttribute('d', `M ${x} ${y - cs} A ${cs} ${cs} 0 0 1 ${x + cs} ${y}`);
    } else {
      // 蝶番:右、扉:上へ
      panel.setAttribute('x1', x+cs); panel.setAttribute('y1', y);
      panel.setAttribute('x2', x+cs); panel.setAttribute('y2', y - cs);
      arc.setAttribute('d', `M ${x + cs} ${y - cs} A ${cs} ${cs} 0 0 0 ${x} ${y}`);
    }
  } else {
    if (!flip) {
      // 蝶番:上、扉:右へ
      panel.setAttribute('x1', x); panel.setAttribute('y1', y);
      panel.setAttribute('x2', x + cs); panel.setAttribute('y2', y);
      arc.setAttribute('d', `M ${x + cs} ${y} A ${cs} ${cs} 0 0 1 ${x} ${y + cs}`);
    } else {
      // 蝶番:下、扉:右へ
      panel.setAttribute('x1', x); panel.setAttribute('y1', y + cs);
      panel.setAttribute('x2', x + cs); panel.setAttribute('y2', y + cs);
      arc.setAttribute('d', `M ${x + cs} ${y + cs} A ${cs} ${cs} 0 0 0 ${x} ${y}`);
    }
  }

  panel.setAttribute('class', 'el-door-panel');
  arc.setAttribute('class', 'el-door-arc');
  g.appendChild(panel);
  g.appendChild(arc);
  svgEl.appendChild(g);
}

function renderWindow(svgEl, col, row, dir, cs) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'el-window');
  const x = col * cs, y = row * cs;

  // 窓記号: 辺の上に3本平行線（外壁・ガラス2枚）
  const offs = [-4, 0, 4];
  for (const off of offs) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    if (dir === 'h') {
      line.setAttribute('x1', x); line.setAttribute('y1', y + off);
      line.setAttribute('x2', x + cs); line.setAttribute('y2', y + off);
    } else {
      line.setAttribute('x1', x + off); line.setAttribute('y1', y);
      line.setAttribute('x2', x + off); line.setAttribute('y2', y + cs);
    }
    g.appendChild(line);
  }
  svgEl.appendChild(g);
}

function renderHoverPreview(svgEl, edge, cs, willRemove) {
  const c = edgeCoords(edge.col, edge.row, edge.dir, cs);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', c.x1); line.setAttribute('y1', c.y1);
  line.setAttribute('x2', c.x2); line.setAttribute('y2', c.y2);
  line.setAttribute('class', willRemove ? 'el-preview el-preview-remove' : 'el-preview');
  svgEl.appendChild(line);
}
