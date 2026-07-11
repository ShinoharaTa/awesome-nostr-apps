import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { createManagementBot } from "../bots/management/index.js";
import { createShinoemonBot } from "../bots/shinoemon/index.js";
import type { BotHandler } from "../core/bot-handler.js";
import { BotManager } from "../core/bot-manager.js";
import type { EventBus } from "../core/event-bus.js";
import { createIdentity } from "../core/identity.js";
import type { NostrClient } from "../core/nostr-client.js";
import { MockNostrClient, createMockEvent, createReplyToMe } from "./helpers/mock-client.js";

// 全 Bot は鍵を持つ前提。テストでは固定 Identity を割り当てる。
const identity = createIdentity(bytesToHex(generateSecretKey()));

function withId(handler: BotHandler): BotHandler {
  handler.identity = identity;
  return handler;
}

function buildManager(client: MockNostrClient): BotManager {
  const fakeBus = { subscribe: () => {} } as unknown as EventBus;
  return new BotManager(client as unknown as NostrClient, fakeBus);
}

describe("ShinoemonBot", () => {
  it("replies よんだ？ when called by name", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createTestShinoemonBot()));

    await manager.handleEvent(createMockEvent({ content: "しのえもん" }));

    expect(client.sent).toHaveLength(1);
    expect(client.sent[0].content).toBe("よんだ？");
  });

  it("replies when called by name with a Nostr mention prefix", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createTestShinoemonBot()));

    await manager.handleEvent(
      createMockEvent({
        content: "nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq しのえもん",
      }),
    );

    expect(client.sent[0].content).toBe("よんだ？");
  });

  it("does not react to salmon-related words", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createTestShinoemonBot()));

    await manager.handleEvent(createMockEvent({ content: "サモン！" }));
    await manager.handleEvent(createMockEvent({ content: "サーモン食べたい" }));

    expect(client.sent).toHaveLength(0);
  });

  it("ignores unrelated posts", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createTestShinoemonBot()));

    await manager.handleEvent(createMockEvent({ content: "こんにちは" }));

    expect(client.sent).toHaveLength(0);
  });
});

describe("ManagementBot", () => {
  it("lists bots on !bots when replied to me", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createManagementBot(manager)));
    manager.register(withId(createTestShinoemonBot()));

    await manager.handleEvent(createReplyToMe("!bots", identity.pubkey));

    expect(client.sent).toHaveLength(1);
    expect(client.sent[0].content).toContain("ShinoemonBot: 有効");
  });

  it("disables a bot on !disable", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createManagementBot(manager)));
    manager.register(withId(createTestShinoemonBot()));

    await manager.handleEvent(createReplyToMe("!disable ShinoemonBot", identity.pubkey));
    client.clear();

    // ShinoemonBot is now disabled, so しのえもん should get no reply
    await manager.handleEvent(createMockEvent({ content: "しのえもん" }));
    expect(client.sent).toHaveLength(0);
  });

  it("ignores management commands not addressed to me", async () => {
    const client = new MockNostrClient();
    const manager = buildManager(client);
    manager.register(withId(createManagementBot(manager)));

    await manager.handleEvent(createMockEvent({ content: "!bots" }));

    expect(client.sent).toHaveLength(0);
  });
});

function createTestShinoemonBot(): BotHandler {
  return createShinoemonBot({
    skills: {
      callResponse: true,
      lightControl: false,
      calendar: false,
    },
    switchBot: null,
    acl: {
      smartHome: [],
    },
    home: {
      lightDeviceNames: [],
      allowControl: false,
    },
    calendar: {
      model: "gpt-4",
    },
  });
}
