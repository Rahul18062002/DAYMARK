import { route } from "@/server/http";
import { createOrganizationWithAdmin } from "@/server/services/organization";

// Public: creates a brand-new, independent workspace and its first admin.
export const POST = route({ auth: false, limit: [10, 3600, "onboarding"] }, async ({ req }) => {
  const out = await createOrganizationWithAdmin(await req.json());
  return { organizationId: out.organizationId };
});
