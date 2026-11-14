import { z } from "zod";
import { prisma } from "../../db";
import { audit } from "../../audit";
import { assertCan, type Actor } from "../../policy";

const schema = z.object({ managerAccess: z.boolean().optional(), includeBlockerText: z.boolean().optional() });

export async function getAutomationSettings(organizationId: string) {
  const s = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { automationsManagerAccess: true, automationsIncludeBlockerText: true } });
  return { managerAccess: s?.automationsManagerAccess ?? false, includeBlockerText: s?.automationsIncludeBlockerText ?? false };
}

/** Admin only. */
export async function updateAutomationSettings(actor: Actor & { userId: string }, input: unknown) {
  assertCan(actor, "org:settings");
  const data = schema.parse(input);
  await prisma.$transaction(async (tx) => {
    await tx.orgSettings.upsert({
      where: { organizationId: actor.organizationId },
      create: { organizationId: actor.organizationId, automationsManagerAccess: data.managerAccess ?? false, automationsIncludeBlockerText: data.includeBlockerText ?? false },
      update: { automationsManagerAccess: data.managerAccess, automationsIncludeBlockerText: data.includeBlockerText },
    });
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "automation.settings_updated", entityType: "OrgSettings", entityId: actor.organizationId, metadata: { changed: Object.keys(data) } });
  });
  return getAutomationSettings(actor.organizationId);
}
