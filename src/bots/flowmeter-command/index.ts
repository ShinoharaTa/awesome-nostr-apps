import { fromUnixTime, subDays } from "date-fns";
import type { Event } from "nostr-tools";
import {
  AndFilter,
  type BotContext,
  type BotHandler,
  NotFromSelfFilter,
  OrFilter,
  RegexFilter,
  ReplyToMeFilter,
  actionFromFn,
} from "../../core/bot-handler.js";
import { logger } from "../../core/logger.js";
import { countPosts } from "../../jobs/flowmeter/measure.js";

const ANALYZE_KINDS = [1, 6, 42];
const AVERAGE_POSTS = 70;

export interface FlowmeterCommandOptions {
  relays: string[];
  enabled: boolean;
}

/**
 * 流速計測 Bot への会話インターフェース。
 * 出自: nostr-flowmeter-batch の subscribe ハンドラ（定期処理から分離）。
 */
export function createFlowmeterCommandBot(options: FlowmeterCommandOptions): BotHandler {
  const action = actionFromFn(async (event: Event, ctx: BotContext) => {
    if (/^流速ちゃん？/.test(event.content)) {
      await ctx.client.publishText("呼びましたか？", { replyTo: event });
      return;
    }

    // 自分宛の「さわぎすぎ」系リプライには投稿数分析で返す
    await analysePosts(event, ctx, options.relays);
  });

  return {
    name: "FlowmeterCommandBot",
    filter: new OrFilter([
      new RegexFilter(/^流速ちゃん？/),
      new AndFilter([
        new NotFromSelfFilter(),
        new ReplyToMeFilter(),
        new RegexFilter(/(さわぎすぎ|騒ぎすぎ|しゃべりすぎ|喋りすぎ|うるさくない|うるさすぎ)/),
      ]),
    ]),
    action,
    enabled: options.enabled,
  };
}

async function analysePosts(event: Event, ctx: BotContext, relays: string[]): Promise<void> {
  const now = fromUnixTime(event.created_at);
  try {
    const yesterday = await countPosts(relays, ANALYZE_KINDS, subDays(now, 1), 1440, [event.pubkey]);
    const today = await countPosts(relays, ANALYZE_KINDS, now, 1440, [event.pubkey]);

    let text = `直近24時間は ${today} 投稿です。\nその前は ${yesterday} 投稿でした。\n`;
    const ratio = today / (yesterday || 1);

    if (today <= yesterday) {
      text += "昨日ほどじゃないね👍️";
    } else if (ratio >= 1.1 && today > 10) {
      if (today >= AVERAGE_POSTS * 1.5 && today >= yesterday * 1.5) {
        text += "ねえ、多すぎない？😅";
      } else if (today > AVERAGE_POSTS || today > yesterday * 1.3) {
        text += "昨日の投稿数を超えてるよ？大丈夫？😮";
      } else {
        text += "今日はちょっと多めだね😌";
      }
    } else if (today <= 5) {
      text += "まだ全然書いてないよ！忙しかった？😟";
    } else {
      text += "順調だね！😊";
    }

    await ctx.client.publishText(text, { replyTo: event });
  } catch (error) {
    logger.error("FlowmeterCommandBot analyse failed", { error: String(error) });
    await ctx.client.publishText("ちょっといま忙しい", { replyTo: event });
  }
}
