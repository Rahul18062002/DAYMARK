import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { appUrl } from "./env";
import { AppError, forbidden } from "./errors";
import { requireContext, type Ctx } from "./auth/context";
import { clientIp, throttle } from "./throttle";

type Options = {
  /** Public endpoints set this to false; everything else requires a signed-in, active member. */
  auth?: boolean;
  /** Per-IP limit for public endpoints: [maxRequests, windowSeconds, bucketName]. */
  limit?: [number, number, string];
};

type Handler<P> = (a: { req: Request; ctx: Ctx; params: P }) => Promise<unknown>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Wraps a route handler with: same-origin check on mutations, authentication,
 * optional rate limit, and uniform JSON error responses. Authorization (role,
 * scope, tenant) is enforced inside the services, never trusted from the client.
 */
export function route<P = Record<string, string>>(opts: Options, handler: Handler<P>) {
  const requireAuth = opts.auth !== false;
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    try {
      if (MUTATING.has(req.method)) {
        const origin = req.headers.get("origin");
        if (origin && origin !== new URL(appUrl()).origin) throw forbidden("Cross-origin request blocked.");
      }
      if (opts.limit) {
        const [max, windowSeconds, bucket] = opts.limit;
        await throttle(`${bucket}:${clientIp(req.headers)}`, max, windowSeconds);
      }
      const ctx = requireAuth ? await requireContext() : (undefined as unknown as Ctx);
      const params = await routeCtx.params;
      const data = await handler({ req, ctx, params });
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const fields = Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message]));
    return NextResponse.json(
      { error: { code: "VALIDATION", message: e.issues[0]?.message ?? "Invalid input.", details: fields } },
      { status: 400 },
    );
  }
  if (e instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body." } }, { status: 400 });
  }
  console.error("[daymark] unhandled error:", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
}

export const json = (req: Request) => req.json();
