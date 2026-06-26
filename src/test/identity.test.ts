import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { type BotHandler, ReplyToMeFilter, actionFromFn } from "../core/bot-handler.js";
import { BotManager } from "../core/bot-manager.js";
import type { EventBus } from "../core/event-bus.js";
import { createIdentity } from "../core/identity.js";
import type { NostrClient } from "../core/nostr-client.js";
import { MockNostrClient, createMockEvent } from "./helpers/mock-client.js";

function buildManager(client: MockNostrClient): BotManager {
  const fakeBus = { subscribe: () => {} } as unknown as EventBus;
  return new BotManager(client as unknown as NostrClient, fakeBus);
}

function replyToMeBot(): BotHandler {
  return {
    name: "IdBot",
    filter: new ReplyToMeFilter(),
    action: actionFromFn(async (event, ctx) => {
      await ctx.client.publishText("hi", { replyTo: event });
    }),
    enabled: true,
  };
}

describe("createIdentity", () => {
  it("derives pubkey/npub from a key", () => {
    const id = createIdentity(bytesToHex(generateSecretKey()));
    expect(id.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(id.npub.startsWith("npub1")).toBe(true);
  });
});

describe("per-bot identity routing", () => {
  it("evaluates replies against the bot's own identity, not the main key", async () => {
    const client = new MockNostrClient(); // main pubkey = "f".repeat(64)
    const manager = buildManager(client);

    const identity = createIdentity(bytesToHex(generateSecretKey()));
    manager.register({ ...replyToMeBot(), identity });

    // 自分(=Bot固有Identity)宛の返信には反応する
    await manager.handleEvent(createMockEvent({ tags: [["p", identity.pubkey]] }));
    expect(client.sent).toHaveLength(1);

    // メイン鍵宛では、この Bot は別 Identity なので反応しない
    client.clear();
    await manager.handleEvent(createMockEvent({ tags: [["p", "f".repeat(64)]] }));
    expect(client.sent).toHaveLength(0);
  });

  it("skips an enabled bot that has no identity (no default key exists)", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(replyToMeBot()); // identity 未設定

    await manager.handleEvent(createMockEvent({ tags: [["p", "f".repeat(64)]] }));
    expect(client.sent).toHaveLength(0);
  });
});
