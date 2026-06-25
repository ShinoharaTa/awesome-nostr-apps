import { logger } from "../../core/logger.js";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Discord Webhook へ埋め込みメッセージを送る薄いクライアント。
 * testMode のときは送信せずログのみ。
 */
export class DiscordClient {
  constructor(
    private readonly webhookUrl: string,
    private readonly testMode: boolean,
  ) {}

  async sendEmbed(embed: DiscordEmbed): Promise<void> {
    if (this.testMode) {
      logger.info("[TEST_MODE] discord embed skipped", { title: embed.title });
      return;
    }
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!res.ok) {
        logger.error("Discord webhook failed", { status: res.status });
      }
    } catch (error) {
      logger.error("Discord webhook error", { error: String(error) });
    }
  }
}
