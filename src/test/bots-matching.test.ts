import { describe, expect, it } from "vitest";
import { createIoTBot } from "../bots/shinoemon/iot/index.js";
import { createMonitorBot } from "../bots/monitor/index.js";
import type { BotClient, BotContext } from "../core/bot-handler.js";
import { MockNostrClient, createMockEvent } from "./helpers/mock-client.js";

function ctxOf(client: MockNostrClient): BotContext {
  return { client: client as unknown as BotClient };
}

describe("IoTBot", () => {
  it("reacts to salmon keyword for non-self posts", async () => {
    const client = new MockNostrClient();
    const bot = createIoTBot({ switchBot: null });
    const event = createMockEvent({ content: "サーモン食べたい" });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(true);
    await bot.action.execute(event, ctxOf(client));
    expect(client.sent[0].content).toBe("ﾝﾅｧ～!!!");
  });

  it("does not react to its own posts", () => {
    const client = new MockNostrClient();
    const bot = createIoTBot({ switchBot: null });
    const event = createMockEvent({ content: "サーモン", pubkey: client.getPublicKey() });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(false);
  });

  it("ignores light commands when SwitchBot is not configured", () => {
    const client = new MockNostrClient();
    const bot = createIoTBot({ switchBot: null });
    const event = createMockEvent({
      content: "光あれ",
      tags: [["p", client.getPublicKey()]],
    });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(false);
  });
});

describe("MonitorBot", () => {
  it("is disabled without a webhook URL", () => {
    const bot = createMonitorBot({
      keywords: ["緊急"],
      npubs: [],
      mentionNpubs: [],
      testMode: true,
    });
    expect(bot.enabled).toBe(false);
  });

  it("matches configured keywords", () => {
    const client = new MockNostrClient();
    const bot = createMonitorBot({
      webhookUrl: "https://discord.example/webhook",
      keywords: ["緊急"],
      npubs: [],
      mentionNpubs: [],
      testMode: true,
    });
    const hit = createMockEvent({ content: "これは緊急です" });
    const miss = createMockEvent({ content: "ふつうの投稿" });

    expect(bot.filter.matches(hit, ctxOf(client))).toBe(true);
    expect(bot.filter.matches(miss, ctxOf(client))).toBe(false);
  });
});
