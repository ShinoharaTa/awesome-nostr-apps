import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { NostrClient } from "../core/nostr-client.js";

function transport() {
  return new NostrClient({ relays: ["wss://relay.invalid"], testMode: true });
}

describe("NostrClient (transport, TEST_MODE)", () => {
  it("does not hit the network when publishing in test mode", async () => {
    const key = bytesToHex(generateSecretKey());
    const id = await transport().publishText("hello", { privateKey: key });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requires a signing key (no default account exists)", async () => {
    await expect(transport().publishText("hello")).rejects.toThrow(/privateKey/);
  });
});
