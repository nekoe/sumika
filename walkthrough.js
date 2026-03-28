// walkthrough.js - 3Dウォークスルー
import * as THREE from 'three';

const CELL       = 0.91;
const EYE_H      = 1.6;
const WALL_H     = 2.4;
const WALL_T     = 0.12;
const DOOR_H     = 2.1;
const WIN_LOW    = 0.9;
const WIN_HIGH   = 1.8;
const SPEED      = 4.0;
const MOUSE_SENS = 0.002;
const COL_R      = 0.28;   // 衝突半径
const DOOR_DIST  = 1.8;    // ドアが開く距離 (m)

// ─────────────────────────────────────────────────────────
// エントリポイント
// ─────────────────────────────────────────────────────────
export function startWalkthrough(state) {
  if (!state.rooms.length) {
    alert('部屋を配置してからウォークスルーを開始してください。');
    return;
  }

  // ── オーバーレイ ────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'wt-overlay';
  overlay.innerHTML = `
    <div id="wt-crosshair"></div>
    <div id="wt-room-name"></div>
    <div id="wt-hint">
      <div class="wt-hint-title">操作方法</div>
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 矢印キー — 移動</div>
      <div><b>マウス</b> — 視点変更（クリックでキャプチャ）</div>
      <div><kbd>Shift</kbd> — ダッシュ &nbsp; <kbd>Esc</kbd> — 終了</div>
      <div class="wt-hint-click">クリックして開始</div>
    </div>
    <canvas id="wt-minimap"></canvas>
    <div id="wt-door-hint"></div>
    <button id="wt-close">✕ 終了 (Esc)</button>
  `;
  document.body.appendChild(overlay);

  const canvas = document.createElement('canvas');
  canvas.id = 'wt-canvas';
  overlay.prepend(canvas);

  // ── Three.js ──────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 18, 45);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
  const fr = state.rooms[0];
  camera.position.set((fr.x + fr.w / 2) * CELL, EYE_H, (fr.y + fr.h / 2) * CELL);

  // ── シーン構築 ────────────────────────────────────────
  const { wallSegs, doorMap } = buildScene(scene, state);

  // ── 衝突判定 ─────────────────────────────────────────
  const roomRects = state.rooms.map(r => ({
    minX: r.x * CELL + COL_R, maxX: (r.x + r.w) * CELL - COL_R,
    minZ: r.y * CELL + COL_R, maxZ: (r.y + r.h) * CELL - COL_R,
  })).filter(r => r.maxX > r.minX && r.maxZ > r.minZ);

  function inRoom(x, z) {
    return roomRects.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  }

  // 壁セグメントを横切るか判定
  function wallBlocks(cx, cz, nx, nz, segs) {
    for (const seg of segs) {
      if (seg.open) continue;
      const wx = seg.col * CELL, wz = seg.row * CELL;
      if (seg.dir === 'h') {
        if (cx >= wx - COL_R && cx <= wx + CELL + COL_R) {
          if ((cz > wz + COL_R && nz < wz + COL_R) ||
              (cz < wz - COL_R && nz > wz - COL_R)) return true;
        }
      } else {
        if (cz >= wz - COL_R && cz <= wz + CELL + COL_R) {
          if ((cx > wx + COL_R && nx < wx + COL_R) ||
              (cx < wx - COL_R && nx > wx - COL_R)) return true;
        }
      }
    }
    return false;
  }

  function tryMove(cx, cz, nx, nz) {
    if (inRoom(nx, nz) && !wallBlocks(cx, cz, nx, nz, wallSegs))       return { x: nx, z: nz };
    if (inRoom(nx, cz) && !wallBlocks(cx, cz, nx, cz, wallSegs))       return { x: nx, z: cz };
    if (inRoom(cx, nz) && !wallBlocks(cx, cz, cx, nz, wallSegs))       return { x: cx, z: nz };
    return { x: cx, z: cz };
  }

  // ── FPS コントロール ──────────────────────────────────
  let yaw = 0, pitch = 0, isLocked = false;
  const keys = {};

  const onMouseMove = e => {
    if (!isLocked) return;
    yaw   -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  };
  const onPLC = () => {
    isLocked = document.pointerLockElement === canvas;
    document.getElementById('wt-hint').style.display = isLocked ? 'none' : 'flex';
  };
  const onKD = e => { keys[e.code] = true; };
  const onKU = e => { keys[e.code] = false; };

  canvas.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', onPLC);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onKD);
  document.addEventListener('keyup', onKU);

  // ── ミニマップ ────────────────────────────────────────
  const mmC = document.getElementById('wt-minimap');
  const mmX = mmC.getContext('2d');
  mmC.width = mmC.height = 150;

  // ── アニメーション ────────────────────────────────────
  let running = true;
  let lastTime = performance.now();

  // 太陽ライト（後で位置更新）
  const sunLight = scene.getObjectByName('sunLight');

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;

    // リサイズ
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
      const sprint = (keys['ShiftLeft'] || keys['ShiftRight']) ? 2 : 1;
      const dx = (right ? 1 : 0) - (left ? 1 : 0);
      const dz = (bwd   ? 1 : 0) - (fwd  ? 1 : 0);
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const wx = ((dx/len)*cosY + (dz/len)*sinY) * SPEED * sprint * dt;
      const wz = (-(dx/len)*sinY + (dz/len)*cosY) * SPEED * sprint * dt;
      const cx = camera.position.x, cz = camera.position.z;
      const moved = tryMove(cx, cz, cx + wx, cz + wz);
      camera.position.x = moved.x;
      camera.position.z = moved.z;
    }

    // ドア開閉アニメーション
    updateDoors(doorMap, camera.position, wallSegs);

    // 太陽光位置更新
    if (sunLight) updateSunPosition(sunLight, state);

    // 部屋名
    const gx = camera.position.x / CELL, gz = camera.position.z / CELL;
    const cur = state.rooms.find(r => gx >= r.x && gx < r.x+r.w && gz >= r.y && gz < r.y+r.h);
    const nameEl = document.getElementById('wt-room-name');
    if (nameEl) nameEl.textContent = cur ? cur.label : '';

    drawMinimap(mmX, state, camera.position, yaw);
    renderer.render(scene, camera);
  }
  animate();

  // ── 終了 ─────────────────────────────────────────────
  function close() {
    if (!running) return;
    running = false;
    document.exitPointerLock();
    renderer.dispose();
    overlay.remove();
    document.removeEventListener('pointerlockchange', onPLC);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('keydown', onKD);
    document.removeEventListener('keyup', onKU);
    document.removeEventListener('keydown', onEscClose);
  }
  function onEscClose(e) { if (e.key === 'Escape' && !isLocked) close(); }
  document.addEventListener('keydown', onEscClose);
  document.getElementById('wt-close').addEventListener('click', close);
}

