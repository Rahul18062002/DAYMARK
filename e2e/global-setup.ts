import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { appendFileSync } from "node:fs";
import { MAILBOX } from "./helpers";

let server: SMTPServer | undefined;

export default async function globalSetup() {
  config({ path: ".env.test", override: true });
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env } });
  // Clear rate-limit state so repeated runs from the same machine don't interfere.
  execSync(`psql "${process.env.DATABASE_URL}" -c 'TRUNCATE "RequestThrottle", "RateLimit"'`, { stdio: "ignore" });

  mkdirSync("test-results", { recursive: true });
  writeFileSync(MAILBOX, "");
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    async onData(stream, _session, cb) {
      const mail = await simpleParser(stream);
      const to = (Array.isArray(mail.to) ? mail.to[0] : mail.to)?.value[0]?.address ?? "";
      appendFileSync(MAILBOX, JSON.stringify({ to, from: mail.from?.text, subject: mail.subject, text: mail.text, html: mail.html }) + "\n");
      cb();
    },
  });
  await new Promise<void>((res) => server!.listen(2525, "127.0.0.1", res));
  (globalThis as unknown as { __smtp?: SMTPServer }).__smtp = server;
}
