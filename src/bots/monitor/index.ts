import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import {
  type BotContext,
  type BotHandler,
  actionFromFn,
  filterFromFn,
} from "../../core/bot-handler.js";
import { DiscordClient } from "../../integrations/discord/index.js";

export interface MonitorOptions {
  webhookUrl?: string;
  keywords: string[];
  npubs: string[];
  mentionNpubs: string[];
  testMode: boolean;
}

/**
 * キーワード / 投稿者 / メンション宛先を監視し、ヒットを Discord に通知する。
 * Nostr への返信はしない外部連携 Bot。
 * 出自: OnlineConcierge MonitorBot。
 */
export function createMonitorBot(options: MonitorOptions): BotHandler {
  const enabled = Boolean(options.webhookUrl);
  const discord = options.webhookUrl
    ? new DiscordClient(options.webhookUrl, options.testMode)
    : null;
  const targetPubkeys = options.npubs.map(decodeNpub);

  const filter = filterFromFn((event: Event, ctx: BotContext) => {
    if (event.pubkey === ctx.client.getPublicKey()) return false;
    return matchReasons(event, options, targetPubkeys).length > 0;
  });

  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    if (!discord) return;
    const reasons = matchReasons(event, options, targetPubkeys);
    const profile = await ctx.client.getProfile(event.pubkey).catch(() => null);
    const userName =
      (profile?.display_name as string) ||
      (profile?.name as string) ||
      `${event.pubkey.slice(0, 8)}...`;
    const noteId = nip19.noteEncode(event.id);

    await discord.sendEmbed({
      title: userName,
      description: event.content.slice(0, 1000),
      fields: [
        {
          name: "日時",
          value: new Date(event.created_at * 1000).toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
          }),
          inline: true,
        },
        { name: "検出理由", value: reasons.join("\n"), inline: false },
        { name: "Nostter", value: `[開く](https://nostter.app/${noteId})`, inline: true },
        { name: "Nostx", value: `[開く](https://nostx.io/${noteId})`, inline: true },
      ],
      footer: { text: "Nostr監視Bot" },
      timestamp: new Date(event.created_at * 1000).toISOString(),
    });
  });

  return {
    name: "MonitorBot",
    filter,
    action,
    enabled,
    // Nostr へ投稿せず Discord 通知のみ。投稿鍵 (MONITOR_NSEC) は不要。
    readOnly: true,
  };
}

function matchReasons(event: Event, options: MonitorOptions, targetPubkeys: string[]): string[] {
  const reasons: string[] = [];
  const content = event.content.toLowerCase();

  for (const keyword of options.keywords) {
    if (content.includes(keyword.toLowerCase())) {
      reasons.push(`キーワード: ${keyword}`);
    }
  }
  if (targetPubkeys.includes(event.pubkey)) {
    reasons.push("監視対象の投稿");
  }
  for (const npub of options.mentionNpubs) {
    if (content.includes(npub.toLowerCase())) {
      reasons.push(`メンション: ${npub.slice(0, 12)}...`);
    }
  }
  return reasons;
}

function decodeNpub(npub: string): string {
  if (!npub.startsWith("npub1")) return npub;
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === "npub" ? decoded.data : npub;
  } catch {
    return npub;
  }
}