// ─────────────────────────────────────────────────────────
// シーン構築
// ─────────────────────────────────────────────────────────
function buildScene(scene, state) {
  // ライト
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));

  const sun = new THREE.DirectionalLight(0xfff8e8, 0.85);
  sun.name = 'sunLight';
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 0.1, far: 80 });
  scene.add(sun);
  updateSunPosition(sun, state);

  const fill = new THREE.DirectionalLight(0xcce0ff, 0.18);
  fill.position.set(-8, 5, -5);
  scene.add(fill);

  generateFloors(scene, state.rooms);
  generateZoneFloors(scene, state.rooms);
  generateCeilings(scene, state.rooms);
  const { wallSegs, doorMap } = generateWalls(scene, state);

  return { wallSegs, doorMap };
}

// ─────────────────────────────────────────────────────────
// 太陽光位置計算
// ─────────────────────────────────────────────────────────
export function updateSunPosition(sun, state) {
  const compass  = (state.compass  || 0) * Math.PI / 180;
  const hour     = state.sunHour   ?? 12;

  // 方位角: 東(6時)→南(12時)→西(18時)、北半球の太陽
  const azFromNorth = (90 + (hour - 6) * 15) * Math.PI / 180;
  const elevRaw  = Math.sin(Math.PI * Math.max(0, Math.min(hour - 6, 12)) / 12);
  const elev     = Math.max(0.08, elevRaw) * (Math.PI * 72 / 180);

  // コンパス考慮: グリッド上でのワールド座標変換
  // north = -Z 方向, compas=0のとき南(+Z)から太陽
  const az = azFromNorth - compass;
  const D  = 35;
  sun.position.set(
    Math.sin(az)  * Math.cos(elev) * D,
    Math.sin(elev) * D,
    -Math.cos(az) * Math.cos(elev) * D
  );
  sun.intensity = Math.max(0.05, elevRaw) * 0.9;
}

