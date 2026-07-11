import type { FileConfig } from "./schema.js";

/**
 * 非機密設定のベース（Git 管理）。秘密情報（鍵・APIキー・Webhook・SwitchBot
 * トークン）は .env で管理し、ここには置かない。
 *
 * APP_ENV 未指定ならこのファイルのみ、APP_ENV=LOCAL なら config.local.ts を
 * ディープマージして使う（src/config/schema.ts の loadFileConfig 参照）。
 *
 * 「機能を有効化したら .env に何が必要か」の対応:
 *   shinoemon   : enabled=true なら SHINOEMON_NSEC 必須
 *   management  : enabled=true なら MANAGEMENT_NSEC 必須
 *   shinoemon.skills.calendar : 有効化時、OPENROUTER/OPENAI_API_KEY があれば予定解析の精度向上
 *   shinoemon.skills.lightControl : 有効化時、実機操作するなら SWITCH_BOT_TOKEN/SECRET
 *   monitor     : 投稿しない監視系。NSEC 不要。DISCORD_WEBHOOK_URL 必須
 *   flowmeterChan : enabled=true なら FLOWMETER_CHAN_NSEC 必須
 *   passport    : enabled=true なら PASSPORT_NSEC 必須
 *   metadataRefresh : enabled=true なら METADATA_KEYS 必須（投稿鍵ではなく対象アカウントの鍵）
 * 共通アカウントにしたい機能には、各 <機能>_NSEC へ「同じ鍵」を入れる。
 */
const config = {
  logLevel: "info", // debug / info / warn / error
  testMode: false, // true の間は実際に投稿せずログのみ
  cooldownSec: 5, // 応答系 Bot の連投抑止（秒・投稿者ごと）

  relays: {
    // リアルタイム購読に使うリレー
    subscribe: [
      "wss://relay-jp.shino3.net",
      "wss://yabu.me",
      "wss://r.kojira.io",
      "wss://relay-jp.nostr.wirednet.jp",
      "wss://nrelay-jp.c-stellar.net",
    ],
    // 投稿の既定リレー（機能側で個別指定がなければここを使う）
    publish: [
      "wss://relay-jp.shino3.net",
      "wss://yabu.me",
      "wss://r.kojira.io",
      "wss://relay-jp.nostr.wirednet.jp",
      "wss://nrelay-jp.c-stellar.net",
    ],
  },

  // --- しのえもん（キャラ/オーケストレーション Bot） ---
  shinoemon: {
    enabled: true, // 要 SHINOEMON_NSEC
    model: "gpt-4", // 将来の予定解析など、LLM が必要な skill のモデル
    skills: {
      callResponse: true, // 「しのえもん」と呼ばれたら「よんだ？」と返す
      lightControl: true, // まいへや/光ある？/光あれ！（要 SWITCH_BOT_TOKEN/SECRET）
      calendar: false, // 「予定 ...」から Google カレンダー URL を生成
    },
    acl: {
      // スマートホーム操作（まいへや/光ある？/光あれ）を許可する npub または hex。
      // 空配列なら全員拒否。信頼できる自分の npub を列挙する。
      smartHome: ["npub1l60d6h2uvdwa9yq0r7r2suhgrnsadcst6nsx2j03xwhxhu2cjyascejxe5"],
    },
    home: {
      // 温湿度計は SwitchBot のデバイスタイプから自動選択し、deviceName の名前順で表示する。
      lightDeviceNames: [],
      // 「光あれ！」で実際にライトを点灯する場合のみ true。
      allowControl: true,
      // まいへや応答に添えるアメダス観測所（気象庁の観測所 ID）。
      // さいたま市内の観測所は「さいたま」(43241・桜区) の 1 箇所のみ。近隣候補:
      //   43256 越谷 / 44071 練馬 / 44132 東京(全要素) / 43266 所沢 / 43126 久喜 / 43056 熊谷(全要素)
      amedasStations: ["43241"],
      // まいへや応答に過去5年比較の気温レンジグラフを画像で添える。
      amedasChart: true,
    },
  },

  // --- 管理 ---
  management: { enabled: true }, // 要 MANAGEMENT_NSEC

  // --- 監視（Discord通知のみ・投稿鍵不要） ---
  monitor: {
    enabled: false, // 要 DISCORD_WEBHOOK_URL（NSEC は不要）
    keywords: [],
    npubs: [],
    mentionNpubs: [],
  },

  // --- 流速ちゃん（定期ジョブ＋コマンド応答） ---
  flowmeterChan: {
    enabled: true, // 要 FLOWMETER_CHAN_NSEC
    command: true,
    job: true,
    cron: "*/10 * * * *",
    relays: [
      { key: "shino3", name: "しの川", url: "wss://relay-jp.shino3.net", target: "jp" },
      { key: "yabumi", name: "やぶみ川", url: "wss://yabu.me", target: "jp" },
      { key: "kojira", name: "こじら川", url: "wss://r.kojira.io", target: "jp" },
      { key: "kirino", name: "きりの川", url: "wss://relay-jp.nostr.wirednet.jp", target: "jp" },
      { key: "c-stellar", name: "かすてら川", url: "wss://nrelay-jp.c-stellar.net", target: "jp" },
      { key: "ydgw", name: "淀川", url: "https://r.ydg.works/", target: "jp" },
      { key: "kojira_g", name: "こじら大川", url: "wss://x.kojira.io", target: "all" },
      { key: "shino3_g", name: "しの川(G)", url: "wss://relay.nostx.io", target: "all" },
    ],
  },

  // --- メタデータ維持（定期再Publish・投稿鍵ではなく対象鍵を使う） ---
  metadataRefresh: {
    enabled: false, // 要 METADATA_KEYS
    cron: "0 12 * * *",
    relays: ["wss://relay-jp.shino3.net", "wss://yabu.me"],
  },

  // --- パスポート（定期投稿） ---
  passport: {
    enabled: false, // 要 PASSPORT_NSEC
    cron: "0 1 * * *",
    targetNpub: "",
    relays: ["wss://relay-jp.shino3.net", "wss://yabu.me"],
  },
} satisfies FileConfig;

export default config;
