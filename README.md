# Daymark — Make Every Day Count.

Daymark helps companies collect daily work updates, see individual, team and company progress, surface
blockers, tie everyday work to company goals, and review AI-assisted summaries and weekly reports.
It is a multi-company SaaS: every company gets an isolated workspace.

## What it does
* **Daily updates** — one per person per day, with drafts, edit window, revision history, late flag and links; work can be tagged to goals.
* **Transparency by hierarchy** — an organization-wide visibility setting (managers only → team → department → everyone), with the reporting line (up to the CEO) always able to see downward. Blockers can be masked; the model is enforced on the server (`src/server/policy`).
* **Goals (OKRs)** — company → department → team → person objectives with key results, KPIs and tasks; weighted roll-up, health (on track / at risk / off track), owners, audit trail. Work is linked to goals both ways.
* **Org chart, Compare and Profiles** — reporting tree for 100–300 people, peer / team-lead / mentor comparison, and per-person profiles (consistency, blockers, goal contribution). Progress is self-reported and labelled as such.
* **Reminders** — one organization-wide time (timezone and working days aware), delivered through viaSocket (e.g. to Slack) — optional.
* **AI summaries, weekly reports and manager review** — Anthropic first, provider-independent; off until an admin gives consent in Settings; every generated report is a draft that a person approves, edits or rejects before it is published.
* **Automations (viaSocket)** — optional outbound events for the company's own apps.
* **Backups** — nightly encrypted backups to Embarko storage with a restore drill (see below).

**Status:** all of the above is implemented and tested (integration, browser, and a deployed smoke test). Known limits are listed in [docs/embarko-diagnostics-report.md](docs/embarko-diagnostics-report.md).

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · SQLite (better-sqlite3) · Prisma 7 · Better Auth · Zod · Nodemailer (SMTP) · Vitest · Playwright

## Architecture
```
src/
  app/(public)/   login, onboarding, invite/[token], forgot-password, reset-password, no-access
  app/(app)/      dashboard, employees, settings   (role-aware)
  app/api/        thin JSON route handlers (auth allowlist, onboarding, invitations, employees, teams, ...)
  server/
    auth/         Better Auth config, request context (session -> active membership)
    policy/       THE place for role + manager-scope rules
    services/     business logic (organization, structure, members, invitations, overview, updates, team-updates)
    channels/     ingest.ts — the single entry point every submission channel goes through
    email/        SMTP mailer + Daymark email templates
    http.ts       route wrapper: origin check, auth, rate limit, uniform errors
  components/     ui primitives, brand (logo), layout shell
prisma/           schema + migrations
tests/            Vitest integration tests (real SQLite file)
e2e/              Playwright end-to-end tests (real servers, real SMTP capture)
```

### Tenancy & security model
* `User` is a global identity (Better Auth). `Membership` links a user to an organization with a role, so one person can belong to several organizations later with **no schema change**. Today the active membership is the oldest active one (or the `daymark_org` cookie if set).
* Every domain table has `organizationId`; cross-table references are **composite foreign keys** `(id, organizationId)`, so the database itself rejects cross-company references.
* The organization, role and ids always come from the server-side session — never from the request body. Out-of-scope records return **404**, not 403, so existence isn't revealed.
* Roles: ADMIN (whole organization), MANAGER (managed teams + direct reports + explicit `ManagerTeamAccess` grants), EMPLOYEE (self). Rules live in `src/server/policy`.
* No public registration: user creation is only possible inside server code (onboarding / invitation acceptance); `/api/auth/sign-up/*` is not exposed and a database hook rejects any other creation path.
* Passwords are hashed by Better Auth (scrypt) in the auth `Account` table. Invitation tokens are stored only as SHA-256 hashes.
* Rate limits: Better Auth's (database-backed) limiter on sign-in / reset; a database-backed limiter on onboarding and invitation acceptance.
* Audit log rows are written in the same transaction as each important change.

