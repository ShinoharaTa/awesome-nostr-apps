import type { Event } from "nostr-tools";
import { currUnixtime } from "../shared/time.js";
import { logger } from "./logger.js";
import type { NostrClient } from "./nostr-client.js";

export type EventListener = (event: Event) => void | Promise<void>;

/**
 * Nostr 購読を 1 本に集約し、受信イベントを各リスナーへ配信する。
 * OnlineConcierge であった二重購読を避けるため、購読の入口はここだけにする。
 */
const HEALTH_CHECK_INTERVAL_MS = 60_000;

export class EventBus {
  private readonly listeners: EventListener[] = [];
  private subscription: { close: () => void } | null = null;
  private readonly seen = new Set<string>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: NostrClient,
    private readonly subscribeRelays: string[],
  ) {}

  subscribe(listener: EventListener): void {
    this.listeners.push(listener);
  }

  start(): void {
    if (this.subscription) return;
    logger.info("EventBus starting (kind:1 realtime subscription)", {
      relays: this.subscribeRelays.length,
    });
    this.subscription = this.client.subscribe(
      { kinds: [1], since: currUnixtime() },
      (event) => this.dispatch(event),
      this.subscribeRelays,
    );
    this.startHealthCheck();
  }

  /**
   * 定期的にリレー接続状況を点検し、全断などの異常を検知してログに残す。
   * 個々のリレー再接続はライブラリ層 (enableReconnect) が担う。
   */
  private startHealthCheck(): void {
    this.healthTimer = setInterval(() => {
      const status = this.client.connectionStatus();
      const connected = [...status.values()].filter(Boolean).length;
      const total = status.size;
      if (total > 0 && connected === 0) {
        logger.error("All relays disconnected; waiting for auto-reconnect", { total });
      } else if (connected < total) {
        logger.warn("Some relays disconnected", { connected, total });
      } else {
        logger.debug("Relay health ok", { connected, total });
      }
    }, HEALTH_CHECK_INTERVAL_MS);
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
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.subscription?.close();
    this.subscription = null;
  }
}
