import dotenv from "dotenv";
import { logger } from "../core/logger.js";
import { toHexKey } from "../shared/keys.js";
import type { RelayInfo } from "./relays.js";
import { type FileConfig, readFileConfig } from "./schema.js";

dotenv.config();

function str(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function list(name: string): string[] {
  const value = str(name);
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 機能ごとの上書き鍵 (nsec/hex) を読む。未設定なら undefined（=メイン鍵を使う）。
 * 不正な鍵は分かりやすいエラーにする。
 */
function optKey(name: string): string | undefined {
  const value = str(name);
  if (!value) return undefined;
  try {
    return toHexKey(value);
  } catch (error) {
    throw new Error(`Invalid key in ${name}: ${String(error)}`);
  }
}

/**
 * アプリ全体の設定。秘密情報は .env、非機密設定は JSON(config.*.json) から読み、
 * ここで 1 つの構造体に統合する。各 Bot / Job はここだけを参照する。
 */
export interface AppConfig {
  appEnv?: string;
  configPath: string;
  testMode: boolean;
  logLevel: string;
  cooldownSec: number;

  relays: {
    subscribe: string[];
    publish: string[];
  };

  /**
   * key: 機能ごとの投稿鍵 (.env の <機能>_NSEC 由来, hex)。
   * 有効な機能は鍵必須。共通アカウントにしたい場合は各機能へ同じ鍵を入れる。
   */
  salmon: { enabled: boolean; key?: string };
  management: { enabled: boolean; key?: string };

  calendar: {
    enabled: boolean;
    model: string;
    key?: string;
    /** .env 由来 */
    apiKey?: string;
  };

  monitor: {
    enabled: boolean;
    keywords: string[];
    npubs: string[];
    mentionNpubs: string[];
    key?: string;
    /** .env 由来 */
    webhookUrl?: string;
  };

  iot: {
    enabled: boolean;
    allowControl: boolean;
    key?: string;
    /** .env 由来 */
    token?: string;
    secret?: string;
  };

  flowmeter: {
    enabled: boolean;
    cron: string;
    relays: RelayInfo[];
    key?: string;
  };

  metadataRefresh: {
    enabled: boolean;
    cron: string;
    relays: string[];
    /** .env 由来。再 Publish の「対象アカウント」の秘密鍵リスト（Bot の鍵とは別物）。 */
    keys: string[];
  };

  passport: {
    enabled: boolean;
    cron: string;
    targetNpub?: string;
    relays: string[];
    key?: string;
  };
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  // --- 秘密情報は .env から ---
  // 鍵は「機能ごと」に持つ。共通アカウントにしたければ各 <機能>_NSEC へ同じ鍵を入れる。
  // 「既定鍵 / メインアカウント」という概念は持たない。
  const appEnv = str("APP_ENV");
  const calendarApiKey = str("OPENROUTER_API_KEY") ?? str("OPENAI_API_KEY");
  const webhookUrl = str("DISCORD_WEBHOOK_URL");
  const switchBotToken = str("SWITCH_BOT_TOKEN");
  const switchBotSecret = str("SWITCH_BOT_SECRET");
  // 再 Publish 対象アカウント自身の鍵（Bot の投稿鍵とは別物）
  const metadataKeys = list("METADATA_KEYS");

  // --- 非機密設定は JSON から ---
  const { config: file, path: configPath, fileName } = readFileConfig(appEnv);
  logger.info(`Loaded config file: ${fileName}`);

  const merged: AppConfig = {
    appEnv,
    configPath,
    testMode: file.testMode ?? false,
    logLevel: file.logLevel ?? "info",
    cooldownSec: file.cooldownSec ?? 20,

    relays: {
      subscribe: file.relays.subscribe,
      publish: file.relays.publish,
    },

    salmon: { enabled: file.salmon?.enabled ?? true, key: optKey("SALMON_NSEC") },
    management: { enabled: file.management?.enabled ?? true, key: optKey("MANAGEMENT_NSEC") },

    calendar: {
      enabled: file.calendar?.enabled ?? false,
      model: file.calendar?.model ?? "gpt-4",
      key: optKey("CALENDAR_NSEC"),
      apiKey: calendarApiKey,
    },

    monitor: {
      enabled: file.monitor?.enabled ?? false,
      keywords: file.monitor?.keywords ?? [],
      npubs: file.monitor?.npubs ?? [],
      mentionNpubs: file.monitor?.mentionNpubs ?? [],
      key: optKey("MONITOR_NSEC"),
      webhookUrl,
    },

    iot: {
      enabled: file.iot?.enabled ?? false,
      allowControl: file.iot?.allowControl ?? false,
      key: optKey("IOT_NSEC"),
      token: switchBotToken,
      secret: switchBotSecret,
    },

    flowmeter: {
      enabled: file.flowmeter?.enabled ?? false,
      cron: file.flowmeter?.cron ?? "*/10 * * * *",
      relays: file.flowmeter?.relays ?? [],
      key: optKey("FLOWMETER_NSEC"),
    },

    metadataRefresh: {
      enabled: file.metadataRefresh?.enabled ?? false,
      cron: file.metadataRefresh?.cron ?? "0 12 * * *",
      relays: file.metadataRefresh?.relays ?? [],
      keys: metadataKeys,
    },

    passport: {
      enabled: file.passport?.enabled ?? false,
      cron: file.passport?.cron ?? "0 1 * * *",
      targetNpub: file.passport?.targetNpub,
      relays: file.passport?.relays ?? [],
      key: optKey("PASSPORT_NSEC"),
    },
  };

  validate(merged, file);

  cached = merged;
  return cached;
}

/**
 * 必須リレーと、有効化された機能の依存（鍵 / リレー / 秘密情報）を検証する。
 * - 有効な機能は自分の鍵（<機能>_NSEC）が必須。欠けていれば設定ミスとして停止する。
 * - リレーが欠けていれば停止する。
 * - Webhook など外部秘密が欠けている場合は当該機能を無効化して警告する（起動は継続）。
 */
function validate(config: AppConfig, _file: FileConfig): void {
  if (config.relays.subscribe.length === 0) {
    throw new Error('Config "relays.subscribe" must not be empty.');
  }
  if (config.relays.publish.length === 0) {
    throw new Error('Config "relays.publish" must not be empty.');
  }

  // 外部秘密が欠けている機能は先に無効化（鍵を要求しない）
  if (config.monitor.enabled && !config.monitor.webhookUrl) {
    logger.warn("monitor disabled: DISCORD_WEBHOOK_URL is missing in .env");
    config.monitor.enabled = false;
  }
  if (config.metadataRefresh.enabled && config.metadataRefresh.keys.length === 0) {
    logger.warn("metadataRefresh disabled: METADATA_KEYS is empty in .env");
    config.metadataRefresh.enabled = false;
  }

  // 投稿する各機能は自分の鍵が必須（共通にしたい場合は各 <機能>_NSEC へ同じ鍵を入れる）
  requireKey(config.salmon.enabled, config.salmon.key, "SALMON_NSEC");
  requireKey(config.management.enabled, config.management.key, "MANAGEMENT_NSEC");
  requireKey(config.calendar.enabled, config.calendar.key, "CALENDAR_NSEC");
  requireKey(config.iot.enabled, config.iot.key, "IOT_NSEC");
  requireKey(config.monitor.enabled, config.monitor.key, "MONITOR_NSEC");
  requireKey(config.flowmeter.enabled, config.flowmeter.key, "FLOWMETER_NSEC");
  requireKey(config.passport.enabled, config.passport.key, "PASSPORT_NSEC");

  if (config.flowmeter.enabled && config.flowmeter.relays.length === 0) {
    throw new Error('flowmeter.enabled=true requires "flowmeter.relays".');
  }
  if (config.passport.enabled && config.passport.relays.length === 0) {
    throw new Error('passport.enabled=true requires "passport.relays".');
  }
  if (config.metadataRefresh.enabled && config.metadataRefresh.relays.length === 0) {
    throw new Error('metadataRefresh.enabled=true requires "metadataRefresh.relays".');
  }
}

function requireKey(enabled: boolean, key: string | undefined, envName: string): void {
  if (enabled && !key) {
    throw new Error(`${envName} is required in .env when the feature is enabled in config.`);
  }
}
