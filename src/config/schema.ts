import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RelayInfo } from "./relays.js";

/**
 * JSON 設定ファイル（config.json / config.<env>.json）の型。
 * 秘密情報（鍵・APIキー・Webhook 等）はここには含めず .env で管理する。
 * リレーは「使用する項目ごと」に明示指定する（グローバル既定は持たない）。
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

  salmon?: { enabled?: boolean };
  management?: { enabled?: boolean };
  calendar?: { enabled?: boolean; model?: string };
  monitor?: {
    enabled?: boolean;
    keywords?: string[];
    npubs?: string[];
    mentionNpubs?: string[];
  };
  iot?: { enabled?: boolean; allowControl?: boolean };

  flowmeter?: {
    enabled?: boolean;
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
 * APP_ENV から読み込む設定ファイル名を決める。
 * - 未指定 → `config.json`
 * - 例: APP_ENV=LOCAL → `config.local.json`
 */
export function resolveConfigFileName(appEnv?: string): string {
  const env = appEnv?.trim();
  if (!env) return "config.json";
  return `config.${env.toLowerCase()}.json`;
}

export interface LoadedFileConfig {
  config: FileConfig;
  path: string;
  fileName: string;
}

/**
 * APP_ENV に応じた JSON 設定ファイルを読み込む。
 * 見つからない / パースできない場合は分かりやすいエラーを投げる。
 */
export function readFileConfig(appEnv?: string, baseDir: string = process.cwd()): LoadedFileConfig {
  const fileName = resolveConfigFileName(appEnv);
  const path = resolve(baseDir, fileName);

  if (!existsSync(path)) {
    const hint = appEnv
      ? `APP_ENV=${appEnv} に対応する ${fileName} が見つかりません。`
      : `${fileName} が見つかりません。config.json を用意するか APP_ENV を指定してください。`;
    throw new Error(`Config file not found: ${path}\n${hint}`);
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Failed to read config file: ${path}\n${String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Config file is not valid JSON: ${path}\n${String(error)}`);
  }

  const config = parsed as FileConfig;
  if (
    !config.relays ||
    !Array.isArray(config.relays.subscribe) ||
    !Array.isArray(config.relays.publish)
  ) {
    throw new Error(
      `Config file is missing required "relays.subscribe" / "relays.publish": ${path}`,
    );
  }

  return { config, path, fileName };
}
