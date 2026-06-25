export type RelayTarget = "jp" | "all";

export interface RelayInfo {
  key: string;
  name: string;
  url: string;
  target: RelayTarget;
}

/**
 * 既定のリレー一覧。flowmeter のように JP/GLOBAL を区別する機能でも使えるよう
 * メタ情報を持たせている。env の RELAYS で URL 群のみ上書き可能。
 */
export const DEFAULT_RELAYS: RelayInfo[] = [
  { key: "shino3", name: "しの川", url: "wss://relay-jp.shino3.net", target: "jp" },
  { key: "yabumi", name: "やぶみ川", url: "wss://yabu.me", target: "jp" },
  { key: "kojira", name: "こじら川", url: "wss://r.kojira.io", target: "jp" },
  { key: "kirino", name: "きりの川", url: "wss://relay-jp.nostr.wirednet.jp", target: "jp" },
  { key: "c-stellar", name: "かすてら川", url: "wss://nrelay-jp.c-stellar.net", target: "jp" },
  { key: "kojira_g", name: "こじら大川", url: "wss://x.kojira.io", target: "all" },
  { key: "shino3_g", name: "しの川(G)", url: "wss://relay.nostx.io", target: "all" },
];

export function relayUrls(relays: RelayInfo[] = DEFAULT_RELAYS): string[] {
  return relays.map((relay) => relay.url);
}
