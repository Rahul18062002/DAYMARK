import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env().DATABASE_URL }) });
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const client = (globalForPrisma.prisma ??= create());
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type Db = PrismaClient | Tx;
