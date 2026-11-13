import { z } from "zod";

// Shared by API routes and client forms so rules never drift apart.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const idSchema = z.string().min(1).max(64);
export const nameSchema = z.string().trim().min(1, "Name is required").max(100);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const timezoneSchema = z.string().refine(isValidTimezone, "Choose a valid timezone");

export const roleSchema = z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]);

export const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2, "Company name is required").max(100),
  timezone: timezoneSchema,
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    timezone: timezoneSchema,
    logoUrl: z.union([z.url({ protocol: /^https$/ }).max(500), z.literal(""), z.null()]),
  })
  .partial();

export const settingsSchema = z
  .object({
    updateCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)"),
    editWindowHours: z.number().int().min(0).max(168),
    workingDays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Pick at least one working day")
      .transform((d) => [...new Set(d)].sort()),
    aiEnabled: z.boolean(),
  })
  .partial();

export const departmentSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(80) });

export const teamSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  departmentId: idSchema.nullable().optional(),
  managerId: idSchema.nullable().optional(),
});
export const teamUpdateSchema = teamSchema.partial();

export const inviteSchema = z.object({
  email: emailSchema,
  role: roleSchema,
  departmentId: idSchema.nullable().optional(),
  teamId: idSchema.nullable().optional(),
  managerId: idSchema.nullable().optional(),
});

export const memberUpdateSchema = z
  .object({
    role: roleSchema,
    status: z.enum(["ACTIVE", "DEACTIVATED"]),
    departmentId: idSchema.nullable(),
    teamId: idSchema.nullable(),
    managerId: idSchema.nullable(),
    jobTitle: z.string().trim().max(100).nullable(),
    accessTeamIds: z.array(idSchema).max(200),
  })
  .partial();

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: nameSchema,
  password: passwordSchema,
});

export const memberFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
  role: roleSchema.optional(),
  departmentId: idSchema.optional(),
  teamId: idSchema.optional(),
});

// ── Daily updates ───────────────────────────────────────────────────────────
export const MAX_ITEMS_PER_SECTION = 20;
export const MAX_ITEM_LENGTH = 2000;
export const MAX_LINKS = 10;

export const dayStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Use a valid date");

const itemText = z.string().trim().min(1, "Entries can't be empty").max(MAX_ITEM_LENGTH, `Keep each entry under ${MAX_ITEM_LENGTH} characters`);
const itemList = z.array(itemText).max(MAX_ITEMS_PER_SECTION, `At most ${MAX_ITEMS_PER_SECTION} entries per section`);

export const sectionsSchema = z
  .object({
    workedOn: itemList.default([]),
    completed: itemList.default([]),
    pending: itemList.default([]),
    blockers: itemList.default([]),
    nextPriorities: itemList.default([]),
  })
  .refine((s) => Object.values(s).flat().join("").length <= 20_000, "This update is too long");

// Only http(s) links are accepted, so a stored link can never be a javascript: / data: URL.
export const linkSchema = z.object({
  url: z.string().trim().max(500).pipe(z.url("Enter a full link starting with https://")).refine((u) => /^https?:\/\//i.test(u), "Links must start with http:// or https://"),
  label: z.string().trim().max(100).optional().transform((v) => v || undefined),
});

export const createUpdateSchema = z.object({
  updateDate: dayStringSchema.optional(),
  sections: sectionsSchema,
  links: z.array(linkSchema).max(MAX_LINKS, `At most ${MAX_LINKS} links`).default([]),
  submit: z.boolean().default(false),
});

export const patchUpdateSchema = z.object({
  sections: sectionsSchema.optional(),
  links: z.array(linkSchema).max(MAX_LINKS).optional(),
  submit: z.boolean().optional(),
});

export const teamUpdateFilterSchema = z.object({
  from: dayStringSchema.optional(),
  to: dayStringSchema.optional(),
  departmentId: idSchema.optional(),
  teamId: idSchema.optional(),
  membershipId: idSchema.optional(),
  status: z.enum(["submitted", "edited", "missing"]).optional(),
  blockers: z.enum(["1"]).optional(),
});
