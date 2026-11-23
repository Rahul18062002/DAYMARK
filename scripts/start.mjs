// Production start (Embarko runs `npm start`): migrate the SQLite database safely, then serve.
// One process: the Next.js standalone server is imported here instead of being spawned.
import path from "node:path";
import fs from "node:fs";
import { safeMigrate, resolveDbFile } from "./safe-migrate.mjs";
import { parseKey, restoreBackup, storageClient } from "../src/server/backup/core.mjs";

const root = path.resolve(import.meta.dirname, "..");
// Restore from an encrypted backup when asked: RESTORE_FROM=<backup file name | latest> (once per backup: a marker
// stops it repeating on every start), or RESTORE_ON_EMPTY=1 to restore the newest backup when there is no database yet.
{
  const dbFile = resolveDbFile();
  const want = process.env.RESTORE_FROM?.trim() || (process.env.RESTORE_ON_EMPTY === "1" && !fs.existsSync(dbFile) ? "latest" : "");
  const marker = (n) => `${dbFile}.restored-${n.replace(/[^\w.-]/g, "_")}`;
  if (want && !fs.existsSync(marker(want))) {
    try {
      const r = await restoreBackup({ dbFile, key: parseKey(process.env.BACKUP_ENCRYPTION_KEY), storage: storageClient({ url: process.env.STORAGE_URL, token: process.env.STORAGE_TOKEN, app: process.env.APP_NAME }), name: want, log: console.log });
      fs.writeFileSync(marker(want), `${new Date().toISOString()} ${r.filename}\n`);
    } catch (e) {
      console.error(`[start] restore requested (${want}) but failed: ${e.message}. Not starting, so the current data is not touched further.`);
      process.exit(1);
    }
  }
}

const result = safeMigrate({ cwd: root });
if (!result.ok) {
  console.error("[start] database migration failed; not starting the server (the database was restored if it existed).");
  process.exit(1);
}
process.env.HOSTNAME = "0.0.0.0"; // containers set HOSTNAME to their own id; the platform proxy needs all interfaces
process.env.PORT ||= "3000";
// The platform proxy reuses upstream connections; Node closes idle ones after 5 s by default, which shows up as
// random connection resets (measured: ~0.6% of requests). Keep them open longer than any proxy idle timeout.
process.env.KEEP_ALIVE_TIMEOUT ||= "65000";
await import(path.join(root, ".next/standalone/server.js"));
