import { describe, expect, it } from "vitest";
import type { BotHandler } from "../core/bot-handler.js";
import { BotManager } from "../core/bot-manager.js";
import type { EventBus } from "../core/event-bus.js";
import type { NostrClient } from "../core/nostr-client.js";
import { MockNostrClient, createMockEvent } from "./helpers/mock-client.js";

function buildManager(client: MockNostrClient): BotManager {
  const fakeBus = { subscribe: () => {} } as unknown as EventBus;
  return new BotManager(client as unknown as NostrClient, fakeBus);
}

function echoBot(cooldownSec: number): BotHandler {
  return {
    name: "EchoBot",
    filter: { matches: () => true },
    action: {
      execute: async (event, ctx) => {
        await ctx.client.publishText("echo", { replyTo: event });
      },
    },
    enabled: true,
    cooldownSec,
  };
}

describe("BotManager cooldown enforcement", () => {
  it("suppresses rapid repeated responses to the same author", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(echoBot(20));

    const author = "b".repeat(64);
    await manager.handleEvent(createMockEvent({ content: "1", pubkey: author }));
    await manager.handleEvent(createMockEvent({ content: "2", pubkey: author }));
    await manager.handleEvent(createMockEvent({ content: "3", pubkey: author }));

    expect(client.sent).toHaveLength(1);
  });

  it("allows responses to different authors", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(echoBot(20));

    await manager.handleEvent(createMockEvent({ content: "1", pubkey: "a".repeat(64) }));
    await manager.handleEvent(createMockEvent({ content: "2", pubkey: "b".repeat(64) }));

    expect(client.sent).toHaveLength(2);
  });

  it("does not throttle when cooldownSec is 0", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(echoBot(0));

    const author = "c".repeat(64);
    await manager.handleEvent(createMockEvent({ content: "1", pubkey: author }));
    await manager.handleEvent(createMockEvent({ content: "2", pubkey: author }));

    expect(client.sent).toHaveLength(2);
  });
});
