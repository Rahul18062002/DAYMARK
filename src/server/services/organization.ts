import type { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Actor } from "../policy";
import { assertCan } from "../policy";
import { conflict, notFound } from "../errors";
import { auth, withUserCreation } from "../auth/auth";
import { onboardingSchema, settingsSchema, updateOrganizationSchema } from "../validation";

type Onboarding = z.infer<typeof onboardingSchema>;

/**
 * Secure company onboarding: creates the identity, the organization, its default
 * settings and the first ADMIN membership. If anything after the identity step
 * fails, the identity is removed so no orphan account is left behind.
 */
export async function createOrganizationWithAdmin(input: Onboarding) {
  const data = onboardingSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) {
    throw conflict("An account with this email already exists. Sign in instead, or use your invitation link.", "EMAIL_TAKEN");
  }

  let userId: string;
  try {
    const res = await withUserCreation(() =>
      auth.api.signUpEmail({ body: { name: data.name, email: data.email, password: data.password } }),
    );
    userId = res.user.id;
  } catch (e) {
    // Lost a race with a concurrent registration of the same email.
    const dup = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (dup) throw conflict("An account with this email already exists.", "EMAIL_TAKEN");
    throw e;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: data.organizationName, timezone: data.timezone, settings: { create: {} } },
      });
      const membership = await tx.membership.create({
        data: { userId, organizationId: organization.id, role: "ADMIN" },
      });
      await audit(tx, {
        organizationId: organization.id,
        userId,
        action: "organization.created",
        entityType: "Organization",
        entityId: organization.id,
        metadata: { name: organization.name },
      });
      return { organizationId: organization.id, membershipId: membership.id, userId };
    });
  } catch (e) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    throw e;
  }
}

export async function getOrganization(actor: Actor) {
  const org = await prisma.organization.findFirst({
    where: { id: actor.organizationId },
    include: { settings: true },
  });
  if (!org) throw notFound("Organization");
  return org;
}

export async function updateOrganization(actor: Actor & { userId: string }, input: unknown) {
  assertCan(actor, "org:update");
  const data = updateOrganizationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findFirst({ where: { id: actor.organizationId } });
    if (!before) throw notFound("Organization");
    const org = await tx.organization.update({
      where: { id: actor.organizationId },
      data: {
        name: data.name,
        timezone: data.timezone,
        logoUrl: data.logoUrl === undefined ? undefined : data.logoUrl || null,
      },
    });
    await audit(tx, {
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: "organization.updated",
      entityType: "Organization",
      entityId: org.id,
      metadata: { changed: Object.keys(data) },
    });
    return org;
  });
}

export async function updateSettings(actor: Actor & { userId: string }, input: unknown) {
  assertCan(actor, "org:settings");
  const data = settingsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const settings = await tx.orgSettings.upsert({
      where: { organizationId: actor.organizationId },
      create: { organizationId: actor.organizationId, ...data },
      update: data,
    });
    await audit(tx, {
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: "settings.updated",
      entityType: "OrgSettings",
      entityId: actor.organizationId,
      metadata: { changed: Object.keys(data) },
    });
    return settings;
  });
}
