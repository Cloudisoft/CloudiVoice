import "server-only";
import { env } from "@cloudivoice/core/env";

export interface MailResult {
  sent: boolean;
  /** Only in development without SMTP: the link, so flows can be tested locally. */
  devLink?: string;
}

/** Send a transactional email. Without SMTP in development, returns the link instead. */
export async function sendMail(to: string, subject: string, text: string, link: string): Promise<MailResult> {
  if (!env.smtpUrl) {
    if (env.isProduction) {
      console.error(`[mail] SMTP_URL not configured; could not send "${subject}"`);
      return { sent: false };
    }
    console.info(`[mail:dev] to=${to} subject="${subject}" link=${link}`);
    return { sent: false, devLink: link };
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(env.smtpUrl);
  await transport.sendMail({ from: env.mailFrom, to, subject, text: `${text}\n\n${link}\n\n— CloudiVoice by Cloudisoft` });
  return { sent: true };
}
