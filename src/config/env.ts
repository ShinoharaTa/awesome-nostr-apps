import dotenv from "dotenv";
import { DEFAULT_RELAYS, type RelayInfo, relayUrls } from "./relays.js";

dotenv.config();

function str(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bool(name: string, fallback = false): boolean {
  const value = str(name);
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
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
 * アプリ全体の設定を 1 箇所に集約する。各 Bot / Job はここを参照し、
 * 個別に dotenv を読み込まない。
 */
export interface AppConfig {
  hex: string;
  testMode: boolean;
  logLevel: string;
  relays: RelayInfo[];
  relayUrls: string[];

  calendar: {
    apiKey?: string;
    model: string;
  };

  monitor: {
    webhookUrl?: string;
    keywords: string[];
    npubs: string[];
    mentionNpubs: string[];
  };

  switchBot: {
    token?: string;
    secret?: string;
    allowControl: boolean;
  };

  flowmeter: {
    enabled: boolean;
    cron: string;
  };

  metadata: {
    keys: string[];
    relays: string[];
    cron: string;
  };

  passport: {
    hex?: string;
    targetNpub?: string;
    cron: string;
  };
}

function resolveRelays(): RelayInfo[] {
  const override = list("RELAYS");
  if (override.length === 0) return DEFAULT_RELAYS;
  return override.map((url, index) => ({
    key: `relay-${index}`,
    name: url,
    url,
    target: "jp" as const,
  }));
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const hex = str("HEX");
  if (!hex) {
    throw new Error("HEX environment variable is required (bot private key in hex).");
  }

  const relays = resolveRelays();

  cached = {
    hex,
    testMode: bool("TEST_MODE", false),
    logLevel: str("LOG_LEVEL") ?? "info",
    relays,
    relayUrls: relayUrls(relays),

    calendar: {
      apiKey: str("OPENROUTER_API_KEY") ?? str("OPENAI_API_KEY"),
      model: str("LLM_MODEL_NAME") ?? "gpt-4",
    },

    monitor: {
      webhookUrl: str("DISCORD_WEBHOOK_URL"),
      keywords: list("MONITOR_KEYWORDS"),
      npubs: list("MONITOR_NPUBS"),
      mentionNpubs: list("MONITOR_MENTION_NPUBS"),
    },

    switchBot: {
      token: str("SWITCH_BOT_TOKEN"),
      secret: str("SWITCH_BOT_SECRET"),
      allowControl: bool("SWITCH_BOT_ALLOW_CONTROL", false),
    },

    flowmeter: {
      enabled: bool("FLOWMETER_ENABLED", false),
      cron: str("FLOWMETER_CRON") ?? "*/10 * * * *",
    },

    metadata: {
      keys: list("METADATA_KEYS"),
      relays: list("METADATA_RELAYS"),
      cron: str("METADATA_CRON") ?? "0 12 * * *",
    },

    passport: {
      hex: str("PASSPORT_HEX"),
      targetNpub: str("PASSPORT_TARGET_NPUB"),
      cron: str("PASSPORT_CRON") ?? "0 1 * * *",
    },
  };

  return cached;
}
