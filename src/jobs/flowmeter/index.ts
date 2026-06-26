import { format, getUnixTime, startOfMinute, subMinutes } from "date-fns";
import type { RelayInfo } from "../../config/relays.js";
import { type Identity, createIdentity } from "../../core/identity.js";
import type { Job } from "../../core/job-runner.js";
import { logger } from "../../core/logger.js";
import type { NostrClient } from "../../core/nostr-client.js";
import { appendWithLimit } from "../../shared/array.js";
import { type CountByRelay, countByKind } from "./measure.js";

const SITE_URL = "https://nostr-hotter-site.vercel.app";
const CHART_LIMIT = 144;

interface ChartData {
  axis: number[];
  datas: Record<string, number[]>;
}

export interface FlowmeterJobOptions {
  client: NostrClient;
  relays: RelayInfo[];
  schedule: string;
  enabled: boolean;
  /** 投稿・NIP-78 保存に使う鍵 (hex)。FLOWMETER_NSEC 由来。 */
  key?: string;
  spanMinutes?: number;
}

/**
 * リレー投稿流速を定期集計し、Nostr へ投稿しつつ NIP-78 にチャート用データを保存する。
 * 出自: nostr-flowmeter-batch の cron 処理（会話応答は FlowmeterCommandBot に分離）。
 */
export function createFlowmeterJob(options: FlowmeterJobOptions): Job {
  const span = options.spanMinutes ?? 10;

  return {
    name: "FlowmeterJob",
    schedule: options.schedule,
    enabled: options.enabled,
    async run() {
      if (!options.key) return;
      const identity = createIdentity(options.key);
      const now = new Date();
      const relayUrls = options.relays.map((relay) => relay.url);
      const counts = await countByKind(relayUrls, now, span);

      await postSummary(options.client, identity, options.relays, relayUrls, counts, span);
      await updateCharts(options.client, identity, options.relays, relayUrls, counts, now);
    },
  };
}

async function postSummary(
  client: NostrClient,
  identity: Identity,
  relays: RelayInfo[],
  relayUrls: string[],
  counts: CountByRelay,
  span: number,
): Promise<void> {
  const now = new Date();
  const from = subMinutes(startOfMinute(now), span);
  const to = startOfMinute(now);

  let text = "■ 流速計測\n";
  text += `  ${format(from, "yyyy/MM/dd")} ${format(from, "HH:mm")}～${format(to, "HH:mm")}\n\n`;
  text += "[JP リレー]\n";
  text += relaySection(
    relays.filter((r) => r.target === "jp"),
    counts,
  );
  text += "\n[GLOBAL リレー]\n";
  text += relaySection(
    relays.filter((r) => r.target === "all"),
    counts,
  );
  text += `\n■ 野洲田川定点観測所\n  ${SITE_URL}\n`;

  await client.publishText(text, { relays: relayUrls, privateKey: identity.hex });
}

function relaySection(relays: RelayInfo[], counts: CountByRelay): string {
  let text = "";
  for (const relay of relays) {
    const count = counts[relay.url];
    if (count) {
      text += `${relay.name}: ${count.posts} posts, ${count.reposts} reposts, ${count.favs} favs\n`;
    } else {
      text += `${relay.name}: 欠測\n`;
    }
  }
  return text;
}

async function updateCharts(
  client: NostrClient,
  identity: Identity,
  relays: RelayInfo[],
  relayUrls: string[],
  counts: CountByRelay,
  now: Date,
): Promise<void> {
  const time = getUnixTime(startOfMinute(now));
  const postsByRelay: Record<string, number> = {};
  for (const relay of relays) {
    postsByRelay[relay.url] = counts[relay.url]?.posts ?? 0;
  }

  await updateChart(
    client,
    identity,
    "nostr_river_flowmeter",
    relays,
    relayUrls,
    time,
    postsByRelay,
  );
  const dateKey = format(startOfMinute(now), "yyyyMMdd");
  await updateChart(
    client,
    identity,
    `nostr_river_flowmeter_${dateKey}`,
    relays,
    relayUrls,
    time,
    postsByRelay,
  );
}

async function updateChart(
  client: NostrClient,
  identity: Identity,
  tableName: string,
  relays: RelayInfo[],
  relayUrls: string[],
  time: number,
  postsByRelay: Record<string, number>,
): Promise<void> {
  try {
    const raw = await client.nip78Get(tableName, identity.pubkey, relayUrls);
    const chart: ChartData = raw ? (JSON.parse(raw) as ChartData) : { axis: [], datas: {} };

    for (const relay of relays) {
      const existing = chart.datas[relay.key] ?? [];
      chart.datas[relay.key] = appendWithLimit(existing, postsByRelay[relay.url], CHART_LIMIT);
    }
    chart.axis = appendWithLimit(chart.axis, time, CHART_LIMIT);

    await client.nip78Post(tableName, JSON.stringify(chart), identity.hex, relayUrls);
  } catch (error) {
    logger.error(`Flowmeter chart update failed: ${tableName}`, { error: String(error) });
  }
}
