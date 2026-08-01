import nodemailer from "nodemailer";

export async function sendEmail(input: { to: string | string[]; subject: string; message: string }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) {
    console.error("[email] SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM on the API host.");
    return { sent: false, reason: "not-configured" } as const;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user, pass },
  });
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM_NAME ? `"${process.env.SMTP_FROM_NAME.replaceAll('"', "")}" <${from}>` : from,
      to: Array.isArray(input.to) ? input.to.join(",") : input.to,
      subject: input.subject,
      text: input.message,
    });
    return { sent: true } as const;
  } catch (error) {
    console.error("[email] Failed to send:", input.subject, error);
    return { sent: false, reason: "send-failed" } as const;
  }
}
