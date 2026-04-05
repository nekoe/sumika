// 土地モードのマウスイベントハンドラ

import { state, ui } from './state.js';
import { pushUndo } from './undo.js';
import { saveProject } from './storage.js';
import {
  getLandPos, distPx, getHitVertex, calcCentroid,
  rotatePointsAround, isPointInPolygon,
} from './land.js';

export function initLandHandlers(gridEl, { renderLandLayer }) {

  // ── mousedown: 頂点ドラッグ / 回転 / 全体移動の開始 ────────
  gridEl.addEventListener('mousedown', e => {
    if (state.mode !== 'land') return;
    const cs  = state.cellSize;
    const pos = getLandPos(e, gridEl, cs);

    const idx = getHitVertex(e, gridEl, cs, state.land);
    if (idx !== -1) {
      e.preventDefault();
      if (idx === 0 && state.land?.closed && (state.land.points?.length ?? 0) >= 3) {
        // 赤い頂点 → 回転開始
        const c = calcCentroid(state.land.points);
        ui.landRotating          = true;
        ui.landRotated           = false;
        ui.landRotateCenter      = c;
        ui.landRotateStartAngle  = Math.atan2(pos.y - c.y, pos.x - c.x);
        ui.landRotateStartPoints = state.land.points.map(p => ({ ...p }));
      } else {
        // その他の頂点 → 頂点移動
        ui.landDragIdx = idx;
        ui.landDragged = false;
      }
      return;
    }

    // ポリゴン内部クリック → 全体移動
    if (state.land?.closed && (state.land.points?.length ?? 0) >= 3) {
      if (isPointInPolygon(pos, state.land.points)) {
        e.preventDefault();
        ui.landMoving          = true;
        ui.landMoveStartPos    = pos;
        ui.landMoveStartPoints = state.land.points.map(p => ({ ...p }));
        ui.landMoved = false;
      }
    }
  });

  // ── mouseup: ドラッグ終了 ─────────────────────────��────────
  document.addEventListener('mouseup', () => {
    if (ui.landRotating) {
      const didRotate = ui.landRotated;
      ui.landRotating = false; ui.landRotated = false; ui.landRotateStartPoints = null;
      if (didRotate) saveProject(state);
      return;
    }
    if (ui.landMoving) {
      ui.landMoving = false; ui.landMoveStartPos = null; ui.landMoveStartPoints = null;
      if (ui.landMoved) saveProject(state);
      ui.landMoved = false; return;
    }
    if (ui.landDragIdx < 0) return;
    ui.landDragIdx = -1;
    if (ui.landDragged) saveProject(state);
    ui.landDragged = false;
  });

  // ── mousemove: 回転 / 移動 / 頂点ドラッグ / プレビュー ────
  gridEl.addEventListener('mousemove', e => {
    if (state.mode !== 'land') return;
    const cs = state.cellSize;

    if (ui.landRotating && ui.landRotateStartPoints) {
      const pos   = getLandPos(e, gridEl, cs);
      const angle = Math.atan2(pos.y - ui.landRotateCenter.y, pos.x - ui.landRotateCenter.x);
      const delta = angle - ui.landRotateStartAngle;
      if (!ui.landRotated) { pushUndo(); ui.landRotated = true; }
      state.land  = {
        ...state.land,
        points: rotatePointsAround(ui.landRotateStartPoints, ui.landRotateCenter.x, ui.landRotateCenter.y, delta),
      };
      renderLandLayer(); return;
    }

    if (ui.landMoving && ui.landMoveStartPoints) {
      const pos = getLandPos(e, gridEl, cs);
      const dx  = pos.x - ui.landMoveStartPos.x;
      const dy  = pos.y - ui.landMoveStartPos.y;
      if (!ui.landMoved) pushUndo();
      state.land = {
        ...state.land,
        points: ui.landMoveStartPoints.map(p => ({ x: p.x + dx, y: p.y + dy })),
      };
      ui.landMoved = true;
      renderLandLayer(); return;
    }

    if (ui.landDragIdx >= 0) {
      const pos = getLandPos(e, gridEl, cs);
      const pts = [...(state.land?.points ?? [])];
      pts[ui.landDragIdx] = pos;
      if (!ui.landDragged) pushUndo();
      state.land = { ...state.land, points: pts };
      ui.landDragged = true;
      renderLandLayer(); return;
    }

    // カーソル変更（頂点・ポリゴン内部ホバー時）
    const pos2   = getLandPos(e, gridEl, cs);
    const hitIdx = getHitVertex(e, gridEl, cs, state.land);
    if (hitIdx === 0 && state.land?.closed) {
      gridEl.style.cursor = 'crosshair'; // 赤い頂点 → 回転
    } else if (hitIdx > 0) {
      gridEl.style.cursor = 'grab';       // 頂点 → 移動
    } else if (state.land?.closed && isPointInPolygon(pos2, state.land.points ?? [])) {
      gridEl.style.cursor = 'move';       // 内部 → 全体移動
    } else {
      gridEl.style.cursor = '';
    }

    // 描画中プレビュー
    if (!state.land?.closed && (state.land?.points?.length ?? 0) > 0) {
      ui.landPreview = getLandPos(e, gridEl, state.cellSize);
    } else {
      ui.landPreview = null;
    }
    renderLandLayer();
  });

  gridEl.addEventListener('mouseleave', () => {
    if (state.mode !== 'land') return;
    gridEl.style.cursor = '';
    ui.landPreview = null;
    renderLandLayer();
  });

  // ── click: 頂点追加 / ポリゴンを閉じる ────────────────────
  gridEl.addEventListener('click', e => {
    if (state.mode !== 'land') return;
    if (ui.landDragged) { ui.landDragged = false; return; }
    if (state.land?.closed) return;
    const pos  = getLandPos(e, gridEl, state.cellSize);
    const land = state.land ?? { points: [], closed: false };
    if (land.points.length >= 3 && distPx(pos, land.points[0], state.cellSize) < 12) {
      pushUndo();
      state.land  = { ...land, closed: true };
      ui.landPreview = null;
      renderLandLayer();
      saveProject(state); return;
    }
    pushUndo();
    state.land = { ...land, points: [...land.points, pos] };
    renderLandLayer();
    saveProject(state);
  });
}
