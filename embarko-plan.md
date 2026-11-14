# Daymark on Embarko — adaptation plan (awaiting approval)

Status: **plan only. No application code has been changed for this plan.**
Hosting: Embarko only. Existing app identity is kept: app name `daymark`, app id `cmwg1sx4n01ny12kfzy4qa31o`. No second deployment.

Sources read (latest): quickstart, deploy, data, env-vars, schedules, files, logs, prerequisites, errors, and the "deploy an app without GitHub" guide.
Note: `https://embarko.ai/docs/escalation.md` currently serves a page byte-identical to the "prerequisites" page. It has no separate escalation procedure. If we hit a platform limit we cannot fix, the documented channel is the feedback endpoint (`https://ship.embarko.ai/apps/daymark/customer-query`).

---

## 1. Platform facts that drive the design

| Fact (from docs) | Consequence |
| --- | --- |
| 256 MB memory per app, cannot be raised; one process; no workers | The whole process tree must fit, including `npm start`. No background threads or timers doing real work. |
| No managed database. SQLite file under `DATA_DIR` survives redeploys. Everything else on disk is wiped on redeploy | SQLite is the only database. DB file lives at `$DATA_DIR/daymark.db`. |
| "Data is not backed up" | We must build and test our own backups. |
| Every SQLite file under DATA_DIR contains Embarko bookkeeping tables `_litestream_seq`, `_litestream_lock` | Never use schema-diff tools (`prisma db push`, `migrate dev`). Only apply committed migration files (`migrate deploy`). Never force past a warning. Embarko appears to replicate the file internally, but this is not documented as a backup or restore, so we do not rely on it. |
| Schedules: `embarko.json`, max 5, at least 5 min apart, `GET` with `Authorization: Bearer $CRON_SECRET` (Embarko creates the secret), 5 min per call, `skipped` if the previous run is still going, missed runs are not replayed | Replaces Vercel Cron. Routes must be idempotent and re-derive outstanding work each run. |
| File store: every file gets a **public** URL; quota set by plan | Backups stored there must be client-side encrypted with unguessable names. Never store employee data unencrypted there. |
| `npm start` is how a Node app starts; must bind `0.0.0.0:$PORT` | The `npm` parent process cannot be removed by us (to be confirmed by measurement, see §4). |

## 2. Existing architecture assessment

Live deployment today: build succeeds, status `live`, but `https://daymark.embarko.app` returns 502. The log shows the process stops at `prisma migrate deploy` because there is no PostgreSQL. Env stored: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` (applies on next deploy). Nothing else.

**There is no production data.** The deployed app never started, so no production Postgres exists. The only Postgres is the local sandbox test database (disposable fixtures). So the migration is a clean re-baseline, plus an optional export/import tool for later.

Codebase (Next.js 16, Prisma 7 + `pg` adapter, Better Auth, viaSocket SDK, nodemailer, recharts):

* PostgreSQL-only schema features, validated by running `prisma validate` with the SQLite provider. Exactly **2 blockers**; enums, `Json`, `BigInt`, composite FKs and indexes all validate:
  1. `OrgSettings.workingDays Int[]` (list of primitives unsupported).
  2. `DailyUpdate.updateDate @db.Date` (native type unsupported). Touches 21 files / 108 references; `workingDays` 59 references.
* PostgreSQL-only SQL, 6 sites:
  * `db-errors.ts` — `SELECT … FOR UPDATE` (last-admin safety lock)
  * `throttle.ts` — `ON CONFLICT` + `now()` + `make_interval`
  * `dispatch.ts` ×2 — `UPDATE … RETURNING` claim, `FOR UPDATE SKIP LOCKED` sweep
  * `cron.ts` — `pg_try_advisory_xact_lock`
  * `members.ts` — `mode: "insensitive"` search
* Features that do **not exist yet**: AI summaries, weekly reports, manager review (Phase 3), and daily reminders. "Preserve AI functionality" therefore means "build it to work here"; see Decisions D4/D5.
* Attachments are URL links only (`UpdateAttachment.url`); the app stores no uploaded files, so nothing sensitive goes to the file store.

## 3. PostgreSQL → SQLite migration plan

**Safety / rollback.** Work on a new branch `embarko-sqlite` from `viasocket-automations`; tag the current head `pre-sqlite`. The Postgres migrations are moved to `prisma/migrations-postgres-archive/` (kept, never deleted). The local Postgres test DB is not touched. Rollback = check out `pre-sqlite`. Since no production data exists, there is nothing to restore.

**Schema changes**

| Postgres | SQLite replacement |
| --- | --- |
| `workingDays Int[]` | `workingDays String @default("1,2,3,4,5")` with one typed accessor (`parseWorkingDays`/`formatWorkingDays`), validated 1–7 |
| `updateDate DateTime @db.Date` | `updateDate String` holding `YYYY-MM-DD` in the org timezone. Same meaning as today, sorts correctly, unique `(membershipId, updateDate)` still works |
| enums, `Json`, `BigInt` | unchanged in the schema (Prisma stores enums as text, `Json` as text) |
| composite FKs `(id, organizationId)` | kept. `PRAGMA foreign_keys=ON` is verified at startup and by a test that cross-tenant inserts are rejected by the database |

**Driver.** Prisma 7 SQLite adapter (`@prisma/adapter-better-sqlite3`, needs Node ≥ 22; or `@prisma/adapter-libsql` if the native build fails on Embarko). Decided by the Step 0 diagnostics build, not by assumption. Connection pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`. DB file mode 0600. `DATA_DIR` is never under `public/`, so it is never served.

