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
  config/               環境変数・リレー・機能フラグの一元管理
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
cp .env.sample .env   # 値を設定する
npm run dev           # 開発実行（tsx watch）
```

本番:

```bash
npm run build
npm start
```

## テストモード

`TEST_MODE=true` を設定すると、Nostr への実投稿や外部サービスへの実操作を行わず、
送信予定内容をログ出力します。実運用前の動作確認に使ってください。

## 各機能の出自

| 機能 | 種別 | 参考元リポジトリ |
| --- | --- | --- |
| SalmonBot / CalendarBot / MonitorBot 等 | イベント Bot | OnlineConcierge |
| IoTBot（SwitchBot 連携） | イベント Bot + 外部連携 | NostrIot |
| FlowmeterJob / FlowmeterCommandBot | 定期ジョブ + 会話 Bot | nostr-flowmeter-batch |
| MetadataRefreshJob | 定期ジョブ | nostr-metadata-enhancer |

各機能は環境変数の有無で有効/無効が切り替わります。詳細は `.env.sample` を参照してください。
