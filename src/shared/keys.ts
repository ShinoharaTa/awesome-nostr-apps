import { nip19 } from "nostr-tools";

/**
 * nsec1... または hex 文字列を秘密鍵バイト列に正規化する。
 */
export function toSecretKeyBytes(key: string): Uint8Array {
  const trimmed = key.trim();
  if (trimmed.startsWith("nsec1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec key");
    }
    return decoded.data;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("Secret key must be nsec1... or 64-char hex");
  }
  return new Uint8Array(Buffer.from(trimmed, "hex"));
}
