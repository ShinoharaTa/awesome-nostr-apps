# 機能一覧とワード応答表

このプロジェクトに含まれる Bot / Job と、応答トリガー（ワード）の一覧です。
設定は `src/config/config.ts`（機能の有効化）と `.env`（鍵・秘密）で行います。

## 凡例

- **種別**: 応答Bot=Nostr の投稿に反応 / 監視=Discord 通知のみ / 定期Job=cron 実行
- **投稿鍵**: その機能が投稿に使う `.env` の鍵（`config.ts` で有効化したら必須）
- 全角「？」やカタカナは実装どおりに表記しています。

## 公開Bot / 機能一覧

| 公開Bot/機能 | 内部 skill / 処理 | 種別 | config key | 投稿鍵 (.env) | その他の秘密 | 概要 |
| --- | --- | --- | --- | --- | --- | --- |
| ShinoemonBot（しのえもん） | `keywordReply` / `lightControl` / `calendar` | 応答Bot | `shinoemon` | `SHINOEMON_NSEC` | `OPENROUTER/OPENAI_API_KEY`（任意）、`SWITCH_BOT_TOKEN/SECRET`（照明操作時） | キャラを持つオーケストレーションBot。内部 skill を選んで応答 |
| FlowmeterChanBot（流速ちゃん） | `command` | 応答Bot | `flowmeterChan` | `FLOWMETER_CHAN_NSEC` | - | 流速計への会話。投稿数の増減をコメント |
| FlowmeterJob（流速ちゃん） | `job` | 定期Job | `flowmeterChan` | `FLOWMETER_CHAN_NSEC` | - | リレー流速を定期計測し集計を投稿（NIP-78 チャート保存） |
| ManagementBot | 管理 | 応答Bot | `management` | `MANAGEMENT_NSEC` | - | 自分宛コマンドで Bot の状態確認/有効・無効切替 |
| MonitorBot | 監視 | 監視（Discord） | `monitor` | 不要 | `DISCORD_WEBHOOK_URL` 必須 | キーワード/投稿者/メンションを検出し Discord 通知 |
| MetadataRefreshJob | メタデータ維持 | 定期Job | `metadataRefresh` | -（対象鍵） | `METADATA_KEYS` 必須 | 対象アカウントの kind:0 を再 Publish |
| PassportJob | パスポート | 定期Job | `passport` | `PASSPORT_NSEC` | - | 定期的にパスポート投稿 |

## ワード → 応答表（応答系 Bot）

### ShinoemonBot（しのえもん）

しのえもんは公開Botとして 1 体です。内部で `keywordReply` / `lightControl` / `calendar`
skill を順番に評価し、最初にマッチした skill だけを実行します。

#### keywordReply skill

| トリガー（正規表現） | 条件 | 応答 |
| --- | --- | --- |
| `^サモン！` | 先頭一致。IoT側の `サモン` 反応より優先 | `サーモン！` |
| `^(かみさま\|神様)$` | 本文がこれだけ | `よんだ？` |
| `サーモン` / `ｻｰﾓﾝ` | 部分一致 | `ﾝﾅｧ～!!!` |
| `サモン` / `ｻﾓﾝ` | 部分一致 | `サモン！サーモン！` |
| `サモーン` / `ｻﾓｰﾝ` | 部分一致 | `ﾅｧﾝ!!!` |
| `salmon` | 部分一致（大小無視） | `👀` |

#### lightControl skill

自分宛リプライ＋SwitchBot 設定ありのときだけ反応します。

| トリガー | 条件 | 応答 |
| --- | --- | --- |
| `^光ある？` | 自分宛リプライ＋SwitchBot 設定あり | 点灯確認 → `光あるよ` / `光ないよ` |
| `^光あれ` | 同上 | 点灯 → `世界は光に包まれた`（失敗時 `光を操作できなかった`） |
| `^光ないよ` | 同上 | 消灯 → `闇に還した`（失敗時 `光を操作できなかった`） |

#### calendar skill

| トリガー | 条件 | 応答 |
| --- | --- | --- |
| `予定 <内容>` | 先頭（任意で自分へのメンション可） | Google カレンダー登録 URL（`📅 …🔗 https://www.google.com/calendar/render?…`） |

LLM（API キー）があれば高精度解析、なければ簡易解析（「明日」「午後3時」など）にフォールバック。

### ManagementBot（管理）

自分宛リプライのみ。`priority:100`・`stopOnMatch:true`（最優先・後続を止める）。

| トリガー | 応答 |
| --- | --- |
| `!bots` | 全 Bot の有効/無効一覧 |
| `!enable <Bot名>` | `<Bot名>を有効にしました` / `<Bot名>が見つかりません` |
| `!disable <Bot名>` | `<Bot名>を無効にしました` / `<Bot名>が見つかりません` |

### FlowmeterChanBot（流速ちゃん）

| トリガー | 条件 | 応答 |
| --- | --- | --- |
| `^流速ちゃん？` | 先頭一致 | `呼びましたか？` |
| `さわぎすぎ` / `騒ぎすぎ` / `しゃべりすぎ` / `喋りすぎ` / `うるさくない` / `うるさすぎ` | 自分宛リプライ | 直近24時間と前日の投稿数を比較しコメント（例: `順調だね！😊` / `ねえ、多すぎない？😅`） |

### MonitorBot（監視・応答なし）

Nostr へは返信せず、一致時に Discord 通知のみ。

| 検出条件（config の設定） | 動作 |
| --- | --- |
| `monitor.keywords` の語を含む | Discord に Embed 通知 |
| `monitor.npubs` の投稿者 | 同上（理由「監視対象の投稿」） |
| `monitor.mentionNpubs` 宛メンション | 同上 |

## 定期 Job の出力

| Job | スケジュール（既定） | 出力 |
| --- | --- | --- |
| FlowmeterJob（流速ちゃん） | `*/10 * * * *` | 各リレーの流速サマリ投稿＋ NIP-78 にチャート保存 |
| MetadataRefreshJob | `0 12 * * *` | `METADATA_KEYS` の各アカウントの kind:0 を再 Publish |
| PassportJob | `0 1 * * *` | `本日のパスポートを発行します (YYYY/MM/DD)`（任意で対象 npub をメンション） |

## 注意点・既知の重複

- **「サモン！」の二重応答は解消済み**: しのえもん内部で `^サモン！` を先に処理するため、
  IoT 由来の `サモン` 応答とは二重に反応しません。
- **全角/半角カナ**: しのえもんの `keywordReply` skill は半角カナ（`ｻｰﾓﾝ` など）も拾います。
- **クールダウン**: 応答系 Bot は投稿者ごとに `cooldownSec`（既定20秒）で連投抑止。
  ManagementBot は管理操作のため抑止対象外。
