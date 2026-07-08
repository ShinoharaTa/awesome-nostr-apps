import { Resvg } from "@resvg/resvg-js";
import { logger } from "../../core/logger.js";
import type { Nip96Uploader } from "../nostr-media/index.js";
import { AMEDAS_ETRN, type AmedasClient } from "./index.js";

const ETRN_BASE = "https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php";
const PAST_YEARS = 5;
const WINDOW_DAYS = 10; // 今日の前後日数

export interface TempRangeChartOptions {
  /** bosai 側の観測所 ID（AMEDAS_ETRN に対応があること） */
  stationId: string;
  /** 現在気温の取得に使う */
  amedas: AmedasClient;
  uploader: Nip96Uploader;
}

export interface TempChartResult {
  url: string;
  /** kind:1 に付ける imeta タグ (NIP-92) */
  imeta: string[];
}

interface DayTemps {
  max?: number;
  min?: number;
}

/**
 * 過去5年＋今年の日別最高/最低気温から気温レンジグラフ (PNG) を生成し、
 * NIP-96 サーバーへアップロードして URL を返す。まいへや応答用。
 * 失敗時は null（呼び出し側はテキストのみで応答する）。
 */
export class TempRangeChart {
  /** etrn 月別ページのキャッシュ。過去年は不変、今年分は日付が変わったら取り直す。 */
  private readonly monthCache = new Map<string, Record<number, DayTemps>>();
  private currentYearCacheDate = "";

  constructor(private readonly options: TempRangeChartOptions) {}

  async generate(): Promise<TempChartResult | null> {
    const etrn = AMEDAS_ETRN[this.options.stationId];
    if (!etrn) {
      logger.warn("TempRangeChart: no etrn mapping for station", { stationId: this.options.stationId });
      return null;
    }
    try {
      const now = jstNow();
      const window = buildWindow(now);
      const temps = await this.fetchWindowTemps(etrn, window, now);
      const nowTemp = await this.fetchNowTemp();
      const svg = buildSvg(window, temps, nowTemp);
      const png = new Resvg(svg, {
        fitTo: { mode: "width", value: 2400 },
        font: { loadSystemFonts: true },
      })
        .render()
        .asPng();
      const uploaded = await this.options.uploader.upload(Buffer.from(png), "temp-range.png", "image/png");
      if (!uploaded) return null;
      const imeta = ["imeta", `url ${uploaded.url}`, "m image/png", `x ${uploaded.sha256}`];
      if (uploaded.ox) imeta.push(`ox ${uploaded.ox}`);
      if (uploaded.dim) imeta.push(`dim ${uploaded.dim}`);
      return { url: uploaded.url, imeta };
    } catch (error) {
      logger.error("TempRangeChart generate failed", { error: String(error) });
      return null;
    }
  }

  private async fetchNowTemp(): Promise<number | undefined> {
    const observations = await this.options.amedas.getLatestAll();
    return observations.find((obs) => obs.stationId === this.options.stationId)?.temperature;
  }

  /** ウィンドウ内の各日について、過去5年＋今年の値を年オフセット別に集める。 */
  private async fetchWindowTemps(
    etrn: { prec: number; block: string },
    window: WindowDay[],
    now: Date,
  ): Promise<Map<string, DayTemps[]>> {
    // 今年分のキャッシュは日付が変わったら破棄する
    const today = jstDateKey(now);
    if (this.currentYearCacheDate !== today) {
      const currentYear = now.getUTCFullYear();
      for (const key of [...this.monthCache.keys()]) {
        if (key.includes(`-${currentYear}-`)) this.monthCache.delete(key);
      }
      this.currentYearCacheDate = today;
    }

    // 必要な (年, 月) ページを列挙して取得
    const pages = new Set<string>();
    for (const day of window) {
      for (let back = 0; back <= PAST_YEARS; back++) {
        pages.add(`${day.year - back}-${day.month}`);
      }
    }
    for (const page of pages) {
      const [year, month] = page.split("-").map(Number);
      await this.fetchMonth(etrn, year, month);
    }

    const result = new Map<string, DayTemps[]>();
    for (const day of window) {
      const perYear: DayTemps[] = [];
      for (let back = 0; back <= PAST_YEARS; back++) {
        const month = this.monthCache.get(this.monthKey(etrn, day.year - back, day.month));
        perYear.push(month?.[day.day] ?? {});
      }
      result.set(day.key, perYear);
    }
    return result;
  }

  private monthKey(etrn: { prec: number; block: string }, year: number, month: number): string {
    return `${etrn.prec}-${etrn.block}-${year}-${month}`;
  }

