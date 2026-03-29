# SUMIKA（すみか）

ブラウザで動く間取り検討アプリです。部屋の配置・建具・家具・土地形状を2Dグリッド上で設計し、3Dウォークスルーで確認できます。

## 機能

- 部屋の配置・リサイズ・ラベル編集
- 壁・ドア・窓の配置（建具）
- 家具の配置
- 階段（1F/2F連携）
- 土地形状の描画（辺の長さ表示付き）
- 採光シミュレーション（方位・時刻）
- 3Dウォークスルー（Three.js）
- PDF・SVG・PNG出力
- データの保存・JSON入出力

## ローカルでの起動方法

このアプリは ES Modules（`import` / `export`）を使用しているため、**ローカルファイルを直接ブラウザで開くことはできません**。ローカルサーバーが必要です。

### Node.js を使う場合

```bash
# リポジトリをクローン
git clone <repository-url>
cd SUMIKA

# npx でサーバーを起動（インストール不要）
npx serve .
```

ブラウザで `http://localhost:3000` を開きます。

### Python を使う場合

```bash
cd SUMIKA
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開きます。

### VS Code を使う場合

[Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) 拡張をインストールし、`index.html` を右クリック →「Open with Live Server」を選択します。

## 技術スタック

- Vanilla JavaScript（ES Modules）
- SVG（壁・建具・土地レイヤー）
- [Three.js](https://threejs.org/) v0.165（3Dウォークスルー）
- HTML / CSS のみ（フレームワーク・ビルドツール不要）
