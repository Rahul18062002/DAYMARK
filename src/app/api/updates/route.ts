import { route } from "@/server/http";
import { ingestUpdate } from "@/server/channels/ingest";
import { badRequest } from "@/server/errors";
import { listOwnUpdates } from "@/server/services/updates";

export const GET = route({}, async ({ ctx }) => ({ updates: await listOwnUpdates(ctx) }));

// The dashboard form is one channel into the shared ingest path. The channel is fixed
// server-side: a client cannot claim to be Slack/email.
export const POST = route({}, async ({ req, ctx }) => {
  const body = await req.json();
  if (!body || typeof body !== "object") throw badRequest("Invalid request.");
  return ingestUpdate(ctx, { ...body, channel: "DASHBOARD" });
});
