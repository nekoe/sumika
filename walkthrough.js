// walkthrough.js - 3Dウォークスルー
import * as THREE from 'three';

const CELL       = 0.91;   // m / グリッド1マス
const EYE_H      = 1.6;    // 目線高さ (m)
const WALL_H     = 2.4;    // 天井高 (m)
const WALL_T     = 0.12;   // 壁厚 (m)
const DOOR_H     = 2.1;    // ドア高さ (m)
const WIN_LOW    = 0.9;    // 窓下端 (m)
const WIN_HIGH   = 1.8;    // 窓上端 (m)
const SPEED      = 4.0;    // 移動速度 (m/s)
const MOUSE_SENS = 0.002;  // マウス感度
const COL_R      = 0.28;   // 衝突半径 (m)

// ─────────────────────────────────────────────────────────
// エントリポイント
// ─────────────────────────────────────────────────────────
export function startWalkthrough(state) {
  if (!state.rooms.length) {
    alert('部屋を配置してからウォークスルーを開始してください。');
    return;
  }

  // ── オーバーレイ作成 ──────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'wt-overlay';
  overlay.innerHTML = `
    <div id="wt-crosshair"></div>
    <div id="wt-room-name"></div>
    <div id="wt-hint">
      <div class="wt-hint-title">操作方法</div>
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> または 矢印キー — 移動</div>
      <div><b>マウス</b> — 視点変更（クリックでキャプチャ）</div>
      <div><kbd>Shift</kbd> — ダッシュ</div>
      <div><kbd>Esc</kbd> — 終了</div>
      <div class="wt-hint-click">クリックして開始</div>
    </div>
    <canvas id="wt-minimap"></canvas>
    <button id="wt-close">✕ 終了 (Esc)</button>
  `;
  document.body.appendChild(overlay);

  // メインキャンバス
  const canvas = document.createElement('canvas');
  canvas.id = 'wt-canvas';
  overlay.prepend(canvas);

  // ── Three.js 初期化 ──────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 18, 45);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);

  // 開始位置: 最初の部屋の中心
  const fr = state.rooms[0];
  camera.position.set(
    (fr.x + fr.w / 2) * CELL,
    EYE_H,
    (fr.y + fr.h / 2) * CELL
  );

  // ── シーン構築 ────────────────────────────────────────
  buildScene(scene, state);

  // ── 衝突判定 ─────────────────────────────────────────
  const roomRects = state.rooms.map(r => ({
    minX: r.x * CELL + COL_R, maxX: (r.x + r.w) * CELL - COL_R,
    minZ: r.y * CELL + COL_R, maxZ: (r.y + r.h) * CELL - COL_R,
  })).filter(r => r.maxX > r.minX && r.maxZ > r.minZ);

  function canMoveTo(x, z) {
    return roomRects.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  }

  // ── FPSカメラ制御 ─────────────────────────────────────
  let yaw = 0, pitch = 0, isLocked = false;
  const keys = {};

  const onMouseMove = e => {
    if (!isLocked) return;
    yaw   -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  };
  const onPointerLockChange = () => {
    isLocked = document.pointerLockElement === canvas;
    document.getElementById('wt-hint').style.display = isLocked ? 'none' : 'flex';
  };
  const onKeyDown = e => { keys[e.code] = true; };
  const onKeyUp   = e => { keys[e.code] = false; };

  canvas.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // ── ミニマップ ────────────────────────────────────────
  const mmCanvas = document.getElementById('wt-minimap');
  const mmCtx    = mmCanvas.getContext('2d');
  mmCanvas.width = mmCanvas.height = 150;

  // ── アニメーションループ ──────────────────────────────
  let running = true;
  let lastTime = performance.now();

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;

    // レンダラーサイズ更新
    const W = overlay.clientWidth, H = overlay.clientHeight;
    if (canvas.width !== W || canvas.height !== H) {
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }

    // 移動
    const fwd   = keys['KeyW'] || keys['ArrowUp'];
    const bwd   = keys['KeyS'] || keys['ArrowDown'];
    const left  = keys['KeyA'] || keys['ArrowLeft'];
    const right = keys['KeyD'] || keys['ArrowRight'];

    if (fwd || bwd || left || right) {
      const sprint = keys['ShiftLeft'] || keys['ShiftRight'] ? 2 : 1;
      const dx = ((right ? 1 : 0) - (left  ? 1 : 0));
      const dz = ((bwd   ? 1 : 0) - (fwd   ? 1 : 0));
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const wx = ((dx / len) * cosY + (dz / len) * sinY) * SPEED * sprint * dt;
      const wz = (-(dx / len) * sinY + (dz / len) * cosY) * SPEED * sprint * dt;
      const cx = camera.position.x, cz = camera.position.z;

      // X/Z独立の壁スライド
      if      (canMoveTo(cx + wx, cz + wz)) { camera.position.x += wx; camera.position.z += wz; }
      else if (canMoveTo(cx + wx, cz))       { camera.position.x += wx; }
      else if (canMoveTo(cx, cz + wz))       { camera.position.z += wz; }
    }

    // 部屋名表示
    const gx = camera.position.x / CELL, gz = camera.position.z / CELL;
    const cur = state.rooms.find(r => gx >= r.x && gx < r.x+r.w && gz >= r.y && gz < r.y+r.h);
    const nameEl = document.getElementById('wt-room-name');
    if (nameEl) nameEl.textContent = cur ? cur.label : '';

    drawMinimap(mmCtx, state, camera.position, yaw);
    renderer.render(scene, camera);
  }
  animate();

  // ── 終了処理 ──────────────────────────────────────────
  function close() {
    if (!running) return;
    running = false;
    document.exitPointerLock();
    renderer.dispose();
    overlay.remove();
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('keydown', onEscClose);
  }
  function onEscClose(e) {
    if (e.key === 'Escape' && !isLocked) { close(); }
  }
  document.addEventListener('keydown', onEscClose);
  document.getElementById('wt-close').addEventListener('click', close);
}

