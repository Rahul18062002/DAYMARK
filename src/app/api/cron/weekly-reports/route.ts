import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { aiConfigured } from "@/server/ai/provider";
import { runWeeklyReports } from "@/server/ai/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const digest = (v: string) => createHash("sha256").update(v).digest();

/** Embarko scheduler → GET with `Authorization: Bearer $CRON_SECRET`. Writes last week's reports that don't exist yet. */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } }, { status: 503 });
  if (!timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized." } }, { status: 401 });
  }
  if (!aiConfigured()) return NextResponse.json({ skipped: "AI is not configured" });
  try { return NextResponse.json(await runWeeklyReports()); }
  catch (e) { console.error("[daymark] weekly reports run failed:", e instanceof Error ? e.name : "error"); return NextResponse.json({ error: { code: "INTERNAL", message: "Run failed." } }, { status: 500 }); }
}
