import dotenv from "dotenv";
import { logger } from "../core/logger.js";
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
 * アプリ全体の設定。秘密情報は .env、非機密設定は JSON(config.*.json) から読み、
 * ここで 1 つの構造体に統合する。各 Bot / Job はここだけを参照する。
 */
export interface AppConfig {
  appEnv?: string;
  configPath: string;
  testMode: boolean;
  logLevel: string;
  cooldownSec: number;
  hex: string;

  relays: {
    subscribe: string[];
    publish: string[];
  };

  salmon: { enabled: boolean };
  management: { enabled: boolean };

  calendar: {
    enabled: boolean;
    model: string;
    /** .env 由来 */
    apiKey?: string;
  };

  monitor: {
    enabled: boolean;
    keywords: string[];
    npubs: string[];
    mentionNpubs: string[];
    /** .env 由来 */
    webhookUrl?: string;
  };

  iot: {
    enabled: boolean;
    allowControl: boolean;
    /** .env 由来 */
    token?: string;
    secret?: string;
  };

  flowmeter: {
    enabled: boolean;
    cron: string;
    relays: RelayInfo[];
  };

  metadataRefresh: {
    enabled: boolean;
    cron: string;
    relays: string[];
    /** .env 由来（秘密鍵） */
    keys: string[];
  };

  passport: {
    enabled: boolean;
    cron: string;
    targetNpub?: string;
    relays: string[];
    /** .env 由来（秘密鍵） */
    key?: string;
  };
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  // --- 秘密情報は .env から ---
  const hex = str("HEX");
  if (!hex) {
    throw new Error("HEX environment variable is required (bot private key in hex).");
  }
  const appEnv = str("APP_ENV");
  const calendarApiKey = str("OPENROUTER_API_KEY") ?? str("OPENAI_API_KEY");
  const webhookUrl = str("DISCORD_WEBHOOK_URL");
  const switchBotToken = str("SWITCH_BOT_TOKEN");
  const switchBotSecret = str("SWITCH_BOT_SECRET");
  const metadataKeys = list("METADATA_KEYS");
  const passportKey = str("PASSPORT_KEY") ?? str("PASSPORT_HEX");

  // --- 非機密設定は JSON から ---
  const { config: file, path: configPath, fileName } = readFileConfig(appEnv);
  logger.info(`Loaded config file: ${fileName}`);

  const merged: AppConfig = {
    appEnv,
    configPath,
    testMode: file.testMode ?? false,
    logLevel: file.logLevel ?? "info",
    cooldownSec: file.cooldownSec ?? 20,
    hex,

    relays: {
      subscribe: file.relays.subscribe,
      publish: file.relays.publish,
    },

    salmon: { enabled: file.salmon?.enabled ?? true },
    management: { enabled: file.management?.enabled ?? true },

    calendar: {
      enabled: file.calendar?.enabled ?? false,
      model: file.calendar?.model ?? "gpt-4",
      apiKey: calendarApiKey,
    },

    monitor: {
      enabled: file.monitor?.enabled ?? false,
      keywords: file.monitor?.keywords ?? [],
      npubs: file.monitor?.npubs ?? [],
      mentionNpubs: file.monitor?.mentionNpubs ?? [],
      webhookUrl,
    },

    iot: {
      enabled: file.iot?.enabled ?? false,
      allowControl: file.iot?.allowControl ?? false,
      token: switchBotToken,
      secret: switchBotSecret,
    },

    flowmeter: {
      enabled: file.flowmeter?.enabled ?? false,
      cron: file.flowmeter?.cron ?? "*/10 * * * *",
      relays: file.flowmeter?.relays ?? [],
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
      key: passportKey,
    },
  };

  validate(merged, file);

  cached = merged;
  return cached;
}

/**
 * 必須リレーと、有効化された機能の依存（リレー / 秘密鍵）を検証する。
 * 秘密鍵 / Webhook が欠けている場合は当該機能を無効化して警告する（起動は継続）。
 * リレーが欠けている場合は設定ミスとして起動を止める。
 */
function validate(config: AppConfig, _file: FileConfig): void {
  if (config.relays.subscribe.length === 0) {
    throw new Error('Config "relays.subscribe" must not be empty.');
  }
  if (config.relays.publish.length === 0) {
    throw new Error('Config "relays.publish" must not be empty.');
  }

  if (config.flowmeter.enabled && config.flowmeter.relays.length === 0) {
    throw new Error('flowmeter.enabled=true requires "flowmeter.relays".');
  }

  if (config.metadataRefresh.enabled) {
    if (config.metadataRefresh.relays.length === 0) {
      throw new Error('metadataRefresh.enabled=true requires "metadataRefresh.relays".');
    }
    if (config.metadataRefresh.keys.length === 0) {
      logger.warn("metadataRefresh disabled: METADATA_KEYS is empty in .env");
      config.metadataRefresh.enabled = false;
    }
  }

  if (config.passport.enabled) {
    if (config.passport.relays.length === 0) {
      throw new Error('passport.enabled=true requires "passport.relays".');
    }
    if (!config.passport.key) {
      logger.warn("passport disabled: PASSPORT_KEY is missing in .env");
      config.passport.enabled = false;
    }
  }

  if (config.monitor.enabled && !config.monitor.webhookUrl) {
    logger.warn("monitor disabled: DISCORD_WEBHOOK_URL is missing in .env");
    config.monitor.enabled = false;
  }
}
