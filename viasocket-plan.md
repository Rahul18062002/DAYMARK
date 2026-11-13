# Daymark × viaSocket — implementation plan (awaiting approval)

Status: **PLAN ONLY. No integration code has been written.** Skill version read: `2026-11-11.1`
(pointer installed at `.claude/skills/viasocket-integrations/SKILL.md`; the live skill and every page below
were fetched and read to their `END OF PAGE` line on 2026-11-13).

Pages this plan follows: `skill.md?format=sdk`, `embed.md`, `automations.md`, `skill/app-integrations.md`,
`skill/connect.md`, `skill/actions-and-events.md`, `skill/manage.md`, `skill/test-connection.md`,
`skill/setup.md`, `skill/journey.md`, `skill/feedback.md`, `slack/send-message.md`, plus the `viasocket-apps`
0.19.0 README and type definitions.

## 1. Scope (approved)

* **Outbound events only.** Daymark → viaSocket. No inbound API, no Daymark "actions" (deferred).
* **Three triggers now:** `update.submitted`, `update.blocker_reported`, `update.missing`.
  `report.generated` / `report.approved` arrive with Phase 3.
* **Organization-level identity.** Each Daymark organization is one viaSocket "user": `daymark-org-<organizationId>`
  (a string derived on the server from the session, never from the browser). Its connections, flows and run
  history are isolated from every other organization by viaSocket itself.
* **Managers have no access by default**; an admin can switch it on (`automationsManagerAccess`).
* **viaSocket is optional.** Not configured / unreachable ⇒ Daymark behaves exactly as today.

## 2. What was verified (sources)

| Fact | Source |
|---|---|
| The prebuilt UI mounts in a box of our page with a per-user embed token; users connect apps, pick triggers/actions, map fields, test and publish inside it | embed.md §1–3 |
| Default config = "users build flows the product's code runs (one URL per flow)"; the product learns of flows **only** through `flow` events (`initiated/published/updated/paused/deleted`) | embed.md §3–4a |
| On `published`/`updated` the **backend reads the flow itself** (`user.listFlows()`), not a URL from the browser, and stores its URL | embed.md §4a |
| A flow URL (`https://flow.sokt.io/func/<id>`) runs the user's apps ⇒ it is a **credential**: server-side only | embed.md, skill.md "On every job" |
| The product triggers a flow with `POST <flow url>` + JSON body; the caller gets the flow's output; a paused/deleted flow answers 400 | embed.md §4a, §5 |
| A failed step does **not** fail the run; the webhook caller still gets 200 | automations.md "The VM" |
| "Runs overlap and events repeat" ⇒ idempotency key needed | automations.md |
| Token endpoint behind the product's login; browser holds only the embed token; every message checked with `event.origin === "https://embedfrontend.viasocket.com"` | connect.md §1, embed.md |
| `open` options: `dummy_payload` (sample JSON so users get mapping suggestions), `meta`, `create_default_flow_with_api` | embed.md §1 |
| `viasocket-apps` has **no** method to POST to a flow URL; embed.md prescribes plain `fetch` for it | package types / embed.md §4a |
| Slack `Send_Message` v107: `destination.messageto/channel_id/userId` are `PICK`; `markdown_content` required | slack/send-message.md |
| Setup check (`listConnections`) passes with the provided keys | run 2026-11-13 |
| Node's built-in `fetch` ignores the sandbox proxy; sandbox needs `NODE_USE_ENV_PROXY=1` (not needed on Vercel) | /root/.ccr/README.md |

**Found during setup:** the shared test identity `apps-api-test-user` of this project already holds 7 connections
(Slack ×2, Gmail ×2, Google Sheets ×2, Google Forms) made by someone else. **They will not be used.** All tests use
a dedicated identity and a target made for the test.

## 3. Architecture

