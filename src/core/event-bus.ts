import type { Event } from "nostr-tools";
import { currUnixtime } from "../shared/time.js";
import { logger } from "./logger.js";
import type { NostrClient } from "./nostr-client.js";

export type EventListener = (event: Event) => void | Promise<void>;

/**
 * Nostr 購読を 1 本に集約し、受信イベントを各リスナーへ配信する。
 * OnlineConcierge であった二重購読を避けるため、購読の入口はここだけにする。
 */
export class EventBus {
  private readonly listeners: EventListener[] = [];
  private subscription: { close: () => void } | null = null;
  private readonly seen = new Set<string>();

  constructor(private readonly client: NostrClient) {}

  subscribe(listener: EventListener): void {
    this.listeners.push(listener);
  }

  start(): void {
    if (this.subscription) return;
    logger.info("EventBus starting (kind:1 realtime subscription)");
    this.subscription = this.client.subscribe(
      { kinds: [1], since: currUnixtime() },
      (event) => this.dispatch(event),
    );
  }

  private async dispatch(event: Event): Promise<void> {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 5000) {
      // 単純な上限管理。古い id から落とす。
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }

    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        logger.error("EventBus listener error", { error: String(error) });
      }
    }
  }

  stop(): void {
    this.subscription?.close();
    this.subscription = null;
  }
}
