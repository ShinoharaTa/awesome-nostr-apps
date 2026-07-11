import type { Event } from "nostr-tools";
import {
  type BotContext,
  type BotHandler,
  actionFromFn,
  filterFromFn,
} from "../../../core/bot-handler.js";
import { logger } from "../../../core/logger.js";
import type { TempRangeChart } from "../../../integrations/amedas/chart.js";
import type { AmedasClient, AmedasObservation } from "../../../integrations/amedas/index.js";
import type { SwitchBotClient, SwitchBotDevice } from "../../../integrations/switchbot/index.js";
import { normalizeCommandContent } from "../../../shared/nostr-content.js";
import { currUnixtime } from "../../../shared/time.js";

const ROOM_COMMAND = /^まいへや[？?！!。.\s]*$/;
const LIGHT_STATUS_COMMAND = /^光ある？[？?！!。.\s]*$/;
const LIGHT_ON_COMMAND = /^光あれ[？?！!。.\s]*$/;

/**
 * 操作コマンド（光あれ）の許容鮮度（秒）。これより古い投稿は実行しない。
 * リアルタイム購読 (EventBus は since=now) が基本のため、リプレイや
 * 過去投稿の掘り起こしによる意図しない点灯を防ぐ保険。
 */
const CONTROL_MAX_AGE_SEC = 180;

export interface IoTOptions {
  switchBot: SwitchBotClient | null;
  /** まいへや応答にアメダスの気象データを添える場合に渡す */
  amedas?: AmedasClient | null;
  /** まいへや応答に気温レンジグラフ画像を添える場合に渡す */
  tempChart?: TempRangeChart | null;
  lightControlEnabled?: boolean;
  /**
   * スマートホーム操作を許可する pubkey(hex)。空なら全員拒否。
   * まいへや / 光ある？ / 光あれ の全コマンドに適用する。
   */
  allowedPubkeys?: string[];
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
  // 許可鍵は Set で高速照合。空なら全員拒否（default deny）。
  const allowed = new Set(options.allowedPubkeys ?? []);

  /**
   * スマートホームコマンドとして処理してよいか判定する。
   * 署名検証は SimplePool が購読時に済ませている（無効署名は Bot に届かない）ため、
   * ここでは ACL（許可鍵）と操作イベントの鮮度だけを見る。
   */
  const shouldHandle = (event: Event, ctx: BotContext): boolean => {
    if (event.pubkey === ctx.client.getPublicKey()) return false;
    if (!lightControlEnabled || !options.switchBot) return false;

    const content = normalizeCommandContent(event.content);
    const isRoom = ROOM_COMMAND.test(content);
    const isStatus = LIGHT_STATUS_COMMAND.test(content);
    const isOn = LIGHT_ON_COMMAND.test(content);
    if (!isRoom && !isStatus && !isOn) return false;

    if (!allowed.has(event.pubkey)) {
      logger.warn("smart home command denied: pubkey not in ACL", {
        pubkey: `${event.pubkey.slice(0, 12)}...`,
      });
      return false;
    }

    // 操作系（点灯）だけは古いイベントを弾く。参照系は再取得しても無害。
    if (isOn && event.created_at < currUnixtime() - CONTROL_MAX_AGE_SEC) {
      logger.warn("smart home operation denied: stale event", {
        pubkey: `${event.pubkey.slice(0, 12)}...`,
        createdAt: event.created_at,
      });
      return false;
    }

    return true;
  };

  const filter = filterFromFn((event: Event, ctx: BotContext) => shouldHandle(event, ctx));

  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    if (!options.switchBot || !shouldHandle(event, ctx)) return;
    await handleHomeCommand(
      event,
      ctx,
      options.switchBot,
      options.amedas ?? null,
      options.tempChart ?? null,
      options.home,
      normalizeCommandContent(event.content),
    );
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
  amedas: AmedasClient | null,
  tempChart: TempRangeChart | null,
  home: HomeOptions,
  content: string,
): Promise<void> {
  const devices = await switchBot.getDevices();
  if (ROOM_COMMAND.test(content)) {
    await publishRoomStatus(event, ctx, switchBot, amedas, tempChart, devices);
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
  amedas: AmedasClient | null,
  tempChart: TempRangeChart | null,
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

  const weatherLines = amedas ? formatAmedasLines(await amedas.getLatestAll()) : [];
  const chart = tempChart ? await tempChart.generate() : null;
  const parts = ["🏠 部屋の現在の状況：", ...lines, ...weatherLines];
  if (chart) parts.push(chart.url);
  await ctx.client.publishText(parts.join("\n"), {
    replyTo: event,
    tags: chart ? [chart.imeta, ["r", chart.url]] : undefined,
  });
}

/** アメダス観測値をまいへや応答用の行に整形する。取得できなかった場合は空配列。 */
function formatAmedasLines(observations: AmedasObservation[]): string[] {
  if (observations.length === 0) return [];
  const lines = ["🌤 そとの様子（アメダス）："];
  for (const obs of observations) {
    const parts = [
      `${formatMetric(obs.temperature, "℃")} / ${formatMetric(obs.humidity, "%")}`,
      `降水 ${obs.precipitation1h === undefined ? "取得不可" : `${obs.precipitation1h.toFixed(1)}mm/h`}`,
    ];
    if (obs.windSpeed !== undefined) {
      const direction = obs.windDirection && obs.windSpeed > 0 ? `${obs.windDirection} ` : "";
      parts.push(`風 ${direction}${obs.windSpeed.toFixed(1)}m/s`);
    }
    lines.push(`${obs.stationName}（${obs.time}）：${parts.join(" / ")}`);
  }
  return lines;
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
