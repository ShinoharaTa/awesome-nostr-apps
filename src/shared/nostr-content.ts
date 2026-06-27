const NOSTR_MENTION = /nostr:(?:npub1|nprofile1)[0-9a-z]+/gi;

/**
 * Bot コマンド判定用に Nostr クライアントが本文へ挿入するメンションを取り除く。
 * 例: "nostr:npub1... 光あれ" -> "光あれ"
 */
export function normalizeCommandContent(content: string): string {
  return content.replace(NOSTR_MENTION, "").replace(/\s+/g, " ").trim();
}
