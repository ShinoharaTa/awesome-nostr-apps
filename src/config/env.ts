import dotenv from "dotenv";
import { logger } from "../core/logger.js";
import { toHexKey, toPubkeyHex } from "../shared/keys.js";
import type { RelayInfo } from "./relays.js";
import { type FileConfig, loadFileConfig } from "./schema.js";

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
 * 機能ごとの投稿鍵 (nsec/hex) を読む。未設定なら undefined。
 * その機能が config.ts で有効なら validate() で必須チェックされる。
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
 * npub / hex 公開鍵のリストを 64 文字 hex に正規化する。不正値は起動時に例外。
 */
function pubkeyList(values: string[], source: string): string[] {
  return values.map((value) => {
    try {
      return toPubkeyHex(value);
    } catch (error) {
      throw new Error(`Invalid pubkey in ${source} ("${value}"): ${String(error)}`);
    }
  });
}

/**
 * アプリ全体の設定。秘密情報は .env、非機密設定は config.ts から読み、
 * ここで 1 つの構造体に統合する。各 Bot / Job はここだけを参照する。
 */
export interface AppConfig {
  appEnv?: string;
  /** 読み込み元の説明（例: "config.ts + config.local.ts"） */
  configSource: string;
  testMode: boolean;
  logLevel: string;
  cooldownSec: number;

  relays: {
    subscribe: string[];
    publish: string[];
  };

  /**
   * key: 公開 Bot ごとの投稿鍵 (.env の <Bot>_NSEC 由来, hex)。
   * 有効な Bot は鍵必須。内部 skill は公開 Bot の鍵で投稿する。
   */
  management: { enabled: boolean; key?: string };

  shinoemon: {
    enabled: boolean;
    model: string;
    skills: {
      callResponse: boolean;
      lightControl: boolean;
      calendar: boolean;
    };
    /** スマートホーム操作を許可する pubkey(hex)。空なら全員拒否。 */
    acl: {
      smartHome: string[];
    };
    home: {
      lightDeviceNames: string[];
      allowControl: boolean;
      amedasStations: string[];
      amedasChart: boolean;
    };
    key?: string;
    /** .env 由来 */
    apiKey?: string;
    /** .env 由来 */
    token?: string;
    secret?: string;
  };

  monitor: {
    enabled: boolean;
    keywords: string[];
    npubs: string[];
    mentionNpubs: string[];
    /**
     * .env 由来。MonitorBot は Nostr へ投稿せず Discord 通知のみ行うため、
     * 投稿鍵 (NSEC) は不要。この Webhook URL が必須。
     */
    webhookUrl?: string;
  };

  flowmeterChan: {
    enabled: boolean;
    command: boolean;
    job: boolean;
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

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;

  // --- 秘密情報は .env から ---
  // 鍵は「公開 Bot ごと」に持つ。内部 skill は公開 Bot の鍵で投稿する。
  // 「既定鍵 / メインアカウント」という概念は持たない。
  const appEnv = str("APP_ENV");
  const calendarApiKey = str("OPENROUTER_API_KEY") ?? str("OPENAI_API_KEY");
  const webhookUrl = str("DISCORD_WEBHOOK_URL");
  const switchBotToken = str("SWITCH_BOT_TOKEN");
  const switchBotSecret = str("SWITCH_BOT_SECRET");
  // 再 Publish 対象アカウント自身の鍵（Bot の投稿鍵とは別物）
  const metadataKeys = list("METADATA_KEYS");

  // --- 非機密設定は config.ts(+config.<env>.ts) から ---
  const { config: file, source } = await loadFileConfig(appEnv);
  logger.info(`Loaded config: ${source}`);

  const merged: AppConfig = {
    appEnv,
    configSource: source,
    testMode: file.testMode ?? false,
    logLevel: file.logLevel ?? "info",
    cooldownSec: file.cooldownSec ?? 20,

    relays: {
      subscribe: file.relays.subscribe,
      publish: file.relays.publish,
    },

    management: { enabled: file.management?.enabled ?? true, key: optKey("MANAGEMENT_NSEC") },

    shinoemon: {
      enabled: file.shinoemon?.enabled ?? true,
      model: file.shinoemon?.model ?? "gpt-4",
      skills: {
        callResponse: file.shinoemon?.skills?.callResponse ?? true,
        lightControl: file.shinoemon?.skills?.lightControl ?? false,
        calendar: file.shinoemon?.skills?.calendar ?? false,
      },
      acl: {
        smartHome: pubkeyList(file.shinoemon?.acl?.smartHome ?? [], "shinoemon.acl.smartHome"),
      },
      home: {
        lightDeviceNames: file.shinoemon?.home?.lightDeviceNames ?? [],
        allowControl: file.shinoemon?.home?.allowControl ?? false,
        amedasStations: file.shinoemon?.home?.amedasStations ?? [],
        amedasChart: file.shinoemon?.home?.amedasChart ?? false,
      },
      key: optKey("SHINOEMON_NSEC"),
      apiKey: calendarApiKey,
      token: switchBotToken,
      secret: switchBotSecret,
    },

    monitor: {
      enabled: file.monitor?.enabled ?? false,
      keywords: file.monitor?.keywords ?? [],
      npubs: file.monitor?.npubs ?? [],
      mentionNpubs: file.monitor?.mentionNpubs ?? [],
      webhookUrl,
    },

    flowmeterChan: {
      enabled: file.flowmeterChan?.enabled ?? false,
      command: file.flowmeterChan?.command ?? true,
      job: file.flowmeterChan?.job ?? true,
      cron: file.flowmeterChan?.cron ?? "*/10 * * * *",
      relays: file.flowmeterChan?.relays ?? [],
      key: optKey("FLOWMETER_CHAN_NSEC"),
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
  if (
    config.shinoemon.enabled &&
    config.shinoemon.skills.lightControl &&
    (!config.shinoemon.token || !config.shinoemon.secret)
  ) {
    logger.warn("shinoemon lightControl skill disabled: SWITCH_BOT_TOKEN/SECRET is missing in .env");
    config.shinoemon.skills.lightControl = false;
  }
  if (
    config.shinoemon.enabled &&
    config.shinoemon.skills.lightControl &&
    config.shinoemon.acl.smartHome.length === 0
  ) {
    logger.warn(
      "shinoemon lightControl is enabled but shinoemon.acl.smartHome is empty: all smart home commands will be denied. Add allowed npubs.",
    );
  }

  // Nostr へ投稿する公開 Bot は自分の鍵が必須。内部 skill はその Bot の鍵を使う。
  // monitor は投稿しない (Discord 通知のみ) ため鍵は不要。
  requireKey(config.shinoemon.enabled, config.shinoemon.key, "SHINOEMON_NSEC");
  requireKey(config.management.enabled, config.management.key, "MANAGEMENT_NSEC");
  requireKey(config.flowmeterChan.enabled, config.flowmeterChan.key, "FLOWMETER_CHAN_NSEC");
  requireKey(config.passport.enabled, config.passport.key, "PASSPORT_NSEC");

  if (config.flowmeterChan.enabled && config.flowmeterChan.relays.length === 0) {
    throw new Error('flowmeterChan.enabled=true requires "flowmeterChan.relays".');
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
