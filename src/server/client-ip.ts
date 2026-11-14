/**
 * The real client address behind a proxy, safe against spoofing.
 *
 * A client can send any `X-Forwarded-For` / `X-Real-IP` it likes, and Embarko's proxy does NOT replace them
 * (measured: it appends to X-Forwarded-For and passes X-Real-IP through). What a client cannot do is change the
 * END of the list: each proxy appends the address it received the request from. With `TRUSTED_PROXY_HOPS`
 * proxies under our control (Embarko: 1), the client is the entry just before those, counted from the right.
 * Anything a client prepends is ignored. No X-Forwarded-For at all (local run) → "unknown".
 */
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIpFrom(headers: Headers, hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string {
  const parts = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "unknown";
  const ip = parts[Math.max(0, parts.length - 1 - Math.max(0, hops))];
  return IP_SHAPE.test(ip) ? ip : "unknown";
}

/** Header Daymark sets itself (overwriting any client value) so Better Auth's rate limiter keys on the real client. */
export const CLIENT_IP_HEADER = "x-daymark-client-ip";
