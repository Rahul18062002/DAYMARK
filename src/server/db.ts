import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { databaseFile } from "./db-path";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * SQLite settings that matter for a web app:
 *  - WAL: readers don't block the writer and the file stays consistent after a crash (persistent in the file).
 *  - busy_timeout: a request that meets another write waits instead of failing with SQLITE_BUSY.
 *  - foreign_keys: on (better-sqlite3's default); the composite (id, organizationId) keys enforce tenant isolation.
 */
function create() {
  const file = databaseFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const init = new Database(file);
  init.pragma("journal_mode = WAL");
  init.close();
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}`, timeout: 10_000 }) });
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const client = (globalForPrisma.prisma ??= create());
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type Db = PrismaClient | Tx;