```
Admin browser ── /automations ── mounts viaSocket embed (token from our server)
      │                              │ flow events (published/updated/paused/deleted)
      │                              ▼
      │                    POST /api/automations/sync   (body ignored; server re-reads)
      │                              │ user('daymark-org-<id>').listFlows()
      ▼                              ▼
 Daymark DB  ◄── AutomationFlow (title, status, event type, ENCRYPTED flow URL)

Daymark core action (submit / edit / cron) ──after commit, try/catch──► IntegrationEvent (+ one Delivery per linked flow)
                                                                           │ dispatcher (after() + cron sweep)
                                                                           ▼
                                             POST https://flow.sokt.io/func/<id>   (8 s timeout, retries, idempotent)
```

* **Embed page `/automations`** (admin; managers only if enabled): mounts the embed with default config
  (`pageheading: "Automation"`, Daymark theme colours). Next to it, a Daymark panel lists each linked flow and
  lets the admin choose **which Daymark event starts it** (a dropdown per flow) — the browser never decides this
  silently; `meta` from the embed is only a suggestion.
* **"Send test event"** per flow: delivers a clearly-marked synthetic payload (`test: true`, fake person) so the
  user can test their automation without real employee data.
* **Token endpoint** `GET /api/viasocket/token` (name from connect.md): requires a session, an active membership,
  and the Automations permission; derives the identity from the session; returns `{ token, serviceIds }`; rate-limited.
* **Sync** `POST /api/automations/sync`: ignores the request body, calls `listFlows()` for the **session's**
  organization identity, upserts `AutomationFlow` rows, marks vanished flows deleted. Spoofed browser messages can
  at worst trigger a harmless re-read.
* **Flow URL storage:** AES-256-GCM encrypted at rest (key derived with HKDF from `VIASOCKET_EMBED_SECRET`,
  context `daymark/viasocket/flow-url/v1`); a keyed hash of the flow id is used for lookups. The table is a cache of
  `listFlows()` plus the event link, so a key change is recovered by "Re-sync" + re-linking. The URL is taken
  verbatim from `listFlows().webhook` (never built by hand).
* **Delivery uses `fetch`** to the URL returned by the SDK — the single deliberate exception to "SDK for every call",
  because the package has no method for it and embed.md §4a prescribes it. Every other viaSocket call uses
  `viasocket-apps`.

## 4. Event catalogue — payloads and where each value comes from

Source categories: **DB** = Daymark backend; **ONCE** = user selects once (in the flow builder);
**RUN** = user input per run (none planned); **AI** = Daymark AI per run (none — no AI in these events);
**EXT** = returned by the connected app.

Common envelope (all events):

| Field | Example | Source |
|---|---|---|
| `schemaVersion` | `1` | DB (constant) |
| `eventId` | `"evt_…"` | DB — stable per logical event; **the idempotency key flows should dedupe on** |
| `eventType` | `"update.blocker_reported"` | DB |
| `occurredAt` | ISO-8601 UTC | DB |
| `test` | `false` (`true` for "Send test event") | DB |
| `organization.name` | `"Acme Inc."` | DB |
| `attempt` | `1…5` | DB |

### 4.1 `update.submitted` — emitted once, on the update's first submission

