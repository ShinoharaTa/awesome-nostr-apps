import { describe, expect, it } from "vitest";
import { createIoTBot } from "../bots/shinoemon/iot/index.js";
import { createMonitorBot } from "../bots/monitor/index.js";
import type { BotClient, BotContext } from "../core/bot-handler.js";
import type { AmedasClient, AmedasObservation } from "../integrations/amedas/index.js";
import type { SwitchBotClient, SwitchBotDevice } from "../integrations/switchbot/index.js";
import { MockNostrClient, createMockEvent } from "./helpers/mock-client.js";

function ctxOf(client: MockNostrClient): BotContext {
  return { client: client as unknown as BotClient };
}

describe("IoTBot", () => {
  const home = {
    lightDeviceNames: ["まいへやライト"],
    allowControl: true,
  };

  it("does not react to salmon keywords", () => {
    const client = new MockNostrClient();
    const bot = createIoTBot({ switchBot: null, home });
    const event = createMockEvent({ content: "サーモン食べたい" });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(false);
  });

  it("does not react to its own posts", () => {
    const client = new MockNostrClient();
    const bot = createIoTBot({ switchBot: null, home });
    const event = createMockEvent({ content: "サーモン", pubkey: client.getPublicKey() });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(false);
  });

  it("ignores light commands when SwitchBot is not configured", () => {
    const client = new MockNostrClient();
    const bot = createIoTBot({ switchBot: null, home });
    const event = createMockEvent({
      content: "光あれ",
      tags: [["p", client.getPublicKey()]],
    });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(false);
  });

  it("replies with room temperature and humidity for まいへや", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "meter-1", deviceName: "まいへや温湿度計", deviceType: "Meter" },
    ]);
    const bot = createIoTBot({ switchBot: switchBot as unknown as SwitchBotClient, home });
    const event = createMockEvent({ content: "まいへや" });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(true);
    await bot.action.execute(event, ctxOf(client));

    expect(client.sent[0].content).toBe("🏠 部屋の現在の状況：\nまいへや温湿度計：23.4℃ / 56.0%");
  });

  it("appends AMeDAS weather to まいへや when configured", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "meter-1", deviceName: "まいへや温湿度計", deviceType: "Meter" },
    ]);
    const amedas = new MockAmedasClient([
      {
        stationId: "43241",
        stationName: "さいたま",
        time: "10:50",
        temperature: 27.2,
        humidity: 51,
        precipitation1h: 0,
        windSpeed: 0.7,
        windDirection: "南南西",
      },
    ]);
    const bot = createIoTBot({
      switchBot: switchBot as unknown as SwitchBotClient,
      amedas: amedas as unknown as AmedasClient,
      home,
    });

    await bot.action.execute(createMockEvent({ content: "まいへや" }), ctxOf(client));

    expect(client.sent[0].content).toBe(
      "🏠 部屋の現在の状況：\nまいへや温湿度計：23.4℃ / 56.0%\n" +
        "🌤 そとの様子（アメダス）：\nさいたま（10:50）：27.2℃ / 51.0% / 降水 0.0mm/h / 風 南南西 0.7m/s",
    );
  });

  it("keeps まいへや reply unchanged when AMeDAS fetch returns nothing", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "meter-1", deviceName: "まいへや温湿度計", deviceType: "Meter" },
    ]);
    const amedas = new MockAmedasClient([]);
    const bot = createIoTBot({
      switchBot: switchBot as unknown as SwitchBotClient,
      amedas: amedas as unknown as AmedasClient,
      home,
    });

    await bot.action.execute(createMockEvent({ content: "まいへや" }), ctxOf(client));

    expect(client.sent[0].content).toBe("🏠 部屋の現在の状況：\nまいへや温湿度計：23.4℃ / 56.0%");
  });

  it("orders room status by device name and skips unavailable values", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "meter-living", deviceName: "リビング温湿度", deviceType: "Meter" },
      { deviceId: "meter-rack-top", deviceName: "サーバーラック上部", deviceType: "Meter" },
      { deviceId: "meter-dead", deviceName: "取得不可センサー", deviceType: "Meter" },
    ]);
    const bot = createIoTBot({ switchBot: switchBot as unknown as SwitchBotClient, home });

    await bot.action.execute(createMockEvent({ content: "まいへや" }), ctxOf(client));

    expect(client.sent[0].content).toBe(
      "🏠 部屋の現在の状況：\nサーバーラック上部：25.4℃ / 74.0%\nリビング温湿度：25.1℃ / 74.0%",
    );
  });

  it("replies with light status for 光ある？", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "light-1", deviceName: "まいへやライト", deviceType: "Ceiling Light" },
    ]);
    const bot = createIoTBot({ switchBot: switchBot as unknown as SwitchBotClient, home });
    const event = createMockEvent({ content: "光ある？" });

    await bot.action.execute(event, ctxOf(client));

    expect(client.sent[0].content).toBe("まいへやライト: ついてる");
  });

  it("turns on configured lights for 光あれ！", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "light-1", deviceName: "まいへやライト", deviceType: "Ceiling Light" },
    ]);
    const bot = createIoTBot({ switchBot: switchBot as unknown as SwitchBotClient, home });
    const event = createMockEvent({ content: "光あれ！" });

    await bot.action.execute(event, ctxOf(client));

    expect(switchBot.commands).toEqual([{ deviceId: "light-1", command: "turnOn" }]);
    expect(client.sent[0].content).toBe("光あれ");
  });

  it("turns on lights for 光あれ without punctuation", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "light-1", deviceName: "まいへやライト", deviceType: "Ceiling Light" },
    ]);
    const bot = createIoTBot({ switchBot: switchBot as unknown as SwitchBotClient, home });

    await bot.action.execute(createMockEvent({ content: "光あれ" }), ctxOf(client));

    expect(switchBot.commands).toEqual([{ deviceId: "light-1", command: "turnOn" }]);
  });

  it("matches commands in mention-prefixed content", async () => {
    const client = new MockNostrClient();
    const switchBot = new MockSwitchBotClient([
      { deviceId: "light-1", deviceName: "まいへやライト", deviceType: "Ceiling Light" },
    ]);
    const bot = createIoTBot({ switchBot: switchBot as unknown as SwitchBotClient, home });
    const event = createMockEvent({ content: "nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq 光ある？" });

    expect(bot.filter.matches(event, ctxOf(client))).toBe(true);
    await bot.action.execute(event, ctxOf(client));

    expect(client.sent[0].content).toBe("まいへやライト: ついてる");
  });
});

class MockSwitchBotClient {
  readonly commands: Array<{ deviceId: string; command: string }> = [];

  constructor(
    private readonly devices: SwitchBotDevice[],
    readonly allowControl = true,
  ) {}

  async getDevices(): Promise<SwitchBotDevice[]> {
    return this.devices;
  }

  async getStatus(deviceId: string): Promise<Record<string, unknown> | null> {
    if (deviceId === "meter-rack-top") return { temperature: 25.4, humidity: 74 };
    if (deviceId === "meter-living") return { temperature: 25.1, humidity: 74 };
    if (deviceId === "meter-dead") return {};
    if (deviceId.startsWith("meter")) return { temperature: 23.4, humidity: 56 };
    if (deviceId.startsWith("light")) return { power: "on" };
    return null;
  }

  async sendCommand(deviceId: string, command: string): Promise<boolean> {
    this.commands.push({ deviceId, command });
    return true;
  }
}

class MockAmedasClient {
  constructor(private readonly observations: AmedasObservation[]) {}

  async getLatestAll(): Promise<AmedasObservation[]> {
    return this.observations;
  }
}

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
