import type { Event } from "nostr-tools";
import type { NostrClient } from "./nostr-client.js";

export interface BotContext {
  client: NostrClient;
}

export interface BotFilter {
  matches(event: Event, ctx: BotContext): boolean;
}

export interface BotAction {
  execute(event: Event, ctx: BotContext): Promise<void>;
}

export interface BotHandler {
  /** 一意な Bot 名 */
  name: string;
  filter: BotFilter;
  action: BotAction;
  enabled: boolean;
  /**
   * 数値が大きいほど先に評価される。既定 0。
   * ManagementBot のように先に処理したいものへ付与する。
   */
  priority?: number;
  /**
   * true の場合、この Bot がマッチしたら後続 Bot の評価を打ち切る。
   */
  stopOnMatch?: boolean;
  /**
   * 応答暴走対策。値 (秒) を設定すると、同一投稿者に対してこの間隔より
   * 短い連続実行を BotManager が抑止する。0 または未設定なら無制限。
   */
  cooldownSec?: number;
}

export abstract class BaseBotFilter implements BotFilter {
  abstract matches(event: Event, ctx: BotContext): boolean;
}

export abstract class BaseBotAction implements BotAction {
  abstract execute(event: Event, ctx: BotContext): Promise<void>;
}

export class RegexFilter extends BaseBotFilter {
  constructor(private readonly pattern: RegExp) {
    super();
  }

  matches(event: Event): boolean {
    return this.pattern.test(event.content);
  }
}

export class ReplyToMeFilter extends BaseBotFilter {
  matches(event: Event, ctx: BotContext): boolean {
    return ctx.client.isReplyToMe(event);
  }
}

export class NotFromSelfFilter extends BaseBotFilter {
  matches(event: Event, ctx: BotContext): boolean {
    return event.pubkey !== ctx.client.getPublicKey();
  }
}

export class AndFilter extends BaseBotFilter {
  constructor(private readonly filters: BotFilter[]) {
    super();
  }

  matches(event: Event, ctx: BotContext): boolean {
    return this.filters.every((filter) => filter.matches(event, ctx));
  }
}

export class OrFilter extends BaseBotFilter {
  constructor(private readonly filters: BotFilter[]) {
    super();
  }

  matches(event: Event, ctx: BotContext): boolean {
    return this.filters.some((filter) => filter.matches(event, ctx));
  }
}

/**
 * 関数からフィルタを手早く作るためのヘルパ。
 */
export function filterFromFn(fn: (event: Event, ctx: BotContext) => boolean): BotFilter {
  return { matches: fn };
}

/**
 * 関数からアクションを手早く作るためのヘルパ。
 */
export function actionFromFn(
  fn: (event: Event, ctx: BotContext) => Promise<void>,
): BotAction {
  return { execute: fn };
}

/**
 * 単純なテキスト返信アクション。
 */
export class TextReplyAction extends BaseBotAction {
  constructor(private readonly text: string) {
    super();
  }

  async execute(event: Event, ctx: BotContext): Promise<void> {
    await ctx.client.publishText(this.text, { replyTo: event });
  }
}
