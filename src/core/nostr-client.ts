import { type Event, type EventTemplate, type Filter, finalizeEvent } from "nostr-tools";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";
import { firstMentionedPubkey, replyTags } from "../shared/nostr-tags.js";
import { currUnixtime } from "../shared/time.js";
import type { BotClient } from "./bot-handler.js";
import type { Identity } from "./identity.js";
import { logger } from "./logger.js";

useWebSocketImplementation(WebSocket);

export interface NostrClientConfig {
  /** 既定の投稿先リレー。publish 時に relays を渡せば機能ごとに上書きできる。 */
  relays: string[];
  testMode: boolean;
}

export interface PublishOptions {
  /** 返信先イベント。指定すると e/p タグを付ける */
  replyTo?: Event | null;
  /** 投稿に使う秘密鍵 (hex)。NostrClient 単体では必須。IdentityClient が自動付与する。 */
  privateKey?: string;
  /** 追加タグ */
  tags?: string[][];
  /** 投稿先リレーの上書き (未指定なら既定の publish リレー) */
  relays?: string[];
}

/**
 * Nostr のリレー接続・送受信を担う「トランスポート」。鍵（アカウント）は持たず、
 * 署名鍵は呼び出し側 (Bot は IdentityClient、Job は明示) が必ず渡す。
 * 購読は EventBus 側で 1 本化するため、ここでは購読の低レベル API のみ提供する。
 *
 * 切断対策として SimplePool の自動再接続 (enableReconnect) と keepalive ping
 * (enablePing) を有効化する。再接続時はリレー層が lastEmitted+1 から再購読するため、
 * 切断中の取りこぼしも軽減される。
 */
export class NostrClient {
  private readonly pool: SimplePool;
  /** これまで接続したリレーURL（shutdown 時にまとめて閉じる） */
  private readonly usedRelays = new Set<string>();

  constructor(private readonly config: NostrClientConfig) {
    for (const url of config.relays) this.usedRelays.add(url);
    this.pool = new SimplePool({ enableReconnect: true, enablePing: true });
    this.pool.onRelayConnectionFailure = (url: string) => {
      logger.warn("relay disconnected", { url });
    };
    this.pool.onRelayConnectionSuccess = (url: string) => {
      logger.info("relay connected", { url });
    };
  }

  get relays(): string[] {
    return this.config.relays;
  }

  /** 操作対象リレーを決め、shutdown 用に記録する。 */
  private useRelays(relays?: string[]): string[] {
    const target = relays && relays.length > 0 ? relays : this.config.relays;
    for (const url of target) this.usedRelays.add(url);
    return target;
  }

  /**
   * 各リレーの接続状態を返す (ヘルスチェック用)。
   */
  connectionStatus(): Map<string, boolean> {
    return this.pool.listConnectionStatus();
  }

  /**
   * テキスト (kind:1) を投稿する。privateKey は必須。TEST_MODE ではログ出力のみ。
   */
  async publishText(content: string, options: PublishOptions = {}): Promise<string | null> {
    const created = options.replyTo ? options.replyTo.created_at + 1 : currUnixtime();
    const tags: string[][] = [...(options.tags ?? [])];
    if (options.replyTo) tags.push(...replyTags(options.replyTo));

    return this.publishEvent(
      {
        kind: 1,
        content,
        tags,
        created_at: created,
      },
      options.privateKey,
      options.relays,
    );
  }

  /**
   * 任意の EventTemplate を署名して送信する。privateKey 必須、relays 未指定なら既定。
   */
  async publishEvent(
    template: EventTemplate,
    privateKey?: string,
    relays?: string[],
  ): Promise<string | null> {
    if (!privateKey) {
      throw new Error("publishEvent requires a privateKey (no default account key exists).");
    }
    const signed = finalizeEvent(template, hexToBytes(privateKey));

    if (this.config.testMode) {
      logger.info("[TEST_MODE] publish skipped", {
        kind: template.kind,
        content: template.content.slice(0, 120),
      });
      return signed.id;
    }

    try {
      await Promise.any(this.pool.publish(this.useRelays(relays), signed));
      return signed.id;
    } catch (error) {
      logger.error("publish failed", { error: String(error) });
      return null;
    }
  }

  /**
   * フィルタを指定して購読する。onEvent はイベントごとに呼ばれる。
   * relays 未指定なら既定リレー。EventBus は subscribe リレーを渡す。
   */
  subscribe(
    filter: Filter,
    onEvent: (event: Event) => void | Promise<void>,
    relays?: string[],
  ): { close: () => void } {
    const sub = this.pool.subscribeMany(this.useRelays(relays), filter, {
      onevent: (event) => {
        void onEvent(event);
      },
    });
    return { close: () => sub.close() };
  }

  /**
   * 指定 pubkey の最新 kind:0 を取得する。
   */
  async getProfile(pubkey: string, relays?: string[]): Promise<Record<string, unknown> | null> {
    const event = await this.pool.get(this.useRelays(relays), { kinds: [0], authors: [pubkey] });
    if (!event) return null;
    try {
      return JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * NIP-78 (kind:30078) の保存値を、指定アカウント (author) について取得する。
   */
  async nip78Get(dTag: string, author: string, relays?: string[]): Promise<string | undefined> {
    const event = await this.pool.get(this.useRelays(relays), {
      kinds: [30078],
      "#d": [dTag],
      authors: [author],
    });
    return event?.content;
  }

  /**
   * NIP-78 (kind:30078) に値を保存する。privateKey 必須。
   */
  async nip78Post(
    dTag: string,
    content: string,
    privateKey: string,
    relays?: string[],
  ): Promise<string | null> {
    return this.publishEvent(
      {
        kind: 30078,
        content,
        tags: [["d", dTag]],
        created_at: currUnixtime(),
      },
      privateKey,
      relays,
    );
  }

  close(): void {
    this.pool.close([...this.usedRelays]);
  }
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/**
 * メインの NostrClient(=リレー接続/送信) を共有しつつ、別の Identity として
 * 振る舞う薄いラッパ。投稿は自分の鍵で署名し、自己判定も自分の pubkey で行う。
 */
export class IdentityClient implements BotClient {
  constructor(
    private readonly base: NostrClient,
    private readonly identity: Identity,
  ) {}

  getPublicKey(): string {
    return this.identity.pubkey;
  }

  getNpub(): string {
    return this.identity.npub;
  }

  isReplyToMe(event: Event): boolean {
    return firstMentionedPubkey(event) === this.identity.pubkey;
  }

  publishText(content: string, options: PublishOptions = {}): Promise<string | null> {
    return this.base.publishText(content, {
      ...options,
      privateKey: options.privateKey ?? this.identity.hex,
    });
  }

  getProfile(pubkey: string, relays?: string[]): Promise<Record<string, unknown> | null> {
    return this.base.getProfile(pubkey, relays);
  }
}
