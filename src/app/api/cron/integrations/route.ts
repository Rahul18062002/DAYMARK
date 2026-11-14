import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { isViaSocketConfigured } from "@/server/integrations/viasocket/config";
import { runIntegrationCron } from "@/server/integrations/viasocket/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (v: string) => createHash("sha256").update(v).digest();

// Vercel Cron calls this with GET and `Authorization: Bearer $CRON_SECRET`. It is a public URL,
// so without a configured secret it refuses to run at all.
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } }, { status: 503 });
  const given = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized." } }, { status: 401 });
  }
  if (!isViaSocketConfigured()) return NextResponse.json({ skipped: "viaSocket is not configured" });
  try {
    return NextResponse.json(await runIntegrationCron());
  } catch (e) {
    console.error("[daymark] integration cron failed:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Run failed." } }, { status: 500 });
  }
}