// ─────────────────────────────────────────────────────────
// ジオメトリ生成
// ─────────────────────────────────────────────────────────
function toColor(hex) {
  try { return new THREE.Color(hex); } catch { return new THREE.Color(0xffffff); }
}

function generateFloors(scene, rooms) {
  for (const r of rooms) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(r.w * CELL, r.h * CELL),
      new THREE.MeshLambertMaterial({ color: toColor(r.color) })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.x + r.w/2)*CELL, 0.001, (r.y + r.h/2)*CELL);
    m.receiveShadow = true;
    scene.add(m);
  }
}

function generateZoneFloors(scene, rooms) {
  for (const r of rooms) {
    for (const z of (r.zones || [])) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(z.w*CELL, z.h*CELL),
        new THREE.MeshLambertMaterial({ color: toColor(z.color) })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x+z.x+z.w/2)*CELL, 0.003, (r.y+z.y+z.h/2)*CELL);
      m.receiveShadow = true;
      scene.add(m);
      addZoneLabel(scene, z.label, (r.x+z.x+z.w/2)*CELL, 0.05, (r.y+z.y+z.h/2)*CELL);
    }
  }
}

function generateCeilings(scene, rooms) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xf8f8f6, side: THREE.BackSide });
  for (const r of rooms) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w*CELL, r.h*CELL), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set((r.x+r.w/2)*CELL, WALL_H, (r.y+r.h/2)*CELL);
    scene.add(m);
  }
}

function generateWalls(scene, state) {
  const occupied = new Set();
  for (const r of state.rooms)
    for (let row = r.y; row < r.y+r.h; row++)
      for (let col = r.x; col < r.x+r.w; col++)
        occupied.add(`${col},${row}`);

  const elMap = new Map();
  for (const el of (state.elements || [])) elMap.set(`${el.dir}:${el.col}:${el.row}`, el);

  const wallMat  = new THREE.MeshLambertMaterial({ color: 0xf2ede6 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x99ccff, transparent: true, opacity: 0.22,
    roughness: 0.05, metalness: 0, side: THREE.DoubleSide,
  });
  const doorMat  = new THREE.MeshLambertMaterial({ color: 0xc8a870 });

  const wallSegs = []; // { dir, col, row, open:bool }
  const doorMap  = new Map(); // key → { seg, group, angle, target }
  const added    = new Set();

  function addEdge(dir, col, row, nCol, nRow) {
    if (occupied.has(`${nCol},${nRow}`)) return;
    const k = `E:${dir}:${col}:${row}`;
    if (added.has(k)) return;
    added.add(k);
    const el = elMap.get(`${dir}:${col}:${row}`);
    const type = el?.type;

    if (type === 'door') {
      addDoorGeometry(scene, doorMat, wallMat, dir, col, row, el?.flip || false, wallSegs, doorMap);
    } else if (type === 'window') {
      addWallSeg(scene, wallMat,  dir, col, row, 0, WIN_LOW);
      addWallSeg(scene, glassMat, dir, col, row, WIN_LOW, WIN_HIGH);
      if (WALL_H - WIN_HIGH > 0.02) addWallSeg(scene, wallMat, dir, col, row, WIN_HIGH, WALL_H);
      wallSegs.push({ dir, col, row, open: false });
    } else {
      addWallSeg(scene, wallMat, dir, col, row, 0, WALL_H);
      wallSegs.push({ dir, col, row, open: false });
    }
  }

  for (const key of occupied) {
    const [c, r] = key.split(',').map(Number);
    addEdge('h', c,   r,   c,   r-1);
    addEdge('h', c,   r+1, c,   r+1);
    addEdge('v', c,   r,   c-1, r  );
    addEdge('v', c+1, r,   c+1, r  );
  }

  // 内壁
  for (const el of (state.elements || [])) {
    if (el.type !== 'wall') continue;
    const k = `I:${el.dir}:${el.col}:${el.row}`;
    if (added.has(k)) continue;
    added.add(k);
    addWallSeg(scene, wallMat, el.dir, el.col, el.row, 0, WALL_H);
    wallSegs.push({ dir: el.dir, col: el.col, row: el.row, open: false });
  }

  return { wallSegs, doorMap };
}

