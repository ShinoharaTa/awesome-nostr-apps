import type { Event } from "nostr-tools";
import { ReplyCooldown } from "../shared/rate-limit.js";
import type { BotContext, BotHandler } from "./bot-handler.js";
import type { EventBus } from "./event-bus.js";
import type { Identity } from "./identity.js";
import { logger } from "./logger.js";
import { IdentityClient, type NostrClient } from "./nostr-client.js";

/**
 * Bot を登録し、EventBus 経由のイベントを各 Bot に振り分ける。
 * 複数 Bot の同時反応を許すが、priority と stopOnMatch で制御できる。
 * 応答系 Bot の暴走は cooldownSec により Bot ごと x 投稿者ごとに抑止する。
 */
export class BotManager {
  private handlers: BotHandler[] = [];
  private readonly ctxCache = new Map<string, BotContext>();
  private readonly cooldowns = new Map<string, ReplyCooldown>();

  constructor(
    private readonly client: NostrClient,
    private readonly bus: EventBus,
  ) {}

  /**
   * Bot 固有の Identity（鍵）にバインドしたコンテキストを返す（Bot ごとにキャッシュ）。
   * すべての Bot は自分の鍵を持つ前提（既定鍵 / メインアカウントは存在しない）。
   */
  private contextFor(identity: Identity, name: string): BotContext {
    let ctx = this.ctxCache.get(name);
    if (!ctx) {
      ctx = { client: new IdentityClient(this.client, identity) };
      this.ctxCache.set(name, ctx);
    }
    return ctx;
  }

  register(handler: BotHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    logger.info(`Bot registered: ${handler.name}`, {
      enabled: handler.enabled,
      npub: handler.identity?.npub,
    });
  }

  unregister(name: string): void {
    this.handlers = this.handlers.filter((handler) => handler.name !== name);
  }

  getHandlers(): BotHandler[] {
    return [...this.handlers];
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const handler = this.handlers.find((h) => h.name === name);
    if (!handler) return false;
    handler.enabled = enabled;
    logger.info(`Bot ${name} ${enabled ? "enabled" : "disabled"}`);
    return true;
  }

  start(): void {
    this.bus.subscribe((event) => this.handleEvent(event));
    logger.info("BotManager subscribed to EventBus");
  }

  async handleEvent(event: Event): Promise<void> {
    for (const handler of this.handlers) {
      if (!handler.enabled) continue;
      if (!handler.identity) {
        logger.warn(
          `Bot "${handler.name}" enabled without a key; skipping. Set its <feature>_NSEC.`,
        );
        continue;
      }
      try {
        const ctx = this.contextFor(handler.identity, handler.name);
        if (!handler.filter.matches(event, ctx)) continue;

        if (this.isCoolingDown(handler, event.pubkey)) {
          logger.debug(`Cooldown active: ${handler.name}`, { pubkey: event.pubkey });
          continue;
        }

        logger.debug(`Event matched: ${handler.name}`, { eventId: event.id });
        await handler.action.execute(event, ctx);
        if (handler.stopOnMatch) break;
      } catch (error) {
        logger.error(`Bot error: ${handler.name}`, { error: String(error) });
      }
    }
  }

  /**
   * cooldownSec が設定された Bot について、同一投稿者の連続実行を抑止する。
   * 抑止対象なら true を返す（実行をスキップ）。
   */
  private isCoolingDown(handler: BotHandler, pubkey: string): boolean {
    if (!handler.cooldownSec || handler.cooldownSec <= 0) return false;
    let cooldown = this.cooldowns.get(handler.name);
    if (!cooldown) {
      cooldown = new ReplyCooldown(handler.cooldownSec);
      this.cooldowns.set(handler.name, cooldown);
    }
    return !cooldown.isSafe(pubkey);
  }
}
