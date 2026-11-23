import { z } from "zod";
import { route } from "@/server/http";
import { dayStringSchema, idSchema } from "@/server/validation";
import { requestReport } from "@/server/services/summaries";

const schema = z.object({ kind: z.enum(["PERSON_WEEK", "TEAM_WEEK", "DEPARTMENT_WEEK", "COMPANY_WEEK"]), subjectId: idSchema.optional(), weekStart: dayStringSchema });
export const POST = route({}, async ({ req, ctx }) => requestReport(ctx, schema.parse(await req.json())));
