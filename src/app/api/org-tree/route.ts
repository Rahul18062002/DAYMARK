import { route } from "@/server/http";
import { orgTree } from "@/server/services/org-tree";

export const GET = route({}, async ({ ctx }) => orgTree(ctx));
