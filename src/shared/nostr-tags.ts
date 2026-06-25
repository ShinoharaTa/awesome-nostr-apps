import type { Event } from "nostr-tools";

/**
 * イベントに付いている最初の `p` タグ（宛先 pubkey）を返す。
 */
export function firstMentionedPubkey(event: Event): string | undefined {
  return event.tags.find((tag) => tag[0] === "p")?.[1];
}

/**
 * 返信用の e/p タグを生成する。
 */
export function replyTags(event: Event): string[][] {
  return [
    ["e", event.id],
    ["p", event.pubkey],
  ];
}
