import { logger } from "../../core/logger.js";

const BASE_URL = "https://www.jma.go.jp/bosai/amedas";

/**
 * さいたま市および近隣のアメダス観測所（気象庁 amedastable.json より、さいたま市中心からの距離順）。
 * さいたま市内に該当する観測所は「さいたま」(43241・桜区) の 1 箇所のみ。
 * 観測要素: ◎=気温/湿度/風/降水/日照, ★=気圧・積雪含む全要素（気象台）
 *
 *   43241 さいたま ◎  さいたま市桜区（市内・約5.5km）
 *   43256 越谷     ◎  約10km
 *   44071 練馬     ◎  約15km
 *   44132 東京     ★  約21km
 *   43266 所沢     ◎  約23km
 *   43126 久喜     ◎  約25km
 *   43056 熊谷     ★  約40km（埼玉県の地方気象台）
 */
export const AMEDAS_STATIONS: Record<string, string> = {
  "43241": "さいたま",
  "43256": "越谷",
  "44071": "練馬",
  "44132": "東京",
  "43266": "所沢",
  "43126": "久喜",
  "43056": "熊谷",
};

/**
 * 「過去の気象データ検索」(etrn) 用の地点パラメータ。過去年の日別値の取得に使う。
 * bosai 側の観測所 ID とは体系が異なるためここで対応付ける（さいたま市内の観測所のみ）。
 */
export const AMEDAS_ETRN: Record<string, { prec: number; block: string }> = {
  "43241": { prec: 43, block: "0363" }, // さいたま（桜区）
};

/** windDirection の 16 方位（1=北北東 … 16=北、0=静穏）。 */
const WIND_DIRECTIONS = [
  "静穏",
  "北北東",
  "北東",
  "東北東",
  "東",
  "東南東",
  "南東",
  "南南東",
  "南",
  "南南西",
  "南西",
  "西南西",
  "西",
  "西北西",
  "北西",
  "北北西",
  "北",
];

export interface AmedasObservation {
  stationId: string;
  stationName: string;
  /** 観測時刻 "HH:mm" (JST) */
  time: string;
  /** ℃ */
  temperature?: number;
  /** % */
  humidity?: number;
  /** mm（前1時間） */
  precipitation1h?: number;
  /** m/s */
  windSpeed?: number;
  /** 16方位の和名（例: "南南東"） */
  windDirection?: string;
}

/**
 * 気象庁アメダス（bosai/amedas）の最新観測値クライアント。認証不要。
 * latest_time.txt で最新観測時刻を取り、地点別 3 時間ファイルから該当時刻を読む。
 */
export class AmedasClient {
  constructor(private readonly stationIds: string[]) {}

  get enabled(): boolean {
    return this.stationIds.length > 0;
  }

  /** 設定された全観測所の最新観測値を返す。取得失敗した観測所はスキップする。 */
  async getLatestAll(): Promise<AmedasObservation[]> {
    const latest = await this.fetchLatestTime();
    if (!latest) return [];

    const results = await Promise.all(
      this.stationIds.map((stationId) => this.fetchStation(stationId, latest)),
    );
    return results.filter((obs): obs is AmedasObservation => obs !== null);
  }

  /** latest_time.txt（例: "2026-07-08T10:50:00+09:00"）を JST の文字列のまま分解する。 */
  private async fetchLatestTime(): Promise<LatestTime | null> {
    try {
      const res = await fetch(`${BASE_URL}/data/latest_time.txt`);
      const text = (await res.text()).trim();
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!match) {
        logger.warn("Amedas latest_time.txt has unexpected format", { text });
        return null;
      }
      const [, year, month, day, hour, minute] = match;
      return { year, month, day, hour, minute };
    } catch (error) {
      logger.error("Amedas fetchLatestTime failed", { error: String(error) });
      return null;
    }
  }

  private async fetchStation(stationId: string, latest: LatestTime): Promise<AmedasObservation | null> {
    // 地点別ファイルは 3 時間ごと（00/03/.../21 始まり）にまとまっている
    const block = String(Math.floor(Number(latest.hour) / 3) * 3).padStart(2, "0");
    const url = `${BASE_URL}/data/point/${stationId}/${latest.year}${latest.month}${latest.day}_${block}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn("Amedas point fetch failed", { stationId, status: res.status });
        return null;
      }
      const data = (await res.json()) as Record<string, Record<string, unknown>>;
      const key = `${latest.year}${latest.month}${latest.day}${latest.hour}${latest.minute}00`;
      const entry = data[key] ?? data[Object.keys(data).sort().at(-1) ?? ""];
      if (!entry) return null;

      const windDirection = readValue(entry, "windDirection");
      return {
        stationId,
        stationName: AMEDAS_STATIONS[stationId] ?? stationId,
        time: `${latest.hour}:${latest.minute}`,
        temperature: readValue(entry, "temp"),
        humidity: readValue(entry, "humidity"),
        precipitation1h: readValue(entry, "precipitation1h"),
        windSpeed: readValue(entry, "wind"),
        windDirection: windDirection !== undefined ? WIND_DIRECTIONS[windDirection] : undefined,
      };
    } catch (error) {
      logger.error("Amedas fetchStation failed", { stationId, error: String(error) });
      return null;
    }
  }
}

interface LatestTime {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

/** アメダスの値は [値, 品質フラグ] のタプル。フラグ 0 (正常) のみ採用する。 */
function readValue(entry: Record<string, unknown>, key: string): number | undefined {
  const value = entry[key];
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [amount, quality] = value;
  return typeof amount === "number" && quality === 0 ? amount : undefined;
}
