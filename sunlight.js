// 2D採光オーバーレイ — スコア計算と Canvas 描画

const WINDOW_TYPES = new Set(['window', 'window_tall', 'window_low']);
// 窓種別ごとの採光ウェイト
const WINDOW_WEIGHT = { window_tall: 1.5, window: 1.0, window_low: 0.6 };

/**
 * 各部屋の採光スコアを計算する。
 *
 * 座標系: screen座標（y下向き、上=北 when compass=0）
 *   太陽方位角 az = azFromNorth - compass
 *   sunDir = (sin(az), -cos(az))  ← 太陽がある方向の単位ベクトル
 *
 * 窓の外向き法線と sunDir の内積が正 → その方向から日が差し込む。
 *
 * @param {object} state - アプリ状態（elements, compass, sunHour）
 * @param {object} grid  - ui.grid（cells[row][col] = roomId | null）
 * @returns {Map<string, number>} roomId → 採光スコア（0以上、上限なし）
 */
export function calcSunlightScores(state, grid) {
  const azDeg   = (90 + (state.sunHour - 6) * 15) - (state.compass || 0);
  const azRad   = azDeg * Math.PI / 180;
  const sunDirX = Math.sin(azRad);
  const sunDirY = -Math.cos(azRad);

  // 太陽高度による強度係数（時刻 6〜18 でサイン波）
  const elevRaw    = Math.sin(Math.PI * Math.max(0, Math.min(state.sunHour - 6, 12)) / 12);
  const elevFactor = Math.max(0.05, elevRaw);

  const scores = new Map(); // roomId → score
  const cells  = grid.cells;

  const windows = (state.elements || []).filter(el => WINDOW_TYPES.has(el.type));

  for (const win of windows) {
    const weight = WINDOW_WEIGHT[win.type] ?? 1.0;

    if (win.dir === 'h') {
      // 水平辺 h:col:row — セル(col, row-1) の南面 or セル(col, row) の北面
      const roomAbove = (win.row >= 1 ? cells[win.row - 1]?.[win.col] : null) || null;
      const roomBelow = cells[win.row]?.[win.col] || null;

      if (roomAbove && !roomBelow) {
        // 南面: 外向き法線 = (0, +1)
        const dot = sunDirY; // sunDir · (0,+1)
        if (dot > 0) scores.set(roomAbove, (scores.get(roomAbove) || 0) + dot * weight * elevFactor);
      } else if (roomBelow && !roomAbove) {
        // 北面: 外向き法線 = (0, -1)
        const dot = -sunDirY; // sunDir · (0,-1)
        if (dot > 0) scores.set(roomBelow, (scores.get(roomBelow) || 0) + dot * weight * elevFactor);
      }
    } else { // 'v'
      // 垂直辺 v:col:row — セル(col-1, row) の東面 or セル(col, row) の西面
      const roomLeft  = (win.col >= 1 ? cells[win.row]?.[win.col - 1] : null) || null;
      const roomRight = cells[win.row]?.[win.col] || null;

      if (roomLeft && !roomRight) {
        // 東面: 外向き法線 = (+1, 0)
        const dot = sunDirX; // sunDir · (+1,0)
        if (dot > 0) scores.set(roomLeft, (scores.get(roomLeft) || 0) + dot * weight * elevFactor);
      } else if (roomRight && !roomLeft) {
        // 西面: 外向き法線 = (-1, 0)
        const dot = -sunDirX; // sunDir · (-1,0)
        if (dot > 0) scores.set(roomRight, (scores.get(roomRight) || 0) + dot * weight * elevFactor);
      }
    }
  }

  return scores;
}

/**
 * 採光スコアを Canvas に描画する。
 * スコアなし（窓がない）部屋は描画しない（3Aの仕様）。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Map<string, number>} scores  - roomId → 採光スコア
 * @param {Array}              rooms   - state.rooms
 * @param {number}             cs      - cellSize (px)
 */
export function renderSunlightOverlay(canvas, scores, rooms, cs) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (scores.size === 0) return;

  const maxScore = Math.max(...scores.values());
  if (maxScore <= 0) return;

  for (const room of rooms) {
    const score = scores.get(room.id);
    if (score === undefined) continue; // 窓がない部屋はスキップ

    const t = score / maxScore; // 0〜1 に正規化

    // 色補間: 青(影) → 黄(日当たり良)
    // t=0: rgba(100,149,237,0.25)  t=1: rgba(255,210,50,0.55)
    const r = Math.round(lerp(100, 255, t));
    const g = Math.round(lerp(149, 210, t));
    const b = Math.round(lerp(237,  50, t));
    const a = lerp(0.25, 0.55, t);

    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    for (const key of room.cells) {
      const [col, row] = key.split(',').map(Number);
      ctx.fillRect(col * cs, row * cs, cs, cs);
    }
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