| Field | Source | Why it is included |
|---|---|---|
| `employee.name`, `employee.team` | DB | who and where |
| `update.date`, `update.isLate`, `update.hasBlockers` | DB | headline facts |
| `update.url` | DB (absolute Daymark link; access still needs login + permission) | lets the reader open the detail |
| `manager.name`, `manager.email` | DB (employee's manager, else team manager; `null` if none) | the natural recipient |

Not included: update text, links, AI output, employee email. `eventKey = update.submitted:<updateId>`.

### 4.2 `update.blocker_reported` — emitted once per update, the first time it has a real blocker (at submission or via a later edit; "None"/"N/A" do not count)

| Field | Source | Why |
|---|---|---|
| `employee.name`, `employee.team` | DB | who |
| `update.date`, `update.url` | DB | context + link |
| `manager.name`, `manager.email` | DB | recipient |
| `blocker.count` | DB | how many entries |
| `blocker.text` | DB — **only if the organization turned on "Include blocker text"** (default OFF); first entry, truncated to 280 chars | optional detail |

`eventKey = update.blocker_reported:<updateId>`. Default is link-only to avoid sending free-text work content to
third-party apps unless the company decides it wants that.

### 4.3 `update.missing` — emitted at most once per person per day, by cron

Condition: the organization's cut-off time (its own timezone) has passed on a **working day**; the person is
active, joined on/before that day, and has **no submitted update** for it (a draft does not count); the organization has
≥1 active flow linked to this event.

| Field | Source | Why |
|---|---|---|
| `employee.name`, `employee.email`, `employee.team` | DB | recipient for the reminder (Slack lookup / email) |
| `reminder.date` | DB | the day missing |
| `reminder.submitUrl` | DB (`/my-updates/new?date=…`) | one-click to submit |
| `reminder.cutoffTime`, `reminder.timezone` | DB (org settings) | message wording |

`eventKey = update.missing:<membershipId>:<date>`. No manager data, no work content.

### 4.4 Inputs the user decides in the flow builder (Slack `Send_Message` v107, per slack/send-message.md)

| App | Action (key, version) | `inputData` key | Who supplies | When |
|---|---|---|---|---|
| slack | `Send_Message` v107 | `destination.messageto` | user (flow builder) | once per flow |
| slack | `Send_Message` v107 | `destination.channel_id` / `destination.userId` | user, chosen from the list of their own channels/users (`PICK`) | once per flow |
| slack | `Send_Message` v107 | `markdown_content` | user writes a template; values filled from the event payload above | template once; values per run |
| slack | `Send_Message` v107 | `destination.tagged_users`, `thread_*`, `buttons`, `schedule_*`, `bot_details`, `preview` | left out on purpose in Daymark's tests; available to users | — |

Email/Gmail and other apps are built the same way by users in the embed; they are not tested by Daymark.
Per the skill, nothing is guessed: every id comes from the user's own list, never typed.

## 5. Reliability

* **Outbox:** each event is stored (`IntegrationEvent`, unique `(organizationId, eventKey)` ⇒ duplicate events are
  impossible) with one `IntegrationDelivery` per linked active flow (unique `(eventId, automationFlowId)`).
* **Never affects core:** events are published **after** the core transaction commits, inside try/catch; any
  failure is logged (no payload) and swallowed. No event is created unless viaSocket is configured **and** the
  organization has a linked active flow for that event type. Delivery never runs in the request path
  (`after()`), with a hard 8 s timeout (`AbortController`).
* **Retries:** network error, timeout, 408/425/429/5xx → retry with backoff 1 m, 5 m, 30 m, 2 h, 6 h, then `FAILED`.
  A 400 "paused"/"deleted" → mark the flow inactive and `SKIPPED` (no retry). Other 4xx → `FAILED`, no retry.
  A cron sweep (`FOR UPDATE SKIP LOCKED`) picks due deliveries so two instances never send the same one.
* **At-least-once:** a crash between the HTTP call and the status update can resend. `eventId` is in every payload for
  flows to dedupe on (documented to users in the Automations page).
* **Honest status:** a 2xx means "viaSocket accepted it", not "Slack posted it" (a failed step still returns 200).
  The UI says so and does not claim end-to-end success.
* **Retention:** payloads are deleted after 30 days; delivery rows keep status/time/HTTP code only.
* **Audit:** flow linked/unlinked, settings changed, final delivery failure.

## 6. Security and isolation

* Embed secret, flow URLs, tokens: server only; never logged, never in client bundles, never committed.
* Identity from the session; every API checks role + the organization setting; no organization id from the client.
* Flow ownership: a flow is only used for the organization whose identity `listFlows()` returned it for.
* `message` listener checks `event.origin`; its content is never trusted.
* Cron route requires `Authorization: Bearer $CRON_SECRET` (Vercel's mechanism); refuses to run if unset.
* Minimal payloads (section 4); blocker text opt-in; synthetic data for tests.
* CSRF/origin check on mutating routes (existing wrapper).

## 7. Data model and files (proposed)

* `OrgSettings` += `automationsManagerAccess Boolean @default(false)`, `automationsIncludeBlockerText Boolean @default(false)`.
* New: `AutomationFlow`, `IntegrationEvent`, `IntegrationDelivery` (organization-scoped, composite FKs like the rest).
* `src/server/integrations/viasocket/`: `client.ts` (lazy SDK + config check), `crypto.ts`, `flows.ts` (sync),
  `events.ts` (build/emit), `dispatch.ts` (deliver/retry), `missing.ts` (cron detection).
* Routes: `/api/viasocket/token`, `/api/automations` (+ `sync`, `flows/[id]`, `flows/[id]/test`, `settings`), `/api/cron/integrations`.
* UI: `/automations` page + nav item (visibility = permission), config-state and error-state screens.
* `vercel.json` cron entry; `.env.example` placeholders (**done**), `CRON_SECRET`.
* Docs: README section + this plan kept current.

## 8. Testing plan (real connection; anything not run is reported UNTESTED)

Test identity: a dedicated organization identity (never `apps-api-test-user`). Target: a Slack DM to the person who
authorizes (made for the test), never existing channels or customers.

1. Token + embed render for the test org; `embed.update(...)` live. 
2. Slack connection by the user (**needs your browser authorization** — see "What I need").
3. Real `Send_Message` once; keep the real response.
4. For each event (`submitted`, `blocker_reported`, `missing`): a real flow (webhook trigger → Slack DM) receives a
   real Daymark delivery; verify the DM and `runHistory`.
5. Embed lifecycle: flow published → `published` event + `webhookurl`; paused → `paused` event; sync links it.
6. Failure paths: paused flow (400), bad URL / timeout, retry + backoff, duplicate event (no second delivery),
   viaSocket unreachable (core update still succeeds).
7. Isolation: org B cannot see/sync/trigger org A's flows; employee/manager-without-setting get 403; token endpoint refuses.
8. Cron: missing-update detection on working/non-working day, before/after cut-off, draft vs submitted.
9. `npx -y viasocket-apps check <integration folder>` with 0 FAIL; existing 75 tests stay green.

### Official "Finished when" lines that apply (reported one by one at the end)

* **embed.md:** (1) page loads with a test user's token and UI renders; (2) `embed.update(...)` changes it without
  reload — *note: the line names `chatbot: true`, which Daymark does not use (default config); I will test `update`
  with the keys Daymark uses and say so*; (3) flow published as test user reaches the listener as `published` with a
  `webhookurl`; (4) section 4a done and answered (POST to the flow); (5) pause reaches the listener as `paused`;
  (6) check script ran.
* **automations.md** (used for test flows): `automationToken`; `createFlow/setTrigger/saveSteps` + `readFlow`;
  it ran once; check script 0 FAIL. *(plugin-trigger line N/A: Daymark flows use a webhook trigger.)*
* **app-integrations.md:** Confirmed (this plan + your yes); Who connects (product's own user via the embed's Connect);
  Where/when each value comes from (section 4); Who picks the action (the user, in the builder); Where it runs
  (server, ownership checked, browser holds only the embed token); Tested; Proof (check output + one real response).

## 9. Environment

| Variable | Where | Notes |
|---|---|---|
| `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET` | `.env` (**added**, gitignored), Vercel env | secret server-only |
| `CRON_SECRET` | Vercel env | protects `/api/cron/integrations` |
| `NODE_USE_ENV_PROXY=1` | **sandbox only** | not for Vercel |

Vercel Cron: sub-daily schedules (needed for per-organization cut-off times) require a plan that allows them; on a
daily-only plan the missing-update reminder could only run once a day.

## 10. Decisions still open

1. Blocker text default OFF (this plan) vs ON (my earlier suggestion) — changed because of your "no unnecessary
   sensitive data" rule; admins can switch it on per organization.
2. Cron frequency / Vercel plan (see section 9).
3. How you authorize the Slack test connection (preview link or one local command).

## 11. Not in scope

Daymark actions (Get Employee Details, …), inbound webhooks/API, report triggers (Phase 3), publishing Daymark as a
viaSocket app/connector, AI-written messages, deploying anything.
