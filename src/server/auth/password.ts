import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for Better Auth: the SAME algorithm, parameters and stored format as Better Auth's own
 * default (scrypt, N=16384, r=16, p=1, 64-byte key, "salt:hexkey", NFKC-normalized), so existing hashes keep
 * verifying and nothing needs re-hashing.
 *
 * The only difference is how many run at once. Each scrypt call needs ~32 MiB of working memory; the default
 * runs up to four in parallel (libuv's thread pool), a transient ~130 MiB spike that does not fit alongside the
 * rest of the app in a 256 MiB container. Here they run one at a time (a login takes well under 100 ms, and the
 * queue is bounded so a flood of sign-in attempts cannot pile up memory or requests).
 */
const PARAMS = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;
const MAX_WAITING = 64;

let running = 0;
let peakRunning = 0;
const waiting: (() => void)[] = [];
export const passwordHashStats = () => ({ running, peakRunning, waiting: waiting.length });

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 1) {
    if (waiting.length >= MAX_WAITING) throw new Error("Too many sign-in attempts at once. Try again in a moment.");
    await new Promise<void>((res) => waiting.push(res));
  }
  running++;
  peakRunning = Math.max(peakRunning, running);
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, PARAMS.dkLen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 128 * PARAMS.N * PARAMS.r * 2 }, (e, k) => (e ? reject(e) : resolve(k))),
  );

export const hashPassword = (password: string) =>
  exclusive(async () => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${(await derive(password, salt)).toString("hex")}`;
  });

export const verifyPassword = ({ hash, password }: { hash: string; password: string }) =>
  exclusive(async () => {
    const [salt, key] = hash.split(":");
    if (!salt || !key) return false;
    const expected = Buffer.from(key, "hex");
    const actual = await derive(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