  private async fetchMonth(etrn: { prec: number; block: string }, year: number, month: number): Promise<void> {
    const key = this.monthKey(etrn, year, month);
    if (this.monthCache.has(key)) return;
    const url = `${ETRN_BASE}?prec_no=${etrn.prec}&block_no=${etrn.block}&year=${year}&month=${month}&day=&view=`;
    const html = await (await fetch(url)).text();
    const days: Record<number, DayTemps> = {};
    for (const row of html.match(/<tr class="mtx"[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
        m[1].replace(/<[^>]+>/g, "").replace(/[\s)\]]+/g, ""),
      );
      if (cells.length < 7 || !/^\d+$/.test(cells[0])) continue;
      const max = Number.parseFloat(cells[5]);
      const min = Number.parseFloat(cells[6]);
      days[Number(cells[0])] = {
        max: Number.isNaN(max) ? undefined : max,
        min: Number.isNaN(min) ? undefined : min,
      };
    }
    this.monthCache.set(key, days);
    await sleep(300); // 気象庁サーバーへの配慮
  }
}

interface WindowDay {
  key: string;
  label: string;
  year: number;
  month: number;
  day: number;
}

/** JST の現在時刻を UTC getter で扱える Date にして返す。 */
function jstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function jstDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/** 今日の前後 WINDOW_DAYS 日ぶんの日付リスト。 */
function buildWindow(now: Date): WindowDay[] {
  const days: WindowDay[] = [];
  for (let offset = -WINDOW_DAYS; offset <= WINDOW_DAYS; offset++) {
    const d = new Date(now.getTime() + offset * 86400 * 1000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    days.push({ key: `${month}-${day}`, label: `${month}/${day}`, year, month, day });
  }
  return days;
}

// ---- 描画（モバイル前提: 大きめフォント・文字最小限） ----

const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK2 = "#52514e";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const BASE = "#c3c2b7";
const RED = "#e34948";
const BLUE = "#2a78d6";

type Pt = [number, number];

/** Catmull-Rom → cubic bezier で滑らかなパスにする。 */
function smoothPath(points: Pt[], startCommand: "M" | "L" = "M"): string {
  if (points.length < 2) return "";
  let d = `${startCommand}${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function buildSvg(window: WindowDay[], temps: Map<string, DayTemps[]>, nowTemp: number | undefined): string {
  // 日ごと: レンジ上端 = 最高気温の高い順2番目 / 下端 = 最低気温の低い順2番目 / 平均 / 今年
  const days = window.map((w) => {
    const perYear = temps.get(w.key) ?? [];
    const past = perYear.slice(1);
    const maxes = past.map((t) => t.max).filter((v): v is number => typeof v === "number").sort((a, b) => b - a);
    const mins = past.map((t) => t.min).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    return {
      label: w.label,
      hi: maxes[1] ?? maxes[0],
      lo: mins[1] ?? mins[0],
      maxAvg: maxes.length ? maxes.reduce((a, b) => a + b, 0) / maxes.length : undefined,
      minAvg: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : undefined,
      curMax: perYear[0]?.max,
      curMin: perYear[0]?.min,
    };
  });

  const W = 1200;
  const H = 800;
  const M = { top: 96, right: 36, bottom: 72, left: 84 };
  const PW = W - M.left - M.right;
  const PH = H - M.top - M.bottom;

  const allVals = days
    .flatMap((d) => [d.hi, d.lo, d.curMax, d.curMin])
    .filter((v): v is number => typeof v === "number");
  if (typeof nowTemp === "number") allVals.push(nowTemp);
  if (allVals.length === 0) throw new Error("no temperature data for chart");
  const yMin = Math.floor(Math.min(...allVals) / 5) * 5;
  const yMax = Math.ceil(Math.max(...allVals) / 5) * 5;
  const x = (i: number) => M.left + (i / (days.length - 1)) * PW;
  const y = (t: number) => M.top + PH - ((t - yMin) / (yMax - yMin)) * PH;

  const pts = (vals: Array<number | undefined>): Pt[] =>
    vals.flatMap((v, i) => (typeof v === "number" ? [[x(i), y(v)] as Pt] : []));

  const hiPts = pts(days.map((d) => d.hi));
  const loPts = pts(days.map((d) => d.lo));
  const bandPath = `${smoothPath(hiPts)} L${loPts.at(-1)?.[0].toFixed(1)} ${loPts.at(-1)?.[1].toFixed(1)} ${smoothPath(
    [...loPts].reverse(),
    "L",
  ).slice(1)} Z`;
  const meanMaxPath = smoothPath(pts(days.map((d) => d.maxAvg)));
  const meanMinPath = smoothPath(pts(days.map((d) => d.minAvg)));
  const curMaxPts = pts(days.map((d) => d.curMax));
  const curMinPts = pts(days.map((d) => d.curMin));
  const lastMax = curMaxPts.at(-1);
  const lastMin = curMinPts.at(-1);
  const lastMaxV = days.filter((d) => typeof d.curMax === "number").at(-1)?.curMax;
  const lastMinV = days.filter((d) => typeof d.curMin === "number").at(-1)?.curMin;
  const nowIdx = WINDOW_DAYS; // 中央が今日

  let yTicks = "";
  for (let t = yMin; t <= yMax; t += 5) {
    yTicks += `<line x1="${M.left}" y1="${y(t)}" x2="${M.left + PW}" y2="${y(t)}" stroke="${GRID}" stroke-width="1"/>`;
    yTicks += `<text x="${M.left - 16}" y="${y(t) + 9}" text-anchor="end" font-size="28" fill="${MUTED}">${t}</text>`;
  }
  let xTicks = "";
  for (let i = 0; i < days.length; i += 3) {
    xTicks += `<text x="${x(i)}" y="${M.top + PH + 44}" text-anchor="middle" font-size="28" fill="${MUTED}">${days[i].label}</text>`;
  }

  const endLabels =
    lastMax && lastMin && typeof lastMaxV === "number" && typeof lastMinV === "number"
      ? `<circle cx="${lastMax[0]}" cy="${lastMax[1]}" r="8" fill="${RED}" stroke="${SURFACE}" stroke-width="3"/>
         <circle cx="${lastMin[0]}" cy="${lastMin[1]}" r="8" fill="${BLUE}" stroke="${SURFACE}" stroke-width="3"/>
         <g font-size="26" font-weight="600" fill="${INK}">
           <text x="${lastMax[0] + 16}" y="${lastMax[1] + 8}">${lastMaxV.toFixed(1)}℃</text>
           <text x="${lastMin[0] + 16}" y="${lastMin[1] + 8}">${lastMinV.toFixed(1)}℃</text>
         </g>`
      : "";

  const nowMark =
    typeof nowTemp === "number"
      ? `<circle cx="${x(nowIdx)}" cy="${y(nowTemp)}" r="8" fill="${INK}" stroke="${SURFACE}" stroke-width="3"/>
         <text x="${x(nowIdx) + 16}" y="${y(nowTemp) + 8}" font-size="26" fill="${INK}" font-weight="600">いま ${nowTemp.toFixed(1)}℃</text>`
      : "";

  const FONT = `font-family="Hiragino Kaku Gothic ProN, Hiragino Sans, Noto Sans CJK JP, Noto Sans JP, sans-serif"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="rangeGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${RED}" stop-opacity="0.22"/>
    <stop offset="45%" stop-color="${RED}" stop-opacity="0.04"/>
    <stop offset="55%" stop-color="${BLUE}" stop-opacity="0.04"/>
    <stop offset="100%" stop-color="${BLUE}" stop-opacity="0.22"/>
  </linearGradient>
  <linearGradient id="rangeGradLegend" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${RED}" stop-opacity="0.45"/>
    <stop offset="45%" stop-color="${RED}" stop-opacity="0.08"/>
    <stop offset="55%" stop-color="${BLUE}" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="${BLUE}" stop-opacity="0.45"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${SURFACE}"/>
<g ${FONT}>
<g font-size="22" fill="${INK2}">
  <line x1="${M.left}" y1="46" x2="${M.left + 36}" y2="46" stroke="${RED}" stroke-width="4"/>
  <text x="${M.left + 44}" y="53">最高</text>
  <line x1="${M.left + 130}" y1="46" x2="${M.left + 166}" y2="46" stroke="${BLUE}" stroke-width="4"/>
  <text x="${M.left + 174}" y="53">最低</text>
  <line x1="${M.left + 260}" y1="46" x2="${M.left + 296}" y2="46" stroke="${MUTED}" stroke-width="3" stroke-dasharray="7 6"/>
  <text x="${M.left + 304}" y="53">5年平均</text>
  <rect x="${M.left + 440}" y="32" width="36" height="26" rx="4" fill="url(#rangeGradLegend)"/>
  <text x="${M.left + 484}" y="53">5年レンジ</text>
  <circle cx="${M.left + 650}" cy="46" r="7" fill="${INK}" stroke="${SURFACE}" stroke-width="3"/>
  <text x="${M.left + 666}" y="53">いま</text>
</g>
${yTicks}
${xTicks}
<line x1="${M.left}" y1="${M.top + PH}" x2="${M.left + PW}" y2="${M.top + PH}" stroke="${BASE}" stroke-width="1"/>
<text x="${M.left - 48}" y="${M.top - 18}" font-size="26" fill="${MUTED}">℃</text>
<path d="${bandPath}" fill="url(#rangeGrad)"/>
<path d="${meanMaxPath}" fill="none" stroke="${RED}" stroke-width="3" stroke-dasharray="7 6" opacity="0.5" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${meanMinPath}" fill="none" stroke="${BLUE}" stroke-width="3" stroke-dasharray="7 6" opacity="0.5" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${smoothPath(curMaxPts)}" fill="none" stroke="${RED}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
<path d="${smoothPath(curMinPts)}" fill="none" stroke="${BLUE}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
${endLabels}
${nowMark}
</g>
</svg>`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