// ─────────────────────────────────────────────────────────
// シーン構築
// ─────────────────────────────────────────────────────────
function buildScene(scene, state) {
  // ライト
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfff8e8, 0.75);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 0.1, far: 80 });
  scene.add(sun);
  // 補助光（逆方向）
  const fillLight = new THREE.DirectionalLight(0xcce0ff, 0.2);
  fillLight.position.set(-8, 5, -5);
  scene.add(fillLight);

  generateFloors(scene, state.rooms);
  generateZoneFloors(scene, state.rooms);
  generateCeilings(scene, state.rooms);
  generateWalls(scene, state);
}

function toColor(hex) {
  try { return new THREE.Color(hex); } catch { return new THREE.Color(0xffffff); }
}

function generateFloors(scene, rooms) {
  for (const r of rooms) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(r.w * CELL, r.h * CELL),
      new THREE.MeshLambertMaterial({ color: toColor(r.color) })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((r.x + r.w / 2) * CELL, 0.001, (r.y + r.h / 2) * CELL);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function generateZoneFloors(scene, rooms) {
  for (const r of rooms) {
    for (const z of (r.zones || [])) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(z.w * CELL, z.h * CELL),
        new THREE.MeshLambertMaterial({ color: toColor(z.color) })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((r.x + z.x + z.w / 2) * CELL, 0.003, (r.y + z.y + z.h / 2) * CELL);
      mesh.receiveShadow = true;
      scene.add(mesh);

      // ゾーンラベルのスプライト
      addZoneLabel(scene, z.label, (r.x + z.x + z.w / 2) * CELL, 0.05, (r.y + z.y + z.h / 2) * CELL);
    }
  }
}

function generateCeilings(scene, rooms) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xf8f8f6, side: THREE.BackSide });
  for (const r of rooms) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(r.w * CELL, r.h * CELL), mat
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set((r.x + r.w / 2) * CELL, WALL_H, (r.y + r.h / 2) * CELL);
    scene.add(mesh);
  }
}

