# Daymark — Make Every Day Count.

Daymark helps companies collect daily work updates, understand individual and team progress,
surface blockers, and (from Phase 3) generate AI summaries and weekly reports.
It is a multi-company SaaS: every company gets an isolated workspace.

**Status: Phase 1 (Foundation) and Phase 2 (Daily Updates) complete.** AI summaries and weekly reports (Phase 3) and the finalization pass (Phase 4) are not built yet.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL · Prisma 7 · Better Auth · Zod · Nodemailer (SMTP) · Vitest · Playwright

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
tests/            Vitest integration tests (real PostgreSQL)
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
| `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Phase 3 | Validated but unused until Phase 3 |

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

## Deploying to Embarko
Deployment notes are being finalised in a later step (diagnostics, memory and schedules are being verified on the platform first). See `embarko-plan.md`.

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

* **What's sent:** three outbound events — *Daily Update Submitted*, *Employee Reports a Blocker*, *Daily Update
  Missing* — with minimal payloads. Full contract, field-by-field sources and delivery guarantees:
  [docs/automation-events.md](docs/automation-events.md). Weekly-report events come with Phase 3; Daymark actions
  and any inbound API are deliberately not part of this.
* **Isolation:** each organization is one viaSocket identity, `daymark-org-<organizationId>`, derived on the server
  from the session. Flow URLs (which run the company's connected apps) are encrypted at rest and never sent to the browser.
* **Access:** Admins only by default; an admin can authorize managers; employees never.
* **Reliability:** stable event IDs, unique event keys (duplicate-safe), one delivery row per event and flow, an
  attempt log (retry history), 8 s timeout, backoff retries, lease-based claiming with `FOR UPDATE SKIP LOCKED`, an
  advisory lock around the cron pass. Delivery is **at-least-once**: duplicates are possible, so automations should
  dedupe on `eventId`.

### Configuration
| Variable | Notes |
|---|---|
| `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET` | From viaSocket (Integrations → your embed → Install Code). Server-side only. The secret also derives the key that encrypts stored flow URLs: rotating it requires **Refresh** on the Automations page and re-linking events. |
| `CRON_SECRET` | ≥16 random characters. Vercel sends it as `Authorization: Bearer …` to `/api/cron/integrations`. The route refuses to run without it. |

### Vercel Cron — schedule and plan limits
`vercel.json` runs `/api/cron/integrations` every **15 minutes** (`*/15 * * * *`, UTC). It detects missing updates,
delivers/retries everything due, and applies retention. Checked against Vercel's documentation (Cron Jobs: usage &
pricing, last updated 2026-07-15; Schedules: limits):

| Plan | Legacy `crons` (what `vercel.json` uses) | Newer `schedules` property (public beta) |
|---|---|---|
| **Pro / Enterprise** | every minute is allowed → **15-minute schedule works** | every minute (jitter 1–15 min) |
| **Hobby** | **once per day only** (±59 min); a more frequent expression **fails the deployment** | at most every 15 minutes, always a 15-minute jitter window; 5,000 runs per billing period |

* **A Pro (or Enterprise) plan is required for the shipped configuration.** On Hobby, either switch the entry to the
  `schedules` form (same route, `"requestMethod": "GET"`, `CRON_SECRET` unchanged — Vercel documents this as a
  configuration-only migration; remove the `crons` entry so it doesn't run twice) or accept daily runs.
* **Timing is approximate:** schedules start within a jitter window, so a reminder can fire up to ~15 min after the
  15-minute boundary that follows the cut-off. Retries are picked up by the same sweep.
* Vercel's cron delivery is best-effort: a run can be skipped or delivered twice, runs can overlap, and Vercel never
  retries a failed run, never follows redirects, and only invokes the production deployment. The job is built for this:
  idempotent event keys, claim leases, an advisory lock, and a pass that re-derives what's outstanding each time. On a
  once-a-day schedule, first delivery attempts still happen immediately (in the background after the action); only
  retries and missing-update reminders are delayed.

### Tests
`npm test` covers the delivery machinery (idempotency, races, retries, history, isolation) and
`npm run test:e2e` the Automations UI/permissions with dummy viaSocket values and no network. Real-connection tests
(`tests/live/`) need your own viaSocket keys and a connected Slack test account and are run by hand.

## Phase 1 checklist
- [x] Project setup, Prisma schema + migrations, tenant-safe composite foreign keys
- [x] Better Auth (email + password), sessions, forgot / reset password (SMTP)
- [x] Organization onboarding (creates org, settings, first admin)
- [x] Invitations (SMTP email or copyable link, resend, revoke, single-use, 7-day expiry); existing-account acceptance for future multi-org
- [x] Roles & server-side policy; manager scope (+ explicit team access grants)
- [x] Employee management (role, job title, team, department, manager, deactivate / reactivate with session revocation, last-admin protection, no reporting loops)
- [x] Departments & teams; update-schedule settings; organization profile
- [x] Role-specific dashboards (real data), role-aware navigation
- [x] Audit log writes + admin activity feed
- [x] Daymark branding (logo, favicon, light/dark), responsive layout, empty / loading / error states

## Phase 2 checklist
- [x] Schema + migration (updates, items, links, revisions) with tenant-safe composite foreign keys
- [x] Draft / submit / edit with edit window, late flag, one-per-day, backdating limit
- [x] Employee dashboard (today's status, week overview, recent updates), My Updates, update form with multiple entries and links
- [x] Manager/admin Team Updates: cards, trend chart, filters, table, detail, version history, raw highlights
- [x] Source-channel ingest abstraction

## Remaining
- Phase 3: Reports navigation, AI summaries (an AI-summary column in the team table arrives with them) (Anthropic default, OpenAI supported), weekly reports, manager review
- Phase 4: hardening pass, full E2E for updates/AI/reports, deployment polish
- Later: viaSocket Embed integration, Slack / email / WhatsApp channels, file uploads, subscription plans
- Known follow-ups: Team Updates caps at 500 rows (no pagination yet); admins and managers are counted among people expected to submit; the 7-day backdating limit is a constant, not a setting; email-ownership verification at onboarding; admin-initiated password reset when SMTP is unavailable; audit-log viewer page; card layout for the Employees table on narrow phones
