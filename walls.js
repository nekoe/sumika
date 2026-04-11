// walls.js - 壁・ドア・窓のSVGレイヤー

export const ELEMENT_TOOLS = [
  { id: 'wall',        label: '壁',        icon: '▬', color: '#1e293b' },
  { id: 'lowwall',     label: '腰壁',      icon: '▭', color: '#64748b' },
  { id: 'door',        label: 'ドア',      icon: '🚪', color: '#92400e' },
  { id: 'slide_door',  label: '引き戸',    icon: '⬌', color: '#b45309' },
  { id: 'window',      label: '窓(標準)',  icon: '🪟', color: '#0ea5e9' },
  { id: 'window_tall', label: '掃き出し窓', icon: '🟦', color: '#0284c7' },
  { id: 'window_low',  label: '高窓',      icon: '🔲', color: '#7dd3fc' },
  { id: 'eraser',      label: '消しゴム',  icon: '🧹', color: '#ef4444', eraser: true },
];

// エッジの一意キー: "h:col:row" or "v:col:row"
export function edgeKey(col, row, dir) {
  return `${dir}:${col}:${row}`;
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
export function renderWallLayer(svgEl, elements, cs, cols, rows, hoveredEdge, mode, selectedKey) {
  svgEl.innerHTML = '';
  svgEl.setAttribute('width', cols * cs);
  svgEl.setAttribute('height', rows * cs);
  const passThrough = mode === 'room' || mode === 'stair' || mode === 'furniture' || mode === 'landscape';
  svgEl.style.pointerEvents = passThrough ? 'none' : 'all';
  svgEl.style.cursor = passThrough ? 'default' : 'crosshair';

  for (const el of elements) {
    const isSelected = selectedKey && edgeKey(el.col, el.row, el.dir) === selectedKey;
    renderElement(svgEl, el, cs, isSelected);
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

function renderElement(svgEl, el, cs, isSelected) {
  if (el.type === 'wall')        renderWall(svgEl, el.col, el.row, el.dir, cs);
  if (el.type === 'lowwall')     renderLowWall(svgEl, el.col, el.row, el.dir, cs);
  if (el.type === 'door')        renderDoor(svgEl, el.col, el.row, el.dir, cs, el.flip || false, isSelected);
  if (el.type === 'slide_door')  renderSlideDoor(svgEl, el.col, el.row, el.dir, cs);
  if (el.type === 'window')      renderWindow(svgEl, el.col, el.row, el.dir, cs, 'el-window');
  if (el.type === 'window_tall') renderWindow(svgEl, el.col, el.row, el.dir, cs, 'el-window-tall');
  if (el.type === 'window_low')  renderWindow(svgEl, el.col, el.row, el.dir, cs, 'el-window-low');
}

function renderWall(svgEl, col, row, dir, cs, color) {
  const c = edgeCoords(col, row, dir, cs);
  const line = svgLine(svgEl, c.x1, c.y1, c.x2, c.y2, 'el-wall');
  if (color) line.style.stroke = color;
}

function renderLowWall(svgEl, col, row, dir, cs, color) {
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
  if (color) { l1.style.stroke = color; l2.style.stroke = color; }
  g.appendChild(l1);
  g.appendChild(l2);
  svgEl.appendChild(g);
}

function renderDoor(svgEl, col, row, dir, cs, flip, isSelected) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', isSelected ? 'el-door el-door-selected' : 'el-door');
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

function renderSlideDoor(svgEl, col, row, dir, cs) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'el-slide-door');
  const x = col * cs, y = row * cs;
  const pw = cs * 0.6; // パネル幅（開口の60%）
  const bk = cs * 0.12; // 枠の突き出し長さ

  // ギャップ（白線でグリッド線を消す）
  const gap = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  if (dir === 'h') {
    gap.setAttribute('x1', x);    gap.setAttribute('y1', y);
    gap.setAttribute('x2', x+cs); gap.setAttribute('y2', y);
  } else {
    gap.setAttribute('x1', x); gap.setAttribute('y1', y);
    gap.setAttribute('x2', x); gap.setAttribute('y2', y+cs);
  }
  gap.setAttribute('class', 'el-door-gap');
  g.appendChild(gap);

  function mkLine(x1, y1, x2, y2, cls) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    if (cls) l.setAttribute('class', cls);
    return l;
  }

  if (dir === 'h') {
    // 両端枠（垂直方向の短い線）
    g.appendChild(mkLine(x,    y - bk, x,    y + bk, 'el-slide-frame'));
    g.appendChild(mkLine(x+cs, y - bk, x+cs, y + bk, 'el-slide-frame'));
    // ドアパネル（左端から右へ pw 分）
    g.appendChild(mkLine(x,    y - bk * 0.5, x + pw, y - bk * 0.5, 'el-slide-panel'));
    g.appendChild(mkLine(x,    y + bk * 0.5, x + pw, y + bk * 0.5, 'el-slide-panel'));
    g.appendChild(mkLine(x + pw, y - bk * 0.5, x + pw, y + bk * 0.5, 'el-slide-frame'));
  } else {
    // 両端枠（水平方向の短い線）
    g.appendChild(mkLine(x - bk, y,    x + bk, y,    'el-slide-frame'));
    g.appendChild(mkLine(x - bk, y+cs, x + bk, y+cs, 'el-slide-frame'));
    // ドアパネル（上端から下へ pw 分）
    g.appendChild(mkLine(x - bk * 0.5, y,    x - bk * 0.5, y + pw, 'el-slide-panel'));
    g.appendChild(mkLine(x + bk * 0.5, y,    x + bk * 0.5, y + pw, 'el-slide-panel'));
    g.appendChild(mkLine(x - bk * 0.5, y + pw, x + bk * 0.5, y + pw, 'el-slide-frame'));
  }

  svgEl.appendChild(g);
}

function renderWindow(svgEl, col, row, dir, cs, cls = 'el-window') {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', cls);
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
