import { resetTestDatabase } from "../tests/db-reset";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { appendFileSync } from "node:fs";
import { MAILBOX } from "./helpers";

let server: SMTPServer | undefined;
let ai: import("node:http").Server | undefined;

export default async function globalSetup() {
  config({ path: ".env.test", override: true });
  resetTestDatabase(); // fresh SQLite database from the committed migrations

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

  // A stand-in for Anthropic's API, so the REAL provider code path (HTTP, headers, parsing) is exercised end to end.
  const { createServer } = await import("node:http");
  ai = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ok = req.url === "/v1/messages" && req.headers["x-api-key"] === "e2e-key";
      const prompt = ok ? String(JSON.parse(body).messages?.[0]?.content ?? "") : "";
      const text = JSON.stringify({ headline: "E2E headline", summary: "E2E summary: the team reported steady progress.", highlights: ["E2E highlight"], risks: [], blockers: /blockers:/.test(prompt) ? ["E2E blocker reported"] : [], goals: [] });
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(ok ? JSON.stringify({ content: [{ type: "text", text: prompt.includes("single word OK") || req.headers["content-length"] === "0" ? "OK" : text }], usage: { input_tokens: 10, output_tokens: 20 } }) : "{}");
    });
  });
  await new Promise<void>((res) => ai!.listen(2526, "127.0.0.1", res));
  (globalThis as unknown as { __ai?: typeof ai }).__ai = ai;
}
