// 2D採光オーバーレイ — スコア計算と Canvas 描画

const WINDOW_TYPES = new Set(['window', 'window_tall', 'window_low']);
// 窓種別ごとの採光ウェイト
const WINDOW_WEIGHT = { window_tall: 1.5, window: 1.0, window_low: 0.6 };

// 距離減衰係数: 大きいほど光が早く弱まる
const FALLOFF_K = 0.5;

/**
 * 各セルの採光スコアを計算する（セル単位、距離減衰あり）。
 *
 * 座標系: screen座標（y下向き、上=北 when compass=0）
 *   太陽方位角 az = azFromNorth - compass
 *   sunDir = (sin(az), -cos(az))  ← 太陽がある方向の単位ベクトル
 *
 * 窓の外向き法線と sunDir の内積が正 → その方向から日が差し込む。
 * 各窓から同一部屋内のセルへの光は exp(-dist * k) で距離減衰する。
 *
 * @param {object} state - アプリ状態（elements, rooms, compass, sunHour）
 * @param {object} grid  - ui.grid（cells[row][col] = roomId | null）
 * @returns {Map<string, number>} "col,row" → 採光スコア（0以上）
 */
export function calcSunlightScores(state, grid) {
  const azDeg   = (90 + (state.sunHour - 6) * 15) - (state.compass || 0);
  const azRad   = azDeg * Math.PI / 180;
  const sunDirX = Math.sin(azRad);
  const sunDirY = -Math.cos(azRad);

  // 太陽高度による強度係数（時刻 6〜18 でサイン波）
  const elevRaw    = Math.sin(Math.PI * Math.max(0, Math.min(state.sunHour - 6, 12)) / 12);
  const elevFactor = Math.max(0.05, elevRaw);

  // roomId → Array of [col, row] を事前構築
  const roomCells = new Map();
  for (const room of (state.rooms || [])) {
    const list = [];
    for (const key of room.cells) {
      const [c, r] = key.split(',').map(Number);
      list.push([c, r]);
    }
    roomCells.set(room.id, list);
  }

  const scores = new Map(); // "col,row" → score
  const cells  = grid.cells;

  const windows = (state.elements || []).filter(el => WINDOW_TYPES.has(el.type));

  for (const win of windows) {
    const weight = WINDOW_WEIGHT[win.type] ?? 1.0;

    if (win.dir === 'h') {
      // 水平辺 h:col:row — セル(col, row-1) の南面 or セル(col, row) の北面
      const roomAbove = (win.row >= 1 ? cells[win.row - 1]?.[win.col] : null) || null;
      const roomBelow = cells[win.row]?.[win.col] || null;

      if (roomAbove && !roomBelow) {
        // 南面: 外向き法線 = (0, +1) → 太陽が南にあると dot > 0
        const dot = sunDirY;
        if (dot <= 0) continue;
        const basePower = dot * weight * elevFactor;
        // 窓に隣接するセルは (win.col, win.row-1)、北方向に進むほど距離増加
        for (const [c, r] of (roomCells.get(roomAbove) || [])) {
          const perpDist = (win.row - 1) - r; // 北方向距離（0以上）
          const latDist  = Math.abs(c - win.col);
          const dist     = Math.sqrt(perpDist * perpDist + latDist * latDist);
          const falloff  = Math.exp(-dist * FALLOFF_K);
          const key = `${c},${r}`;
          scores.set(key, (scores.get(key) || 0) + basePower * falloff);
        }
      } else if (roomBelow && !roomAbove) {
        // 北面: 外向き法線 = (0, -1) → 太陽が北にあると dot > 0
        const dot = -sunDirY;
        if (dot <= 0) continue;
        const basePower = dot * weight * elevFactor;
        // 窓に隣接するセルは (win.col, win.row)、南方向に進むほど距離増加
        for (const [c, r] of (roomCells.get(roomBelow) || [])) {
          const perpDist = r - win.row; // 南方向距離（0以上）
          const latDist  = Math.abs(c - win.col);
          const dist     = Math.sqrt(perpDist * perpDist + latDist * latDist);
          const falloff  = Math.exp(-dist * FALLOFF_K);
          const key = `${c},${r}`;
          scores.set(key, (scores.get(key) || 0) + basePower * falloff);
        }
      }
    } else { // 'v'
      // 垂直辺 v:col:row — セル(col-1, row) の東面 or セル(col, row) の西面
      const roomLeft  = (win.col >= 1 ? cells[win.row]?.[win.col - 1] : null) || null;
      const roomRight = cells[win.row]?.[win.col] || null;

      if (roomLeft && !roomRight) {
        // 東面: 外向き法線 = (+1, 0) → 太陽が東にあると dot > 0
        const dot = sunDirX;
        if (dot <= 0) continue;
        const basePower = dot * weight * elevFactor;
        // 窓に隣接するセルは (win.col-1, win.row)、西方向に進むほど距離増加
        for (const [c, r] of (roomCells.get(roomLeft) || [])) {
          const perpDist = (win.col - 1) - c; // 西方向距離（0以上）
          const latDist  = Math.abs(r - win.row);
          const dist     = Math.sqrt(perpDist * perpDist + latDist * latDist);
          const falloff  = Math.exp(-dist * FALLOFF_K);
          const key = `${c},${r}`;
          scores.set(key, (scores.get(key) || 0) + basePower * falloff);
        }
      } else if (roomRight && !roomLeft) {
        // 西面: 外向き法線 = (-1, 0) → 太陽が西にあると dot > 0
        const dot = -sunDirX;
        if (dot <= 0) continue;
        const basePower = dot * weight * elevFactor;
        // 窓に隣接するセルは (win.col, win.row)、東方向に進むほど距離増加
        for (const [c, r] of (roomCells.get(roomRight) || [])) {
          const perpDist = c - win.col; // 東方向距離（0以上）
          const latDist  = Math.abs(r - win.row);
          const dist     = Math.sqrt(perpDist * perpDist + latDist * latDist);
          const falloff  = Math.exp(-dist * FALLOFF_K);
          const key = `${c},${r}`;
          scores.set(key, (scores.get(key) || 0) + basePower * falloff);
        }
      }
    }
  }

  return scores;
}

/**
 * 採光スコアを Canvas に描画する。
 *
 * Step 1: 全部屋セルを白く塗りつぶす（見やすさのため）
 * Step 2: セルごとの採光スコアを青→黄のグラデーションで重ね描き
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Map<string, number>} scores  - "col,row" → 採光スコア
 * @param {Array}              rooms   - state.rooms
 * @param {number}             cs      - cellSize (px)
 */
export function renderSunlightOverlay(canvas, scores, rooms, cs) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Step 1: 全部屋セルを白背景で塗りつぶす
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  for (const room of rooms) {
    for (const key of room.cells) {
      const [col, row] = key.split(',').map(Number);
      ctx.fillRect(col * cs, row * cs, cs, cs);
    }
  }

  if (scores.size === 0) return;

  const maxScore = Math.max(...scores.values());
  if (maxScore <= 0) return;

  // Step 2: セルごとに採光スコアを色で重ね描き（青→黄）
  for (const [key, score] of scores) {
    const [col, row] = key.split(',').map(Number);
    const t = score / maxScore; // 0〜1 に正規化

    // 色補間: 青(採光弱) → 黄(日当たり良)
    const r = Math.round(lerp(100, 255, t));
    const g = Math.round(lerp(149, 210, t));
    const b = Math.round(lerp(237,  50, t));
    const a = lerp(0.15, 0.65, t);

    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.fillRect(col * cs, row * cs, cs, cs);
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
