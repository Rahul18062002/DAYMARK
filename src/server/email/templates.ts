import { BRAND } from "@/lib/brand";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, bodyHtml: string, cta: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" style="max-width:520px;background:#fff;border:1px solid #e6e8f0;border-radius:12px">
<tr><td style="padding:28px 32px 8px;font-weight:700;font-size:20px;color:#4f46e5">${BRAND.name}</td></tr>
<tr><td style="padding:8px 32px 0;font-size:18px;font-weight:600">${esc(title)}</td></tr>
<tr><td style="padding:12px 32px;font-size:15px;line-height:1.6;color:#454b66">${bodyHtml}</td></tr>
<tr><td style="padding:8px 32px 28px"><a href="${esc(cta.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px">${esc(cta.label)}</a></td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e6e8f0;font-size:12px;color:#7b819b">${BRAND.name} · ${BRAND.tagline}<br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function invitationEmail(p: { organizationName: string; inviterName: string; role: string; url: string; expiresInDays: number }) {
  const subject = `${p.inviterName} invited you to ${p.organizationName} on ${BRAND.name}`;
  const html = layout(
    `Join ${p.organizationName}`,
    `<p style="margin:0 0 8px">${esc(p.inviterName)} invited you to join <strong>${esc(p.organizationName)}</strong> on ${BRAND.name} as ${esc(p.role.toLowerCase())}.</p><p style="margin:0">This invitation expires in ${p.expiresInDays} days.</p>`,
    { label: "Accept invitation", url: p.url },
  );
  const text = `${p.inviterName} invited you to join ${p.organizationName} on ${BRAND.name} as ${p.role.toLowerCase()}.\n\nAccept: ${p.url}\n\nThis invitation expires in ${p.expiresInDays} days.\n\n${BRAND.name} · ${BRAND.tagline}`;
  return { subject, html, text };
}

export function passwordResetEmail(p: { name: string; url: string }) {
  const subject = `Reset your ${BRAND.name} password`;
  const html = layout(
    "Reset your password",
    `<p style="margin:0 0 8px">Hi ${esc(p.name)}, we received a request to reset your ${BRAND.name} password.</p><p style="margin:0">This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
    { label: "Choose a new password", url: p.url },
  );
  const text = `Hi ${p.name},\n\nReset your ${BRAND.name} password: ${p.url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.\n\n${BRAND.name} · ${BRAND.tagline}`;
  return { subject, html, text };
}
