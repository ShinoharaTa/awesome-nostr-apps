import { createHash } from "node:crypto";
import { finalizeEvent } from "nostr-tools";
import { logger } from "../../core/logger.js";

const DEFAULT_API_URL = "https://nostr.build/api/v2/nip96/upload";

export interface Nip96UploaderConfig {
  /** NIP-98 署名に使う秘密鍵 (hex)。投稿する Bot と同じ鍵を渡す。 */
  signerKey: string;
  apiUrl?: string;
  testMode: boolean;
}

export interface UploadedMedia {
  url: string;
  /** アップロードしたファイルの sha256 (hex) */
  sha256: string;
  /** サーバー側変換前のオリジナル hash（NIP-96 の ox タグ） */
  ox?: string;
  /** "幅x高さ" */
  dim?: string;
}

/**
 * NIP-96 メディアサーバー（既定: nostr.build）へのアップロード。
 * NIP-98 (kind:27235) の HTTP 認証イベントで署名する。失敗時は null。
 */
export class Nip96Uploader {
  constructor(private readonly config: Nip96UploaderConfig) {}

  async upload(file: Buffer, filename: string, mime: string): Promise<UploadedMedia | null> {
    if (this.config.testMode) {
      logger.info("[TEST_MODE] media upload skipped", { filename });
      return null;
    }
    const apiUrl = this.config.apiUrl ?? DEFAULT_API_URL;
    const sha256 = createHash("sha256").update(file).digest("hex");
    try {
      const authEvent = finalizeEvent(
        {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["u", apiUrl],
            ["method", "POST"],
            ["payload", sha256],
          ],
          content: "",
        },
        Uint8Array.from(Buffer.from(this.config.signerKey, "hex")),
      );
      const auth = `Nostr ${Buffer.from(JSON.stringify(authEvent)).toString("base64")}`;

      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(file)], { type: mime }), filename);
      form.append("content_type", mime);

      const res = await fetch(apiUrl, { method: "POST", headers: { Authorization: auth }, body: form });
      const body = (await res.json()) as { status?: string; message?: string; nip94_event?: { tags: string[][] } };
      if (body.status !== "success" || !body.nip94_event) {
        logger.error("NIP-96 upload failed", { status: res.status, message: body.message });
        return null;
      }
      const tag = (name: string) => body.nip94_event?.tags.find((t) => t[0] === name)?.[1];
      const url = tag("url");
      if (!url) {
        logger.error("NIP-96 upload response has no url");
        return null;
      }
      return { url, sha256, ox: tag("ox"), dim: tag("dim") };
    } catch (error) {
      logger.error("NIP-96 upload failed", { error: String(error) });
      return null;
    }
  }
}
