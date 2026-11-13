import nodemailer from "nodemailer";
import { env } from "../env";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export type MailResult = { sent: true } | { sent: false; reason: string };

/** Sends through SMTP. Never pretends: returns `sent:false` when SMTP is missing or fails. */
export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<MailResult> {
  if (!isEmailConfigured()) return { sent: false, reason: "Email (SMTP) is not configured." };
  const e = env();
  try {
    const transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE === "true",
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({ from: e.SMTP_FROM, ...msg });
    return { sent: true };
  } catch (err) {
    console.error("[daymark] email delivery failed:", err instanceof Error ? err.message : err);
    return { sent: false, reason: "The email could not be delivered." };
  }
}
