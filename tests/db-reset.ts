import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { databaseFile } from "@/server/db-path";

/** Fresh SQLite database from the committed migrations (the same path production uses: `prisma migrate deploy`). */
export function resetTestDatabase(stdio: "inherit" | "ignore" = "ignore") {
  const file = databaseFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", { stdio, env: { ...process.env } });
}
