import type { Event } from "nostr-tools";
import {
  type BotContext,
  type BotHandler,
  actionFromFn,
  filterFromFn,
} from "../../../core/bot-handler.js";
import type { SwitchBotClient, SwitchBotDevice } from "../../../integrations/switchbot/index.js";
import { normalizeCommandContent } from "../../../shared/nostr-content.js";

const ROOM_COMMAND = /^まいへや[？?！!。.\s]*$/;
const LIGHT_STATUS_COMMAND = /^光ある？[？?！!。.\s]*$/;
const LIGHT_ON_COMMAND = /^光あれ[？?！!。.\s]*$/;

export interface IoTOptions {
  switchBot: SwitchBotClient | null;
  lightControlEnabled?: boolean;
  home: {
    lightDeviceNames: string[];
    allowControl: boolean;
  };
}

/**
 * しのえもんの照明操作 skill。
 * 出自: NostrIot index.js（照明制御部分）。
 */
export function createIoTBot(options: IoTOptions): BotHandler {
  const lightControlEnabled = options.lightControlEnabled ?? true;
  const filter = filterFromFn((event: Event, ctx: BotContext) => {
    if (event.pubkey === ctx.client.getPublicKey()) return false;
    const content = normalizeCommandContent(event.content);
    if (
      lightControlEnabled &&
      options.switchBot &&
      (ROOM_COMMAND.test(content) ||
        LIGHT_STATUS_COMMAND.test(content) ||
        LIGHT_ON_COMMAND.test(content))
    ) {
      return true;
    }
    return false;
  });

  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    const content = normalizeCommandContent(event.content);
    if (
      lightControlEnabled &&
      options.switchBot &&
      (ROOM_COMMAND.test(content) || LIGHT_STATUS_COMMAND.test(content) || LIGHT_ON_COMMAND.test(content))
    ) {
      await handleHomeCommand(event, ctx, options.switchBot, options.home, content);
      return;
    }

  });

  return {
    name: "IoTBot",
    filter,
    action,
    enabled: true,
  };
}

interface HomeOptions {
  lightDeviceNames: string[];
  allowControl: boolean;
}

async function handleHomeCommand(
  event: Event,
  ctx: BotContext,
  switchBot: SwitchBotClient,
  home: HomeOptions,
  content: string,
): Promise<void> {
  const devices = await switchBot.getDevices();
  if (ROOM_COMMAND.test(content)) {
    await publishRoomStatus(event, ctx, switchBot, devices);
    return;
  }

  const lights = selectLights(devices, home.lightDeviceNames);
  if (LIGHT_STATUS_COMMAND.test(content)) {
    await publishLightStatus(event, ctx, switchBot, lights);
    return;
  }

  if (LIGHT_ON_COMMAND.test(content)) {
    await turnOnLights(event, ctx, switchBot, lights);
  }
}

async function publishRoomStatus(
  event: Event,
  ctx: BotContext,
  switchBot: SwitchBotClient,
  devices: SwitchBotDevice[],
): Promise<void> {
  const meters = selectMeters(devices);
  if (meters.length === 0) {
    await ctx.client.publishText("温湿度計が見つかりませんでした", { replyTo: event });
    return;
  }

  const lines: string[] = [];
  for (const meter of meters) {
    const status = await switchBot.getStatus(meter.deviceId);
    const temperature = readNumber(status, "temperature");
    const humidity = readNumber(status, "humidity");
    if (temperature === undefined && humidity === undefined) {
      continue;
    }
    lines.push(`${meter.deviceName}：${formatMetric(temperature, "℃")} / ${formatMetric(humidity, "%")}`);
  }

  if (lines.length === 0) {
    await ctx.client.publishText("温湿度を取得できませんでした", { replyTo: event });
    return;
  }

  await ctx.client.publishText(`🏠 部屋の現在の状況：\n${lines.join("\n")}`, { replyTo: event });
}

async function publishLightStatus(
  event: Event,
  ctx: BotContext,
  switchBot: SwitchBotClient,
  lights: SwitchBotDevice[],
): Promise<void> {
  if (lights.length === 0) {
    await ctx.client.publishText("ライトが見つかりませんでした", { replyTo: event });
    return;
  }
  const statuses = await Promise.all(lights.map((light) => switchBot.getStatus(light.deviceId)));
  const lines = lights.map((light, index) => {
    const power = statuses[index]?.power;
    const state = power === "on" ? "ついてる" : power === "off" ? "消えてる" : "状態不明";
    return `${light.deviceName}: ${state}`;
  });
  await ctx.client.publishText(lines.join("\n"), { replyTo: event });
}

async function turnOnLights(
  event: Event,
  ctx: BotContext,
  switchBot: SwitchBotClient,
  lights: SwitchBotDevice[],
): Promise<void> {
  if (lights.length === 0) {
    await ctx.client.publishText("点灯するライトが見つかりませんでした", { replyTo: event });
    return;
  }
  if (!switchBot.allowControl) {
    await ctx.client.publishText("ライト操作は無効です", { replyTo: event });
    return;
  }

  const results = await Promise.all(lights.map((light) => switchBot.sendCommand(light.deviceId, "turnOn")));
  const ok = results.every(Boolean);
  if (ok) {
    await ctx.client.publishText("光あれ", { replyTo: event });
  } else {
    await ctx.client.publishText("光を操作できなかった", { replyTo: event });
  }
}

function selectMeters(devices: SwitchBotDevice[]): SwitchBotDevice[] {
  return sortDevicesByName(
    devices.filter((device) => /meter|温湿度|thermo|hygro/i.test(device.deviceType)),
  );
}

function sortDevicesByName(devices: SwitchBotDevice[]): SwitchBotDevice[] {
  const collator = new Intl.Collator("ja-JP", { numeric: true, sensitivity: "base" });
  return [...devices].sort((a, b) => collator.compare(a.deviceName, b.deviceName));
}

function selectLights(devices: SwitchBotDevice[], names: string[]): SwitchBotDevice[] {
  const named = selectByName(devices, names);
  if (named.length > 0) return named;
  return devices.filter((device) => /light|ライト|照明/i.test(device.deviceType));
}

function selectByName(devices: SwitchBotDevice[], names: string[]): SwitchBotDevice[] {
  if (names.length === 0) return [];
  return devices.filter((device) => names.includes(device.deviceName));
}

function readNumber(status: Record<string, unknown> | null, key: string): number | undefined {
  const value = status?.[key];
  return typeof value === "number" ? value : undefined;
}

function formatMetric(value: number | undefined, unit: string): string {
  return value === undefined ? "取得不可" : `${value.toFixed(1)}${unit}`;
}
