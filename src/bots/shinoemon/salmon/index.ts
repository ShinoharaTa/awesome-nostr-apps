import { type BotHandler, RegexFilter, TextReplyAction } from "../../../core/bot-handler.js";

/**
 * 「サモン！」で始まる投稿に「サーモン！」と返す最小 Bot。
 * 出自: OnlineConcierge SalmonBot。
 * 分類: しのえもん（特定文言への応答系）。
 */
export function createSalmonBot(): BotHandler {
  return {
    name: "SalmonBot",
    filter: new RegexFilter(/^サモン！/),
    action: new TextReplyAction("サーモン！"),
    enabled: true,
  };
}
