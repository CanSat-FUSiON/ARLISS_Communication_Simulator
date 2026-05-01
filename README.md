# CanSat 砂漠通信設計シミュレータ

ARLISS(ブラックロック砂漠、ネバダ州)における CanSat の遠隔運用を想定した、LoRa リンクバジェット / 中継器配置設計ツール。GitHub Pages でそのままホスティングできます。

## 機能

- **リンクバジェット計算** — Friis、2波モデル、フレネルゾーン+地球曲率(4/3地球モデル)
- **4周波数帯対応** — 433/915/920/2400 MHz、各国法規制を表示
- **ARLISS 100mW規定の警告** — 送信電力20dBm超で視覚的に警告
- **地図上の中継器配置** — Esri衛星画像、最大10台の中継器をクリックで配置
- **アンテナプリセット** — 市販品代表14種(λ/4ホイップ、八木5/9/13素子、コリニア、パッチ等)+カスタム指定
- **LoRaパラメータ** — SF7-12、BW 125/250/500 kHz、CR 4/5〜4/8、SX127xの感度テーブル準拠
- **推奨エンジン** — ルールベース即時推奨 + Anthropic API キーによるLLM拡張(任意)
- **JSON保存/読込** — 構成全体のセーブとロード

## ローカルで動かす

依存はCDN経由なので、ファイルをブラウザで開くだけで動きます:

```bash
cd cansat-sim
# 任意の方法でローカルサーバを立てる(file:// だとCORSで一部機能が制限される可能性)
python3 -m http.server 8000
# → http://localhost:8000 をブラウザで開く
```

## GitHub Pages へのデプロイ

1. **新しいGitHubリポジトリを作成** (例: `cansat-link-sim`)

2. **このディレクトリをアップロード**:
   ```bash
   cd cansat-sim
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/USERNAME/cansat-link-sim.git
   git push -u origin main
   ```

3. **GitHub Pages を有効化**:
   - リポジトリの Settings → Pages
   - Source: `Deploy from a branch`
   - Branch: `main` / folder: `/ (root)`
   - Save

4. **数分後に公開URLが発行されます**: `https://USERNAME.github.io/cansat-link-sim/`

## ファイル構成

```
cansat-sim/
├── index.html      # エントリポイント
├── styles.css      # スタイル
├── data.js         # 周波数帯・アンテナプリセット・LoRa感度テーブル
├── physics.js      # RF伝搬計算(Friis、2波、Fresnel、Haversine)
├── app.js          # UI・地図・状態管理・推奨エンジン
└── README.md       # このファイル
```

## 操作方法

1. **左カラム**: 周波数帯、送信電力、アンテナ、LoRaパラメータを設定
2. **中央上部**: 地図をクリックして中継器を配置(最大10台、ドラッグで移動)
3. **中央中段**: リンク幾何学の可視化と区間別リンクバジェット表
4. **右カラム**: 制約事項を入力し「推奨構成を生成」を押すと改善提案が出る

## デフォルト座標

要件通り、以下を初期値に設定済み:
- CanSat 投下点: `40.900522, -119.07909722`
- 地上局(人員): `40.654113159604734, -119.3529299890043`
- 直線距離: 約35.8km (ハバーサイン計算値)

これらは現状ハードコードされています(`data.js` 内 `COORD_CANSAT` / `COORD_BASE`)。

## LLM 詳細推奨機能について

任意機能です。Anthropic API キーをお持ちの場合、現在の構成と要件をClaude Sonnet 4.6に渡し、より詳細な推奨を生成できます。

- **APIキーはブラウザ内のみで保持され、サーバーに送信されません**(Anthropic APIに直接送信)
- 1回の生成で約500-1000トークン消費(US$0.003程度)
- キーは `sk-ant-` で始まる Anthropic API キー

## 既知の制約

- 2波モデルは反射係数 Γ=-1(完全導体大地近似)を使用。実際の砂漠地表は誘電体なのでやや楽観的な見積もりです
- アンテナ指向性は利得値のみで近似(放射パターンは未考慮)
- LoRa感度はSX127x系のデータシート値。SX126x/SX127xで僅差あり
- 干渉(他のLoRaトラフィック、ノイズ)は未考慮
- ハバーサインは球地球モデル。実距離との誤差は<0.5%

## ライセンス

MIT License
