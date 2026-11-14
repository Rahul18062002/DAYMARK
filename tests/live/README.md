# Live (real-connection) tests

These talk to **real viaSocket** with your own keys and to a **running Daymark server**. They are not part of CI
(`npm test` / `npm run test:e2e` use fakes and dummy values and never touch the network). Run them by hand.

Prerequisites: `.env` with `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET`; a Daymark server
(`next start`) built from the current code with `CRON_SECRET` set; a throwaway state directory (`LIVE_STATE_DIR`).
In a sandbox that forces an egress proxy, add `NODE_USE_ENV_PROXY=1`.

| Script | What it proves | Needs Slack? |
|---|---|---|
| `01-people.mts` | Creates a fresh organization + manager/employees through the real API | no |
| `02-real-delivery.mts` | All three events delivered to real flows; payloads read back from viaSocket's run history; opt-in blocker text; cron + missing updates; test event; paused flow (real 400); resend carries the same `eventId`; attempt history | no |
| `03-embed-render.mts` | The real embed renders inside the Automations page with a real token | no |
| `04-embed-lifecycle.mts` | A flow built in the real builder is published → `published` event with a URL → picked up → linked → test event accepted → paused in the builder → `paused` event | no |
| `05-slack.mts` | The three events end to end into real Slack DMs, plus one deliberate duplicate | **yes** — someone must authorize Slack once |

Connecting Slack for the test organization (run on your own computer, where your browser is):

```bash
mkdir daymark-slack-test && cd daymark-slack-test
printf 'VIASOCKET_ORG_ID=…\nVIASOCKET_PROJECT_ID=…\nVIASOCKET_EMBED_SECRET=…\n' > .env
npx -y viasocket-apps connect slack --user daymark-org-<the test organization's id>
```

Messages go only to the person who authorized the connection (a DM), never to existing channels.
