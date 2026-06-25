import { format } from "date-fns";
import type { Event } from "nostr-tools";
import {
  type BotContext,
  type BotHandler,
  actionFromFn,
  filterFromFn,
} from "../../core/bot-handler.js";
import { LlmClient } from "../../integrations/llm/index.js";

export interface CalendarOptions {
  apiKey?: string;
  model: string;
}

interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  location?: string;
}

/**
 * 「予定 ...」というメンションから Google カレンダー登録 URL を生成して返す。
 * LLM が使えれば高精度解析、なければ簡易解析にフォールバックする。
 * 出自: OnlineConcierge CalendarBot。
 */
export function createCalendarBot(options: CalendarOptions): BotHandler {
  const llm = new LlmClient({ apiKey: options.apiKey, model: options.model });

  const filter = filterFromFn((event: Event, ctx: BotContext) => {
    const npub = ctx.client.getNpub();
    const pattern = new RegExp(`^(nostr:${npub}\\s+)?予定 .+`);
    return pattern.test(event.content);
  });

  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    const calendarEvent = await parseEvent(llm, event.content, new Date());
    const url = buildGoogleCalendarUrl(calendarEvent);
    const start = format(calendarEvent.start, "yyyy/MM/dd HH:mm");
    const end = format(calendarEvent.end, "HH:mm");
    const text = `📅 カレンダー登録用URLを作成しました!\n📝 ${calendarEvent.title}\n⏰ ${start} - ${end}\n🔗 ${url}`;
    await ctx.client.publishText(text, { replyTo: event });
  });

  return {
    name: "CalendarBot",
    filter,
    action,
    enabled: true,
  };
}

async function parseEvent(llm: LlmClient, content: string, now: Date): Promise<CalendarEvent> {
  const parsed = await llm.parseSchedule(content, now);
  if (parsed) {
    return {
      title: parsed.title,
      start: new Date(parsed.startDateTime),
      end: new Date(parsed.endDateTime),
      location: parsed.location,
    };
  }
  return parseSimple(content, now);
}

/**
 * LLM がない場合の簡易解析。
 */
function parseSimple(content: string, baseDate: Date): CalendarEvent {
  const match = content.match(/予定\s+(.+)/);
  const title = match ? match[1] : content;

  const start = new Date(baseDate);
  if (title.includes("明日")) start.setDate(start.getDate() + 1);

  const timeMatch = title.match(/午後(\d{1,2})時|午前(\d{1,2})時|(\d{1,2})時/);
  if (timeMatch) {
    let hour = Number(timeMatch[1] ?? timeMatch[2] ?? timeMatch[3]);
    if (timeMatch[1]) hour += 12;
    start.setHours(hour, 0, 0, 0);
  } else {
    start.setTime(baseDate.getTime() + 60 * 60 * 1000);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return { title, start, end };
}

function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmt(event.start)}/${fmt(event.end)}`,
  });
  if (event.location) params.set("location", event.location);
  return `https://www.google.com/calendar/render?${params.toString()}`;
}
