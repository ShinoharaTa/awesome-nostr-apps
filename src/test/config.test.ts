import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileConfig, resolveConfigFileName } from "../config/schema.js";

describe("resolveConfigFileName", () => {
  it("falls back to config.json when APP_ENV is unset", () => {
    expect(resolveConfigFileName()).toBe("config.json");
    expect(resolveConfigFileName("")).toBe("config.json");
    expect(resolveConfigFileName("  ")).toBe("config.json");
  });

  it("uses lowercased APP_ENV as the file suffix", () => {
    expect(resolveConfigFileName("LOCAL")).toBe("config.local.json");
    expect(resolveConfigFileName("Production")).toBe("config.production.json");
  });
});

describe("readFileConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ana-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(name: string, body: unknown): void {
    writeFileSync(join(dir, name), JSON.stringify(body), "utf8");
  }

  it("reads config.json when APP_ENV is unset", () => {
    writeConfig("config.json", {
      relays: { subscribe: ["wss://a"], publish: ["wss://b"] },
    });
    const { config, fileName } = readFileConfig(undefined, dir);
    expect(fileName).toBe("config.json");
    expect(config.relays.subscribe).toEqual(["wss://a"]);
  });

  it("reads the APP_ENV-specific file", () => {
    writeConfig("config.local.json", {
      relays: { subscribe: ["wss://local"], publish: ["wss://local"] },
    });
    const { config, fileName } = readFileConfig("LOCAL", dir);
    expect(fileName).toBe("config.local.json");
    expect(config.relays.publish).toEqual(["wss://local"]);
  });

  it("throws a helpful error when the file is missing", () => {
    expect(() => readFileConfig("LOCAL", dir)).toThrow(/config\.local\.json/);
  });

  it("throws when required relays keys are missing", () => {
    writeConfig("config.json", { relays: { subscribe: ["wss://a"] } });
    expect(() => readFileConfig(undefined, dir)).toThrow(/relays\.subscribe.*relays\.publish/);
  });
});
