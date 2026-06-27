import { describe, expect, it } from "vitest";
import { deepMerge, resolveOverrideName } from "../config/schema.js";

describe("resolveOverrideName", () => {
  it("returns undefined when APP_ENV is unset (base config.ts only)", () => {
    expect(resolveOverrideName()).toBeUndefined();
    expect(resolveOverrideName("")).toBeUndefined();
    expect(resolveOverrideName("  ")).toBeUndefined();
  });

  it("builds a lowercased override filename from APP_ENV", () => {
    expect(resolveOverrideName("LOCAL")).toBe("config.local.ts");
    expect(resolveOverrideName("Production")).toBe("config.production.ts");
  });
});

describe("deepMerge", () => {
  it("recursively merges objects and overrides scalars", () => {
    const base = { a: 1, nested: { b: 2, c: 3 } };
    const merged = deepMerge(base, { nested: { b: 9 } });
    expect(merged).toEqual({ a: 1, nested: { b: 9, c: 3 } });
  });

  it("replaces arrays wholesale (does not concat)", () => {
    const base = { relays: ["wss://a", "wss://b"] };
    const merged = deepMerge(base, { relays: ["wss://x"] });
    expect(merged.relays).toEqual(["wss://x"]);
  });

  it("does not mutate the base object", () => {
    const base = { nested: { b: 2 } };
    deepMerge(base, { nested: { b: 9 } });
    expect(base.nested.b).toBe(2);
  });

  it("ignores undefined override values", () => {
    const base = { a: 1, b: 2 };
    const merged = deepMerge(base, { b: undefined });
    expect(merged).toEqual({ a: 1, b: 2 });
  });
});
