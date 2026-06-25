import { describe, expect, it } from "vitest";
import { createManagementBot } from "../bots/management/index.js";
import { createSalmonBot } from "../bots/salmon/index.js";
import { BotManager } from "../core/bot-manager.js";
import type { EventBus } from "../core/event-bus.js";
import type { NostrClient } from "../core/nostr-client.js";
import { MockNostrClient, createMockEvent, createReplyToMe } from "./helpers/mock-client.js";

function buildManager(client: MockNostrClient): BotManager {
  const fakeBus = { subscribe: () => {} } as unknown as EventBus;
  return new BotManager(client as unknown as NostrClient, fakeBus);
}

describe("SalmonBot", () => {
  it("replies サーモン！ to サモン！ posts", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(createSalmonBot());

    await manager.handleEvent(createMockEvent({ content: "サモン！" }));

    expect(client.sent).toHaveLength(1);
    expect(client.sent[0].content).toBe("サーモン！");
  });

  it("ignores unrelated posts", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(createSalmonBot());

    await manager.handleEvent(createMockEvent({ content: "こんにちは" }));

    expect(client.sent).toHaveLength(0);
  });
});

describe("ManagementBot", () => {
  it("lists bots on !bots when replied to me", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(createManagementBot(manager));
    manager.register(createSalmonBot());

    await manager.handleEvent(createReplyToMe("!bots"));

    expect(client.sent).toHaveLength(1);
    expect(client.sent[0].content).toContain("SalmonBot: 有効");
  });

  it("disables a bot on !disable", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(createManagementBot(manager));
    manager.register(createSalmonBot());

    await manager.handleEvent(createReplyToMe("!disable SalmonBot"));
    client.clear();

    // SalmonBot is now disabled, so サモン！ should get no reply
    await manager.handleEvent(createMockEvent({ content: "サモン！" }));
    expect(client.sent).toHaveLength(0);
  });

  it("ignores management commands not addressed to me", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(createManagementBot(manager));

    await manager.handleEvent(createMockEvent({ content: "!bots" }));

    expect(client.sent).toHaveLength(0);
  });
});
