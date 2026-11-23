import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { databaseFile } from "@/server/db-path";
import { env } from "@/server/env";
import { withJobLock } from "@/server/job-lock";
import { parseKey, runBackup, storageClient } from "@/server/backup/core.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const digest = (v: string) => createHash("sha256").update(v).digest();

/**
 * Nightly encrypted backup (Embarko scheduler → GET with `Authorization: Bearer $CRON_SECRET`).
 * Platform-level, not per company: the file holds every organization, so there is deliberately no tenant UI for it.
 * Needs BACKUP_ENCRYPTION_KEY (kept in Embarko's environment, never next to the backups) and Embarko file storage.
 */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } }, { status: 503 });
  if (!timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized." } }, { status: 401 });
  }
  if (!process.env.BACKUP_ENCRYPTION_KEY) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "BACKUP_ENCRYPTION_KEY is not set: no backup was made." } }, { status: 503 });
  try {
    const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
    const storage = storageClient({ url: process.env.STORAGE_URL, token: process.env.STORAGE_TOKEN, app: process.env.APP_NAME });
    const r = await withJobLock("backup", 10 * 60_000, () => runBackup({ dbFile: databaseFile(), key, storage, log: console.log }));
    if (!r.ran) return NextResponse.json({ skipped: "another backup is running" });
    const { filename, sizeBytes, verified, deleted, tables, organizations } = r.value;
    return NextResponse.json({ ok: true, filename, sizeBytes, verified, deleted, tables, organizations });
  } catch (e) {
    // The message is logged without URLs; the response never echoes it.
    console.error("[daymark] backup failed:", e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "<url>") : "error");
    return NextResponse.json({ error: { code: "BACKUP_FAILED", message: "Backup failed. See the app logs." } }, { status: 500 });
  }
}
