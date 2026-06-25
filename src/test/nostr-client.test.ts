import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { NostrClient } from "../core/nostr-client.js";

function testClient() {
  const hex = bytesToHex(generateSecretKey());
  return new NostrClient({ hex, relays: ["wss://relay.invalid"], testMode: true });
}

describe("NostrClient (TEST_MODE)", () => {
  it("derives a stable npub/pubkey", () => {
    const client = testClient();
    expect(client.getPublicKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(client.getNpub().startsWith("npub1")).toBe(true);
  });

  it("does not hit the network when publishing in test mode", async () => {
    const client = testClient();
    // テストモードでは実送信せず、署名済みイベント id のみ返す
    const id = await client.publishText("hello");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects replies addressed to itself", () => {
    const client = testClient();
    const event = {
      id: "x",
      pubkey: "a".repeat(64),
      created_at: 0,
      kind: 1,
      tags: [["p", client.getPublicKey()]],
      content: "hi",
      sig: "s",
    };
    expect(client.isReplyToMe(event)).toBe(true);
  });
});