function addWallSeg(scene, mat, dir, col, row, y0, y1) {
  const h = y1 - y0; if (h <= 0) return;
  const x = col * CELL, z = row * CELL;
  const geo = dir === 'h'
    ? new THREE.BoxGeometry(CELL, h, WALL_T)
    : new THREE.BoxGeometry(WALL_T, h, CELL);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(
    dir === 'h' ? x + CELL/2 : x,
    y0 + h/2,
    dir === 'h' ? z : z + CELL/2
  );
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
}

// ─────────────────────────────────────────────────────────
// ドアジオメトリ（開閉アニメーション用）
// ─────────────────────────────────────────────────────────
function addDoorGeometry(scene, doorMat, wallMat, dir, col, row, flip, wallSegs, doorMap) {
  const x = col * CELL, z = row * CELL;
  const topH = WALL_H - DOOR_H;

  // 鴨居（上部壁）
  if (topH > 0.02) addWallSeg(scene, wallMat, dir, col, row, DOOR_H, WALL_H);

  // 枠（縦方向の細い壁）
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xe0d0b8 });
  const FW = 0.05; // 枠幅
  if (dir === 'h') {
    [x, x + CELL - FW].forEach(fx => {
      const fm = new THREE.Mesh(new THREE.BoxGeometry(FW, DOOR_H, WALL_T + 0.02), frameMat);
      fm.position.set(fx + FW/2, DOOR_H/2, z);
      scene.add(fm);
    });
  } else {
    [z, z + CELL - FW].forEach(fz => {
      const fm = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.02, DOOR_H, FW), frameMat);
      fm.position.set(x, DOOR_H/2, fz + FW/2);
      scene.add(fm);
    });
  }

  // ドアパネル（回転グループ）
  const group = new THREE.Group();

  // 蝶番位置（グループの基点）
  if (dir === 'h') {
    group.position.set(flip ? x + CELL : x, 0, z);
  } else {
    group.position.set(x, 0, flip ? z + CELL : z);
  }
  scene.add(group);

  // パネルメッシュ（蝶番からCELL分伸びる）
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(
      dir === 'h' ? CELL - FW*2 : 0.04,
      DOOR_H - 0.02,
      dir === 'h' ? 0.04 : CELL - FW*2
    ),
    doorMat
  );
  // 蝶番から中央へオフセット
  if (dir === 'h') {
    panel.position.set((flip ? -1 : 1) * (CELL - FW*2) / 2, DOOR_H/2, 0);
  } else {
    panel.position.set(0, DOOR_H/2, (flip ? -1 : 1) * (CELL - FW*2) / 2);
  }

  // ドアノブ
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0xd4a820 })
  );
  if (dir === 'h') knob.position.set((flip ? -1 : 1) * (CELL - FW*2 - 0.1), DOOR_H*0.45, 0.06);
  else             knob.position.set(0.06, DOOR_H*0.45, (flip ? -1 : 1) * (CELL - FW*2 - 0.1));
  panel.add(knob);
  group.add(panel);

  // wallSegs にドアの衝突情報を登録（初期はopen:false）
  const seg = { dir, col, row, open: false, isDoor: true };
  wallSegs.push(seg);

  const key = `${dir}:${col}:${row}`;
  doorMap.set(key, { seg, group, dir, flip, angle: 0, target: 0 });
}

