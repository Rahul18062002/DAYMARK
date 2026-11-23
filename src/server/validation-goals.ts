import { z } from "zod";
import { dayStringSchema, idSchema } from "./validation";

const title = z.string().trim().min(1, "Give it a title").max(200, "Keep it under 200 characters");
const long = z.string().trim().max(2000);
const finite = z.number().finite();

export const objectiveCreateSchema = z.object({
  title,
  description: long.nullish(),
  level: z.enum(["COMPANY", "DEPARTMENT", "TEAM", "INDIVIDUAL"]),
  ownerId: idSchema.optional(),
  departmentId: idSchema.nullish(),
  teamId: idSchema.nullish(),
  parentId: idSchema.nullish(),
  periodStart: dayStringSchema,
  periodEnd: dayStringSchema,
}).refine((v) => v.periodStart <= v.periodEnd, { message: "The end date must be on or after the start date", path: ["periodEnd"] });

export const objectiveUpdateSchema = z.object({
  title: title.optional(),
  description: long.nullable().optional(),
  ownerId: idSchema.optional(),
  parentId: idSchema.nullable().optional(),
  periodStart: dayStringSchema.optional(),
  periodEnd: dayStringSchema.optional(),
  status: z.enum(["ACTIVE", "DONE", "CANCELLED"]).optional(),
});

export const keyResultCreateSchema = z.object({
  title,
  type: z.enum(["NUMBER", "PERCENT", "BOOLEAN"]).default("NUMBER"),
  startValue: finite.default(0),
  targetValue: finite.optional(),
  currentValue: finite.optional(),
  unit: z.string().trim().max(20).nullish(),
  isKpi: z.boolean().default(false),
  weight: z.number().int().min(1).max(10).default(1),
  ownerId: idSchema.optional(),
});

export const keyResultUpdateSchema = z.object({
  title: title.optional(),
  startValue: finite.optional(),
  targetValue: finite.optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  isKpi: z.boolean().optional(),
  weight: z.number().int().min(1).max(10).optional(),
  ownerId: idSchema.optional(),
});

export const checkInSchema = z.object({
  value: finite,
  confidence: z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK"]).default("ON_TRACK"),
  comment: z.string().trim().max(1000).nullish(),
});

export const taskCreateSchema = z.object({
  title,
  keyResultId: idSchema.nullish(),
  assigneeId: idSchema.optional(),
  dueDate: dayStringSchema.nullish(),
});

export const taskUpdateSchema = z.object({
  title: title.optional(),
  keyResultId: idSchema.nullable().optional(),
  assigneeId: idSchema.optional(),
  dueDate: dayStringSchema.nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
});

export const objectiveFilterSchema = z.object({
  from: dayStringSchema.optional(),
  to: dayStringSchema.optional(),
  level: z.enum(["COMPANY", "DEPARTMENT", "TEAM", "INDIVIDUAL"]).optional(),
  ownerId: idSchema.optional(),
  mine: z.union([z.literal("1"), z.literal("true"), z.boolean()]).optional(),
});