**SQL rewrites**

* `FOR UPDATE` org lock → SQLite has one writer; membership-changing transactions start with a write (touch the Organization row) so the write lock is taken first. This avoids deferred-lock upgrade failures. Plus an in-process keyed mutex (valid because Embarko runs exactly one process).
* `throttle` → SQLite upsert with `RETURNING`, epoch-millisecond parameters.
* delivery claim → `UPDATE … WHERE id IN (SELECT … LIMIT n) RETURNING` (atomic under the single writer; `SKIP LOCKED` is not needed).
* advisory lock → `JobLock(name, owner, lockedUntil)` table, acquired by an atomic conditional `UPDATE … RETURNING`; expires if a run dies.
* case-insensitive search → verified lowercase comparison (SQLite `LIKE` is only ASCII-insensitive; non-ASCII names need explicit handling and a test).

**Safe migrations.** The start script runs `prisma migrate deploy` only (never `db push`/`migrate dev`). Before applying any pending migration, take a consistent snapshot (`VACUUM INTO`) to `$DATA_DIR/pre-migrate/`; if the migration fails the server does not start and the snapshot is restored automatically. If the Prisma CLI's startup memory peak or boot time is a problem (measured in Step 0), it is replaced by a small in-process migrator that applies the same SQL files and records them in `_prisma_migrations`.

**Optional data tool** (`scripts/export-postgres-to-sqlite.mts`): reads a Postgres DB read-only and writes an SQLite file, preserving ids, `organizationId`, revisions and audit rows. Only used if real Postgres data exists later. It never writes to or deletes the Postgres source.

**Concurrency and transaction tests** (real SQLite file, WAL): 50 parallel submissions across 5 orgs; two simultaneous "remove last admin" attempts (exactly one wins); two simultaneous delivery sweeps (each delivery claimed once); throttle counts exact under parallel load; overlapping cron runs (one runs, one is a no-op); read-while-write; crash-safety of a failed migration.

## 4. Memory optimisation plan

Known measurements (local, production standalone build): `next-server` RSS ≈ 230 MB uncapped, ≈ 220 MB with a 96 MB heap cap; the `npm start` wrapper adds ≈ 62 MB, so ≈ 290 MB total against 256 MB. A 64 MB heap crashed, so arbitrary heap caps are out. These are rough figures from a different machine; what counts is how Embarko meters it.

