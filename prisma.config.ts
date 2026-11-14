import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

// SQLite: DATABASE_URL (file:…) wins, otherwise $DATA_DIR/daymark.db (Embarko), otherwise ./data/daymark.db.
// Migrations are applied only with `prisma migrate deploy` (committed SQL files). Never `db push`.
const raw = process.env.DATABASE_URL?.trim();
const url = raw ? `file:${path.resolve(raw.replace(/^file:/, ""))}` : `file:${path.resolve(process.env.DATA_DIR?.trim() || "./data", "daymark.db")}`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
