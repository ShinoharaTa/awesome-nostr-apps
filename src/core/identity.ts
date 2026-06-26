import { getPublicKey, nip19 } from "nostr-tools";
import { toSecretKeyBytes } from "../shared/keys.js";

/**
 * 1 つの投稿主体（アカウント）を表す。Bot / Job ごとに別の鍵を割り当てると、
 * それぞれ別アカウントとして投稿・自己判定できる。
 */
export interface Identity {
  /** 秘密鍵 (64 文字 hex) */
  hex: string;
  /** 公開鍵 (64 文字 hex) */
  pubkey: string;
  npub: string;
}

/**
 * nsec1... または hex の鍵から Identity を生成する。不正な鍵は例外。
 */
export function createIdentity(key: string): Identity {
  const sk = toSecretKeyBytes(key);
  const pubkey = getPublicKey(sk);
  return {
    hex: Buffer.from(sk).toString("hex"),
    pubkey,
    npub: nip19.npubEncode(pubkey),
  };
}
