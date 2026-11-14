import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { viaSocketConfig } from "./config";

/**
 * A flow's run URL is a credential, so it is encrypted at rest (AES-256-GCM). The key is derived
 * from the embed secret with HKDF, so there is no extra secret to manage. If the embed secret is
 * rotated the stored URLs become unreadable — recover with "Re-sync" in Automations (the table is
 * only a cache of what viaSocket lists) and re-link the events.
 */
function key(info: string): Buffer {
  const cfg = viaSocketConfig();
  if (!cfg) throw new Error("viaSocket is not configured");
  return Buffer.from(hkdfSync("sha256", cfg.secret, "daymark", info, 32));
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("daymark/viasocket/flow-url/v1"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable stored value");
  const d = createDecipheriv("aes-256-gcm", key("daymark/viasocket/flow-url/v1"), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Keyed hash used to recognise a flow again without keeping its id in clear. */
export function flowKey(viaSocketFlowId: string): string {
  return createHmac("sha256", key("daymark/viasocket/flow-key/v1")).update(viaSocketFlowId).digest("hex");
}
