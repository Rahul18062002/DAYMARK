# Daymark on Embarko — diagnostics and database-migration report

Branch `embarko-sqlite` (git tag `pre-sqlite` = last PostgreSQL version). App: `daymark` on Embarko (same name and app id throughout; no second deployment).
Measurements below were taken on the real platform unless marked "local".

## 1. What the platform really is

| Item | Measured |
| --- | --- |
| Runtime | Node v22.23.4, linux x64, 4 vCPU, kernel 6.8; process tree is `npm run start` → `sh -c` → our `node` |
| Memory limit | cgroup `memory.max` = 256 MiB, swap 0. **Enforcement follows the cgroup (`memory.current`: anonymous + page cache + kernel), not summed process RSS.** Proof: a test process held a 345 MB RSS tree (240 MB cgroup) and was not killed. The `npm` wrapper shows 59 MB RSS but only ~11 MB anonymous. |
| Disk / `DATA_DIR` | writable, 36 GB free of 102 GB; survives redeploys (marker file and the SQLite database both survived two redeploys) |
| SQLite | `better-sqlite3` 13.1.1 installs and loads during Embarko's own build (SQLite 3.53); WAL, foreign keys, `VACUUM INTO` work. `@libsql/client` and `node:sqlite` also load (not needed). |
| Platform bookkeeping tables | **Embarko adds `_litestream_lock` and `_litestream_seq` to `daymark.db`** (confirmed on the live database; the throw-away test files did not get them). It appears to replicate SQLite files, but documents no backup or restore, so we still build our own. Our migrations never diff the schema; `migrate deploy` ran fine with the tables present (`database is up to date`). |
| Outbound network | reachable: `flow.sokt.io`, `embedfrontend.viasocket.com`, `api.anthropic.com`, `api.openai.com`, GitHub, npm |
| File storage | works from inside the app (upload → public URL → download identical → delete). **Only allowed extensions** (png jpg jpeg gif webp avif ico pdf txt md csv json zip gz mp3 mp4 webm wav ogg woff woff2 ttf). Every file is public. Quota 500 MB, 25 MB per file. |
| Scheduler | `embarko.json` schedule registered; ran by itself on time (`outcome: ok`); "run now" ok; `CRON_SECRET` is injected by Embarko and checked by the route |
| Client address | The proxy **appends** to `X-Forwarded-For` (so a client can prepend anything) and **passes `X-Real-IP` through unchanged** (so it is spoofable). The real client is the entry before the platform's last hop. |

## 2. Database migration (PostgreSQL → SQLite)

* SQLite is the only provider. PostgreSQL migrations are archived in `prisma/migrations-postgres-archive/` (not deleted). A fresh baseline migration was generated. No production PostgreSQL database existed (the earlier Embarko deploy never started), and the local test PostgreSQL was not touched.
* Schema changes: `workingDays Int[]` → comma-separated text (`src/lib/working-days.ts`); `updateDate @db.Date` → `YYYY-MM-DD` string; new `JobLock` table. Enums, `Json`, `BigInt` and the composite `(id, organizationId)` foreign keys are unchanged, so the database itself still rejects cross-organization references (tested).
* Code changes: advisory lock → lease table (`src/server/job-lock.ts`); org row lock → write-first transaction; rate limiter, delivery claim and sweep rewritten without PostgreSQL-only SQL; `SKIP LOCKED`, `createMany(skipDuplicates)` and `mode: insensitive` removed. Better Auth uses the `sqlite` adapter.
* Safe migrations: `scripts/safe-migrate.mjs` runs `prisma migrate deploy` only (never `db push`/`migrate dev`); it snapshots the database (`VACUUM INTO`, integrity-checked, last 5 kept) before pending migrations and restores it if one fails. Tested with a deliberately broken migration (half-applied table removed, data intact, integrity ok). On the platform the second boot logs `database is up to date`.

## 3. Test results

