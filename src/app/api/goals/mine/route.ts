import { route } from "@/server/http";
import { myGoals } from "@/server/services/goals";

export const GET = route({}, async ({ ctx }) => myGoals(ctx));