**Step 0 — measure on the real platform (first, before optimising).** A small diagnostics build, deployed to the same app name, adds one route protected by `CRON_SECRET` that returns: `process.memoryUsage()`, per-process RSS for the whole tree, cgroup `memory.current`/`memory.max` if readable, Node version, `DATA_DIR` writability, and a WAL/SQLite smoke test. This tells us what the 256 MB limit actually counts and whether `npm` is included. All memory decisions below depend on it.

**Profile** (local, same flags as production): empty Next.js app baseline → Daymark idle → after visiting every route → under load (autocannon-style, signed-in sessions, 20 concurrent, dashboards + submissions + automations) → 30-minute soak for leaks, with heap snapshots at start and end.

**Candidate reductions** (each kept only if the numbers justify it):
* SQLite in-process replaces the `pg` pool and its per-connection memory.
* `images: { unoptimized: true }` so the image optimiser (`sharp`, 46 MB on disk) is never loaded.
* Lazy `import()` for the viaSocket SDK, nodemailer and (Phase 3) the AI client; none loaded at boot unless needed.
* Charts (recharts) rendered client-only so the server does not render them.
* Ensure the Next.js build has `output: "standalone"`, and drop unused server dependencies.
* Direct start command with `exec` and no extra wrapper; a heap ceiling is set only as a measured backstop (a value with headroom above the observed peak), never as the fix.
* If `npm` itself is the problem: the docs say Embarko runs `npm start`; whether the wrapper can be slimmed will be decided from Step 0, not guessed.

**Target:** steady-state whole-tree RSS ≤ ~200 MB and peak under load ≤ ~225 MB, with no growth across the soak. If we cannot reach it without removing features, I stop and bring you the options (see D5). I will not claim success from a build.

## 5. Scheduling plan (`embarko.json`)

`embarko.json` at the app's top folder with `appId`. No `node-cron`, no worker. CRON_SECRET is created by Embarko; the routes check it with a timing-safe compare (503 if unset, 401 on mismatch; this already exists).

| Schedule | Cron (UTC) | Route | Does |
| --- | --- | --- | --- |
| tick | `*/15 * * * *` | `/api/cron/tick` | missing-update check, reminders due now, delivery retry sweep, retention |
| backup | `30 2 * * *` | `/api/cron/backup` | nightly encrypted backup (§7) |
| weekly (Phase 3) | `*/30 * * * *` | `/api/cron/weekly-reports` | generates reports due in each org's local time |

That is 3 of the 5 allowed schedules. Each org has its own timezone; a schedule can have only one timezone, so the cron runs in UTC and the route decides per org using `Intl` with the org's IANA zone (DST-safe). Idempotency: a ledger row per `(organization, kind, local date)` with a unique constraint (`ReminderRun`, `MissingCheckRun`), the existing deterministic event ids, and delivery claims. Overlap: the `JobLock` lease plus Embarko's own `skipped`; a run that dies releases by lease expiry. Each run does bounded work (under 60 s, well inside the 5 min limit) and re-derives what is outstanding, so a missed run is picked up by the next one. The existing `/api/cron/integrations` route stays as an alias for compatibility. Run-now test via the schedules/run API after deploy.

## 6. viaSocket and AI

* viaSocket architecture is kept unchanged: org identity `daymark-org-<id>`, server-side secret, encrypted flow URLs, stable event ids, delivery/attempt history, retry/backoff, at-least-once documented. Only the 3 raw-SQL spots change (§3), and `RequestThrottle`/outbox tables move to SQLite. The app still runs with viaSocket unset or failing.
* Needs `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET` in Embarko's environment (not in the upload). The Step 0 build also checks outbound reachability to `flow.sokt.io` and the embed host.
* The Slack real-connection test is still pending your browser authorization; it will be re-run against the deployed Embarko app.
* AI: external APIs only (Anthropic default, OpenAI optional), key from Embarko env. Calls use the plain HTTP API (no heavy SDK in memory), and run inside the request or the schedule route, since there are no background workers. This work is Phase 3 (see D4).

## 7. Security and data reliability

