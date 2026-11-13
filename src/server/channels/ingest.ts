import type { UpdateSource } from "@/generated/prisma/enums";
import type { Actor } from "../policy";
import { createUpdate } from "../services/updates";

/**
 * The single entry point for submitting a work update, whatever channel it came from.
 *
 *   Dashboard form → ingestUpdate(...)   (today)
 *   Slack / email / WhatsApp / external forms → adapter resolves the sender to a Membership,
 *   normalizes the payload to the shape below, then calls ingestUpdate(...)   (later)
 *
 * Every channel therefore produces the same `DailyUpdate` record (with `source` recording the
 * channel) and goes through identical validation, revision history and audit logging.
 * No external channel is implemented yet — there is nothing here that pretends otherwise.
 */
export type IncomingUpdate = {
  channel: UpdateSource;
  updateDate?: string;
  sections: { workedOn?: string[]; completed?: string[]; pending?: string[]; blockers?: string[]; nextPriorities?: string[] };
  links?: { url: string; label?: string }[];
  submit: boolean;
};

export function ingestUpdate(actor: Actor & { userId: string }, incoming: IncomingUpdate, opts: { now?: Date } = {}) {
  const { channel, ...payload } = incoming;
  return createUpdate(actor, payload, { source: channel, now: opts.now });
}
