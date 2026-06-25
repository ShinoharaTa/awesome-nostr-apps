import { currUnixtime } from "./time.js";

/**
 * pubkey ごとの連投・無限リプライループ防止。
 */
export class ReplyCooldown {
  private readonly lastReplyAt = new Map<string, number>();

  constructor(private readonly cooldownSec: number = 5) {}

  isSafe(pubkey: string): boolean {
    const now = currUnixtime();
    const last = this.lastReplyAt.get(pubkey);
    if (last !== undefined && now - last < this.cooldownSec) {
      return false;
    }
    this.lastReplyAt.set(pubkey, now);
    return true;
  }
}
