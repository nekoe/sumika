# SUMIKA（すみか）開発ガイド

ブラウザで動く間取り検討アプリ。Vanilla JS (ES Modules) + SVG + Three.js のみ。ビルドツール不要。

## 開発サーバーの起動

```bash
npx serve .   # http://localhost:3000
# または
python3 -m http.server 8080
```

ES Modules を使用しているため、ファイルを直接ブラウザで開くことはできない。

## アーキテクチャ概要

```
app.js              オーケストレーター。全モジュールを初期化しコールバックで配線する
state.js            シングルトン状態。永続化対象の state と UI 一時状態の ui を分離
render.js           DOM 描画（部屋・家具・階段・外構）
walls.js            壁・建具の SVG レイヤー描画
wall-handler.js     壁・建具のマウスイベント処理
context-menu.js     右クリックコンテキストメニュー（部屋/家具/階段/外構/ドア対応）
walkthrough.js      Three.js 3D シーン（採光・家具3Dモデル・階段含む、約1200行）
export.js           SVG / PNG / PDF 出力
storage.js          マルチプロジェクト CRUD・シリアライズ・旧形式マイグレーション
project-manager.js  プロジェクト管理モーダルUI（作成・切替・リネーム・複製・削除・ソート）
undo.js             JSON スナップショット方式の Undo/Redo
grid.js             配置衝突判定（DOM 非依存の純粋ロジック）
rooms.js            部屋タイプ定義・createRoomData・面積計算
materials.js        床材マスタ定義（FLOOR_MATERIALS・getFloorMaterialLabel）
inspector.js        選択状態に応じた右パネル差し替え
toolbar.js          2行ツールバー生成
palette-renderer.js モード別パレット描画
dnd.js              パレット→グリッドへの DnD（タッチ対応）
selection.js        単体・複数選択・一括移動
sunlight.js         採光スコア計算・2D オーバーレイ描画
```

## 状態管理パターン

### state（永続化対象）
```js
state.gridCols / gridRows / cellSize
state.currentFloor       // 0 or 1
state.floors[0..1]       // { rooms, elements, stairs, furniture }
state.mode               // 'room' | 'wall' | 'door' | 'window' | ... | 'eraser' | 'stair' | 'furniture' | 'land' | 'landscape'
state.land               // { points: [{x,y}], closed: bool }
state.landscape          // 全フロア共通
```

`state.rooms` / `state.elements` / `state.stairs` / `state.furniture` は `currentFloor` に基づく仮想プロパティ（`Object.defineProperty`）。

### ui（非永続・一時UI状態）
```js
ui.grid              // 2D配列でセル占有を管理（roomId | null）
ui.svgEl             // 壁レイヤーSVG
ui.selectedId / selectedStairId / selectedFurnitureId / selectedLandscapeId
ui.multiSelected     // Set<id>
ui.hoveredEdge       // 壁モード時のホバー辺
ui.eraserDragging
ui.selectedElementKey
ui.currentProjectId  // 現在編集中のプロジェクトID（storage.js の _currentProjectId と同期）
```

## データ構造

### 部屋（Room）
```js
{ id, typeId, label, x, y, w, h, color, cells: ["col,row", ...], isDoma,
  floorMaterial?: string,   // 'auto'|'flooring'|'tile'|'tatami'|'mortar'|'carpet'|'marble'
  wallColor?: string }      // '#rrggbb' — 未設定は undefined（グローバル壁色を使用）
```
`cells` が実際の占有セル。`x/y/w/h` はバウンディングボックス（`updateIrregularRoomBounds()` で再計算）。
`floorMaterial` は省略または `'auto'` のとき部屋タイプのデフォルト床材を使用。

### 建具（Element）
```js
{ id: "h:3:2", type: "wall"|"door"|"window"|..., col, row, dir: "h"|"v", color, flip }
```
エッジキー形式: `"h:col:row"`（水平辺）/ `"v:col:row"`（垂直辺）

### 家具（Furniture）
```js
{ id, typeId, x, y, w, h, dir: "n"|"s"|"e"|"w" }
```
家具はグリッド衝突チェックなし（自由配置）。

## レンダリングパターン

