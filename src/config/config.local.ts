import type { DeepPartial, FileConfig } from "./schema.js";

/**
 * ローカル開発用の上書き設定（APP_ENV=LOCAL のとき config.ts にディープマージ）。
 * Git 管理対象。base から変えたい非機密項目だけを書く。
 * 各機能を enabled にしたら、対応する鍵を .env に入れること（対応は config.ts 冒頭参照）。
 */
const override = {
  logLevel: "debug",
  testMode: false, // true にすると投稿・外部操作をスキップする

  relays: {
    subscribe: ["wss://relay-jp.shino3.net", "wss://yabu.me"],
    publish: ["wss://relay-jp.shino3.net", "wss://yabu.me"],
  },

  shinoemon: {
    enabled: true, // 要 SHINOEMON_NSEC
    skills: {
      callResponse: true,
      lightControl: true,
      calendar: false,
    },
    acl: {
      // スマートホーム操作を許可する npub / hex。空なら全員拒否。
      smartHome: ["npub1l60d6h2uvdwa9yq0r7r2suhgrnsadcst6nsx2j03xwhxhu2cjyascejxe5"],
    },
    home: {
      lightDeviceNames: [],
      allowControl: false,
    },
  },
  management: { enabled: false },
  flowmeterChan: {
    enabled: true, // 要 FLOWMETER_CHAN_NSEC
    command: true,
    job: true,
    cron: "0 * * * *",
    relays: [
      { key: "shino3", name: "しの川", url: "wss://relay-jp.shino3.net", target: "jp" },
      // { key: "yabumi", name: "やぶみ川", url: "wss://yabu.me", target: "jp" },
      // { key: "kojira", name: "こじら川", url: "wss://r.kojira.io", target: "jp" },
      // { key: "kirino", name: "きりの川", url: "wss://relay-jp.nostr.wirednet.jp", target: "jp" },
      // { key: "c-stellar", name: "かすてら川", url: "wss://nrelay-jp.c-stellar.net", target: "jp" },
      // { key: "kojira_g", name: "こじら大川", url: "wss://x.kojira.io", target: "all" },
      // { key: "shino3_g", name: "しの川(G)", url: "wss://relay.nostx.io", target: "all" },
    ],
  },
} satisfies DeepPartial<FileConfig>;

export default override;
