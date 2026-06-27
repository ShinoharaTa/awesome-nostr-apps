# awesome-nostr-apps

複数リポジトリに分散していた Nostr 関連 Bot を、疎結合のまま 1 つのシステムへ統合した実行基盤です。
イベント駆動 Bot、定期ジョブ、外部サービス連携を、共通の Nostr 接続・設定・ログ基盤の上で動かします。

> EEW（緊急地震速報）配信は別システムとして扱い、このプロジェクトには含めません。

機能の一覧とワード応答表は [docs/features.md](docs/features.md) にまとめています。

## アーキテクチャ

3 つの実行レイヤに分かれています。

- `core`: Nostr 接続・購読・投稿、イベントバス、Bot 登録/実行、ジョブ実行、ログ。
- `bots`: Nostr イベントに反応する機能。`filter + action` で疎結合に登録する。
- `jobs`: cron で動く定期処理。イベント Bot とは別の実行モデル。

```text
src/
  app.ts                アプリ起動。Bot とジョブを登録して開始する
  config/               設定の一元管理（.env=秘密 / config.ts=非機密 を統合）
  core/                 NostrClient / EventBus / BotManager / JobRunner / logger
  bots/                 イベント駆動 Bot（shinoemon / flowmeterChan / management / monitor）
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

- **秘密情報 → `.env`**: 秘密鍵、API キー、Discord Webhook、SwitchBot トークン等。
  `.env` には他に `APP_ENV` のみを置きます。
- **非機密設定 → `src/config/config.ts`**: リレー一覧、機能の有効/無効、cron、キーワード等。
  TypeScript なのでコメント・型補完が使えます。`APP_ENV` 指定時は `src/config/config.<env>.ts`
  を base にディープマージします。各項目の意味は下記「設定項目」を参照してください。

### 設定項目（`config.ts`）

| キー | 説明 |
| --- | --- |
| `logLevel` | ログ出力レベル（`debug` / `info` / `warn` / `error`） |
| `testMode` | `true` の間は実際に投稿・外部操作せずログのみ |
| `cooldownSec` | 応答系 Bot の連投抑止（秒・投稿者ごと） |
| `relays.subscribe` / `relays.publish` | 購読 / 投稿の既定リレー |
| `<Bot/機能>.enabled` | その公開Bot/機能の有効/無効。`true` にしたら下表の秘密を `.env` に用意する |
| `shinoemon.model` | しのえもんの予定解析などで使う LLM モデル名 |
| `shinoemon.skills.*` | しのえもん内部 skill（`callResponse` / `lightControl` / `calendar`）の有効/無効 |
| `shinoemon.home.lightDeviceNames` | 「光ある？」「光あれ！」で使う SwitchBot ライト名。空ならライト系デバイスを自動選択 |
| 温湿度計 | 設定不要。SwitchBot の温湿度系デバイスを自動選択し、`deviceName` の名前順で表示 |
| `shinoemon.home.allowControl` | `true` の時だけ「光あれ！」で実際にライトを点灯する |
| `monitor.keywords` / `npubs` / `mentionNpubs` | 監視するキーワード / 投稿者 / メンション宛先 |
| `<Bot/機能>.cron` | 定期ジョブの cron スケジュール |
| `<Bot/機能>.relays` | その機能が使うリレー（下記「リレー指定」参照） |
| `passport.targetNpub` | パスポート投稿の対象 npub |

### 機能 ↔ 秘密情報の対応

公開Bot/機能の ON/OFF は `config.ts` の各項目 `enabled` で行い、`.env` には有効化したものが
必要とする秘密だけを入れます。`config.ts` で有効にしたのに必要な秘密が欠けていると、
投稿鍵が欠けている場合は**起動エラー**、Webhook / `METADATA_KEYS` が欠けている場合は
**警告して自動無効化**になります。

| 公開Bot/機能 | 投稿鍵（`.env`） | その他の秘密（`.env`） | Nostr 投稿 |
| --- | --- | --- | --- |
| `shinoemon` | `SHINOEMON_NSEC` 必須 | `OPENROUTER_API_KEY` / `OPENAI_API_KEY`（calendar skill 有効時に任意）、`SWITCH_BOT_TOKEN` / `SWITCH_BOT_SECRET`（lightControl skill 有効時） | する |
| `flowmeterChan` | `FLOWMETER_CHAN_NSEC` 必須（command/job 共通） | - | する |
| `management` | `MANAGEMENT_NSEC` 必須 | - | する |
| `monitor` | **不要** | `DISCORD_WEBHOOK_URL` 必須 | **しない（Discord 通知のみ）** |
| `passport` | `PASSPORT_NSEC` 必須 | - | する |
| `metadataRefresh` | -（下記参照） | `METADATA_KEYS` 必須 | 対象鍵で再 Publish |

### 鍵（アカウント）の指定

投稿鍵はすべて `.env` に置き、`nsec1...` でも 64 文字 hex でも指定できます。
**鍵は「公開Botごと」に持ちます。「既定鍵 / メインアカウント」という概念はありません。**

- `<Bot>_NSEC`: その公開Botが**どのアカウントとして投稿するか**を表す鍵。
- しのえもん内部の skill（呼びかけ応答 / 照明 / 予定）は、すべて `SHINOEMON_NSEC` で投稿します。
- 流速ちゃんのコマンド応答と定期ジョブは、どちらも `FLOWMETER_CHAN_NSEC` で投稿します。
- `monitor` は Nostr へ投稿しない監視系（read-only）なので **NSEC は不要**。`DISCORD_WEBHOOK_URL` だけ必要です。
- `METADATA_KEYS`: これだけ性質が異なります。MetadataRefreshJob が kind:0 を再 Publish する
  **対象アカウント自身の秘密鍵リスト**で、Bot の投稿鍵ではありません。

### 読み込むファイルの切り替え（APP_ENV）

`.env` の `APP_ENV` で読み込む設定を切り替えます。`APP_ENV` 指定時は base の `config.ts` に
環境別ファイルを**ディープマージ**します（オブジェクトは再帰マージ、配列・スカラーは上書き）。
環境別ファイルが存在しなければ base の `config.ts` のみを使います。

| `APP_ENV` | 読み込む設定 |
| --- | --- |
| 未指定 | `config.ts`（base・Git 管理） |
| `LOCAL` | `config.ts` + `config.local.ts`（ローカル上書き・`.gitignore` 対象） |
| 任意の値 `X` | `config.ts` + `config.<x>.ts`（小文字化） |

設定ファイルは `src/config/` に置きます（base のみ Git 管理）。上書きは変えたい項目だけを
`export default { ... } satisfies DeepPartial<FileConfig>` で書けば十分です。

### リレーは「使用する項目ごと」に指定

グローバル既定は持たず、用途・機能ごとに明示します。

| 設定キー | 用途 |
| --- | --- |
| `relays.subscribe` | リアルタイム購読（EventBus） |
| `relays.publish` | 応答系 Bot の投稿先 |
| `flowmeterChan.relays` | 流速計測・投稿（JP/GLOBAL の区別あり） |
| `metadataRefresh.relays` | kind:0 の取得・再 Publish |
| `passport.relays` | パスポート投稿先 |

有効化した機能に必要なリレーや投稿鍵（`<機能>_NSEC`）が無い場合は起動時にエラーになります。
一方、`DISCORD_WEBHOOK_URL`（monitor）や `METADATA_KEYS`（metadataRefresh）が無い機能は、
警告を出して自動的に無効化され、起動は継続します。

## テストモード

`config.ts` の `testMode: true` を設定すると、Nostr への実投稿や外部サービスへの
実操作を行わず、送信予定内容をログ出力します。`config.local.ts` は既定で `testMode: true`
です。実運用前の動作確認に使ってください。

## 各機能の出自

| 機能 | 種別 | 参考元リポジトリ |
| --- | --- | --- |
| ShinoemonBot（call/calendar/light skill）/ MonitorBot 等 | イベント Bot | OnlineConcierge / NostrIot |
| FlowmeterChanBot / FlowmeterJob | 会話 Bot + 定期ジョブ | nostr-flowmeter-batch |
| MetadataRefreshJob | 定期ジョブ | nostr-metadata-enhancer |

各機能の有効/無効やリレーは `config.ts` で切り替えます。秘密情報の設定は `.env.sample` を参照してください。
