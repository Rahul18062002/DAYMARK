import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
import { CLIENT_IP_HEADER, clientIpFrom } from "@/server/client-ip";

/**
 * Only the Better Auth endpoints Daymark actually uses are reachable over HTTP.
 * Notably `/sign-up/*` is NOT exposed: there is no public registration.
 */
const ALLOWED = new Set([
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/request-password-reset",
  "/reset-password",
  "/change-password",
  "/list-sessions",
  "/revoke-session",
  "/revoke-other-sessions",
]);
const isAllowed = (pathname: string) => {
  const p = pathname.replace(/^\/api\/auth/, "") || "/";
  return ALLOWED.has(p) || /^\/reset-password\/[^/]+$/.test(p);
};

let handlers: ReturnType<typeof toNextJsHandler> | undefined;
const h = () => (handlers ??= toNextJsHandler(auth.handler));

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });

/** Better Auth rate-limits per client address; give it one we computed (a client-sent value is overwritten). */
function withClientIp(req: Request) {
  const headers = new Headers(req.headers);
  headers.set(CLIENT_IP_HEADER, clientIpFrom(req.headers));
  return new Request(req, { headers });
}

export async function GET(req: Request) {
  return isAllowed(new URL(req.url).pathname) ? h().GET(withClientIp(req)) : notFound();
}
export async function POST(req: Request) {
  return isAllowed(new URL(req.url).pathname) ? h().POST(withClientIp(req)) : notFound();
}