* All secrets in Embarko env (App setup page or the env-vars API); nothing committed; `.env*` stays out of the upload.
* Tenant isolation stays enforced server-side in the policy layer and by composite FKs in the database; the isolation tests run again on SQLite.
* Schedule routes require the bearer secret; the DB file is not under any served path; file mode 0600.
* Audit history is preserved (same tables, append-only revisions).
* **Backups:** nightly consistent snapshot (`VACUUM INTO`), gzip, encrypt with AES-256-GCM using `BACKUP_ENCRYPTION_KEY` from env, upload under a random file name, keep 7 daily + 4 weekly, verify by downloading, decrypting and running `PRAGMA integrity_check`, delete older ones. Because Embarko file links are public, only ciphertext is ever uploaded. Target storage: see D2.
* **Recovery:** the shell cannot touch `DATA_DIR`, so restore is done by the app at boot: setting `RESTORE_FROM=<backup id>` (and the key) once makes the app restore into a fresh file, verify it, swap it in, and ignore the flag afterwards. A restore drill (backup → wipe → restore → compare row counts) is part of testing.

## 8. Testing plan

Run in an Embarko-like local setup (Node 22, SQLite under a temp `DATA_DIR`, `PORT` and `0.0.0.0`), then on the deployed app.

1. Fresh SQLite creation from empty `DATA_DIR`
2. Prisma migrations (clean run, re-run no-op, simulated failing migration is rolled back)
3. Admin authentication (sign-up of first admin, sign-in, sessions, rate limits)
4. Employee authentication
5. Invitation flow (real SMTP capture locally; real SMTP on Embarko if you give credentials)
6. Organization isolation (existing suite + DB-level cross-tenant rejection)
7. Daily work submissions (create/edit window/revisions/missing)
8. AI summaries (Phase 3; needs your API key)
9. Manager dashboard
10. Weekly reports (Phase 3)
11. viaSocket event delivery (fake endpoint locally; real Slack leg needs your authorization)
12. Scheduled reminders (new feature; time-zone and DST cases; duplicate invocation; overlap)
13. Persistence after redeployment (create data, redeploy the same app name, data still there; restore drill)
14. Memory under realistic load (cgroup/RSS on Embarko during a load run + 30-min soak)

I will report each item with real results, not a successful build.

## 9. Implementation order (after approval)

0. Diagnostics build to the existing `daymark` app (platform facts, memory metering, SQLite/WAL, egress).
1. Branch `embarko-sqlite`: schema + SQL rewrites + migrations + tests on SQLite.
2. Memory profile and reductions; re-measure on the platform.
3. `embarko.json` schedules, tick route, reminders, idempotency, locks.
4. Backups, restore-at-boot, drill.
5. viaSocket re-verification; (Phase 3 AI/reports if approved).
6. Full test matrix, deploy to `daymark`, run schedules once, redeploy persistence check, soak.
7. Report; push the branch.

## 10. Decisions needed from you

* **D1.** Replace PostgreSQL with SQLite as the only provider on the new branch (Postgres migrations archived, not deleted)? Recommended. The alternative is a dual-provider setup, which is much more code and memory risk.
* **D2.** Backup target: (A) Embarko file storage, encrypted client-side (all on Embarko, but same provider/account), or (B) also copy to an S3-compatible bucket you own (survives losing the Embarko account; needs your credentials and is storage only, not hosting). Recommended: A now, B optional.
* **D3.** Reminders are a new feature. Channel: email through SMTP (you provide SMTP settings) and/or a viaSocket event? Time and opt-out rules: org-level reminder time only, no per-user settings?
* **D4.** Phase 3 (AI summaries, weekly reports, manager review) does not exist yet. Build it inside this effort (needs your Anthropic API key via App setup), or deploy Phases 1–2 + viaSocket first and add Phase 3 afterwards? Test items 8 and 10 depend on this.
* **D5.** If the app cannot get under the memory target without cutting features, which are you willing to trade (for example simpler charts, no server-rendered dashboards), or should I stop and escalate to Embarko instead?
* **D6.** May I (a) deploy the diagnostics build to the existing `daymark` app, and (b) set the viaSocket values from the local `.env` into Embarko's environment, or would you rather enter them yourself on the App setup page?
