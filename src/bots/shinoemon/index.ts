import type { Event } from "nostr-tools";
import {
  type BotContext,
  type BotHandler,
  TextReplyAction,
  actionFromFn,
  filterFromFn,
} from "../../core/bot-handler.js";
import type { AmedasClient } from "../../integrations/amedas/index.js";
import type { SwitchBotClient } from "../../integrations/switchbot/index.js";
import { normalizeCommandContent } from "../../shared/nostr-content.js";
import { createCalendarBot } from "../calendar/index.js";
import { createIoTBot } from "./iot/index.js";

export interface ShinoemonSkills {
  callResponse: boolean;
  lightControl: boolean;
  calendar: boolean;
}

export interface ShinoemonOptions {
  skills: ShinoemonSkills;
  switchBot: SwitchBotClient | null;
  /** まいへや応答にアメダスの気象データを添える場合に渡す */
  amedas?: AmedasClient | null;
  home: {
    lightDeviceNames: string[];
    allowControl: boolean;
  };
  calendar: {
    apiKey?: string;
    model: string;
  };
}

/**
 * しのえもん。
 *
 * 公開 Bot としては 1 体に見せ、内部では呼びかけ応答・照明操作・予定作成などの
 * skill を順番に評価する。将来的に LLM/Agent が skill を選ぶ形へ拡張しやすいよう、
 * ここをオーケストレーション層にする。
 */
export function createShinoemonBot(options: ShinoemonOptions): BotHandler {
  const skills = buildSkills(options);

  const filter = filterFromFn((event: Event, ctx: BotContext) => {
    if (event.pubkey === ctx.client.getPublicKey()) return false;
    return skills.some((skill) => skill.enabled && skill.filter.matches(event, ctx));
  });

  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    const skill = skills.find((candidate) => candidate.enabled && candidate.filter.matches(event, ctx));
    if (!skill) return;
    await skill.action.execute(event, ctx);
  });

  return {
    name: "ShinoemonBot",
    filter,
    action,
    enabled: true,
  };
}

function buildSkills(options: ShinoemonOptions): BotHandler[] {
  const skills: BotHandler[] = [];

  if (options.skills.calendar) {
    skills.push(
      createCalendarBot({
        apiKey: options.calendar.apiKey,
        model: options.calendar.model,
      }),
    );
  }

  if (options.skills.callResponse) {
    skills.push(createCallResponseSkill());
  }

  if (options.skills.lightControl) {
    skills.push(
      createIoTBot({
        switchBot: options.switchBot,
        amedas: options.amedas,
        lightControlEnabled: options.skills.lightControl,
        home: options.home,
      }),
    );
  }

  return skills;
}

function createCallResponseSkill(): BotHandler {
  return {
    name: "ShinoemonCallResponseSkill",
    filter: filterFromFn((event) => /^しのえもん[？?！!。.\s]*$/.test(normalizeCommandContent(event.content))),
    action: new TextReplyAction("よんだ？"),
    enabled: true,
  };
}
