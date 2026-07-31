import nodemailer from "nodemailer";

export async function sendEmail(input: { to: string | string[]; subject: string; message: string }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) return { sent: false, reason: "not-configured" } as const;
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM_NAME ? `"${process.env.SMTP_FROM_NAME.replaceAll('"', "")}" <${from}>` : from,
    to: Array.isArray(input.to) ? input.to.join(",") : input.to,
    subject: input.subject,
    text: input.message,
  });
  return { sent: true } as const;
}
