import type { Event } from "nostr-tools";
import type { PublishOptions } from "../../core/nostr-client.js";

export interface SentMessage {
  content: string;
  replyToId?: string;
}

/**
 * NostrClient の挙動を模した最小モック。Bot のユニットテスト用。
 * 実際のリレー接続は行わず、送信内容を records に貯める。
 */
export class MockNostrClient {
  readonly sent: SentMessage[] = [];

  constructor(
    private readonly pubkey = "f".repeat(64),
    private readonly npub = "npub1mockmockmock",
  ) {}

  getPublicKey(): string {
    return this.pubkey;
  }

  getNpub(): string {
    return this.npub;
  }

  isReplyToMe(event: Event): boolean {
    return event.tags.find((tag) => tag[0] === "p")?.[1] === this.pubkey;
  }

  async publishText(content: string, options: PublishOptions = {}): Promise<string | null> {
    this.sent.push({ content, replyToId: options.replyTo?.id });
    return "mock-event-id";
  }

  async getProfile(): Promise<Record<string, unknown> | null> {
    return null;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

let counter = 0;

export function createMockEvent(overrides: Partial<Event> = {}): Event {
  counter += 1;
  return {
    id: `event-${counter}`,
    pubkey: "a".repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  };
}

/**
 * 自分宛の返信イベントを作る (p タグにモック pubkey を入れる)。
 */
export function createReplyToMe(content: string, myPubkey = "f".repeat(64)): Event {
  return createMockEvent({
    content,
    tags: [
      ["e", "root-event"],
      ["p", myPubkey],
    ],
  });
}
