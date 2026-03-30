// walkthrough.js - 3Dウォークスルー（多フロア対応）
import * as THREE from 'three';

const CELL       = 0.91;
const EYE_H      = 1.6;
const WALL_H     = 2.4;
const FLOOR_H    = WALL_H + 0.25;  // 1フロアの高さ（2.65m）
const WALL_T     = 0.12;
const DOOR_H     = 2.1;
const WIN_LOW    = 0.9;
const WIN_HIGH   = 1.8;
const SPEED      = 4.0;
const MOUSE_SENS = 0.002;
const COL_R      = 0.28;
const DOOR_DIST  = 0.9;
const STAIR_SPEED = 2.5;  // 階段移動速度 (m/s)
const STAIR_STEPS = 8;    // 1フロア分の段数

// ─────────────────────────────────────────────────────────
// エントリポイント
// ─────────────────────────────────────────────────────────
export function startWalkthrough(state) {
  const floors = state.floors || [{ rooms: state.rooms || [], elements: state.elements || [], stairs: [] }];
  const allRooms = floors.flatMap(f => f.rooms || []);
  if (!allRooms.length) {
    alert('部屋を配置してからウォークスルーを開始してください。');
    return;
  }

  // ── オーバーレイ ────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'wt-overlay';
  overlay.innerHTML = `
    <div id="wt-crosshair"></div>
    <div id="wt-room-name"></div>
    <div id="wt-floor-badge"></div>
    <div id="wt-hint">
      <div class="wt-hint-title">操作方法</div>
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 矢印キー — 移動</div>
      <div><b>マウス</b> — 視点変更（クリックでキャプチャ）</div>
      <div><kbd>Shift</kbd> — ダッシュ &nbsp; <kbd>Esc</kbd> — 終了</div>
      <div>🪜 階段に近づくと自動でフロア移動</div>
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
  scene.fog = new THREE.Fog(0x87ceeb, 18, 50);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);

  // ── シーン構築 ────────────────────────────────────────
  const { floorData, stairAreas, sunLight } = buildScene(scene, floors, state);

  // ── プレイヤー初期位置 ────────────────────────────────
  let currentFloor3D = 0;
  // 1Fに部屋があればそこから開始、なければ最初に部屋があるフロアから
  for (let fi = 0; fi < floors.length; fi++) {
    if ((floors[fi].rooms || []).length > 0) { currentFloor3D = fi; break; }
  }
  const startRoom = floors[currentFloor3D].rooms[0];
  camera.position.set(
    (startRoom.x + startRoom.w / 2) * CELL,
    currentFloor3D * FLOOR_H + EYE_H,
    (startRoom.y + startRoom.h / 2) * CELL
  );

  // ── 階段遷移状態 ──────────────────────────────────────
  let stairTransition = null; // { fromY, toY, progress }
  let stairCooldown   = 0;    // 連続遷移防止クールダウン

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

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;

    if (stairCooldown > 0) stairCooldown -= dt;

    // リサイズ
    const W = overlay.clientWidth, H = overlay.clientHeight;
    if (canvas.width !== W || canvas.height !== H) {
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }

    // ── 階段遷移中 ─────────────────────────────────────
    if (stairTransition) {
      stairTransition.progress += dt * STAIR_SPEED;
      const t = Math.min(1, stairTransition.progress);
      camera.position.y = stairTransition.fromY + (stairTransition.toY - stairTransition.fromY) * easeInOut(t);
      if (t >= 1) {
        camera.position.y = stairTransition.toY;
        currentFloor3D = stairTransition.toFloor;
        stairTransition = null;
        stairCooldown = 1.0; // 1秒クールダウン
        showFloorBadge(currentFloor3D + 1);
      }
    } else {
      // ── 通常移動 ───────────────────────────────────────
      const fwd   = keys['KeyW'] || keys['ArrowUp'];
      const bwd   = keys['KeyS'] || keys['ArrowDown'];
      const turnL = keys['KeyA'] || keys['ArrowLeft'];
      const turnR = keys['KeyD'] || keys['ArrowRight'];

      // 左右キー → 視点回転
      if (turnL || turnR) {
        const TURN = Math.PI * 0.9; // rad/s
        yaw += ((turnL ? 1 : 0) - (turnR ? 1 : 0)) * TURN * dt;
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
      }

      // 前後キー → 前進・後退
      if (fwd || bwd) {
        const sprint = (keys['ShiftLeft'] || keys['ShiftRight']) ? 2 : 1;
        const dz = (bwd ? 1 : 0) - (fwd ? 1 : 0);
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const wx = dz * sinY * SPEED * sprint * dt;
        const wz = dz * cosY * SPEED * sprint * dt;
        const cx = camera.position.x, cz = camera.position.z;
        const fd = floorData[currentFloor3D];
        const moved = tryMove(cx, cz, cx + wx, cz + wz, fd);
        camera.position.x = moved.x;
        camera.position.z = moved.z;
      }

      // ── 階段チェック ────────────────────────────────────
      if (stairCooldown <= 0) {
        const sa = stairAreas.find(s =>
          camera.position.x >= s.x1 && camera.position.x <= s.x2 &&
          camera.position.z >= s.z1 && camera.position.z <= s.z2
        );
        if (sa) {
          const toFloor = sa.floors.find(f => f !== currentFloor3D);
          if (toFloor !== undefined) {
            const fromY = camera.position.y;
            const toY   = toFloor * FLOOR_H + EYE_H;
            stairTransition = { fromY, toY, toFloor, progress: 0 };
          }
        }
      }
    }

    // ドア開閉アニメーション（現在フロアのみ）
    const fd = floorData[currentFloor3D];
    if (fd) updateDoors(fd.doorMap, camera.position, fd.wallSegs);

    // 太陽光位置更新
    if (sunLight) updateSunPosition(sunLight, state);

    // 部屋名（現在フロア）
    const gx = camera.position.x / CELL, gz = camera.position.z / CELL;
    const curFloorRooms = floors[currentFloor3D]?.rooms || [];
    const curRoom = curFloorRooms.find(r => {
      if (r.cells) return r.cells.includes(`${Math.floor(gx)},${Math.floor(gz)}`);
      return gx >= r.x && gx < r.x+r.w && gz >= r.y && gz < r.y+r.h;
    });
    const nameEl = document.getElementById('wt-room-name');
    if (nameEl) nameEl.textContent = curRoom ? `${currentFloor3D + 1}F ${curRoom.label}` : `${currentFloor3D + 1}F`;

    drawMinimap(mmX, floors, currentFloor3D, camera.position, yaw, state, stairAreas);
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

  function showFloorBadge(num) {
    const el = document.getElementById('wt-floor-badge');
    if (!el) return;
    el.textContent = `${num}F`;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2000);
  }
  showFloorBadge(currentFloor3D + 1);
}

// ─────────────────────────────────────────────────────────
// シーン構築
// ─────────────────────────────────────────────────────────
function buildScene(scene, floors, state) {
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

  // 各フロアを構築
  const floorData = [];
  const stairAreas = [];

  for (let fi = 0; fi < floors.length; fi++) {
    const fl = floors[fi];
    const baseY = fi * FLOOR_H;
    const rooms     = fl.rooms     || [];
    const elements  = fl.elements  || [];
    const stairs    = fl.stairs    || [];
    const furniture = fl.furniture || [];

    if (rooms.length === 0 && stairs.length === 0 && furniture.length === 0 && fi > 0) {
      floorData.push({ wallSegs: [], doorMap: new Map(), roomRects: [] });
      continue;
    }

    // 上のフロアのvoidセルキー（天井の穴あけに使用）
    const aboveVoidCells = (fi + 1 < floors.length)
      ? getVoidCells(floors[fi + 1].rooms || [])
      : new Set();

    // フロアの床・天井
    generateFloors(scene, rooms, baseY);
    generateZoneFloors(scene, rooms, baseY);
    generateCeilings(scene, rooms, baseY, aboveVoidCells);
    if (fi > 0) generateFloorSlab(scene, rooms, baseY);

    // 下のフロアのvoidセルキー（吹き抜け上部の壁を下まで延ばすために使用）
    const belowVoidCells = fi > 0 ? getVoidCells(floors[fi - 1].rooms || []) : new Set();

    // 下のフロアの占有セル（z-fightingを避けるため：1F側が既に吹き抜け外壁を生成済みの位置には2F壁を下げない）
    const lowerOccupied = fi > 0 ? (() => {
      const s = new Set();
      for (const r of (floors[fi - 1].rooms || [])) {
        if (r.cells) { for (const k of r.cells) s.add(k); }
        else { for (let rr = r.y; rr < r.y + r.h; rr++) for (let cc = r.x; cc < r.x + r.w; cc++) s.add(`${cc},${rr}`); }
      }
      return s;
    })() : new Set();

    // 壁・建具
    const { wallSegs, doorMap } = generateWalls(scene, { rooms, elements, stairs }, baseY, belowVoidCells, lowerOccupied, aboveVoidCells);

    // 不定形部屋はセルごとにrectを生成（バウンディングボックスより正確な衝突判定）
    // void部屋は歩行不可（吹き抜け）
    const roomRects = [
      ...rooms.flatMap(r => {
        if (r.typeId === 'void') return [];
        if (r.cells) {
          return r.cells.map(key => {
            const [c, ro] = key.split(',').map(Number);
            return { minX: c*CELL, maxX: (c+1)*CELL, minZ: ro*CELL, maxZ: (ro+1)*CELL };
          });
        }
        return [{ minX: r.x*CELL, maxX: (r.x+r.w)*CELL, minZ: r.y*CELL, maxZ: (r.y+r.h)*CELL }];
      }),
      // 階段セルも歩行可能エリアに含める（昇降のため入れるようにする）
      ...stairs.map(s => ({ minX: s.x*CELL, maxX: (s.x+s.w)*CELL, minZ: s.y*CELL, maxZ: (s.y+s.h)*CELL })),
    ];

    floorData.push({ wallSegs, doorMap, roomRects });

    // 階段ジオメトリ
    for (const s of stairs) {
      generateStair(scene, s, baseY, fi);
    }

    // 家具ジオメトリ
    generateFurnitureItems(scene, furniture, baseY);
  }

  // 階段エリアの登録
  // mirrorフラグなしの階段のみ処理。同じ位置は重複登録しない（3F接続防止）
  const seenStairPos = new Set();
  for (let fi = 0; fi < floors.length; fi++) {
    for (const s of (floors[fi].stairs || [])) {
      if (s.mirror) continue;
      const key = `${s.x},${s.y}`;
      if (seenStairPos.has(key)) continue;
      seenStairPos.add(key);
      // この階段が接続する隣接フロア（常に 0↔1）
      const fj = fi === 0 ? Math.min(1, floors.length - 1) : 0;
      if (fj !== fi) {
        stairAreas.push({
          x1: s.x * CELL,      z1: s.y * CELL,
          x2: (s.x+s.w)*CELL,  z2: (s.y+s.h)*CELL,
          floors: [Math.min(fi, fj), Math.max(fi, fj)],
        });
      }
    }
  }

  return { floorData, stairAreas, sunLight: sun };
}

// ─────────────────────────────────────────────────────────
// 太陽光位置計算
// ─────────────────────────────────────────────────────────
export function updateSunPosition(sun, state) {
  const compass  = (state.compass  || 0) * Math.PI / 180;
  const hour     = state.sunHour   ?? 12;
  const azFromNorth = (90 + (hour - 6) * 15) * Math.PI / 180;
  const elevRaw  = Math.sin(Math.PI * Math.max(0, Math.min(hour - 6, 12)) / 12);
  const elev     = Math.max(0.08, elevRaw) * (Math.PI * 72 / 180);
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

const DOMA_DROP = 0.15;  // 土間の床段差（m）

function generateFloors(scene, rooms, baseY) {
  for (const r of rooms) {
    if (r.typeId === 'void') continue;
    const isDoma = r.isDoma ?? (r.typeId === 'doma' || r.typeId === 'genkan');
    const floorY = isDoma ? baseY - DOMA_DROP : baseY;
    const mat = new THREE.MeshLambertMaterial({ color: isDoma ? 0xb8b0a4 : toColor(r.color) });
    if (r.cells) {
      for (const key of r.cells) {
        const [col, row] = key.split(',').map(Number);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set((col + 0.5)*CELL, floorY + 0.001, (row + 0.5)*CELL);
        m.receiveShadow = true;
        scene.add(m);
      }
      // 土間: セルの縁に段差側面を追加
      if (isDoma) addDomaEdges(scene, r.cells, baseY);
    } else {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w * CELL, r.h * CELL), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x + r.w/2)*CELL, floorY + 0.001, (r.y + r.h/2)*CELL);
      m.receiveShadow = true;
      scene.add(m);
      // 土間: 外周に段差側面を追加
      if (isDoma) addDomaRect(scene, r.x, r.y, r.w, r.h, baseY);
    }
  }
}

// 矩形土間の外周段差側面
function addDomaRect(scene, rx, ry, rw, rh, baseY) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a8278 });
  const y   = baseY - DOMA_DROP / 2;
  const x0  = rx * CELL, z0 = ry * CELL;
  const x1  = (rx + rw) * CELL, z1 = (ry + rh) * CELL;
  // 北・南辺
  for (const [zPos, zRot] of [[z0, 0], [z1, Math.PI]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(rw * CELL, DOMA_DROP), mat);
    m.rotation.y = zRot;
    m.position.set((x0 + x1) / 2, y, zPos);
    scene.add(m);
  }
  // 西・東辺
  for (const [xPos, yRot] of [[x0, -Math.PI/2], [x1, Math.PI/2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(rh * CELL, DOMA_DROP), mat);
    m.rotation.y = yRot;
    m.position.set(xPos, y, (z0 + z1) / 2);
    scene.add(m);
  }
}

// 不定形土間の外縁段差側面
function addDomaEdges(scene, cells, baseY) {
  const mat  = new THREE.MeshLambertMaterial({ color: 0x8a8278 });
  const set  = new Set(cells);
  const y    = baseY - DOMA_DROP / 2;
  for (const key of cells) {
    const [col, row] = key.split(',').map(Number);
    // 各セルの4辺を調べ、隣がなければ側面を追加
    const edges = [
      { nx: col,   nz: row-1, x: (col+0.5)*CELL,  z: row*CELL,       w: CELL, rotY: 0 },
      { nx: col,   nz: row+1, x: (col+0.5)*CELL,  z: (row+1)*CELL,   w: CELL, rotY: Math.PI },
      { nx: col-1, nz: row,   x: col*CELL,         z: (row+0.5)*CELL, w: CELL, rotY: -Math.PI/2 },
      { nx: col+1, nz: row,   x: (col+1)*CELL,     z: (row+0.5)*CELL, w: CELL, rotY: Math.PI/2 },
    ];
    for (const e of edges) {
      if (!set.has(`${e.nx},${e.nz}`)) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(e.w, DOMA_DROP), mat);
        m.rotation.y = e.rotY;
        m.position.set(e.x, y, e.z);
        scene.add(m);
      }
    }
  }
}

function generateFloorSlab(scene, rooms, baseY) {
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d8 });
  for (const r of rooms) {
    if (r.typeId === 'void') continue;
    if (r.cells) {
      for (const key of r.cells) {
        const [col, row] = key.split(',').map(Number);
        const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.25, CELL), slabMat);
        m.position.set((col + 0.5)*CELL, baseY - 0.125, (row + 0.5)*CELL);
        m.receiveShadow = true;
        scene.add(m);
      }
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(r.w*CELL, 0.25, r.h*CELL), slabMat);
      m.position.set((r.x+r.w/2)*CELL, baseY - 0.125, (r.y+r.h/2)*CELL);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
}

function generateZoneFloors(scene, rooms, baseY) {
  for (const r of rooms) {
    for (const z of (r.zones || [])) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(z.w*CELL, z.h*CELL),
        new THREE.MeshLambertMaterial({ color: toColor(z.color) })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x+z.x+z.w/2)*CELL, baseY + 0.003, (r.y+z.y+z.h/2)*CELL);
      m.receiveShadow = true;
      scene.add(m);
      addZoneLabel(scene, z.label, (r.x+z.x+z.w/2)*CELL, baseY + 0.05, (r.y+z.y+z.h/2)*CELL);
    }
  }
}

function generateCeilings(scene, rooms, baseY, aboveVoidCells = new Set()) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xf8f8f6, side: THREE.DoubleSide });
  for (const r of rooms) {
    if (r.cells) {
      for (const key of r.cells) {
        if (aboveVoidCells.has(key)) continue;
        const [col, row] = key.split(',').map(Number);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), mat);
        m.rotation.x = Math.PI / 2;
        m.position.set((col + 0.5)*CELL, baseY + WALL_H, (row + 0.5)*CELL);
        scene.add(m);
      }
    } else {
      // 矩形部屋: void穴がある場合はセルごとに生成
      if (aboveVoidCells.size > 0) {
        for (let row = r.y; row < r.y + r.h; row++) {
          for (let col = r.x; col < r.x + r.w; col++) {
            if (aboveVoidCells.has(`${col},${row}`)) continue;
            const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), mat);
            m.rotation.x = Math.PI / 2;
            m.position.set((col + 0.5)*CELL, baseY + WALL_H, (row + 0.5)*CELL);
            scene.add(m);
          }
        }
      } else {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w*CELL, r.h*CELL), mat);
        m.rotation.x = Math.PI / 2;
        m.position.set((r.x+r.w/2)*CELL, baseY + WALL_H, (r.y+r.h/2)*CELL);
        scene.add(m);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// void部屋のセルキーを収集するヘルパー
// ─────────────────────────────────────────────────────────
function getVoidCells(rooms) {
  const cells = new Set();
  for (const r of rooms) {
    if (r.typeId !== 'void') continue;
    if (r.cells) {
      for (const key of r.cells) cells.add(key);
    } else {
      for (let row = r.y; row < r.y + r.h; row++)
        for (let col = r.x; col < r.x + r.w; col++)
          cells.add(`${col},${row}`);
    }
  }
  return cells;
}

// ─────────────────────────────────────────────────────────
// 階段ジオメトリ（向き対応: n/s/e/w）
// ─────────────────────────────────────────────────────────
function generateStair(scene, stair, baseY, floorIdx) {
  const sx = stair.x * CELL;
  const sz = stair.y * CELL;
  const sw = stair.w * CELL;
  const sh = stair.h * CELL;
  const dir = stair.dir || 's';

  // ミラー階段（2F側）は吹き抜けマーカーのみ表示
  if (stair.mirror) {
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshLambertMaterial({ color: 0xd4b896, transparent: true, opacity: 0.3 })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(sx + sw / 2, baseY + 0.005, sz + sh / 2);
    scene.add(marker);
    return;
  }

  const stepMat = new THREE.MeshLambertMaterial({ color: 0xc4a882 });

  const stepH = FLOOR_H / STAIR_STEPS;
  const isNS  = (dir === 'n' || dir === 's');

  for (let i = 0; i < STAIR_STEPS; i++) {
    const y0 = baseY + i * stepH;

    if (isNS) {
      const stepD = sh / STAIR_STEPS;
      const z0 = dir === 's'
        ? sz + i * stepD
        : sz + sh - (i + 1) * stepD;

      // 踏面のみ（蹴込み板なし）
      const tread = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.03, stepD), stepMat);
      tread.position.set(sx + sw / 2, y0 + stepH - 0.015, z0 + stepD / 2);
      scene.add(tread);
    } else {
      const stepD = sw / STAIR_STEPS;
      const x0 = dir === 'e'
        ? sx + i * stepD
        : sx + sw - (i + 1) * stepD;

      // 踏面のみ（蹴込み板なし）
      const tread = new THREE.Mesh(new THREE.BoxGeometry(stepD, 0.03, sh), stepMat);
      tread.position.set(x0 + stepD / 2, y0 + stepH - 0.015, sz + sh / 2);
      scene.add(tread);
    }
  }

  // 階段マーカー（床面）
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(sw, sh),
    new THREE.MeshLambertMaterial({ color: 0xd4b896, transparent: true, opacity: 0.5 })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(sx + sw / 2, baseY + 0.005, sz + sh / 2);
  scene.add(marker);

  // 手すり
  addStairHandrails(scene, stair, baseY);
}

// 階段手すり
function addStairHandrails(scene, stair, baseY) {
  if (stair.mirror) return;

  const HANDRAIL_H = 0.9;   // 手すりの高さ
  const POST_W     = 0.05;  // 支柱の太さ
  const RAIL_W     = 0.04;  // 手すり棒の太さ
  const BALUSTER_INTERVAL = 2; // 間柱の間隔（ステップ数）

  const mat  = new THREE.MeshLambertMaterial({ color: 0x8b6343 });
  const sx   = stair.x * CELL, sz = stair.y * CELL;
  const sw   = stair.w * CELL, sh = stair.h * CELL;
  const dir  = stair.dir || 's';
  const isNS = dir === 'n' || dir === 's';
  const stepH = FLOOR_H / STAIR_STEPS;

  function makeBox(w, h, d) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  }

  if (isNS) {
    const stepD  = sh / STAIR_STEPS;
    const zStart = dir === 's' ? sz       : sz + sh;
    const zEnd   = dir === 's' ? sz + sh  : sz;
    const railLen = Math.sqrt(sh * sh + FLOOR_H * FLOOR_H);
    const angle   = Math.atan2(FLOOR_H, sh);

    for (const rx of [sx + POST_W / 2, sx + sw - POST_W / 2]) {
      // 両端の縦支柱
      const bottom = makeBox(POST_W, HANDRAIL_H, POST_W);
      bottom.position.set(rx, baseY + HANDRAIL_H / 2, zStart);
      scene.add(bottom);

      const top = makeBox(POST_W, HANDRAIL_H, POST_W);
      top.position.set(rx, baseY + FLOOR_H + HANDRAIL_H / 2, zEnd);
      scene.add(top);

      // 間柱（中間バルスター）
      for (let i = BALUSTER_INTERVAL; i < STAIR_STEPS; i += BALUSTER_INTERVAL) {
        const zi = dir === 's' ? sz + i * stepD : sz + sh - i * stepD;
        const yi = baseY + i * stepH;
        const bal = makeBox(POST_W, HANDRAIL_H, POST_W);
        bal.position.set(rx, yi + HANDRAIL_H / 2, zi);
        scene.add(bal);
      }

      // 斜め手すり棒
      const rail = makeBox(RAIL_W, RAIL_W, railLen);
      rail.position.set(rx, baseY + FLOOR_H / 2 + HANDRAIL_H, (zStart + zEnd) / 2);
      rail.rotation.x = dir === 's' ? -angle : angle;
      scene.add(rail);
    }
  } else {
    const stepD  = sw / STAIR_STEPS;
    const xStart = dir === 'e' ? sx       : sx + sw;
    const xEnd   = dir === 'e' ? sx + sw  : sx;
    const railLen = Math.sqrt(sw * sw + FLOOR_H * FLOOR_H);
    const angle   = Math.atan2(FLOOR_H, sw);

    for (const rz of [sz + POST_W / 2, sz + sh - POST_W / 2]) {
      const bottom = makeBox(POST_W, HANDRAIL_H, POST_W);
      bottom.position.set(xStart, baseY + HANDRAIL_H / 2, rz);
      scene.add(bottom);

      const top = makeBox(POST_W, HANDRAIL_H, POST_W);
      top.position.set(xEnd, baseY + FLOOR_H + HANDRAIL_H / 2, rz);
      scene.add(top);

      for (let i = BALUSTER_INTERVAL; i < STAIR_STEPS; i += BALUSTER_INTERVAL) {
        const xi = dir === 'e' ? sx + i * stepD : sx + sw - i * stepD;
        const yi = baseY + i * stepH;
        const bal = makeBox(POST_W, HANDRAIL_H, POST_W);
        bal.position.set(xi, yi + HANDRAIL_H / 2, rz);
        scene.add(bal);
      }

      const rail = makeBox(railLen, RAIL_W, RAIL_W);
      rail.position.set((xStart + xEnd) / 2, baseY + FLOOR_H / 2 + HANDRAIL_H, rz);
      rail.rotation.z = dir === 'e' ? angle : -angle;
      scene.add(rail);
    }
  }
}

// ─────────────────────────────────────────────────────────
// 家具ジオメトリ生成
// ─────────────────────────────────────────────────────────
function generateFurnitureItems(scene, furniture, baseY) {
  for (const f of furniture) {
    const x  = f.x * CELL;
    const z  = f.y * CELL;
    const fw = f.w * CELL;
    const fd = f.h * CELL;
    switch (f.typeId) {
      case 'kitchen': genKitchen(scene, x, z, fw, fd, baseY); break;
      case 'bath':    genBath(scene, x, z, fw, fd, baseY); break;
      case 'toilet':  genToilet(scene, x, z, fw, fd, baseY); break;
      case 'chair':   genChair(scene, x, z, fw, fd, baseY); break;
      case 'table':   genTable(scene, x, z, fw, fd, baseY); break;
      case 'washer':  genWasher(scene, x, z, fw, fd, baseY); break;
      case 'sink':    genSink(scene, x, z, fw, fd, baseY); break;
      case 'fridge':  genFridge(scene, x, z, fw, fd, baseY); break;
    }
  }
}

function addBox(scene, color, px, py, pz, sw, sh, sd) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sw, sh, sd),
    new THREE.MeshLambertMaterial({ color })
  );
  mesh.position.set(px, py, pz);
  scene.add(mesh);
}

function genKitchen(scene, x, z, fw, fd, baseY) {
  // カウンター本体
  addBox(scene, 0xd0d0c8, x + fw/2, baseY + 0.45, z + fd/2, fw, 0.9, fd);
  // 天板
  addBox(scene, 0x888880, x + fw/2, baseY + 0.91, z + fd/2, fw, 0.03, fd);
  // シンク（凹み表現: 暗い色の箱）
  const sinkW = Math.min(0.4, fw * 0.4);
  addBox(scene, 0x707070, x + fw * 0.35, baseY + 0.93, z + fd/2, sinkW, 0.05, fd * 0.6);
}

function genBath(scene, x, z, fw, fd, baseY) {
  // 浴槽外壁
  addBox(scene, 0xdbeafe, x + fw/2, baseY + 0.3, z + fd/2, fw, 0.6, fd);
  // 内側（水面）
  addBox(scene, 0x93c5fd, x + fw/2, baseY + 0.58, z + fd/2, fw*0.8, 0.03, fd*0.75);
}

function genToilet(scene, x, z, fw, fd, baseY) {
  const bw = Math.min(fw, 0.35), bd = Math.min(fd * 0.65, 0.45);
  // 便器本体
  addBox(scene, 0xf0fdf4, x + fw/2, baseY + 0.22, z + fd*0.55, bw, 0.44, bd);
  // タンク
  addBox(scene, 0xe7f7ed, x + fw/2, baseY + 0.5, z + fd*0.12, bw*0.9, 0.35, fd*0.22);
}

function genChair(scene, x, z, fw, fd, baseY) {
  const sw = fw * 0.7, sd = fd * 0.7;
  // 座面
  addBox(scene, 0xfbbf24, x + fw/2, baseY + 0.44, z + fd/2, sw, 0.06, sd);
  // 脚 x4
  const lw = 0.04, lh = 0.44;
  const ox = sw/2 - 0.06, oz = sd/2 - 0.06;
  for (const [dx, dz] of [[ox,oz],[-ox,oz],[ox,-oz],[-ox,-oz]])
    addBox(scene, 0x92400e, x+fw/2+dx, baseY+lh/2, z+fd/2+dz, lw, lh, lw);
  // 背もたれ
  addBox(scene, 0xfbbf24, x + fw/2, baseY + 0.75, z + fd/2 - sd/2 + 0.03, sw, 0.6, 0.05);
}

function genTable(scene, x, z, fw, fd, baseY) {
  // 天板
  addBox(scene, 0xc8a04a, x + fw/2, baseY + 0.73, z + fd/2, fw*0.95, 0.06, fd*0.95);
  // 脚 x4
  const lw = 0.06, lh = 0.73;
  const ox = fw*0.4, oz = fd*0.4;
  for (const [dx, dz] of [[ox,oz],[-ox,oz],[ox,-oz],[-ox,-oz]])
    addBox(scene, 0xa07830, x+fw/2+dx, baseY+lh/2, z+fd/2+dz, lw, lh, lw);
}

function genWasher(scene, x, z, fw, fd, baseY) {
  addBox(scene, 0xe0f2fe, x + fw/2, baseY + 0.45, z + fd/2, fw*0.9, 0.9, fd*0.9);
  // ドラム窓
  const geo = new THREE.CylinderGeometry(Math.min(fw, fd)*0.28, Math.min(fw, fd)*0.28, 0.06, 16);
  const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5 }));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x + fw/2, baseY + 0.55, z + fd * 0.05);
  scene.add(mesh);
}

function genSink(scene, x, z, fw, fd, baseY) {
  // 台
  addBox(scene, 0xf0fdfa, x + fw/2, baseY + 0.4, z + fd/2, fw*0.9, 0.8, fd*0.9);
  // 天板
  addBox(scene, 0xccfbf1, x + fw/2, baseY + 0.81, z + fd/2, fw*0.9, 0.03, fd*0.9);
  // ボウル
  addBox(scene, 0x99f6e4, x + fw/2, baseY + 0.83, z + fd/2, fw*0.55, 0.05, fd*0.55);
}

function genFridge(scene, x, z, fw, fd, baseY) {
  // 本体（天井近くまで）
  addBox(scene, 0xfafafa, x + fw/2, baseY + 0.9, z + fd/2, fw*0.92, 1.8, fd*0.9);
  // ドアライン（上下区切り）
  addBox(scene, 0xe5e7eb, x + fw/2, baseY + 0.6, z + fd*0.04, fw*0.88, 0.03, 0.02);
  addBox(scene, 0xe5e7eb, x + fw/2, baseY + 1.2, z + fd*0.04, fw*0.88, 0.03, 0.02);
}

// ─────────────────────────────────────────────────────────
// 壁・建具生成
// ─────────────────────────────────────────────────────────
function generateWalls(scene, floorState, baseY, belowVoidCells = new Set(), lowerOccupied = new Set(), aboveVoidCells = new Set()) {
  const { rooms, elements, stairs } = floorState;
  const occupied  = new Set();
  const domaCells = new Set();
  const voidCells = new Set();
  for (const r of rooms) {
    const isDoma = r.isDoma ?? (r.typeId === 'doma' || r.typeId === 'genkan');
    const isVoid = r.typeId === 'void';
    if (r.cells) {
      for (const key of r.cells) {
        occupied.add(key);
        if (isDoma) domaCells.add(key);
        if (isVoid) voidCells.add(key);
      }
    } else {
      for (let row = r.y; row < r.y+r.h; row++)
        for (let col = r.x; col < r.x+r.w; col++) {
          const key = `${col},${row}`;
          occupied.add(key);
          if (isDoma) domaCells.add(key);
          if (isVoid) voidCells.add(key);
        }
    }
  }
  // 階段セルは通行可能エリアとして扱う。ただし外周に壁を生成しないため別セットで管理
  const stairCells = new Set();
  for (const s of (stairs || [])) {
    for (let row = s.y; row < s.y+s.h; row++)
      for (let col = s.x; col < s.x+s.w; col++) {
        const key = `${col},${row}`;
        occupied.add(key);
        stairCells.add(key);
      }
  }

  const elMap = new Map();
  for (const el of (elements || [])) elMap.set(`${el.dir}:${el.col}:${el.row}`, el);

  const wallMat  = new THREE.MeshLambertMaterial({ color: 0xf2ede6 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x99ccff, transparent: true, opacity: 0.22,
    roughness: 0.05, metalness: 0, side: THREE.DoubleSide,
  });
  const doorMat  = new THREE.MeshLambertMaterial({ color: 0xc8a870 });
  const matCache = new Map();
  function getElWallMat(el) {
    if (!el?.color) return wallMat;
    if (matCache.has(el.color)) return matCache.get(el.color);
    const m = new THREE.MeshLambertMaterial({ color: parseInt(el.color.replace('#', ''), 16) });
    matCache.set(el.color, m);
    return m;
  }

  const wallSegs = [];
  const doorMap  = new Map();
  const added    = new Set();

  function addEdge(dir, col, row, nCol, nRow) {
    const el = elMap.get(`${dir}:${col}:${row}`);
    // 隣接セルが占有済みの場合、明示的に配置された建具のみ描写する
    if (occupied.has(`${nCol},${nRow}`) && !el) return;
    const k = `E:${dir}:${col}:${row}`;
    if (added.has(k)) return;
    added.add(k);
    const type = el?.type;
    // エッジに隣接する両セルを確認（エッジ座標は必ずしもセル座標と一致しない）
    const cellA = dir === 'h' ? `${col},${row-1}` : `${col-1},${row}`;
    const cellB = `${col},${row}`;
    // 隣接セル（空側）が下階の吹き抜けなら壁を1F床まで下げる
    const neighKey = `${nCol},${nRow}`;
    // ownCell: このエッジを所有する部屋側のセル（neighKeyの逆側）
    const ownCell = (cellA === neighKey) ? cellB : cellA;
    const wallY0 = (domaCells.has(cellA) || domaCells.has(cellB)) ? baseY - DOMA_DROP
                 : (belowVoidCells.has(neighKey) && lowerOccupied.has(ownCell)) ? baseY - FLOOR_H
                 : baseY;
    const needsFullHeight = voidCells.has(cellA) || voidCells.has(cellB)
                          || aboveVoidCells.has(cellA) || aboveVoidCells.has(cellB);
    const wallTop = needsFullHeight ? baseY + FLOOR_H : baseY + WALL_H;
    const eMat = getElWallMat(el);
    if (type === 'door') {
      addDoorGeometry(scene, doorMat, eMat, dir, col, row, el?.flip || false, wallSegs, doorMap, wallY0, wallTop);
    } else if (type === 'window') {
      addWallSeg(scene, eMat,     dir, col, row, wallY0,            wallY0 + WIN_LOW);
      addWallSeg(scene, glassMat, dir, col, row, wallY0 + WIN_LOW,  wallY0 + WIN_HIGH);
      if (WALL_H - WIN_HIGH > 0.02) addWallSeg(scene, eMat, dir, col, row, wallY0 + WIN_HIGH, wallTop);
      wallSegs.push({ dir, col, row, open: false });
    } else if (type === 'window_tall') {
      addWallSeg(scene, glassMat, dir, col, row, wallY0, wallY0 + 2.0);
      if (WALL_H - 2.0 > 0.02) addWallSeg(scene, eMat, dir, col, row, wallY0 + 2.0, wallTop);
      wallSegs.push({ dir, col, row, open: false });
    } else if (type === 'window_low') {
      addWallSeg(scene, eMat,     dir, col, row, wallY0,        wallY0 + 1.5);
      addWallSeg(scene, glassMat, dir, col, row, wallY0 + 1.5,  wallY0 + Math.min(2.2, WALL_H));
      if (WALL_H - 2.2 > 0.02) addWallSeg(scene, eMat, dir, col, row, wallY0 + 2.2, wallTop);
      wallSegs.push({ dir, col, row, open: false });
    } else if (type === 'lowwall') {
      addWallSeg(scene, eMat, dir, col, row, wallY0, wallY0 + WALL_H / 3);
      wallSegs.push({ dir, col, row, open: false });
    } else {
      addWallSeg(scene, eMat, dir, col, row, wallY0, wallTop);
      wallSegs.push({ dir, col, row, open: false });
    }
  }

  for (const key of occupied) {
    if (stairCells.has(key)) continue; // 階段セルの外周には壁を生成しない
    const [c, r] = key.split(',').map(Number);
    addEdge('h', c,   r,   c,   r-1);
    addEdge('h', c,   r+1, c,   r+1);
    addEdge('v', c,   r,   c-1, r  );
    addEdge('v', c+1, r,   c+1, r  );
  }

  for (const el of (elements || [])) {
    if (el.type !== 'wall' && el.type !== 'lowwall') continue;
    const k = `I:${el.dir}:${el.col}:${el.row}`;
    if (added.has(k)) continue;
    added.add(k);
    const h = el.type === 'lowwall' ? WALL_H / 3 : WALL_H;
    addWallSeg(scene, getElWallMat(el), el.dir, el.col, el.row, baseY, baseY + h);
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
// ドアジオメトリ
// ─────────────────────────────────────────────────────────
function addDoorGeometry(scene, doorMat, wallMat, dir, col, row, flip, wallSegs, doorMap, baseY, wallTop) {
  const x = col * CELL, z = row * CELL;
  if (wallTop === undefined) wallTop = baseY + WALL_H;
  const topH = wallTop - baseY - DOOR_H;

  if (topH > 0.02) addWallSeg(scene, wallMat, dir, col, row, baseY + DOOR_H, wallTop);

  const frameMat = new THREE.MeshLambertMaterial({ color: 0xe0d0b8 });
  const FW = 0.05;
  if (dir === 'h') {
    [x, x + CELL - FW].forEach(fx => {
      const fm = new THREE.Mesh(new THREE.BoxGeometry(FW, DOOR_H, WALL_T + 0.02), frameMat);
      fm.position.set(fx + FW/2, baseY + DOOR_H/2, z);
      scene.add(fm);
    });
  } else {
    [z, z + CELL - FW].forEach(fz => {
      const fm = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.02, DOOR_H, FW), frameMat);
      fm.position.set(x, baseY + DOOR_H/2, fz + FW/2);
      scene.add(fm);
    });
  }

  const group = new THREE.Group();
  if (dir === 'h') {
    group.position.set(flip ? x + CELL : x, baseY, z);
  } else {
    group.position.set(x, baseY, flip ? z + CELL : z);
  }
  scene.add(group);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(
      dir === 'h' ? CELL - FW*2 : 0.04,
      DOOR_H - 0.02,
      dir === 'h' ? 0.04 : CELL - FW*2
    ),
    doorMat
  );
  if (dir === 'h') {
    panel.position.set((flip ? -1 : 1) * (CELL - FW*2) / 2, DOOR_H/2, 0);
  } else {
    panel.position.set(0, DOOR_H/2, (flip ? -1 : 1) * (CELL - FW*2) / 2);
  }

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0xd4a820 })
  );
  if (dir === 'h') knob.position.set((flip ? -1 : 1) * (CELL - FW*2 - 0.1), DOOR_H*0.45, 0.06);
  else             knob.position.set(0.06, DOOR_H*0.45, (flip ? -1 : 1) * (CELL - FW*2 - 0.1));
  panel.add(knob);
  group.add(panel);

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
    const wx = door.dir === 'h' ? (door.seg.col + 0.5) * CELL : door.seg.col * CELL;
    const wz = door.dir === 'h' ? door.seg.row * CELL          : (door.seg.row + 0.5) * CELL;
    const dist = Math.sqrt((camPos.x-wx)**2 + (camPos.z-wz)**2);
    door.target = dist < DOOR_DIST ? 88 : 0;
    const speed = 180;
    if (door.angle < door.target) door.angle = Math.min(door.target, door.angle + speed * 0.016);
    if (door.angle > door.target) door.angle = Math.max(door.target, door.angle - speed * 0.016);
    const rad = door.angle * Math.PI / 180;
    if (door.dir === 'h') door.group.rotation.y = (door.flip ? 1 : -1) * rad;
    else                  door.group.rotation.y = (door.flip ? -1 : 1) * rad;
    door.seg.open = door.angle > 45;
  }
}

// ─────────────────────────────────────────────────────────
// 衝突判定
// ─────────────────────────────────────────────────────────
function inRoom(x, z, roomRects) {
  return roomRects.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

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

function tryMove(cx, cz, nx, nz, fd) {
  const { roomRects, wallSegs } = fd;
  if (inRoom(nx, nz, roomRects) && !wallBlocks(cx, cz, nx, nz, wallSegs)) return { x: nx, z: nz };
  if (inRoom(nx, cz, roomRects) && !wallBlocks(cx, cz, nx, cz, wallSegs)) return { x: nx, z: cz };
  if (inRoom(cx, nz, roomRects) && !wallBlocks(cx, cz, cx, nz, wallSegs)) return { x: cx, z: nz };
  return { x: cx, z: cz };
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
function drawMinimap(ctx, floors, currentFloorIdx, camPos, yaw, state, stairAreas) {
  const S = 150;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(10,10,20,0.55)';
  ctx.fillRect(0, 0, S, S);

  const allRooms = floors.flatMap(f => f.rooms || []);
  if (!allRooms.length) return;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of allRooms) {
    if (r.x < minX) minX = r.x;
    if (r.x+r.w > maxX) maxX = r.x+r.w;
    if (r.y < minZ) minZ = r.y;
    if (r.y+r.h > maxZ) maxZ = r.y+r.h;
  }
  const span  = Math.max((maxX-minX)*CELL, (maxZ-minZ)*CELL, 0.01);
  const scale = (S-20) / span;
  const ox = 10 - minX*CELL*scale, oz = 10 - minZ*CELL*scale;

  // 非アクティブフロア（薄く表示）
  for (let fi = 0; fi < floors.length; fi++) {
    const alpha = fi === currentFloorIdx ? 'bb' : '33';
    for (const r of (floors[fi].rooms || [])) {
      ctx.fillStyle = (r.color||'#ccc') + alpha;
      if (r.cells) {
        for (const key of r.cells) {
          const [c, ro] = key.split(',').map(Number);
          ctx.fillRect(c*CELL*scale+ox, ro*CELL*scale+oz, CELL*scale, CELL*scale);
        }
      } else {
        ctx.beginPath(); ctx.roundRect(r.x*CELL*scale+ox, r.y*CELL*scale+oz, r.w*CELL*scale, r.h*CELL*scale, 2);
        ctx.fill();
        if (fi === currentFloorIdx) {
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.7; ctx.stroke();
        }
      }
    }
  }

  // 階段エリア
  for (const sa of stairAreas) {
    ctx.fillStyle = 'rgba(180,140,80,0.7)';
    ctx.fillRect(sa.x1*scale+ox, sa.z1*scale+oz, (sa.x2-sa.x1)*scale, (sa.z2-sa.z1)*scale);
    ctx.fillStyle = '#fff';
    ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🪜', (sa.x1+sa.x2)/2*scale+ox, (sa.z1+sa.z2)/2*scale+oz+3);
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

  // フロア表示
  ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${currentFloorIdx+1}F`, 4, 12);

  // カメラ矢印
  const cx = camPos.x*scale+ox, cz = camPos.z*scale+oz;
  ctx.save();
  ctx.translate(cx, cz); ctx.rotate(-yaw);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(5,5); ctx.lineTo(0,3); ctx.lineTo(-5,5); ctx.closePath();
  ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────
function easeInOut(t) {
  return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
}
