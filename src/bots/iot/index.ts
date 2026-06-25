import type { Event } from "nostr-tools";
import {
  type BotContext,
  type BotHandler,
  actionFromFn,
  filterFromFn,
} from "../../core/bot-handler.js";
import { ReplyCooldown } from "../../shared/rate-limit.js";
import type { SwitchBotClient } from "../../integrations/switchbot/index.js";

const KEYWORD_REPLIES: Array<{ pattern: RegExp; reply: string }> = [
  { pattern: /^(かみさま|神様)$/i, reply: "よんだ？" },
  { pattern: /(サーモン|ｻｰﾓﾝ)/i, reply: "ﾝﾅｧ～!!!" },
  { pattern: /(サモン|ｻﾓﾝ)/i, reply: "サモン！サーモン！" },
  { pattern: /(サモーン|ｻﾓｰﾝ)/i, reply: "ﾅｧﾝ!!!" },
  { pattern: /(salmon)/i, reply: "👀" },
];

const LIGHT_COMMAND = /^光(ある？|あれ|ないよ)/;

export interface IoTOptions {
  switchBot: SwitchBotClient | null;
}

/**
 * Nostr のキーワードに反応し、設定があれば SwitchBot 経由で照明を操作する Bot。
 * 出自: NostrIot index.js（キーワード反応 + 照明制御）。
 */
export function createIoTBot(options: IoTOptions): BotHandler {
  const cooldown = new ReplyCooldown(5);

  const filter = filterFromFn((event: Event, ctx: BotContext) => {
    if (event.pubkey === ctx.client.getPublicKey()) return false;
    if (KEYWORD_REPLIES.some(({ pattern }) => pattern.test(event.content))) return true;
    if (options.switchBot && ctx.client.isReplyToMe(event) && LIGHT_COMMAND.test(event.content)) {
      return true;
    }
    return false;
  });

  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    if (options.switchBot && ctx.client.isReplyToMe(event) && LIGHT_COMMAND.test(event.content)) {
      await handleLight(event, ctx, options.switchBot);
      return;
    }

    if (!cooldown.isSafe(event.pubkey)) return;
    const match = KEYWORD_REPLIES.find(({ pattern }) => pattern.test(event.content));
    if (match) {
      await ctx.client.publishText(match.reply, { replyTo: event });
    }
  });

  return {
    name: "IoTBot",
    filter,
    action,
    enabled: true,
  };
}

async function handleLight(
  event: Event,
  ctx: BotContext,
  switchBot: SwitchBotClient,
): Promise<void> {
  const command = event.content.match(LIGHT_COMMAND)?.[1];
  const lights = (await switchBot.getDevices()).filter((d) => d.deviceType === "Ceiling Light");

  if (command === "ある？") {
    const statuses = await Promise.all(lights.map((l) => switchBot.getStatus(l.deviceId)));
    const anyOn = statuses.some((s) => s?.power === "on");
    await ctx.client.publishText(anyOn ? "光あるよ" : "光ないよ", { replyTo: event });
    return;
  }

  const turnOn = command === "あれ";
  const results = await Promise.all(
    lights.map((l) => switchBot.sendCommand(l.deviceId, turnOn ? "turnOn" : "turnOff")),
  );
  const ok = results.length > 0 && results.every(Boolean);
  if (turnOn) {
    await ctx.client.publishText(ok ? "世界は光に包まれた" : "光を操作できなかった", {
      replyTo: event,
    });
  } else {
    await ctx.client.publishText(ok ? "闇に還した" : "光を操作できなかった", { replyTo: event });
  }
}
