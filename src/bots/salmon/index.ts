import { RegexFilter, TextReplyAction, type BotHandler } from "../../core/bot-handler.js";

/**
 * 「サモン！」で始まる投稿に「サーモン！」と返す最小 Bot。
 * 出自: OnlineConcierge SalmonBot。
 */
export function createSalmonBot(): BotHandler {
  return {
    name: "SalmonBot",
    filter: new RegexFilter(/^サモン！/),
    action: new TextReplyAction("サーモン！"),
    enabled: true,
  };
}
