import { hashPassword, verifyPassword } from "./password";
import { CLIENT_IP_HEADER } from "../client-ip";
import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "../db";
import { appUrl, env } from "../env";
import { isEmailConfigured, sendMail } from "../email/mailer";
import { passwordResetEmail } from "../email/templates";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Daymark has NO public registration. Users are only created by server code that
 * runs inside `withUserCreation` (organization onboarding and invitation
 * acceptance). Any other path that tries to create a user is rejected here, in
 * addition to the HTTP allowlist in `src/app/api/auth/[...all]/route.ts`.
 */
// Held on globalThis because the bundler may load this module more than once (one copy per
// route bundle) while the Better Auth instance below is shared; both must see the same storage.
const gs = globalThis as unknown as { __daymarkUserCreation?: AsyncLocalStorage<true>; __daymarkAuth?: unknown };
const userCreation = (gs.__daymarkUserCreation ??= new AsyncLocalStorage<true>());
export const withUserCreation = <T>(fn: () => Promise<T>) => userCreation.run(true, fn);

function create() {
  return betterAuth({
    appName: "Daymark",
    baseURL: appUrl(),
    secret: env().BETTER_AUTH_SECRET,
    trustedOrigins: [appUrl()],
    // Rate limits key on the client address Daymark computes from the proxy chain (see client-ip.ts).
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    database: prismaAdapter(prisma, { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: false,
      password: { hash: hashPassword, verify: verifyPassword }, // same scrypt format, one at a time (memory)
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      async sendResetPassword({ user, url }) {
        if (!isEmailConfigured()) return; // the UI reports this state; nothing is faked
        const mail = passwordResetEmail({ name: user.name, url });
        await sendMail({ to: user.email, ...mail });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/request-password-reset": { window: 600, max: 5 },
        "/reset-password": { window: 600, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!userCreation.getStore()) return false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof create>;
const g = globalThis as unknown as { __daymarkAuth?: Auth };

export const auth: Auth = new Proxy({} as Auth, {
  get(_t, prop) {
    g.__daymarkAuth ??= create();
    return Reflect.get(g.__daymarkAuth, prop);
  },
});
