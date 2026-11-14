import path from "node:path";

/**
 * Where the SQLite database lives.
 *  - `DATABASE_URL=file:<path>` wins when set (tests, local development).
 *  - otherwise `$DATA_DIR/daymark.db` — Embarko sets DATA_DIR to the folder that survives redeploys.
 *  - otherwise `./data/daymark.db` for a plain local run.
 * Kept free of imports from the rest of the app so it can be used by scripts and `prisma.config.ts`.
 */
export function databaseFile(e: Record<string, string | undefined> = process.env): string {
  const url = e.DATABASE_URL?.trim();
  if (url) {
    if (!url.startsWith("file:")) throw new Error('DATABASE_URL must be a SQLite file URL such as "file:./data/daymark.db".');
    return path.resolve(url.slice("file:".length));
  }
  return path.resolve(e.DATA_DIR?.trim() || "./data", "daymark.db");
}
