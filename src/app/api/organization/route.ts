import { route } from "@/server/http";
import { getOrganization, updateOrganization } from "@/server/services/organization";

export const GET = route({}, async ({ ctx }) => ({ organization: await getOrganization(ctx) }));
export const PATCH = route({}, async ({ req, ctx }) => ({ organization: await updateOrganization(ctx, await req.json()) }));
