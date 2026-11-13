# Daymark — Make Every Day Count.

Daymark helps companies collect daily work updates, understand individual and team progress,
surface blockers, and (from Phase 3) generate AI summaries and weekly reports.
It is a multi-company SaaS: every company gets an isolated workspace.

**Status: Phase 1 (Foundation) complete.** Daily updates (Phase 2), AI (Phase 3) and finalization (Phase 4) are not built yet.

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
    services/     business logic (organization, structure, members, invitations, overview)
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
* Rate limits: Better Auth's (database-backed) limiter on sign-in / reset; a PostgreSQL limiter on onboarding and invitation acceptance.
* Audit log rows are written in the same transaction as each important change.

## Setup
Requirements: Node 22+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
npx prisma migrate deploy   # apply migrations (use `npm run db:migrate` while developing)
npm run dev                 # http://localhost:3000
```
Open `/onboarding` to create the first company workspace.

### Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (pooled is fine) |
| `DIRECT_URL` | no | Non-pooled URL used only by `prisma migrate` (Neon/Supabase etc.) |
| `BETTER_AUTH_SECRET` | yes | ≥32 chars. Signs sessions/tokens. |
| `BETTER_AUTH_URL` | yes | Public base URL, no trailing slash. Must match the browser origin. |
| `NEXT_PUBLIC_APP_URL` | yes | Same public URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | Email. **Without `SMTP_HOST`**: invitation links are shown to the admin to copy, and Forgot password says email isn't configured. Nothing pretends to send. |
| `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Phase 3 | Validated but unused until Phase 3 |

## Tests
```bash
npm run lint                       # type-check
npm test                           # Vitest integration tests (needs the daymark_test database, see .env.test)
npm run test:e2e                   # builds, then Playwright against two real servers
```
Copy `.env.test.example` to `.env.test` (it points at a database named `daymark_test`). If Playwright's own browser isn't installed, set
`PW_CHROMIUM_PATH` to an installed Chromium binary.

## Deploying to Vercel + managed PostgreSQL
1. Create a managed PostgreSQL database (Neon, Supabase, Vercel Postgres, …).
2. In Vercel, import the repo and set the environment variables above. `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` = your production URL.
   Use the pooled connection string for `DATABASE_URL` and the direct one for `DIRECT_URL`.
3. Build command: `npm run build` (runs `prisma generate` then `next build`).
4. Apply migrations against production before/at release: `DATABASE_URL=<direct url> npx prisma migrate deploy` (CI step or one-off).
5. Configure SMTP (e.g. any provider with SMTP credentials) so invitations and password resets are emailed.

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

## Remaining (not in Phase 1)
- Phase 2: daily update form, history, edit window, revision history (original submission status preserved), manager team-updates view, My Updates / Team Updates / Reports navigation
- Phase 3: AI summaries (Anthropic default, OpenAI supported), weekly reports, manager review
- Phase 4: hardening pass, full E2E for updates/AI/reports, deployment polish
- Later: viaSocket Embed integration, Slack / email / WhatsApp channels, file uploads, subscription plans
- Known follow-ups: email-ownership verification at onboarding; admin-initiated password reset when SMTP is unavailable; audit-log viewer page; card layout for the Employees table on narrow phones