| Check | Result |
| --- | --- |
| Integration tests (real SQLite file) | **233 passed** (14 files: tenancy and visibility, goals and roll-up math, insights, a 300-person scale test, backup/restore, AI layer, SQLite durability, safe migration incl. a real second process holding the lock, password hashing, client-IP, automations) |
| Browser tests (Playwright, two real servers) | **54 passed** (desktop and phone: updates, goals, reports, automations, permissions) |
| Concurrency | 40 parallel rate-limit calls → exactly 25 pass / 15 refused; parallel submissions in several organizations all land; 8 parallel double-submits → exactly 1; two admins demoting each other at once → exactly 1 succeeds; 6 workers racing one delivery → 1 send; concurrent sweeps → each delivery once; lease exclusive under 12 concurrent acquirers; crashed lease expires |
| Deployed smoke test (`tests/live/10-embarko-smoke.mts`, 34 checks) | all functional checks pass: onboarding, invitations, sign-in rules, isolation between organizations (404 / nothing visible), scheduler routes refuse missing/wrong secret, visibility and hierarchy, goals with weighted roll-up, org chart, compare / insights, reports pages. The only check that can fail is "no server errors" when the sandbox network resets a connection (0.06–0.3% of requests in load runs; the app log shows no error). |
| Backup + restore drill on the platform (repeated with the final schema) | nightly job: encrypted, uploaded, downloaded back and verified (≈180 KB). Restore via `RESTORE_FROM`: an organization created before the backup signs in afterwards; one created after it does not (rolled back); the flag removed → no second restore; `[migrate] database is up to date`. |
| Migrations on the platform | six migrations applied on the live database; a redeploy that overlaps the old instance waits for the database lock (retries, never restores on a lock) |
| Persistence across redeploys | accounts and data survive redeploys |
| Scheduler | the three schedules (integrations every 15 min, backup nightly, weekly reports every 30 min) ran by themselves and on demand with `outcome: ok`; weekly reports answer `AI is not configured` until a key is added |
| viaSocket on the platform | credentials present server-side; embed token works for an admin; Automations page 200. **Real Slack delivery from Embarko is still untested** (needs your browser authorization) |
| AI | real-provider path tested against a fake provider and a local Anthropic-compatible stand-in (validation, injection handling, consent, review, idempotency, budgets). **Not yet tried against the real Anthropic API** (needs your key). |

## 4. Memory (platform, cgroup)

Load = 12 concurrent signed-in users requesting server-rendered pages non-stop (~25 requests/s, far above a small team's use).

| Build / setting | idle | after sign-ups, invites, updates (peak) | under load (peak) | result |
| --- | --- | --- | --- | --- |
| first SQLite build | 78–88 MB | 217–233 MB | 237 MB | works but only 7% headroom |
| + `MALLOC_ARENA_MAX=2` | 58 | 213 | 231 | no effect |
| + `MALLOC_MMAP_THRESHOLD_` | 55 | 195 | 227 | no effect |
| + heap flags (`--max-old-space-size=128 --max-semi-space-size=4`) | **171** | – | – | made idle much worse; rejected |
| + `--max-old-space-size=112` | 63 | 234 | **≥ 255 → OOM restart, 5 errors** | rejected |
| **final**: Prisma small compiler + one-at-a-time scrypt | 60–88 | **136–142** | **173–179** (90–150 s) | 0 errors |
| final, 5-minute soak | 170→ | 183 | **peak 189, plateau ~187, back to 154 afterwards** | no leak; ~26% headroom |

### Final memory result (full feature set: visibility, goals, compare, reminders, backups, AI layer)

| Configuration | idle | peak during heavy synthetic load | note |
| --- | --- | --- | --- |
| no V8 cap | ≈ 62 MB | 208 MB (~81%) | borderline |
| **`NODE_OPTIONS=--max-old-space-size=160` (chosen, live)** | **62 MB** | **201 MB** in a 5-minute soak (12 concurrent users, ≈5,500 requests, plateau ≈ 198 MB) | back to ≈ 159 MB 45 s after the load, no growth over time; ≈ 21% headroom below the 256 MB limit |

The load is far above a normal team's use, so everyday memory is lower (idle ≈ 62 MB; after a day of functional tests ≈ 135 MB). If a real workload ever hits the limit the platform restarts the app and the database is unharmed (WAL), but the headroom is the thing to watch: we did **not** remove any core feature to get here. Earlier rows of the table above (the 112 MB cap, etc.) were measured before the full feature set existed.

Where the memory went (local profiling, `smaps`/V8 stats):
* Prisma's WebAssembly query compiler: ~55–75 MB. The `compilerBuild = "small"` generator option saves ~30 MB.
* Password hashing: Better Auth's scrypt needs ~32 MiB per hash and ran up to 4 in parallel (~130 MiB transient). `src/server/auth/password.ts` keeps the identical algorithm and stored format (verified compatible in both directions with Better Auth's own functions) but runs one hash at a time with a bounded queue. Peak after sign-ups fell from 233 to 136 MB.
* V8 old-space garbage: with no cap, a fast machine grew to 569 MB anonymous in 30 s of load. Caps do bound it locally (193 MB at 96 MB cap), but on the platform the non-heap part dominated, so we kept no cap and fixed the real causes above instead.
* Node's default 5-second keep-alive closed connections the platform proxy reuses: ~0.6% of requests failed with socket resets. `KEEP_ALIVE_TIMEOUT=65000` (set in `scripts/start.mjs`) → 0 errors in 3,803 requests.

