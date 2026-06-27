import crypto from "node:crypto";
import { logger } from "../../core/logger.js";

const BASE_URL = "https://api.switch-bot.com/v1.1";

export interface SwitchBotDevice {
  deviceId: string;
  deviceName: string;
  deviceType: string;
}

export interface SwitchBotConfig {
  token: string;
  secret: string;
  /** 実デバイス操作 (turnOn/turnOff 等) を許可するか */
  allowControl: boolean;
  testMode: boolean;
}

/**
 * SwitchBot Open API v1.1 クライアント。
 * 出自: NostrIot の SwitchBot.js。デバイス操作は allowControl が true のときのみ。
 */
export class SwitchBotClient {
  constructor(private readonly config: SwitchBotConfig) {}

  get allowControl(): boolean {
    return this.config.allowControl;
  }

  private authHeaders(): Record<string, string> {
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const sign = crypto
      .createHmac("sha256", this.config.secret)
      .update(Buffer.from(this.config.token + t + nonce, "utf-8"))
      .digest("base64");
    return {
      Authorization: this.config.token,
      sign,
      nonce,
      t,
      "Content-Type": "application/json",
    };
  }

  async getDevices(): Promise<SwitchBotDevice[]> {
    try {
      const res = await fetch(`${BASE_URL}/devices`, { headers: this.authHeaders() });
      const data = (await res.json()) as { body?: { deviceList?: SwitchBotDevice[] } };
      return data.body?.deviceList ?? [];
    } catch (error) {
      logger.error("SwitchBot getDevices failed", { error: String(error) });
      return [];
    }
  }

  async getStatus(deviceId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${BASE_URL}/devices/${deviceId}/status`, {
        headers: this.authHeaders(),
      });
      const data = (await res.json()) as { body?: Record<string, unknown> };
      return data.body ?? null;
    } catch (error) {
      logger.error("SwitchBot getStatus failed", { error: String(error) });
      return null;
    }
  }

  /**
   * デバイスにコマンドを送る。allowControl が false の場合は実行しない。
   */
  async sendCommand(deviceId: string, command: string, parameter = "default"): Promise<boolean> {
    if (!this.config.allowControl) {
      logger.warn("SwitchBot control disabled (SWITCH_BOT_ALLOW_CONTROL=false)", { command });
      return false;
    }
    if (this.config.testMode) {
      logger.info("[TEST_MODE] switchbot command skipped", { deviceId, command });
      return true;
    }
    try {
      const res = await fetch(`${BASE_URL}/devices/${deviceId}/commands`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ command, parameter, commandType: "command" }),
      });
      return res.ok;
    } catch (error) {
      logger.error("SwitchBot sendCommand failed", { error: String(error) });
      return false;
    }
  }
}
