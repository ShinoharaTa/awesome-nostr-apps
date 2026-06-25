import { format } from "date-fns";
import { nip19 } from "nostr-tools";
import type { Job } from "../../core/job-runner.js";
import type { NostrClient } from "../../core/nostr-client.js";
import { toSecretKeyBytes } from "../../shared/keys.js";

export interface PassportOptions {
  client: NostrClient;
  /** パスポート送信用の秘密鍵 (nsec or hex) */
  hex?: string;
  targetNpub?: string;
  schedule: string;
}

/**
 * 定期的に「パスポート」メッセージを送る定期ジョブ。
 * 出自: OnlineConcierge PassportBot（スケジュール専用アクション）。
 */
export function createPassportJob(options: PassportOptions): Job {
  const enabled = Boolean(options.hex);

  return {
    name: "PassportJob",
    schedule: options.schedule,
    enabled,
    async run() {
      if (!options.hex) return;
      const privateKey = Buffer.from(toSecretKeyBytes(options.hex)).toString("hex");

      const today = format(new Date(), "yyyy/MM/dd");
      let content = `本日のパスポートを発行します (${today})`;
      if (options.targetNpub) {
        const tag = mentionTag(options.targetNpub);
        if (tag) content += `\nnostr:${options.targetNpub}`;
      }

      await options.client.publishText(content, { privateKey });
    },
  };
}

function mentionTag(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === "npub" ? decoded.data : null;
  } catch {
    return null;
  }
}
