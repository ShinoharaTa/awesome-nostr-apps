import type { Event } from "nostr-tools";
import type { BotContext, BotHandler } from "./bot-handler.js";
import type { EventBus } from "./event-bus.js";
import { logger } from "./logger.js";
import type { NostrClient } from "./nostr-client.js";

/**
 * Bot を登録し、EventBus 経由のイベントを各 Bot に振り分ける。
 * 複数 Bot の同時反応を許すが、priority と stopOnMatch で制御できる。
 */
export class BotManager {
  private handlers: BotHandler[] = [];
  private readonly ctx: BotContext;

  constructor(
    client: NostrClient,
    private readonly bus: EventBus,
  ) {
    this.ctx = { client };
  }

  register(handler: BotHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    logger.info(`Bot registered: ${handler.name}`, { enabled: handler.enabled });
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
      try {
        if (handler.filter.matches(event, this.ctx)) {
          logger.debug(`Event matched: ${handler.name}`, { eventId: event.id });
          await handler.action.execute(event, this.ctx);
          if (handler.stopOnMatch) break;
        }
      } catch (error) {
        logger.error(`Bot error: ${handler.name}`, { error: String(error) });
      }
    }
  }
}