## 5. Security findings fixed along the way

* `X-Real-IP` and the head of `X-Forwarded-For` are client-controlled on this platform (observed: a client-sent `X-Real-IP` comes back unchanged; a spoofed `X-Forwarded-For` arrives as `spoof, <real client>, <platform hop>`). The old code (and Better Auth's default) would have let a client dodge or poison per-IP rate limits. Now `src/server/client-ip.ts` takes the entry just before the platform hop (`TRUSTED_PROXY_HOPS`, default 1), ignores anything prepended, and hands Better Auth a header we overwrite (`x-daymark-client-ip`). Unit-tested; on the live app the sign-in limit (10/min) triggers a 429 over a single connection and the old "could not determine a client IP" warning is gone. A full spoof test from the test sandbox is not possible because its outbound address rotates per request.
* Next.js copies a local `.env` into `.next/standalone`; `scripts/postbuild.mjs` now deletes it. The upload excludes `.env*`, `.next`, tests and archives (verified: 0 env files in the tarball).

## 6. Remaining limitations and actions for you

**Done since the first report:** encrypted backups with a restore drill, visibility/hierarchy/org chart, goals (OKR + KPIs + tasks), work-to-goal linking, compare and profiles, scale work (a quarter of data for 300 people), reminders, AI summaries / weekly reports / manager review, the diagnostics route and `DIAG_TOKEN` are removed.

**Your actions**
* Set your own production `BACKUP_ENCRYPTION_KEY` in Embarko (App setup) and keep a copy outside Embarko. The key used in testing is a test key, and the test backups in Embarko storage were made with it (delete them from the storage page once your own key is set and a new backup exists).
* Add `ANTHROPIC_API_KEY` in Embarko's App setup (never in chat), then use Settings → AI → test once, and approve one real report.
* Rotate the credentials that appeared in chat or were used in testing: the Embarko deploy key (create a new one at embarko.ai/app/tokens, revoke the old one), and the viaSocket embed secret (then update `VIASOCKET_EMBED_SECRET` in Embarko). `BETTER_AUTH_SECRET` was generated server-side and never displayed.
* Run the Slack end-to-end test with your own authorization (`tests/live/02-real-delivery.mts` and `05-slack.mts` still use PostgreSQL SQL and must be ported first).
* Tell staff before opening visibility company-wide and review the AI disclosure shown in Settings.

**Limits that remain**
* The platform gives no backups of its own; ours are nightly (restore loses at most the changes since the last one). Embarko file URLs are public, so only ciphertext is uploaded.
* Memory: ≈ 21% headroom under heavy synthetic load (see §4). A single process with a 256 MB limit is the ceiling for this design; very large imports or many simultaneous AI jobs would need the platform's memory raised.
* Occasional connection resets (0.06–0.3%) appear in synthetic load tests between the test sandbox and the platform; no server error accompanies them.
* On a redeploy the new instance can wait up to about a minute for the old instance to release the database (it retries; the platform restarts it if needed).
* SQLite is single-writer; case-insensitive search is ASCII only.
* Progress and update content are self-reported and labelled so; nothing is auto-verified.
* The sign-in rate limit is per client address (10/min); behind a shared office address, many people signing in at once can be throttled briefly. A full header-spoofing test could not be run from the test sandbox (its address rotates per request); the logic is unit-tested.
