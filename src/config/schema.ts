import baseConfig from "./config.js";
import type { RelayInfo } from "./relays.js";

/**
 * 非機密設定（config.ts / config.<env>.ts）の型。
 * 秘密情報（鍵・APIキー・Webhook 等）はここには含めず .env で管理する。
 * リレーは「使用する項目ごと」に明示指定する（グローバル既定は持たない）。
 * 各項目の意味は README の「設定の考え方」を参照。
 */
export interface FileConfig {
  logLevel?: string;
  testMode?: boolean;
  /** 応答系 Bot のクールダウン秒（暴走対策） */
  cooldownSec?: number;

  relays: {
    /** リアルタイム購読（EventBus）に使うリレー */
    subscribe: string[];
    /** 応答・投稿に使う既定リレー */
    publish: string[];
  };

  management?: { enabled?: boolean };
  shinoemon?: {
    enabled?: boolean;
    model?: string;
    skills?: {
      callResponse?: boolean;
      lightControl?: boolean;
      calendar?: boolean;
    };
    home?: {
      /** 点灯状態確認・点灯操作に使うライト名。未指定ならライト系デバイスを自動選択。 */
      lightDeviceNames?: string[];
      /** 光あれ！ による実デバイス操作を許可するか。 */
      allowControl?: boolean;
      /**
       * まいへや応答に添えるアメダス観測所 ID（気象庁 amedastable.json 準拠）。
       * 候補は src/integrations/amedas/index.ts の AMEDAS_STATIONS を参照。
       * 空配列ならアメダス表示なし。
       */
      amedasStations?: string[];
    };
  };
  monitor?: {
    enabled?: boolean;
    keywords?: string[];
    npubs?: string[];
    mentionNpubs?: string[];
  };

  flowmeterChan?: {
    enabled?: boolean;
    command?: boolean;
    job?: boolean;
    cron?: string;
    /** 流速計測・投稿に使うリレー（JP/GLOBAL の区別を持つ） */
    relays?: RelayInfo[];
  };
  metadataRefresh?: {
    enabled?: boolean;
    cron?: string;
    /** kind:0 を取得・再 Publish するリレー */
    relays?: string[];
  };
  passport?: {
    enabled?: boolean;
    cron?: string;
    targetNpub?: string;
    /** パスポート投稿先リレー */
    relays?: string[];
  };
}

/**
 * 上書き用の部分型。配列はそのまま（部分化しない＝丸ごと置き換え）。
 */
export type DeepPartial<T> = T extends Array<unknown>
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * base に override をディープマージする（base は破壊しない）。
 * オブジェクトは再帰的にマージ、配列・スカラーは override で丸ごと置き換える。
 */
export function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as unknown as T) ?? base;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? deepMerge(baseValue, value as DeepPartial<typeof baseValue>)
        : value;
  }
  return result as T;
}

/**
 * APP_ENV から上書き設定ファイル名を決める。
 * - 未指定 → undefined（base の config.ts のみ）
 * - 例: APP_ENV=LOCAL → `config.local.ts`
 */
export function resolveOverrideName(appEnv?: string): string | undefined {
  const env = appEnv?.trim().toLowerCase();
  return env ? `config.${env}.ts` : undefined;
}

export interface LoadedFileConfig {
  config: FileConfig;
  /** 読み込み元の説明（ログ用） */
  source: string;
}

function validateRelays(config: FileConfig, source: string): void {
  if (!config.relays || !Array.isArray(config.relays.subscribe) || !Array.isArray(config.relays.publish)) {
    throw new Error(`Config (${source}) is missing required "relays.subscribe" / "relays.publish".`);
  }
}

/**
 * base の config.ts を読み、APP_ENV があれば config.<env>.ts をディープマージする。
 * 上書きファイルが存在しなければ base のみを使う（gitignore された config.local.ts が
 * 本番に無いケースを許容する）。
 */
export async function loadFileConfig(appEnv?: string): Promise<LoadedFileConfig> {
  const overrideName = resolveOverrideName(appEnv);
  if (!overrideName) {
    validateRelays(baseConfig, "config.ts");
    return { config: baseConfig, source: "config.ts" };
  }

  const env = appEnv?.trim().toLowerCase();
  let override: DeepPartial<FileConfig> | undefined;
  try {
    const mod = (await import(`./config.${env}.js`)) as { default?: DeepPartial<FileConfig> };
    override = mod.default;
  } catch {
    override = undefined;
  }

  if (!override) {
    validateRelays(baseConfig, "config.ts");
    return { config: baseConfig, source: `config.ts (${overrideName} not found)` };
  }

  const merged = deepMerge<FileConfig>(baseConfig, override);
  const source = `config.ts + ${overrideName}`;
  validateRelays(merged, source);
  return { config: merged, source };
}
