import { z } from "zod";

const schema = z.object({
  // SQLite: optional "file:…" override. Default is $DATA_DIR/daymark.db (see db-path.ts).
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL must be a full URL"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Daymark <no-reply@localhost>"),
  AI_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  AI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Optional gateway/proxy base URLs (an AI gateway, or a local stand-in in tests). Default: the providers' own APIs.
  ANTHROPIC_BASE_URL: z.url().optional(),
  OPENAI_BASE_URL: z.url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  // Automations (viaSocket) — all optional: Daymark runs fully without them.
  VIASOCKET_ORG_ID: z.string().optional(),
  VIASOCKET_PROJECT_ID: z.string().optional(),
  VIASOCKET_EMBED_SECRET: z.string().optional(),
  // Shared secret the Embarko scheduler sends as `Authorization: Bearer …` to the cron routes.
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Evaluated lazily so `next build` does not need secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid Daymark environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function appUrl(): string {
  return env().BETTER_AUTH_URL.replace(/\/$/, "");
}
