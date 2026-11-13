import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use DIRECT_URL (non-pooled) when set — required for managed Postgres
// providers that put a pooler in front of the database (Neon, Supabase, etc.).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
