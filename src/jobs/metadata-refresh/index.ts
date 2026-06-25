import { finalizeEvent, getPublicKey } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import type { Job } from "../../core/job-runner.js";
import { logger } from "../../core/logger.js";
import { toSecretKeyBytes } from "../../shared/keys.js";
import { currUnixtime } from "../../shared/time.js";

export interface MetadataRefreshOptions {
  /** 再 Publish したいアカウントの秘密鍵 (nsec or hex) */
  keys: string[];
  relays: string[];
  schedule: string;
  enabled: boolean;
  testMode: boolean;
}

/**
 * 各アカウントの kind:0 をリレーから取得し、再署名して再 Publish する。
 * プロフィール (メタデータ) の消失を防ぐ定期メンテ。
 * 出自: nostr-metadata-enhancer (Rust) の TypeScript 移植。
 */
export function createMetadataRefreshJob(options: MetadataRefreshOptions): Job {
  return {
    name: "MetadataRefreshJob",
    schedule: options.schedule,
    enabled: options.enabled,
    async run() {
      const pool = new SimplePool();
      try {
        for (const key of options.keys) {
          await refreshOne(pool, key, options.relays, options.testMode);
        }
      } finally {
        pool.close(options.relays);
      }
    },
  };
}

async function refreshOne(
  pool: SimplePool,
  key: string,
  relays: string[],
  testMode: boolean,
): Promise<void> {
  let sk: Uint8Array;
  try {
    sk = toSecretKeyBytes(key);
  } catch (error) {
    logger.error("MetadataRefresh: invalid key skipped", { error: String(error) });
    return;
  }

  const pubkey = getPublicKey(sk);

  try {
    const latest = await pool.get(relays, { kinds: [0], authors: [pubkey], limit: 1 });
    if (!latest) {
      logger.warn("MetadataRefresh: kind:0 not found", { pubkey });
      return;
    }

    if (testMode) {
      logger.info("[TEST_MODE] metadata republish skipped", { pubkey });
      return;
    }

    const event = finalizeEvent(
      {
        kind: 0,
        content: latest.content,
        tags: [],
        created_at: currUnixtime(),
      },
      sk,
    );
    await Promise.any(pool.publish(relays, event));
    logger.info("MetadataRefresh: republished kind:0", { pubkey });
  } catch (error) {
    logger.error("MetadataRefresh: failed", { pubkey, error: String(error) });
  }
}
