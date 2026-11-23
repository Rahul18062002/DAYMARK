import { route } from "@/server/http";
import { createObjective, listObjectives } from "@/server/services/goals";

export const GET = route({}, async ({ req, ctx }) => listObjectives(ctx, Object.fromEntries(new URL(req.url).searchParams)));
export const POST = route({}, async ({ req, ctx }) => createObjective(ctx, await req.json()));
