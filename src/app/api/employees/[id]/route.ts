import { route } from "@/server/http";
import { getMember, updateMember } from "@/server/services/members";

export const GET = route<{ id: string }>({}, async ({ ctx, params }) => ({ employee: await getMember(ctx, params.id) }));
export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => updateMember(ctx, params.id, await req.json()));
