import { route } from "@/server/http";
import { testAiConnection } from "@/server/services/summaries";

/** Admin-only connectivity check for the configured AI provider. Sends no employee data. */
export const POST = route({}, async ({ ctx }) => testAiConnection(ctx));