`renderAll()`（app.js）が毎回 DOM 全体を再生成する方式（仮想 DOM なし）:
```
applyGridCss → renderRooms → renderStairs → renderFurniture → renderLandscape → renderWallLayer → renderLandLayer → updateInspector
```

## 変更前に必ず呼ぶセット
```js
pushUndo();          // 変更前に Undo スナップショットを保存
// ... state を変更 ...
renderAll();         // または個別の render 関数
saveProject(state);  // localStorage に保存
```

## コールバック注入パターン

各モジュールは `init*({ renderAll, updateInspector, ... })` でコールバックを受け取り、モジュール内の `let` 変数に保持する（循環参照回避のため）。

## 壁・建具モードの実装規約

- `wall-handler.js` の `isPassThrough()` でモードの振り分けを管理
- `renderWallLayer(svgEl, elements, cs, cols, rows, hoveredEdge, mode, selectedKey, dragPreviewEdges = [])` — 第9引数は省略可
- 壁ドラッグ描画: mousedown で辺を記録、document.mousemove でプレビュー、document.mouseup で確定

## コンテキストメニューの実装規約

- `context-menu.js` の `initContextMenu({...})` で初期化、`showContextMenu(e, svgEl, doorEl)` を呼び出す
- contextmenu イベントリスナーは **SVG ではなくグリッドコンテナ要素** に登録する。
  passThrough モードでは `walls.js` が `svgEl.style.pointerEvents = 'none'` をセットするため、SVG に登録すると発火しない。
- ドア検出は `wall-handler.js` 内で行い、`doorEl`（見つかれば要素オブジェクト、なければ `null`）をコールバックへ渡す

## 物理スケール

| 定数 | 値 |
|------|-----|
| 1セル | 0.91 m |
| デフォルトグリッド | 20列 × 15行 |
| デフォルトセルサイズ | 44 px |
| ズーム範囲 | 24〜96 px（4px刻み） |
| 壁高（3D） | 2.4 m |
| 視点高（3D） | 1.6 m |

## 主要な種別マスタ

- **部屋**: 17種（LDK/リビング/ダイニング/キッチン/主寝室/子供部屋/書斎/浴室/トイレ/洗面所/玄関/土間/廊下/納戸WIC/バルコニー/吹き抜け/カスタム）
- **建具**: 8種（wall/lowwall/door/slide_door/window/window_tall/window_low/eraser）
- **家具**: 9種（kitchen/chair/table/washer/sink/fridge/sofa/lowtable/custom）
- **外構**: 4種（駐車場/庭・芝生/植栽・樹木/テラス）
- **床材**: 7種（auto/flooring/tile/tatami/mortar/carpet/marble）— `materials.js` で管理

## マルチプロジェクトの実装規約

### localStorage キー体系
```
sumika-projects-index        [{id, name, createdAt, updatedAt}]  プロジェクト一覧
sumika-project-{id}          プロジェクトデータ本体（v3 フォーマット）
```
旧キー `sumika-project-v3` は起動時に自動マイグレーションして削除される。

### saveProject の挙動
`saveProject(state)` は `storage.js` 内部の `_currentProjectId` を使って `sumika-project-{id}` へ保存する。
呼び出し側のシグネチャは変わらないため、既存の全モジュールは修正不要。

`setCurrentProjectId(id)` と `ui.currentProjectId = id` を必ずセットで更新すること。

### 未保存変更チェック
`hasUnsavedChanges(state)` は最後の `saveProject` 時の JSON スナップショット（`_lastSavedJSON`）と現在の `_serializeState(state)` を比較する。
一度も保存できていない場合は `true` を返す（安全側フォールバック）。

### IME 入力フォームの規約
テキスト入力の `keydown` で Enter 確定する場合は `e.isComposing` チェックを必ず行う。
```js
if (e.key === 'Enter' && !e.isComposing) { /* 確定処理 */ }
```

## 既知の制約

- フロアは 2 固定（`floors[0]` / `floors[1]`）
- 不定形部屋のリサイズはセルペイント操作のみ（ハンドルなし）
- 家具は他の家具・壁をすり抜けて配置可能（衝突判定なし）
- SVG/PNG エクスポートは現在フロアのみ
- Undo スタックに上限なし（長時間作業でメモリ増大の可能性）
- 採光オーバーレイは窓位置から距離減衰で近似（実際の日射計算ではない）
