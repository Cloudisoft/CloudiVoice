import "server-only";
import { env } from "@cloudivoice/core/env";

export interface MailResult {
  sent: boolean;
  /** Only in development without SMTP: the link, so flows can be tested locally. */
  devLink?: string;
}

export interface ActionEmail {
  /** Opening line, e.g. "Hi Asha," */
  greeting: string;
  /** Short paragraphs of body text. */
  lines: string[];
  cta: string;
  link: string;
  /** Small print under the button (expiry, "didn't ask for this?"). */
  footnote?: string;
}

/** True when emails can actually reach people (SMTP configured, or dev mode showing links). */
export function emailDeliveryAvailable() {
  return Boolean(env.smtpUrl) || !env.isProduction;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(subject: string, m: ActionEmail) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1f2a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e6e8ef">
<tr><td style="padding:26px 30px 6px;font-size:20px;font-weight:700;color:#0b0f1d">Cloudi<span style="color:#f59e0b">Voice</span></td></tr>
<tr><td style="padding:10px 30px 4px;font-size:15px;line-height:1.6">
<p style="margin:0 0 14px">${esc(m.greeting)}</p>
${m.lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join("")}
</td></tr>
<tr><td style="padding:8px 30px 22px"><a href="${esc(m.link)}" style="display:inline-block;background:#ffb020;color:#111;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(m.cta)}</a></td></tr>
<tr><td style="padding:0 30px 26px;font-size:12.5px;line-height:1.6;color:#6b7285">
${m.footnote ? `<p style="margin:0 0 10px">${esc(m.footnote)}</p>` : ""}
<p style="margin:0">If the button doesn’t work, copy this link into your browser:<br><a href="${esc(m.link)}" style="color:#6b7285;word-break:break-all">${esc(m.link)}</a></p>
</td></tr></table>
<p style="font-size:12px;color:#8a90a2;margin:16px 0 0">CloudiVoice by Cloudisoft · AI voice agents for Indian businesses</p>
</td></tr></table></body></html>`;
}

/** Send a transactional email with one call-to-action. Without SMTP in development, returns the link instead. */
export async function sendActionEmail(to: string, subject: string, m: ActionEmail): Promise<MailResult> {
  if (!env.smtpUrl) {
    if (env.isProduction) {
      console.error(`[mail] SMTP_URL not configured; could not send "${subject}"`);
      return { sent: false };
    }
    console.info(`[mail:dev] to=${to} subject="${subject}" link=${m.link}`);
    return { sent: false, devLink: m.link };
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(env.smtpUrl);
  const text = [m.greeting, "", ...m.lines.flatMap((l) => [l, ""]), `${m.cta}: ${m.link}`, "", m.footnote ?? "", "— CloudiVoice by Cloudisoft"].join("\n");
  await transport.sendMail({ from: env.mailFrom, to, subject, text, html: html(subject, m) });
  return { sent: true };
}
