# awesome-nostr-apps

複数リポジトリに分散していた Nostr 関連 Bot を、疎結合のまま 1 つのシステムへ統合した実行基盤です。
イベント駆動 Bot、定期ジョブ、外部サービス連携を、共通の Nostr 接続・設定・ログ基盤の上で動かします。

> EEW（緊急地震速報）配信は別システムとして扱い、このプロジェクトには含めません。

## アーキテクチャ

3 つの実行レイヤに分かれています。

- `core`: Nostr 接続・購読・投稿、イベントバス、Bot 登録/実行、ジョブ実行、ログ。
- `bots`: Nostr イベントに反応する機能。`filter + action` で疎結合に登録する。
- `jobs`: cron で動く定期処理。イベント Bot とは別の実行モデル。

```text
src/
  app.ts                アプリ起動。Bot とジョブを登録して開始する
  config/               設定の一元管理（.env=秘密 / JSON=非機密 を統合）
  core/                 NostrClient / EventBus / BotManager / JobRunner / logger
  bots/                 イベント駆動 Bot（salmon / management / monitor / iot / flowmeter-command / calendar）
  jobs/                 定期ジョブ（flowmeter / metadata-refresh / passport）
  integrations/         外部サービス連携（discord / switchbot / llm）
  shared/               時刻・タグ・レート制限などの共有ユーティリティ
  test/                 テストヘルパ
```

## セットアップ

```bash
npm install
cp .env.sample .env   # 秘密情報を設定する
npm run dev           # 開発実行（tsx watch）
```

本番:

```bash
npm run build
npm start
```

## 設定の考え方

設定は「秘密情報」と「非機密設定」を分けて管理します。

- **秘密情報 → `.env`**: 秘密鍵（`HEX` / `PASSPORT_KEY` / `METADATA_KEYS`）、API キー、
  Discord Webhook、SwitchBot トークン等。`.env` には他に `APP_ENV` のみを置きます。
- **非機密設定 → JSON（`config.json`）**: リレー一覧、機能の有効/無効、cron、キーワード等。

### 読み込むファイルの切り替え（APP_ENV）

`.env` の `APP_ENV` で読み込む JSON を切り替えます。

| `APP_ENV` | 読み込むファイル |
| --- | --- |
| 未指定 | `config.json`（Git 管理） |
| `LOCAL` | `config.local.json`（ローカル上書き・`.gitignore` 対象） |
| 任意の値 `X` | `config.<x>.json`（小文字化） |

### リレーは「使用する項目ごと」に指定

グローバル既定は持たず、用途・機能ごとに明示します。

| 設定キー | 用途 |
| --- | --- |
| `relays.subscribe` | リアルタイム購読（EventBus） |
| `relays.publish` | 応答系 Bot の投稿先 |
| `flowmeter.relays` | 流速計測・投稿（JP/GLOBAL の区別あり） |
| `metadataRefresh.relays` | kind:0 の取得・再 Publish |
| `passport.relays` | パスポート投稿先 |

有効化した機能に必要なリレーが無い場合は起動時にエラーになります。必要な秘密鍵 / Webhook が
無い機能は警告を出して自動的に無効化されます。

## テストモード

`config.json` の `"testMode": true` を設定すると、Nostr への実投稿や外部サービスへの
実操作を行わず、送信予定内容をログ出力します。`config.local.json` は既定で `testMode: true`
です。実運用前の動作確認に使ってください。

## 各機能の出自

| 機能 | 種別 | 参考元リポジトリ |
| --- | --- | --- |
| SalmonBot / CalendarBot / MonitorBot 等 | イベント Bot | OnlineConcierge |
| IoTBot（SwitchBot 連携） | イベント Bot + 外部連携 | NostrIot |
| FlowmeterJob / FlowmeterCommandBot | 定期ジョブ + 会話 Bot | nostr-flowmeter-batch |
| MetadataRefreshJob | 定期ジョブ | nostr-metadata-enhancer |

各機能の有効/無効やリレーは `config.json` で切り替えます。秘密情報の設定は `.env.sample` を参照してください。
