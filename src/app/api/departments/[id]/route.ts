import { route } from "@/server/http";
import { deleteDepartment, renameDepartment } from "@/server/services/structure";

export const PATCH = route<{ id: string }>({}, async ({ req, ctx, params }) => ({ department: await renameDepartment(ctx, params.id, await req.json()) }));
export const DELETE = route<{ id: string }>({}, async ({ ctx, params }) => deleteDepartment(ctx, params.id));
