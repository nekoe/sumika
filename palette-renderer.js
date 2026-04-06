// モード別パレット描画

import { state, ui } from './state.js';
import { ELEMENT_TOOLS, renderWallLayer } from './walls.js';
import { FURNITURE_TYPES } from './furniture.js';
import { LANDSCAPE_TYPES } from './landscape.js';
import { saveProject } from './storage.js';

let _handleModeChange = null;

export function initPaletteRenderer({ handleModeChange }) {
  _handleModeChange = handleModeChange;
}

export function renderElementPalette() {
  const paletteEl = document.getElementById('palette');
  paletteEl.innerHTML = '<div class="palette-section-title">建具</div>';
  for (const t of ELEMENT_TOOLS) {
    const item = document.createElement('div');
    item.className = 'palette-item' + (state.mode === t.id ? ' active' : '') + (t.eraser ? ' palette-eraser' : '');
    item.innerHTML = `<span class="palette-icon">${t.icon}</span><span class="palette-label">${t.label}</span>`;
    item.addEventListener('click', () => {
      _handleModeChange?.(t.id);
      ui.toolbar?.setMode(t.id);
    });
    paletteEl.appendChild(item);
  }
  const colorRow = document.createElement('div');
  colorRow.className = 'palette-color-row';
  colorRow.innerHTML = `<span class="palette-color-label">🎨 壁色</span><input type="color" id="wall-color-pick" value="${state.wallColor ?? '#1e293b'}">`;
  paletteEl.appendChild(colorRow);
  document.getElementById('wall-color-pick').addEventListener('input', e => {
    const color = e.target.value;
    state.wallColor = color;
    state.floors.forEach(fl => fl.elements.forEach(el => { el.color = color; }));
    renderWallLayer(ui.svgEl, state.elements, state.cellSize, state.gridCols, state.gridRows, ui.hoveredEdge, state.mode);
    saveProject(state);
  });
}

export function renderStairPalette() {
  const paletteEl = document.getElementById('palette');
  paletteEl.innerHTML = '<div class="palette-section-title">階段</div>';
  const item = document.createElement('div');
  item.className = 'palette-item';
  item.draggable = true;
  item.dataset.stairItem = '1';
  item.style.background = 'rgba(240,232,220,0.8)';
  item.innerHTML = `<span class="palette-icon">🪜</span><span class="palette-label">階段</span>`;
  paletteEl.appendChild(item);
}

export function renderFurniturePalette() {
  const paletteEl = document.getElementById('palette');
  paletteEl.innerHTML = '<div class="palette-section-title">家具</div>';
  for (const ftype of FURNITURE_TYPES) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.dataset.furnTypeId = ftype.id;
    item.style.background = ftype.color;
    item.innerHTML = `<span class="palette-icon">${ftype.icon}</span><span class="palette-label">${ftype.label}</span>`;
    paletteEl.appendChild(item);
  }
}

export function renderLandscapePalette() {
  const paletteEl = document.getElementById('palette');
  paletteEl.innerHTML = '<div class="palette-section-title">外構・植栽</div>';
  for (const ltype of LANDSCAPE_TYPES) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.dataset.landscapeTypeId = ltype.id;
    item.style.background = ltype.color;
    item.innerHTML = `<span class="palette-icon">${ltype.icon}</span><span class="palette-label">${ltype.label}</span>`;
    paletteEl.appendChild(item);
  }
}
