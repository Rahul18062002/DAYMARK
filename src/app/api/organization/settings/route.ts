import { route } from "@/server/http";
import { updateSettings } from "@/server/services/organization";

export const PATCH = route({}, async ({ req, ctx }) => ({ settings: await updateSettings(ctx, await req.json()) }));