function generateWalls(scene, state) {
  const occupied = new Set();
  for (const r of state.rooms)
    for (let row = r.y; row < r.y + r.h; row++)
      for (let col = r.x; col < r.x + r.w; col++)
        occupied.add(`${col},${row}`);

  // elements lookup: "dir:col:row" → type
  const elMap = new Map();
  for (const el of (state.elements || [])) elMap.set(`${el.dir}:${el.col}:${el.row}`, el.type);

  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf2ede6 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x99ccff, transparent: true, opacity: 0.22,
    roughness: 0.05, metalness: 0, side: THREE.DoubleSide,
  });

  const added = new Set();

  // 外壁 (占有セルの外縁エッジ)
  for (const key of occupied) {
    const [c, r] = key.split(',').map(Number);
    tryAddEdge(scene, 'h', c,   r,   c,   r-1, occupied, elMap, wallMat, glassMat, added);
    tryAddEdge(scene, 'h', c,   r+1, c,   r+1, occupied, elMap, wallMat, glassMat, added);
    tryAddEdge(scene, 'v', c,   r,   c-1, r,   occupied, elMap, wallMat, glassMat, added);
    tryAddEdge(scene, 'v', c+1, r,   c+1, r,   occupied, elMap, wallMat, glassMat, added);
  }

  // 内壁 (ユーザー配置の壁)
  for (const el of (state.elements || [])) {
    if (el.type !== 'wall') continue;
    const k = `I:${el.dir}:${el.col}:${el.row}`;
    if (added.has(k)) continue;
    added.add(k);
    addWallSeg(scene, wallMat, el.dir, el.col, el.row, 0, WALL_H);
  }
}

function tryAddEdge(scene, dir, col, row, nCol, nRow, occupied, elMap, wallMat, glassMat, added) {
  if (occupied.has(`${nCol},${nRow}`)) return; // 隣も部屋 → 壁なし
  const k = `E:${dir}:${col}:${row}`;
  if (added.has(k)) return;
  added.add(k);

  const type = elMap.get(`${dir}:${col}:${row}`);
  if (type === 'door') {
    // 開口部 + 鴨居
    const topH = WALL_H - DOOR_H;
    if (topH > 0.02) addWallSeg(scene, wallMat, dir, col, row, DOOR_H, WALL_H);
  } else if (type === 'window') {
    // 腰壁 + ガラス + 欄間
    addWallSeg(scene, wallMat, dir, col, row, 0, WIN_LOW);
    addWallSeg(scene, glassMat, dir, col, row, WIN_LOW, WIN_HIGH);
    if (WALL_H - WIN_HIGH > 0.02) addWallSeg(scene, wallMat, dir, col, row, WIN_HIGH, WALL_H);
  } else {
    addWallSeg(scene, wallMat, dir, col, row, 0, WALL_H);
  }
}

function addWallSeg(scene, mat, dir, col, row, y0, y1) {
  const h = y1 - y0;
  if (h <= 0) return;
  const x = col * CELL, z = row * CELL;
  const geo = dir === 'h'
    ? new THREE.BoxGeometry(CELL, h, WALL_T)
    : new THREE.BoxGeometry(WALL_T, h, CELL);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    dir === 'h' ? x + CELL / 2 : x,
    y0 + h / 2,
    dir === 'h' ? z : z + CELL / 2
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ─────────────────────────────────────────────────────────
// ゾーンラベル (Canvas Texture スプライト)
// ─────────────────────────────────────────────────────────
function addZoneLabel(scene, text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.roundRect(4, 4, 248, 56, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.set(x, y + 0.05, z);
  scene.add(sprite);
}

// ─────────────────────────────────────────────────────────
// ミニマップ描画
// ─────────────────────────────────────────────────────────
function drawMinimap(ctx, state, camPos, yaw) {
  const S = 150;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(10,10,20,0.55)';
  ctx.fillRect(0, 0, S, S);

  if (!state.rooms.length) return;

  // バウンディングボックス
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of state.rooms) {
    minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
    minZ = Math.min(minZ, r.y); maxZ = Math.max(maxZ, r.y + r.h);
  }
  const span = Math.max((maxX - minX) * CELL, (maxZ - minZ) * CELL, 0.01);
  const scale = (S - 20) / span;
  const ox = 10 - minX * CELL * scale;
  const oz = 10 - minZ * CELL * scale;

  // 部屋
  for (const r of state.rooms) {
    const rx = r.x * CELL * scale + ox;
    const rz = r.y * CELL * scale + oz;
    const rw = r.w * CELL * scale;
    const rh = r.h * CELL * scale;
    ctx.fillStyle = (r.color || '#ccc') + 'bb';
    ctx.beginPath(); ctx.roundRect(rx, rz, rw, rh, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // カメラ（赤い矢印）
  const cx = camPos.x * scale + ox;
  const cz = camPos.z * scale + oz;
  ctx.save();
  ctx.translate(cx, cz);
  ctx.rotate(-yaw);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(5, 5); ctx.lineTo(0, 3); ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
