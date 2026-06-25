import type { Event } from "nostr-tools";
import {
  AndFilter,
  type BotContext,
  type BotHandler,
  NotFromSelfFilter,
  RegexFilter,
  ReplyToMeFilter,
  actionFromFn,
} from "../../core/bot-handler.js";
import type { BotManager } from "../../core/bot-manager.js";

/**
 * 運用中に Bot の状態確認・有効/無効を切り替える管理 Bot。
 * 自分宛の返信で `!bots` / `!enable Name` / `!disable Name` を受け付ける。
 * 出自: OnlineConcierge の setupBotManagementCommands を BotHandler 化したもの。
 */
export function createManagementBot(manager: BotManager): BotHandler {
  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    const content = event.content.trim();
    const command = stripMention(content);

    if (command.startsWith("!bots")) {
      const status = manager
        .getHandlers()
        .map((h) => `${h.name}: ${h.enabled ? "有効" : "無効"}`)
        .join("\n");
      await ctx.client.publishText(`Bot状態:\n${status}`, { replyTo: event });
      return;
    }

    if (command.startsWith("!enable ")) {
      const name = command.slice("!enable ".length).trim();
      const ok = manager.setEnabled(name, true);
      await ctx.client.publishText(
        ok ? `${name}を有効にしました` : `${name}が見つかりません`,
        { replyTo: event },
      );
      return;
    }

    if (command.startsWith("!disable ")) {
      const name = command.slice("!disable ".length).trim();
      const ok = manager.setEnabled(name, false);
      await ctx.client.publishText(
        ok ? `${name}を無効にしました` : `${name}が見つかりません`,
        { replyTo: event },
      );
    }
  });

  return {
    name: "ManagementBot",
    filter: new AndFilter([
      new NotFromSelfFilter(),
      new ReplyToMeFilter(),
      new RegexFilter(/!(bots|enable |disable )/),
    ]),
    action,
    enabled: true,
    priority: 100,
    stopOnMatch: true,
  };
}

function stripMention(content: string): string {
  return content.replace(/^nostr:npub1[0-9a-z]+\s+/, "").trim();
}
