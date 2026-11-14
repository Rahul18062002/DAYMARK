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
| Platform bookkeeping tables | Embarko documents `_litestream_seq` / `_litestream_lock` in SQLite files; none appeared in our test files. Our migration path never diffs the schema, so it is safe either way. |
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
| Integration tests (real SQLite file) | **126 passed** (108 earlier + SQLite durability/WAL/FK, concurrency, rollback, safe-migration, password hashing, client-IP) |
| Browser tests (Playwright, two real servers) | **37 passed** |
| Concurrency | 40 parallel rate-limit calls → exactly 25 pass / 15 refused; 12 parallel submissions in 3 organizations all land; 8 parallel double-submits → exactly 1; two admins demoting each other at once → exactly 1 succeeds, 1 admin remains; 6 workers racing one delivery → 1 send; 3 concurrent sweeps over 30 deliveries → each once; lease exclusive under 12 concurrent acquirers; crashed lease expires |
| Deployed smoke test (`tests/live/10-embarko-smoke.mts`, 23 checks) | **23 passed**: onboarding, 7 invitations accepted, employee and manager sign-in, wrong password refused, unauthenticated API refused, 5 parallel submissions, duplicate-day 409, manager sees team, employee refused the team view, **other organization gets 404 / sees nothing**, scheduler route refuses missing/wrong secret |
| Persistence across redeploys | an account created before a redeploy signed in after it; data and `daymark.db` intact |
| Scheduler | ran automatically and on demand, HTTP 200 in ~100 ms |
| viaSocket on the platform | credentials present server-side; token endpoint returns an embed token for an admin; Automations page 200. **Real Slack delivery from Embarko is still untested** (needs your browser authorization) |

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

Where the memory went (local profiling, `smaps`/V8 stats):
* Prisma's WebAssembly query compiler: ~55–75 MB. The `compilerBuild = "small"` generator option saves ~30 MB.
* Password hashing: Better Auth's scrypt needs ~32 MiB per hash and ran up to 4 in parallel (~130 MiB transient). `src/server/auth/password.ts` keeps the identical algorithm and stored format (verified compatible in both directions with Better Auth's own functions) but runs one hash at a time with a bounded queue. Peak after sign-ups fell from 233 to 136 MB.
* V8 old-space garbage: with no cap, a fast machine grew to 569 MB anonymous in 30 s of load. Caps do bound it locally (193 MB at 96 MB cap), but on the platform the non-heap part dominated, so we kept no cap and fixed the real causes above instead.
* Node's default 5-second keep-alive closed connections the platform proxy reuses: ~0.6% of requests failed with socket resets. `KEEP_ALIVE_TIMEOUT=65000` (set in `scripts/start.mjs`) → 0 errors in 3,803 requests.

## 5. Security findings fixed along the way

* `X-Real-IP` and the head of `X-Forwarded-For` are client-controlled on this platform. The old code (and Better Auth's default) would have let a client dodge or poison per-IP rate limits. Now `src/server/client-ip.ts` takes the entry just before the platform hop (`TRUSTED_PROXY_HOPS`, default 1), ignores anything prepended, and hands Better Auth a header we overwrite (`x-daymark-client-ip`). Unit-tested.
* Next.js copies a local `.env` into `.next/standalone`; `scripts/postbuild.mjs` now deletes it. The upload excludes `.env*`, `.next`, tests and archives (verified: 0 env files in the tarball).

## 6. Remaining limitations / not done yet

* **Not built yet** (next stages, per the approved plan): encrypted backups to Embarko storage + restore drill; reminders and the tick/backup/weekly schedules; AI summaries, weekly reports, manager review; further memory work beyond the above (current headroom is ~26% under heavy synthetic load).
* The platform gives **no backups** of `DATA_DIR`; until our backup job exists, the database is a single copy.
* Embarko file URLs are public: backups must be encrypted before upload (planned).
* SQLite is single-writer; case-insensitive search is ASCII only.
* `tests/live/02-real-delivery.mts` and `05-slack.mts` still use `psql`/PostgreSQL date SQL and must be ported before the Slack run.
* The temporary diagnostics route `/api/diag/memory` (404 unless `DIAG_TOKEN` is set) and `DIAG_TOKEN` must be removed before production.
* **Credentials to rotate** (they appeared in chat or were used during testing): the Embarko deploy key (create a new one at embarko.ai/app/tokens, revoke the old one, then update `~/.embarko/credentials`), the viaSocket embed secret (rotate in viaSocket, then update `VIASOCKET_EMBED_SECRET` in Embarko's App setup and the local `.env`), and `DIAG_TOKEN` (deleted with the route). `BETTER_AUTH_SECRET` on Embarko was generated server-side and never displayed.