// ─────────────────────────────────────────────────────────
// ドア開閉アニメーション
// ─────────────────────────────────────────────────────────
function updateDoors(doorMap, camPos, wallSegs) {
  for (const [key, door] of doorMap) {
    const wx = door.seg.col * CELL + CELL/2;
    const wz = door.seg.row * CELL + CELL/2;
    const dist = Math.sqrt((camPos.x-wx)**2 + (camPos.z-wz)**2);

    door.target = dist < DOOR_DIST ? 88 : 0;
    // アニメーション速度
    const speed = 180; // deg/s
    if (door.angle < door.target) door.angle = Math.min(door.target, door.angle + speed * 0.016);
    if (door.angle > door.target) door.angle = Math.max(door.target, door.angle - speed * 0.016);

    const rad = door.angle * Math.PI / 180;
    if (door.dir === 'h') {
      door.group.rotation.y = (door.flip ? 1 : -1) * rad;
    } else {
      door.group.rotation.y = (door.flip ? -1 : 1) * rad;
    }

    // 十分開いたら衝突無効
    door.seg.open = door.angle > 45;
  }
}

// ─────────────────────────────────────────────────────────
// ゾーンラベル
// ─────────────────────────────────────────────────────────
function addZoneLabel(scene, text, x, y, z) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.roundRect(4, 4, 248, 56, 10); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.set(1.5, 0.38, 1);
  sp.position.set(x, y + 0.05, z);
  scene.add(sp);
}

// ─────────────────────────────────────────────────────────
// ミニマップ
// ─────────────────────────────────────────────────────────
function drawMinimap(ctx, state, camPos, yaw) {
  const S = 150;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(10,10,20,0.55)';
  ctx.fillRect(0, 0, S, S);
  if (!state.rooms.length) return;

  let minX=Inf, maxX=-Inf, minZ=Inf, maxZ=-Inf;
  const Inf = Infinity;
  for (const r of state.rooms) {
    if (r.x < minX) minX = r.x; if (r.x+r.w > maxX) maxX = r.x+r.w;
    if (r.y < minZ) minZ = r.y; if (r.y+r.h > maxZ) maxZ = r.y+r.h;
  }
  const span  = Math.max((maxX-minX)*CELL, (maxZ-minZ)*CELL, 0.01);
  const scale = (S-20) / span;
  const ox = 10 - minX*CELL*scale, oz = 10 - minZ*CELL*scale;

  for (const r of state.rooms) {
    ctx.fillStyle = (r.color||'#ccc') + 'bb';
    ctx.beginPath(); ctx.roundRect(r.x*CELL*scale+ox, r.y*CELL*scale+oz, r.w*CELL*scale, r.h*CELL*scale, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.7; ctx.stroke();
  }

  // 方位
  const compassDeg = state.compass || 0;
  const compassRad = compassDeg * Math.PI / 180;
  ctx.save();
  ctx.translate(S-18, 18);
  ctx.rotate(compassRad);
  ctx.fillStyle = '#ef4444'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('N', 0, -6);
  ctx.restore();

  // カメラ矢印
  const cx = camPos.x*scale+ox, cz = camPos.z*scale+oz;
  ctx.save();
  ctx.translate(cx, cz); ctx.rotate(-yaw);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(5,5); ctx.lineTo(0,3); ctx.lineTo(-5,5); ctx.closePath();
  ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();
  ctx.restore();
}