## Setup
Requirements: Node 22+. The database is a single SQLite file (no database server).

```bash
npm install
cp .env.example .env        # then set BETTER_AUTH_SECRET (openssl rand -base64 32); the database file is created in ./data
node scripts/safe-migrate.mjs   # apply migrations safely (snapshot first, restore on failure)
npm run dev                 # http://localhost:3000
```
Open `/onboarding` to create the first company workspace.

### Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `DATA_DIR` | no | Folder for the SQLite file (`daymark.db`). Embarko sets it; locally it defaults to `./data`. |
| `DATABASE_URL` | no | Optional `file:` override of the database path (tests, local) |
| `BETTER_AUTH_SECRET` | yes | ≥32 chars. Signs sessions/tokens. |
| `BETTER_AUTH_URL` | yes | Public base URL, no trailing slash. Must match the browser origin. |
| `NEXT_PUBLIC_APP_URL` | yes | Same public URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | Email. **Without `SMTP_HOST`**: invitation links are shown to the admin to copy, and Forgot password says email isn't configured. Nothing pretends to send. |
| `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | no | AI summaries and weekly reports. Without a key the AI features report "not configured" and nothing is sent anywhere. Even with a key, an admin must enable AI (and accept the disclosure) in Settings. |
| `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` | no | Optional gateway / stand-in URL (tests use a local fake). |
| `CRON_SECRET` | yes (scheduler) | Created by Embarko. The `/api/cron/*` routes refuse to run without it. |
| `BACKUP_ENCRYPTION_KEY` | yes (backups) | ≥32 characters, **separate from every other secret**. Backups are AES-encrypted before they leave the app, because Embarko file URLs are public. **Keep a copy outside Embarko: without it a backup cannot be restored.** |
| `RESTORE_FROM` | no | Filename of a backup (`dmbk-….gz`) to restore at the next start. Remove it afterwards (the restore is skipped once the file has been applied, but leave no flag behind). |
| `RESTORE_ON_EMPTY` | no | `true`: if the database file is missing at boot, restore the newest backup automatically. |
| `TRUSTED_PROXY_HOPS` | no | Default `1`. How many platform proxies sit in front of the app (client-IP detection for rate limits). |
| `KEEP_ALIVE_TIMEOUT` | no | Default `65000` ms (set by `scripts/start.mjs`); must exceed the platform proxy's idle timeout. |
| `NODE_OPTIONS` | no | On Embarko set `--max-old-space-size=160` to keep the process inside the 256 MB limit. |
| `STORAGE_URL`, `STORAGE_TOKEN`, `APP_NAME` | injected | Provided by Embarko for file storage (backups). |

## Tests
```bash
npm run lint                       # type-check
npm test                           # Vitest integration tests (fresh SQLite file per run, see .env.test)
npm run test:e2e                   # builds, then Playwright against two real servers
```
Copy `.env.test.example` to `.env.test` (it points at `.tmp-sqlite/test.db`, recreated from the committed migrations on every run). If Playwright's own browser isn't installed, set
`PW_CHROMIUM_PATH` to an installed Chromium binary.

## Database and migrations (SQLite)
* The only database provider is SQLite (`better-sqlite3` through Prisma's driver adapter). WAL mode, foreign keys on; the composite `(id, organizationId)` keys still make the database itself reject cross-organization references.
* Migrations are committed SQL files under `prisma/migrations`, applied only with `prisma migrate deploy` (via `scripts/safe-migrate.mjs`). Never use `prisma db push` or `migrate dev` against a deployed database: Embarko keeps its own bookkeeping tables in the file.
* `scripts/safe-migrate.mjs` snapshots the database (`VACUUM INTO`) before applying pending migrations and restores the snapshot if one fails, so a bad migration cannot leave a half-migrated file.
* The earlier PostgreSQL migrations are kept, unused, in `prisma/migrations-postgres-archive/` (git tag `pre-sqlite` is the last PostgreSQL version).
* SQLite specifics handled in code: working days are stored as `"1,2,3,4,5"` (`src/lib/working-days.ts`); an update's day is a `YYYY-MM-DD` string; PostgreSQL advisory locks became a lease table (`JobLock`); name/email search is case-insensitive for ASCII only.

## Backups and restore
* Embarko does not back up `DATA_DIR`, so Daymark does: nightly (`/api/cron/backup`) it takes a consistent snapshot (`VACUUM INTO`), checks integrity, compresses and encrypts it with `BACKUP_ENCRYPTION_KEY`, uploads it to Embarko storage, **downloads it again and verifies it**, and prunes old ones. Uploaded files are public URLs, but they contain only ciphertext.
* Restore: set `RESTORE_FROM=<filename>` and restart; the app restores before it starts serving, keeps the replaced database as a snapshot, and refuses a file that fails decryption or integrity checks. Then remove the variable. Drilled on the live platform: data created before the backup came back, data created after it was rolled back, and the restore did not repeat on the next restart.
* Losing `BACKUP_ENCRYPTION_KEY` makes every backup unreadable — store a copy somewhere other than Embarko.

## Deploying to Embarko
Daymark is hosted only on Embarko (one process, 256 MB, SQLite under `DATA_DIR`). Findings, measurements and limitations: [docs/embarko-diagnostics-report.md](docs/embarko-diagnostics-report.md); the plan: [embarko-plan.md](embarko-plan.md).

* Upload the source (without `node_modules`, `.next`, `.env*`, tests). Embarko runs `npm run build` (`prisma generate`, `next build`, standalone copy) and `npm start` (`scripts/start.mjs`: safe migration, then the single Next.js process).
* `embarko.json` holds the app id and the scheduler entries (`CRON_SECRET` is created by Embarko; scheduled routes check it).
* Secrets go in Embarko's environment (App setup), never in the upload: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `BACKUP_ENCRYPTION_KEY`, optional `VIASOCKET_*`, `SMTP_*`, AI keys.
* `TRUSTED_PROXY_HOPS` (default `1`): how many proxies of the platform sit in front of the app; used to find the real client address for rate limits without trusting spoofable headers.

## Daily updates (Phase 2)
* **Update model:** one `DailyUpdate` per person per day (`@@unique(membershipId, updateDate)`). Content is stored as free-text entries per section (`UpdateItem`: worked on, completed, pending, blockers, next priorities), so a single natural-language paragraph and a long list are both valid. Links are stored in `UpdateAttachment` (http/https only; file uploads can reuse the table later).
* **Statuses:** `DRAFT` → `SUBMITTED` → `EDITED`. Drafts are private to the author. `firstSubmittedAt` (the original submission time) and `submittedLate` are fixed at first submission and never overwritten.
* **Revision history:** `UpdateRevision` is append-only. Revision 1 is the original submission; every later edit adds a revision with a full snapshot and the status at that time. Unchanged saves create no revision.
* **Edit window:** configurable in Settings (hours, `0` = no edits), measured from the original submission and enforced by the server.
* **Dates:** an update's day is the organization's calendar day (timezone-aware). Employees can add updates for today or up to 7 days back, never the future. "Late" = submitted after the day's cut-off in the organization's timezone.
* **Manager / admin view:** `/team-updates` — overview cards, per-day trend, filters (date range ≤ 31 days, department, team, employee, status, blockers), "not submitted" rows (working days only, never before a person joined), full submission detail with version history, and the employees' own recent blockers / pending / completed entries. Managers only see their managed teams, direct reports and explicitly granted teams; out-of-scope updates return 404. Drafts are never visible to anyone but the author.
* **Channels:** every channel calls `server/channels/ingest.ts#ingestUpdate`, which writes the same record with `source` set (`DASHBOARD` today; `SLACK`, `EMAIL`, `WHATSAPP`, `EXTERNAL_FORM` reserved). Only the dashboard exists; no other channel is implemented. The dashboard API fixes the channel server-side.
* **Reported ≠ verified:** the UI labels everything as the employee's own report.

## Automations (viaSocket) — optional

Company admins can connect their own apps (Slack, email, …) and decide what happens when something occurs in
Daymark, from the **Automations** page, which embeds viaSocket's builder. **Daymark works fully without it** and
nothing in Daymark depends on viaSocket being reachable.

* **What's sent:** five outbound events — *Daily Update Submitted*, *Employee Reports a Blocker*, *Daily Update
  Missing*, *Reminder*, *Report Published* (a link only, never the report text) — with minimal payloads. Full contract, field-by-field sources and delivery guarantees:
  [docs/automation-events.md](docs/automation-events.md). Daymark actions and any inbound API are deliberately not part of this.
* **Isolation:** each organization is one viaSocket identity, `daymark-org-<organizationId>`, derived on the server
  from the session. Flow URLs (which run the company's connected apps) are encrypted at rest and never sent to the browser.
* **Access:** Admins only by default; an admin can authorize managers; employees never.
* **Reliability:** stable event IDs, unique event keys (duplicate-safe), one delivery row per event and flow, an
  attempt log (retry history), 8 s timeout, backoff retries, lease-based claiming, a lease
  lock around the cron pass. Delivery is **at-least-once**: duplicates are possible, so automations should
  dedupe on `eventId`.

### Configuration
| Variable | Notes |
|---|---|
| `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET` | From viaSocket (Integrations → your embed → Install Code). Server-side only. The secret also derives the key that encrypts stored flow URLs: rotating it requires **Refresh** on the Automations page and re-linking events. |
| `CRON_SECRET` | ≥16 random characters. Vercel sends it as `Authorization: Bearer …` to `/api/cron/integrations`. The route refuses to run without it. |

### Scheduler (Embarko)
`embarko.json` registers three schedules; the platform calls each route with `GET` and `Authorization: Bearer $CRON_SECRET`:

| Schedule | Route | Does |
|---|---|---|
| `*/15 * * * *` | `/api/cron/integrations` | reminders → missing-update detection → delivery / retry sweep → retention purge |
| `30 2 * * *` | `/api/cron/backup` | encrypted, verified backup to Embarko storage (keeps the newest few) |
| `*/30 * * * *` | `/api/cron/weekly-reports` | drafts weekly reports and daily summaries that are due (only for organizations with AI enabled and consented; budgeted per run) |

* Delivery by the scheduler is best-effort: a run can be skipped or arrive twice. The job is built for that: idempotent event keys, claim leases, a lease lock (`JobLock`) so overlapping runs do not double-work, and a pass that re-derives what is outstanding each time.
* Reminders and the missing-update cut-off follow the organization's timezone and working days, so a run a few minutes late only delays them slightly.

### Tests
`npm test` covers the delivery machinery (idempotency, races, retries, history, isolation) and
`npm run test:e2e` the Automations UI/permissions with dummy viaSocket values and no network. Real-connection tests
(`tests/live/`) need your own viaSocket keys and a connected Slack test account and are run by hand.

## Remaining / known limitations
* Real-provider AI output has been tested against a fake provider and a local stand-in only; try it once with your own key (Settings → AI → test) before relying on it.
* Real Slack delivery from the deployed app needs a connected Slack account in viaSocket and has not been exercised end to end.
* SQLite is single-writer; name/email search is case-insensitive for ASCII only.
* Goal progress and update content are self-reported and labelled as such; nothing is verified automatically.
* Channels other than the dashboard (Slack / email / WhatsApp input), file uploads and subscription plans are not built.
* Opening visibility to the whole company is a policy decision: tell staff (and review the AI disclosure) before turning it on.
