import { getUnixTime, startOfMinute, subMinutes } from "date-fns";
import type { Event } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

export interface RelayCount {
  posts: number;
  reposts: number;
  favs: number;
}

export type CountByRelay = Record<string, RelayCount | null>;

/**
 * 各リレーから指定時間窓の kind 1/6/7 を取得して種別ごとに集計する。
 * 出自: nostr-flowmeter-batch の countByKind（nostr-fetch を nostr-tools の
 * SimplePool.querySync に置き換え）。
 */
export async function countByKind(
  relays: string[],
  start: Date,
  spanMinutes: number,
): Promise<CountByRelay> {
  const now = startOfMinute(start);
  const until = getUnixTime(now);
  const since = getUnixTime(subMinutes(now, spanMinutes));

  const pool = new SimplePool();
  const result: CountByRelay = {};

  try {
    for (const relay of relays) {
      try {
        const events = await pool.querySync([relay], {
          kinds: [1, 6, 7],
          since,
          until,
        });
        result[relay] = {
          posts: events.filter((e: Event) => e.kind === 1).length,
          reposts: events.filter((e: Event) => e.kind === 6).length,
          favs: events.filter((e: Event) => e.kind === 7).length,
        };
      } catch {
        result[relay] = null;
      }
    }
  } finally {
    pool.close(relays);
  }

  return result;
}

/**
 * 指定 author の投稿数を時間窓で数える。FlowmeterChanBot の分析用。
 */
export async function countPosts(
  relays: string[],
  kinds: number[],
  start: Date,
  spanMinutes: number,
  authors?: string[],
): Promise<number> {
  const now = startOfMinute(start);
  const until = getUnixTime(now);
  const since = getUnixTime(subMinutes(now, spanMinutes));

  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relays, {
      kinds,
      since,
      until,
      ...(authors ? { authors } : {}),
    });
    return events.length;
  } finally {
    pool.close(relays);
  }
}
