import { route } from "@/server/http";
import { createDepartment, listDepartments } from "@/server/services/structure";

export const GET = route({}, async ({ ctx }) => ({ departments: await listDepartments(ctx) }));
export const POST = route({}, async ({ req, ctx }) => ({ department: await createDepartment(ctx, await req.json()) }));
