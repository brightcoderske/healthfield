import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt, { hash } from "bcryptjs";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  branches, branchInventory, campaigns, chatConversations, chatMessages, mpesaIncomingPayments, mpesaStkCallbacks, orderItemFulfilments, orderItems, orders, paymentTransactions,
  activityLogs, authSessions, blogPosts, categories, emailVerificationTokens, healthConditions, prescriptions, productHealthConditions, productReviews, products, siteSettings, twoFactorChallenges, users,
} from "../../db/schema";
import { createPasswordResetToken, createSessionToken, createUploadToken, hasStoredTimestamp, requireSession, requestSession, revokeSession, revokeUserSessions, verifyPasswordResetToken } from "./auth";
import { getDb } from "./db";
import { orderEmailHtml, sendBulkEmail, sendEmail } from "./email";
import { emailVerificationResendCooldownMs, emailVerificationRetryAfterSeconds, emailVerificationTiming } from "./email-verification";
import { json, publicImageUrl, safeFilename } from "./http";
import { extractMpesaReceipt, initiateStkPush, mpesaConfiguration } from "./mpesa";
import { replayStoredStkCallback } from "./payment-handlers";
import { secureHashEqual, twoFactorChallengeLifetimeMs, twoFactorCodeHash, twoFactorMaximumAttempts, twoFactorMaximumResends, twoFactorResendCooldownMs, twoFactorTiming } from "./two-factor";

const admins = ["ADMIN", "SUPER_ADMIN"] as const;
const team = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const orderStatuses = ["NEW", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"] as const;

function storefrontOrigin() {
  return (process.env.APP_URL || process.env.STOREFRONT_URL || "https://healthfieldpharmacy.co.ke").replace(/\/$/, "");
}

const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const teamRedirect = (user: { role: string; forcePasswordChange: boolean }) => user.forcePasswordChange ? "/change-password" : user.role === "STAFF" ? "/staff" : "/admin";
async function createEmailTwoFactorChallenge(user: { id: number; email: string; firstName: string }) {
  const rawChallenge = randomUUID() + randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = Date.now();
  const timing = twoFactorTiming(now);
  const db = getDb();
  const challengeHash = tokenHash(rawChallenge);
  // Commit the challenge before handing off to SMTP. Holding the transaction --
  // and the user row lock -- open across the provider round-trip let hosting drop
  // the connection after the code had already been delivered, rolling the row back
  // so a freshly emailed code verified as "login request not found".
  await db.transaction(async (tx) => {
    // Serialize challenges for this account so two login tabs cannot both
    // announce themselves as the newest valid email code.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, user.id));
    await tx.insert(twoFactorChallenges).values({
      userId: user.id,
      tokenHash: challengeHash,
      codeHash: twoFactorCodeHash(rawChallenge, code),
      expiresAt: new Date(timing.expiresAtMs),
      expiresAtMs: timing.expiresAtMs,
      challengeEndsAtMs: now + twoFactorChallengeLifetimeMs,
      lastSentAtMs: now,
    });
  });
  try {
    const delivery = await sendEmail({
      to: user.email,
      subject: "Your Healthfield secure login code",
      message: `Hello ${user.firstName},\n\nYour Healthfield administration login code is ${code}.\n\nIt expires in 10 minutes and can only be used once. If you did not try to sign in, change your password and contact the pharmacy owner immediately.`,
      channel: "security",
    });
    if (!delivery.sent) throw new Error(`Security email delivery failed: ${delivery.reason}`);
  } catch (error) {
    // Retire only this challenge: a concurrent login may already have replaced it.
    await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.tokenHash, challengeHash)).catch(() => undefined);
    throw error;
  }
  const [name, domain] = user.email.split("@");
  const maskedEmail = `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
  return { challengeToken: rawChallenge, maskedEmail, ...timing, challengeEndsAtMs: now + twoFactorChallengeLifetimeMs };
}
async function sendVerificationEmail(user: { id: number; email: string; firstName: string }) {
  const raw = randomUUID() + randomUUID();
  const db = getDb();
  const timing = emailVerificationTiming(Date.now());
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id));
  const rawHash = tokenHash(raw);
  await db.insert(emailVerificationTokens).values({ userId: user.id, tokenHash: rawHash, expiresAt: new Date(timing.expiresAtMs), expiresAtMs: timing.expiresAtMs });
  try {
    const delivery = await sendEmail({ to: user.email, subject: "Activate your Healthfield Pharmacy account", message: `Hello ${user.firstName},\n\nThank you for signing up. Select the button below to verify your email address and activate your customer account. This secure link expires in 24 hours.\n\nIf you did not create this account, you can ignore this email.`, action: { label: "Activate my account", url: `${storefrontOrigin()}/verify-email?token=${encodeURIComponent(raw)}&email=${encodeURIComponent(user.email)}` }, channel: "security" });
    if (!delivery.sent) throw new Error(`Verification email delivery failed: ${delivery.reason}`);
    return timing;
  } catch (error) {
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, rawHash));
    throw error;
  }
}

async function body(request: Request) {
  const value = await request.json().catch(() => null);
  if (value && new URL(request.url).pathname.includes("/blogs") && value.imageUrl === null) value.imageUrl = "";
  return value;
}

export async function handleAuth(request: Request, action: string) {
  const db = getDb();
  if (action === "session" && request.method === "GET") {
    const auth = await requireSession(request);
    if ("response" in auth) return auth.response;
    return json({ authenticated: true, session: auth.session }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (action === "logout" && request.method === "POST") {
    await revokeSession(request);
    return json({ ok: true });
  }
  if (action === "upload-token" && request.method === "POST") {
    const auth = await requireSession(request);
    if ("response" in auth) return auth.response;
    return json({ token: await createUploadToken(auth.session), expiresIn: 300 }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (action === "login" && request.method === "POST") {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(128) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter a valid email and password." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
    const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : await bcrypt.compare(parsed.data.password, "$2b$12$1BVjhn5Hc7qJCnn84gWmTOj3DdbFI4zmL.RXsnXC6CIscSwMPxYjC");
    if (!user || !valid || !user.isActive) return json({ error: "Incorrect email or password." }, { status: 401 });
    if (user.role === "CUSTOMER" && !user.emailVerifiedAt) return json({ error: "Verify your email before signing in.", code: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    const session = { userId: user.id, email: user.email, firstName: user.firstName, role: user.role, forcePasswordChange: user.forcePasswordChange };
    if (team.includes(user.role as typeof team[number])) {
      const [settings] = await db.select({ requireTeamTwoFactor: siteSettings.requireTeamTwoFactor }).from(siteSettings).limit(1);
      if (settings?.requireTeamTwoFactor) {
        try {
          const challenge = await createEmailTwoFactorChallenge(user);
          return json({ requiresTwoFactor: true, ...challenge });
        } catch (error) {
          console.error("Two-factor email failed", error);
          return json({ error: "Your secure login code could not be sent. Please try again shortly." }, { status: 503 });
        }
      }
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    if (user.role === "CUSTOMER") await db.update(orders).set({ customerId: user.id }).where(and(isNull(orders.customerId), sql`lower(trim(${orders.email})) = ${user.email.trim().toLowerCase()}`));
    return json({ token: await createSessionToken(session), session, role: user.role, redirectTo: user.forcePasswordChange ? "/change-password" : user.role === "CUSTOMER" ? "/" : user.role === "STAFF" ? "/staff" : "/admin" });
  }
  if (action === "two-factor" && request.method === "POST") {
    const parsed = z.object({ challengeToken: z.string().min(60).max(100), code: z.string().trim().regex(/^\d{6}$/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter the 6-digit code sent to your email." }, { status: 400 });
    const challengeHash = tokenHash(parsed.data.challengeToken);
    const [challenge] = await db.select().from(twoFactorChallenges).where(eq(twoFactorChallenges.tokenHash, challengeHash)).limit(1);
    if (!challenge) { console.warn("2FA verification failed", { reason: "challenge_not_found", challengeHash: challengeHash.slice(0, 12) }); return json({ error: "This login request was not found. Return to login and start again.", code: "TWO_FACTOR_ENDED" }, { status: 401 }); }
    if (hasStoredTimestamp(challenge.usedAt)) { console.warn("2FA verification failed", { reason: "challenge_already_completed", challengeId: challenge.id }); return json({ error: "This login request has already been completed. Return to login and start again.", code: "TWO_FACTOR_ENDED" }, { status: 401 }); }
    if (challenge.attemptCount >= twoFactorMaximumAttempts) return json({ error: "Too many incorrect attempts. Send a new code to continue.", code: "TWO_FACTOR_LOCKED" }, { status: 401 });
    const now = Date.now();
    if (!challenge.expiresAtMs || now >= challenge.expiresAtMs) { console.warn("2FA verification failed", { reason: "challenge_expired", challengeId: challenge.id }); return json({ error: "This code has expired. Send a new code to continue.", code: "TWO_FACTOR_EXPIRED" }, { status: 401 }); }
    const expected = twoFactorCodeHash(parsed.data.challengeToken, parsed.data.code);
    if (!secureHashEqual(challenge.codeHash, expected)) {
      const attemptsRemaining = twoFactorMaximumAttempts - challenge.attemptCount - 1;
      await db.update(twoFactorChallenges).set({ attemptCount: challenge.attemptCount + 1 }).where(and(eq(twoFactorChallenges.id, challenge.id), isNull(twoFactorChallenges.usedAt), eq(twoFactorChallenges.attemptCount, challenge.attemptCount)));
      return json({ error: attemptsRemaining <= 0 ? "Too many incorrect attempts. Send a new code to continue." : `That code is incorrect. ${attemptsRemaining} ${attemptsRemaining === 1 ? "attempt" : "attempts"} remaining.`, code: attemptsRemaining <= 0 ? "TWO_FACTOR_LOCKED" : "TWO_FACTOR_INCORRECT", attemptsRemaining }, { status: 401 });
    }
    const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user || !user.isActive || !team.includes(user.role as typeof team[number])) return json({ error: "This login request is no longer valid." }, { status: 401 });
    // Consume the verifier before creating a session. Concurrent submissions
    // can both read the row, but exactly one can claim this code.
    const [claimed] = await db.update(twoFactorChallenges).set({ usedAt: new Date() }).where(and(eq(twoFactorChallenges.id, challenge.id), eq(twoFactorChallenges.codeHash, expected), isNull(twoFactorChallenges.usedAt), eq(twoFactorChallenges.attemptCount, challenge.attemptCount), gte(twoFactorChallenges.expiresAtMs, now)));
    if (claimed.affectedRows !== 1) return json({ error: "This security code has already been used." }, { status: 401 });
    const session = { userId: user.id, email: user.email, firstName: user.firstName, role: user.role, forcePasswordChange: user.forcePasswordChange };
    let token: string;
    try {
      token = await createSessionToken(session);
    } catch (error) {
      console.error("2FA verification failed", { reason: "session_creation_failed", challengeId: challenge.id, error });
      return json({ error: "Your code was accepted, but the secure session could not be created. Return to login for a new code." }, { status: 503 });
    }
    await db.update(users).set({ twoFactorEnabled: true, lastLoginAt: new Date() }).where(eq(users.id, user.id)).catch((error) => console.error("2FA login audit update failed", { userId: user.id, error }));
    return json({ token, session, role: user.role, redirectTo: teamRedirect(user) });
  }
  if (action === "two-factor-resend" && request.method === "POST") {
    const parsed = z.object({ challengeToken: z.string().min(60).max(100) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "This login request is invalid." }, { status: 400 });
    const hash = tokenHash(parsed.data.challengeToken);
    const [challenge] = await db.select().from(twoFactorChallenges).where(eq(twoFactorChallenges.tokenHash, hash)).limit(1);
    const now = Date.now();
    if (!challenge || hasStoredTimestamp(challenge.usedAt) || now >= challenge.challengeEndsAtMs || challenge.resendCount >= twoFactorMaximumResends) return json({ error: "This secure login request has ended. Return to login to start again.", code: "TWO_FACTOR_ENDED" }, { status: 429 });
    if (!challenge.lastSentAtMs || now - challenge.lastSentAtMs < twoFactorResendCooldownMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil(((challenge.lastSentAtMs || now) + twoFactorResendCooldownMs - now) / 1000));
      return json({ error: `You can send another code in ${retryAfterSeconds} seconds.`, code: "TWO_FACTOR_COOLDOWN", retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
    }
    const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user || !user.isActive || !team.includes(user.role as typeof team[number])) return json({ error: "This login request is no longer valid." }, { status: 401 });
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const timing = twoFactorTiming(now);
    const { expiresAtMs } = timing;
    const [rotated] = await db.update(twoFactorChallenges).set({ codeHash: twoFactorCodeHash(parsed.data.challengeToken, code), attemptCount: 0, resendCount: challenge.resendCount + 1, expiresAt: new Date(expiresAtMs), expiresAtMs, lastSentAtMs: now }).where(and(eq(twoFactorChallenges.id, challenge.id), isNull(twoFactorChallenges.usedAt), eq(twoFactorChallenges.resendCount, challenge.resendCount)));
    if (rotated.affectedRows !== 1) return json({ error: "This secure login request has changed. Return to login to start again.", code: "TWO_FACTOR_ENDED" }, { status: 409 });
    try {
      const delivery = await sendEmail({ to: user.email, subject: "Your new Healthfield secure login code", message: `Hello ${user.firstName},\n\nYour new Healthfield administration login code is ${code}.\n\nIt expires in 10 minutes and can only be used once.`, channel: "security" });
      if (!delivery.sent) throw new Error(`Security email delivery failed: ${delivery.reason}`);
    } catch (error) {
      console.error("Two-factor resend failed", error);
      await db.update(twoFactorChallenges).set({ usedAt: new Date() }).where(eq(twoFactorChallenges.id, challenge.id));
      return json({ error: "The new code could not be sent. Return to login and try again.", code: "TWO_FACTOR_DELIVERY_FAILED" }, { status: 503 });
    }
    return json({ ok: true, message: "A new security code has been sent.", ...timing, challengeEndsAtMs: challenge.challengeEndsAtMs });
  }
  if (action === "forgot-password" && request.method === "POST") {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter a valid email address." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (user?.isActive) {
      const token = await createPasswordResetToken({ userId: user.id, email: user.email });
      const resetUrl = `${storefrontOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
      await sendEmail({ to: user.email, subject: "Reset your Healthfield Pharmacy password", message: `Hello ${user.firstName},\n\nUse the button below to choose a new password. It expires in one hour.\n\nIf you did not request this, you can ignore this email.`, action:{label:"Reset password",url:resetUrl}, channel:"security" });
    }
    return json({ ok: true, message: "If this email is registered, reset instructions will be sent." });
  }
  if (action === "reset-password" && request.method === "POST") {
    const parsed = z.object({ token: z.string().min(20), newPassword: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Use a strong new password." }, { status: 400 });
    const reset = await verifyPasswordResetToken(parsed.data.token);
    if (!reset) return json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    const [user] = await db.select().from(users).where(and(eq(users.id, reset.userId), eq(users.email, reset.email))).limit(1);
    if (!user || !user.isActive) return json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    await db.update(users).set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), forcePasswordChange: false }).where(eq(users.id, user.id));
    await revokeUserSessions(user.id);
    void sendEmail({ to: user.email, subject: "Your Healthfield password was changed", message: `Hello ${user.firstName},\n\nYour Healthfield Pharmacy password was changed successfully. If you did not do this, contact the pharmacy immediately.`, action:{label:"Sign in securely",url:`${storefrontOrigin()}/login`}, channel:"security" });
    return json({ ok: true, message: "Password updated. You can sign in with your new password." });
  }
  if (action === "register" && request.method === "POST") {
    const parsed = z.object({
      firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100),
      email: z.string().trim().toLowerCase().email(), phone: z.string().trim().min(9).max(30),
      password: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
      acceptTerms: z.literal(true), marketingConsent: z.boolean().default(false),
    }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Complete every field and use a strong password." }, { status: 400 });
    const [existing] = await db.select({ email: users.email, phone: users.phone }).from(users).where(or(eq(users.email, parsed.data.email), eq(users.phone, parsed.data.phone))).limit(1);
    if (existing?.email === parsed.data.email) return json({ error: "An account already uses this email." }, { status: 409 });
    if (existing?.phone === parsed.data.phone) return json({ error: "An account already uses this phone number." }, { status: 409 });
    const { acceptTerms: _acceptTerms, password, ...customer } = parsed.data;
    let created;
    try {
      [created] = await db.insert(users).values({ ...customer, passwordHash: await bcrypt.hash(password, 12), role: "CUSTOMER", isActive: true, twoFactorEnabled: false, forcePasswordChange: false, termsAcceptedAt: new Date(), marketingConsentAt: customer.marketingConsent ? new Date() : null });
    } catch (error) {
      console.error("Customer registration insert failed", error);
      return json({ error: "That email address or phone number is already registered." }, { status: 409 });
    }
    let verificationSent = true;
    try {
      await sendVerificationEmail({ id: created.insertId, email: customer.email, firstName: customer.firstName });
    } catch (error) {
      verificationSent = false;
      console.error("Registration activation email failed", { userId: created.insertId, error });
    }
    const query = new URLSearchParams({ sent: "1", email: customer.email, delivery: verificationSent ? "sent" : "failed" });
    return json({ ok: true, email: customer.email, verificationSent, redirectTo: `/verify-email?${query}` }, { status: 201 });
  }
  if (action === "verify-email" && request.method === "POST") {
    const parsed = z.object({ token: z.string().min(40) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "This verification link is invalid." }, { status: 400 });
    const [record] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, tokenHash(parsed.data.token))).limit(1);
    if (!record || !record.expiresAtMs || record.expiresAtMs <= Date.now()) return json({ error: "This activation link is invalid or has expired.", code: "ACTIVATION_LINK_INVALID" }, { status: 400 });
    const [user] = await db.select().from(users).where(and(eq(users.id, record.userId), eq(users.role, "CUSTOMER"))).limit(1);
    if (!user) return json({ error: "This activation link is no longer valid.", code: "ACTIVATION_LINK_INVALID" }, { status: 400 });
    if (hasStoredTimestamp(record.usedAt) || hasStoredTimestamp(user.emailVerifiedAt)) {
      if (!hasStoredTimestamp(user.emailVerifiedAt)) return json({ error: "This activation link is no longer valid.", code: "ACTIVATION_LINK_INVALID" }, { status: 400 });
      return json({ ok: true, alreadyActivated: true, message: "Your email is already verified. You can continue to login." });
    }
    const activated = await db.transaction(async (tx) => {
      const [result] = await tx.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)));
      await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));
      if (result.affectedRows === 1) await tx.update(orders).set({ customerId: user.id }).where(and(isNull(orders.customerId), sql`lower(trim(${orders.email})) = ${user.email.trim().toLowerCase()}`));
      return result.affectedRows === 1;
    });
    if (activated && process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: "New verified Healthfield customer", message: `${user.firstName} ${user.lastName} activated a customer account.\nEmail: ${user.email}\nPhone: ${user.phone || "Not provided"}`, channel: "security" }).catch(console.error);
    return json({ ok: true, alreadyActivated: !activated, message: activated ? "Your email has been verified and your account is ready." : "Your email is already verified. You can continue to login." });
  }
  if (action === "resend-verification" && request.method === "POST") {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter a valid email." }, { status: 400 });
    const [user] = await db.select().from(users).where(and(eq(users.email, parsed.data.email), eq(users.role, "CUSTOMER"))).limit(1);
    if (!user || user.emailVerifiedAt) return json({ ok: true, message: "If this account still needs activation, a fresh link has been sent." });
    const [current] = await db.select({ expiresAtMs: emailVerificationTokens.expiresAtMs }).from(emailVerificationTokens).where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt))).orderBy(desc(emailVerificationTokens.createdAt)).limit(1);
    const retryAfterSeconds = emailVerificationRetryAfterSeconds(current?.expiresAtMs ?? null, Date.now());
    if (retryAfterSeconds > 0) return json({ error: `Please wait ${retryAfterSeconds} seconds before requesting another activation email.`, code: "ACTIVATION_COOLDOWN", retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
    try {
      await sendVerificationEmail(user);
      return json({ ok: true, message: `A fresh activation link has been sent to ${user.email}.`, retryAfterSeconds: emailVerificationResendCooldownMs / 1000 });
    } catch (error) {
      console.error("Activation email resend failed", { userId: user.id, error });
      return json({ error: "We could not send the activation email right now. Please try again shortly.", code: "ACTIVATION_DELIVERY_FAILED" }, { status: 503 });
    }
  }
  if (action === "change-password" && request.method === "POST") {
    const auth = await requireSession(request, [...team]);
    if ("response" in auth) return auth.response;
    const parsed = z.object({ currentPassword: z.string().min(8).max(128), newPassword: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Use a strong new password." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.id, auth.session.userId)).limit(1);
    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return json({ error: "Current password is incorrect." }, { status: 400 });
    await db.update(users).set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), forcePasswordChange: false }).where(eq(users.id, user.id));
    const session = { ...auth.session, forcePasswordChange: false };
    return json({ token: await createSessionToken(session), session, redirectTo: session.role === "CUSTOMER" ? "/" : session.role === "STAFF" ? "/staff" : "/admin" });
  }
  return json({ error: "Authentication route not found." }, { status: 404 });
}

export async function handleChats(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  const requested = Number(new URL(request.url).searchParams.get("conversation") || 0);
  if (request.method === "GET") {
    let conversationId = requested;
    if (auth.session.role === "CUSTOMER") {
      const [conversation] = await db.select().from(chatConversations).where(eq(chatConversations.customerId, auth.session.userId)).limit(1);
      conversationId = conversation?.id || 0;
    } else if (!team.includes(auth.session.role as typeof team[number])) return json({ error: "Not allowed." }, { status: 403 });
    if (!conversationId) return json({ messages: [] });
    const [allowed] = auth.session.role === "CUSTOMER" ? await db.select({ id: chatConversations.id }).from(chatConversations).where(and(eq(chatConversations.id, conversationId), eq(chatConversations.customerId, auth.session.userId))).limit(1) : [{ id: conversationId }];
    if (!allowed) return json({ error: "Not found." }, { status: 404 });
    const messages = await db.select({ id: chatMessages.id, message: chatMessages.message, createdAt: chatMessages.createdAt, senderId: chatMessages.senderId, firstName: users.firstName, role: users.role }).from(chatMessages).innerJoin(users, eq(users.id, chatMessages.senderId)).where(eq(chatMessages.conversationId, conversationId)).orderBy(chatMessages.createdAt);
    await db.update(chatMessages).set({ readAt: new Date() }).where(and(eq(chatMessages.conversationId, conversationId), ne(chatMessages.senderId, auth.session.userId)));
    return json({ conversationId, messages });
  }
  if (request.method === "POST") {
    const parsed = z.object({ message: z.string().trim().min(1).max(2000), conversationId: z.number().int().positive().optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Write a message first." }, { status: 400 });
    let conversationId = parsed.data.conversationId;
    if (auth.session.role === "CUSTOMER") {
      const [existing] = await db.select().from(chatConversations).where(eq(chatConversations.customerId, auth.session.userId)).limit(1);
      if (existing) conversationId = existing.id;
      else conversationId = (await db.insert(chatConversations).values({ customerId: auth.session.userId }))[0].insertId;
    } else if (!conversationId || !team.includes(auth.session.role as typeof team[number])) return json({ error: "Conversation required." }, { status: 400 });
    await db.insert(chatMessages).values({ conversationId: conversationId!, senderId: auth.session.userId, message: parsed.data.message });
    await db.update(chatConversations).set({ lastMessageAt: new Date(), status: "OPEN" }).where(eq(chatConversations.id, conversationId!));
    return json({ ok: true, conversationId }, { status: 201 });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleOrders(request: Request, id?: number) {
  if (request.method === "DELETE" && id) {
    const auth = await requireSession(request, [...admins]);
    if ("response" in auth) return auth.response;
    const db = getDb();
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status }).from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return json({ error: "Order not found." }, { status: 404 });
    if (!["NEW", "CONFIRMED", "UNDER_REVIEW", "CANCELLED"].includes(order.status)) return json({ error: "Only unfulfilled or cancelled orders can be deleted. Completed and dispatched orders are retained for audit records." }, { status: 409 });
    await db.transaction(async tx => {
      const items = await tx.select({ id: orderItems.id, productId: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, id));
      if (items.length) {
        const fulfilments = await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map(item => item.id)));
        for (const fulfilment of fulfilments) {
          const item = items.find((row) => row.id === fulfilment.orderItemId);
          if (!item?.productId || fulfilment.quantityReserved <= 0) continue;
          const [stock] = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, fulfilment.branchId), eq(branchInventory.productId, item.productId))).limit(1).for("update");
          if (stock) await tx.update(branchInventory).set({ quantityReserved: Math.max(0, stock.quantityReserved - fulfilment.quantityReserved), updatedBy: auth.session.userId }).where(eq(branchInventory.id, stock.id));
        }
        await tx.delete(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map(item => item.id)));
      }
      const payments = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(eq(paymentTransactions.orderId, id));
      if (payments.length) {
        await tx.update(mpesaIncomingPayments).set({ matchedTransactionId: null }).where(inArray(mpesaIncomingPayments.matchedTransactionId, payments.map((payment) => payment.id)));
        await tx.update(mpesaStkCallbacks).set({ processedTransactionId: null }).where(inArray(mpesaStkCallbacks.processedTransactionId, payments.map((payment) => payment.id)));
        await tx.delete(paymentTransactions).where(eq(paymentTransactions.orderId, id));
      }
      await tx.update(prescriptions).set({ orderId: null }).where(eq(prescriptions.orderId, id));
      await tx.delete(orderItems).where(eq(orderItems.orderId, id));
      await tx.delete(orders).where(eq(orders.id, id));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "ORDER_DELETED", entityType: "order", entityId: String(id), metadata: { orderNumber: order.orderNumber } });
    });
    return json({ ok: true, message: `Order ${order.orderNumber} was deleted.` });
  }
  if (request.method === "PATCH" && id) {
    const auth = await requireSession(request, [...team]);
    if ("response" in auth) return auth.response;
    const parsed = z.object({ status:z.enum(orderStatuses),customerName:z.string().trim().max(200).optional(),phone:z.string().trim().max(30).optional(),email:z.string().trim().max(190).nullable().optional(),deliveryAddress:z.string().trim().max(1000).nullable().optional(),deliveryArea:z.string().trim().max(160).nullable().optional(),fulfilments:z.array(z.object({orderItemId:z.number().int().positive(),branchId:z.number().int().positive(),quantityReserved:z.number().int().nonnegative(),quantityPacked:z.number().int().nonnegative(),status:z.enum(["UNASSIGNED","RESERVED","PARTIALLY_RESERVED","PACKED","READY","UNAVAILABLE","REPLACED"])})).optional() }).safeParse(await body(request));
    if (!Number.isInteger(id) || !parsed.success) return json({ error: "Check the order details and status." }, { status: 400 });
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return json({ error: "Order not found." }, { status: 404 });
    const editable=!['READY_FOR_DISPATCH','OUT_FOR_DELIVERY','READY_FOR_PICKUP','COMPLETED','CANCELLED'].includes(order.status);
    const {status,fulfilments,...details}=parsed.data;
    if (["BEING_FULFILLED","PARTIALLY_READY","READY_FOR_DISPATCH","OUT_FOR_DELIVERY","READY_FOR_PICKUP","COMPLETED"].includes(status) && order.prescriptionStatus !== "NOT_REQUIRED" && order.prescriptionStatus !== "APPROVED") return json({ error: "Approve the linked prescription before fulfilling or dispatching this order." }, { status: 409 });
    if (["CONFIRMED","BEING_FULFILLED","PARTIALLY_READY","READY_FOR_DISPATCH","OUT_FOR_DELIVERY","READY_FOR_PICKUP","COMPLETED"].includes(status) && order.paymentStatus !== "PAID") return json({ error: "Confirm payment before approving, processing or dispatching this order." }, { status: 409 });
    if (!editable && status !== order.status) return json({ error: "A dispatched, completed or cancelled order cannot move to another status." }, { status: 409 });
    if (!editable && fulfilments) return json({ error: "Serving-store assignments lock after packaging." }, { status: 400 });
    try {
      await db.transaction(async (tx) => {
        const items = await tx.select({ id: orderItems.id, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, id));
        const byId = new Map(items.map((item) => [item.id, item]));
        const previous = items.length ? await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [];
        const target = fulfilments ?? previous.map((row) => ({ orderItemId: row.orderItemId, branchId: row.branchId, quantityReserved: row.quantityReserved, quantityPacked: row.quantityPacked, status: row.status }));
        if (target.length) {
          const branchRows = await tx.select({ id: branches.id }).from(branches).where(inArray(branches.id, target.map((row) => row.branchId)));
          if (branchRows.length !== new Set(target.map((row) => row.branchId)).size) throw new Error("Choose valid serving stores.");
          for (const row of target) {
            const item = byId.get(row.orderItemId);
            if (!item || item.productId === null || row.quantityReserved !== item.quantity || row.quantityPacked > row.quantityReserved) throw new Error("Check the serving-store quantities.");
          }
        }
        const productIds = items.flatMap((item) => item.productId === null ? [] : [item.productId]);
        const inventory = productIds.length ? await tx.select().from(branchInventory).where(inArray(branchInventory.productId, productIds)).for("update") : [];
        const index = new Map(inventory.map((row) => [`${row.branchId}:${row.productId}`, { ...row }]));
        const changingAllocation = fulfilments !== undefined || status === "CANCELLED" || ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED"].includes(status);
        if (changingAllocation) {
          for (const row of previous) {
            const item = byId.get(row.orderItemId);
            const record = item?.productId ? index.get(`${row.branchId}:${item.productId}`) : undefined;
            if (record) record.quantityReserved = Math.max(0, record.quantityReserved - row.quantityReserved);
          }
        }
        const finalStatus = ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED"].includes(status);
        if (status !== "CANCELLED" && changingAllocation) {
          if (finalStatus && !target.length) throw new Error("Assign a serving store before dispatching this order.");
          for (const row of target) {
            const item = byId.get(row.orderItemId)!;
            const record = index.get(`${row.branchId}:${item.productId}`);
            const sellable = record ? record.quantityAvailable - record.quantityReserved : 0;
            if (!record || sellable < row.quantityReserved) throw new Error(`Insufficient stock for ${item.productName} at the selected store.`);
            if (finalStatus) record.quantityAvailable -= row.quantityReserved;
            else record.quantityReserved += row.quantityReserved;
          }
        }
        for (const record of index.values()) await tx.update(branchInventory).set({ quantityAvailable: record.quantityAvailable, quantityReserved: record.quantityReserved, updatedBy: auth.session.userId }).where(eq(branchInventory.id, record.id));
        if (changingAllocation && items.length) {
          await tx.delete(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id)));
          if (status !== "CANCELLED" && target.length) await tx.insert(orderItemFulfilments).values(target.map((row) => ({ ...row, quantityPacked: finalStatus ? row.quantityReserved : row.quantityPacked, status: finalStatus ? "READY" as const : row.status, handledBy: auth.session.userId })));
        }
        await tx.update(orders).set({ status, ...(editable ? details : {}) }).where(eq(orders.id, id));
      });
    } catch(error) { return json({ error:error instanceof Error?error.message:"Order could not be updated." },{status:400}); }
    if(order.status===status)return json({ok:true,status});
    const label = status==="READY_FOR_DISPATCH"?"packaged and ready for dispatch":status.replaceAll("_", " ").toLowerCase();
    const notificationEmail=details.email===undefined?order.email:details.email,notificationName=details.customerName||order.customerName;
    if (notificationEmail) void sendEmail({ to: notificationEmail, subject: `Order ${order.orderNumber} update`, message: `Hello ${notificationName},\n\nYour order ${order.orderNumber} is now ${label}.\n\nThank you for choosing Healthfield Pharmacy.`, action:{label:"Track my order",url:`${storefrontOrigin()}/account#orders`}, channel:"orders" });
    if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `Order ${order.orderNumber} → ${parsed.data.status}`, message: `${order.customerName}'s order ${order.orderNumber} changed from ${order.status} to ${parsed.data.status}.`, channel:"orders" });
    return json({ok:true,status});
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    fullName: z.string().trim().min(3).max(200), phone: z.string().trim().min(9).max(30), email: z.string().trim().email().optional().or(z.literal("")),
    fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]), paymentMethod: z.enum(["MPESA_EXPRESS", "MANUAL_MPESA"]), billingPhone: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(30).optional()), manualPaymentMessage: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(2500).optional()), deliveryAddress: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(1000).optional()), deliveryArea: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(160).optional()),
    deliveryLatitude: z.preprocess(value=>value===null?undefined:value,z.number().min(-90).max(90).optional()), deliveryLongitude: z.preprocess(value=>value===null?undefined:value,z.number().min(-180).max(180).optional()),
    checkoutToken: z.string().uuid(), items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  if (parsed.data.fulfilmentMethod === "DELIVERY" && !parsed.data.deliveryAddress) return json({ error: "Delivery address is required." }, { status: 400 });
  const db = getDb();
  const [duplicate] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, paymentStatus: orders.paymentStatus, paymentMethod: orders.paymentMethod }).from(orders).where(eq(orders.checkoutToken, parsed.data.checkoutToken)).limit(1);
  if (duplicate) return json({ ok: true, id: duplicate.id, orderNumber: duplicate.orderNumber, total: Number(duplicate.total), paymentStatus: duplicate.paymentStatus, paymentMethod: duplicate.paymentMethod, duplicate: true });
  const [paymentSettings] = await db.select({ onlineMpesaEnabled: siteSettings.onlineMpesaEnabled, onlineManualEnabled: siteSettings.onlineManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber }).from(siteSettings).limit(1);
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && (!paymentSettings?.onlineMpesaEnabled || !mpesaConfiguration())) return json({ error: "M-Pesa Express is currently unavailable. Choose manual M-Pesa payment.", code: "MPESA_UNAVAILABLE" }, { status: 409 });
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (!paymentSettings?.onlineManualEnabled || !paymentSettings.mpesaTillNumber)) return json({ error: "Manual M-Pesa payment is currently unavailable.", code: "MANUAL_PAYMENT_UNAVAILABLE" }, { status: 409 });
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (parsed.data.manualPaymentMessage || "").trim().length < 10) return json({ error: "Paste the complete M-Pesa payment message." }, { status: 400 });
  const manualReceipt = parsed.data.paymentMethod === "MANUAL_MPESA" ? extractMpesaReceipt(parsed.data.manualPaymentMessage || "") : null;
  const catalog = await db.select().from(products).where(inArray(products.id, parsed.data.items.map((item) => item.productId)));
  if (catalog.length !== new Set(parsed.data.items.map((item) => item.productId)).size) return json({ error: "One or more products are unavailable." }, { status: 409 });
  const lines = parsed.data.items.map((item) => { const product = catalog.find((entry) => entry.id === item.productId)!; const price = Number(product.discountPrice ?? product.price); return { ...item, product, price, total: price * item.quantity }; });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const deliveryFee = parsed.data.fulfilmentMethod === "DELIVERY" ? 250 : 0;
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && !Number.isInteger(subtotal + deliveryFee)) return json({ error: "M-Pesa Express requires a whole-shilling total. Choose manual M-Pesa for this order." }, { status: 409 });
  const session = await requestSession(request);
  const customerSession = session?.role === "CUSTOMER" ? session : null;
  if (!customerSession && !parsed.data.email) return json({ error: "Enter your email so this guest order can be linked if you create an account later." }, { status: 400 });
  const requiresPrescription = catalog.some(product => product.prescriptionRequired);
  let customerPrescription: typeof prescriptions.$inferSelect | undefined;
  if (requiresPrescription) {
    if (!customerSession) return json({ error: "Sign in and upload a prescription before ordering prescription medicine.", code: "PRESCRIPTION_REQUIRED" }, { status: 409 });
    [customerPrescription] = await db.select().from(prescriptions).where(and(eq(prescriptions.customerId, customerSession.userId), isNull(prescriptions.orderId))).orderBy(desc(prescriptions.createdAt)).limit(1);
    if (!customerPrescription) return json({ error: "Upload a prescription before placing this order.", code: "PRESCRIPTION_REQUIRED" }, { status: 409 });
    if (customerPrescription.status === "DECLINED") return json({ error: "Your latest prescription was declined. Upload a new valid prescription.", code: "PRESCRIPTION_REQUIRED" }, { status: 409 });
  }
  const orderEmail = customerSession ? customerSession.email.trim().toLowerCase() : (parsed.data.email || "").trim().toLowerCase();
  const orderNumber = `HF-${Date.now().toString().slice(-8)}`;
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(orders).values({ orderNumber, checkoutToken: parsed.data.checkoutToken, customerId: customerSession?.userId ?? null, customerName: parsed.data.fullName, phone: parsed.data.phone, email: orderEmail || null, fulfilmentMethod: parsed.data.fulfilmentMethod, paymentMethod: parsed.data.paymentMethod, paymentReference: manualReceipt, deliveryAddress: parsed.data.deliveryAddress || null, deliveryArea: parsed.data.deliveryArea || null, deliveryLatitude: parsed.data.deliveryLatitude?.toString() || null, deliveryLongitude: parsed.data.deliveryLongitude?.toString() || null, status: requiresPrescription ? "UNDER_REVIEW" : "NEW", prescriptionStatus: requiresPrescription ? customerPrescription!.status : "NOT_REQUIRED", subtotal: subtotal.toString(), deliveryFee: deliveryFee.toString(), discount: "0", total: (subtotal + deliveryFee).toString() });
    await tx.insert(orderItems).values(lines.map((line) => ({ orderId: created.insertId, productId: line.product.id, productName: line.product.name, quantity: line.quantity, unitPrice: line.price.toString(), lineTotal: line.total.toString() })));
    if (customerPrescription) await tx.update(prescriptions).set({ orderId: created.insertId }).where(eq(prescriptions.id, customerPrescription.id));
    const [payment] = await tx.insert(paymentTransactions).values({ orderId: created.insertId, method: parsed.data.paymentMethod, channel: "ONLINE", status: parsed.data.paymentMethod === "MANUAL_MPESA" ? "REQUIRES_REVIEW" : "INITIATED", amount: (subtotal + deliveryFee).toFixed(2), phone: parsed.data.billingPhone || parsed.data.phone, receiptNumber: manualReceipt, manualMessage: parsed.data.manualPaymentMessage || null });
    return { orderId: created.insertId, paymentId: payment.insertId };
  });
  let paymentStatus: "PENDING" | "FAILED" = "PENDING";
  let paymentMessage = parsed.data.paymentMethod === "MANUAL_MPESA" ? "Payment proof submitted for administrator approval." : "Check your phone and enter your M-Pesa PIN.";
  if (parsed.data.paymentMethod === "MPESA_EXPRESS") {
    try {
      const stk = await initiateStkPush({ orderNumber, phone: parsed.data.billingPhone || parsed.data.phone, amount: subtotal + deliveryFee });
      await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, result.paymentId));
      await replayStoredStkCallback(stk.checkoutRequestId);
      paymentMessage = stk.customerMessage;
    } catch (error) {
      paymentStatus = "FAILED";
      paymentMessage = error instanceof Error ? error.message : "M-Pesa Express could not start.";
      await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: paymentMessage }).where(eq(paymentTransactions.id, result.paymentId));
      await db.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, result.orderId));
    }
  }
  if (orderEmail && parsed.data.paymentMethod === "MANUAL_MPESA") void sendEmail({ to: orderEmail, subject: `Payment proof received for ${orderNumber}`, message: `Hello ${parsed.data.fullName},\n\nWe received your payment proof for order ${orderNumber}. Total: KES ${(subtotal + deliveryFee).toLocaleString()}. We will confirm it before processing the order.`, html:orderEmailHtml({name:parsed.data.fullName,orderNumber,items:lines.map(line=>({productName:line.product.name,quantity:line.quantity,lineTotal:line.total.toString()})),subtotal,deliveryFee,total:subtotal+deliveryFee,status:"PAYMENT REVIEW"}), channel:"orders" });
  if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `New order ${orderNumber}`, message: `${parsed.data.fullName} placed order ${orderNumber}.\nPhone: ${parsed.data.phone}\nEmail: ${parsed.data.email || "not provided"}\nFulfilment: ${parsed.data.fulfilmentMethod}\nTotal: KES ${(subtotal + deliveryFee).toLocaleString()}.`, channel:"orders" });
  return json({ ok: true, id: result.orderId, orderNumber, total: subtotal + deliveryFee, paymentStatus, paymentMethod: parsed.data.paymentMethod, paymentMessage }, { status: 202 });
}

export async function handleWalkInSales(request: Request) {
  const auth = await requireSession(request, [...team]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    branchId: z.number().int().positive(),
    customerName: z.string().trim().max(200).optional(), phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().optional().or(z.literal("")),
    checkoutToken: z.string().uuid(), paymentMethod: z.enum(["CASH", "MPESA_EXPRESS", "MANUAL_MPESA"]), billingPhone: z.string().trim().max(30).optional(), manualPaymentMessage: z.string().trim().max(2500).optional(),
    items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Choose a branch and at least one valid product." }, { status: 400 });
  const db = getDb();
  const [duplicate] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.checkoutToken, parsed.data.checkoutToken)).limit(1);
  if (duplicate) return json({ ok: true, id: duplicate.id, orderNumber: duplicate.orderNumber, total: Number(duplicate.total), paymentStatus: duplicate.paymentStatus, duplicate: true });
  const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, parsed.data.branchId), eq(branches.isActive, true))).limit(1);
  if (!branch) return json({ error: "Choose an active branch." }, { status: 400 });
  const grouped = new Map<number, number>();
  for (const item of parsed.data.items) grouped.set(item.productId, (grouped.get(item.productId) || 0) + item.quantity);
  const itemList = [...grouped].map(([productId, quantity]) => ({ productId, quantity }));
  const catalog = await db.select().from(products).where(and(inArray(products.id, itemList.map((item) => item.productId)), eq(products.isActive, true)));
  if (catalog.length !== itemList.length) return json({ error: "One or more products are unavailable." }, { status: 409 });
  const subtotal = itemList.reduce((sum, item) => { const product = catalog.find((entry) => entry.id === item.productId)!; return sum + Number(product.discountPrice ?? product.price) * item.quantity; }, 0);
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && !Number.isInteger(subtotal)) return json({ error: "M-Pesa Express requires a whole-shilling total. Choose cash or manual M-Pesa." }, { status: 409 });
  const [paymentSettings] = await db.select({ posCashEnabled: siteSettings.posCashEnabled, posMpesaEnabled: siteSettings.posMpesaEnabled, posManualEnabled: siteSettings.posManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber }).from(siteSettings).limit(1);
  if (parsed.data.paymentMethod === "CASH" && paymentSettings?.posCashEnabled === false) return json({ error: "Cash payment is disabled in settings." }, { status: 409 });
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && (!paymentSettings?.posMpesaEnabled || !mpesaConfiguration())) return json({ error: "M-Pesa Express is unavailable. Choose cash or manual M-Pesa." }, { status: 409 });
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (!paymentSettings?.posManualEnabled || !paymentSettings.mpesaTillNumber)) return json({ error: "Manual M-Pesa is unavailable." }, { status: 409 });
  const manualReceipt = null;
  const orderNumber = `POS-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
  try {
    const result = await db.transaction(async (tx) => {
      const stock = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, branch.id), inArray(branchInventory.productId, itemList.map((item) => item.productId)))).for("update");
      for (const item of itemList) {
        const record = stock.find((row) => row.productId === item.productId);
        if (!record || record.quantityAvailable - record.quantityReserved < item.quantity) {
          const product = catalog.find((entry) => entry.id === item.productId)!;
          throw new Error(`Insufficient stock for ${product.name}.`);
        }
      }
      const paidCash = parsed.data.paymentMethod === "CASH";
      const cashReference = paidCash ? `CASH-${orderNumber}` : null;
      const [created] = await tx.insert(orders).values({ orderNumber, checkoutToken: parsed.data.checkoutToken, customerName: parsed.data.customerName || "Walk-in customer", phone: parsed.data.phone || parsed.data.billingPhone || "Walk-in", email: parsed.data.email || null, fulfilmentMethod: "PICKUP", status: paidCash ? "COMPLETED" : "NEW", paymentStatus: paidCash ? "PAID" : "PENDING", paymentMethod: parsed.data.paymentMethod, paymentReference: manualReceipt || cashReference, amountPaid: paidCash ? subtotal.toFixed(2) : "0", subtotal: subtotal.toFixed(2), deliveryFee: "0", discount: "0", total: subtotal.toFixed(2), suggestedBranchId: branch.id });
      const insertedItems: Array<{ id: number; productId: number; quantity: number }> = [];
      for (const item of itemList) {
        const product = catalog.find((entry) => entry.id === item.productId)!;
        const unitPrice = Number(product.discountPrice ?? product.price);
        const [createdItem] = await tx.insert(orderItems).values({ orderId: created.insertId, productId: product.id, productName: product.name, quantity: item.quantity, unitPrice: unitPrice.toFixed(2), lineTotal: (unitPrice * item.quantity).toFixed(2) });
        insertedItems.push({ id: createdItem.insertId, productId: item.productId, quantity: item.quantity });
      }
      for (const item of insertedItems) {
        const record = stock.find((row) => row.productId === item.productId)!;
        await tx.update(branchInventory).set({ quantityAvailable: paidCash ? record.quantityAvailable - item.quantity : record.quantityAvailable, quantityReserved: paidCash ? record.quantityReserved : record.quantityReserved + item.quantity, updatedBy: auth.session.userId }).where(eq(branchInventory.id, record.id));
        await tx.insert(orderItemFulfilments).values({ orderItemId: item.id, branchId: branch.id, handledBy: auth.session.userId, quantityReserved: paidCash ? 0 : item.quantity, quantityPacked: paidCash ? item.quantity : 0, status: paidCash ? "READY" : "RESERVED" });
      }
      const [payment] = await tx.insert(paymentTransactions).values({ orderId: created.insertId, method: parsed.data.paymentMethod, channel: "POS", status: paidCash ? "PAID" : parsed.data.paymentMethod === "MANUAL_MPESA" ? "PENDING" : "INITIATED", amount: subtotal.toFixed(2), phone: parsed.data.billingPhone || parsed.data.phone || null, receiptNumber: cashReference, manualMessage: null, verifiedAt: paidCash ? new Date() : null, reviewedBy: paidCash ? auth.session.userId : null, reviewedAt: paidCash ? new Date() : null });
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: paidCash ? "WALK_IN_SALE" : "WALK_IN_PAYMENT_STARTED", entityType: "order", entityId: String(created.insertId), metadata: { branchId: branch.id, total: subtotal, itemCount: itemList.length, paymentMethod: parsed.data.paymentMethod } });
      return { orderId: created.insertId, paymentId: payment.insertId };
    });
    if (parsed.data.paymentMethod === "CASH") return json({ ok: true, paid: true, paymentStatus: "PAID", id: result.orderId, orderNumber, total: subtotal }, { status: 201 });
    let message = parsed.data.paymentMethod === "MANUAL_MPESA" ? "Checking the till payment." : "Check the customer's phone for the M-Pesa prompt.";
    if (parsed.data.paymentMethod === "MPESA_EXPRESS") {
      try {
        const stk = await initiateStkPush({ orderNumber, phone: parsed.data.billingPhone || parsed.data.phone || "", amount: subtotal });
        await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, result.paymentId));
        await replayStoredStkCallback(stk.checkoutRequestId);
        message = stk.customerMessage;
      } catch (error) {
        message = error instanceof Error ? error.message : "M-Pesa Express could not start.";
        await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: message }).where(eq(paymentTransactions.id, result.paymentId));
        await db.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, result.orderId));
      }
    }
    return json({ ok: true, paid: false, paymentStatus: "PENDING", id: result.orderId, checkoutToken: parsed.data.checkoutToken, orderNumber, total: subtotal, message }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Walk-in sale could not be completed.";
    console.error("Walk-in sale failed", error);
    return json({ error: message }, { status: message.startsWith("Insufficient stock") ? 409 : 500 });
  }
}

const productSchema = z.object({
  categoryId: z.coerce.number().int().positive(), name: z.string().trim().min(2).max(220), brand: z.string().trim().max(150).optional().default(""),
  shortDescription: z.string().trim().max(500).optional().default(""), imageUrl: z.string().trim().max(500).optional().default(""),
  description: z.string().trim().max(10000).optional().default(""),
  price: z.coerce.number().nonnegative(), discountPrice: z.coerce.number().nonnegative().nullable().optional(), packSize: z.string().trim().max(100).optional().default(""),
  prescriptionRequired: z.coerce.boolean().default(false), isFeatured: z.coerce.boolean().default(false), conditionIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

export async function handleProducts(request: Request, id?: number) {
  const db = getDb();
  if (request.method === "GET" && !id) {
    return json({ products: (await db.select().from(products).where(eq(products.isActive, true)).orderBy(desc(products.isFeatured), desc(products.createdAt))).map((product) => ({ ...product, imageUrl: publicImageUrl(product.imageUrl) })) }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method === "POST" && !id) {
    const parsed = productSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid product." }, { status: 400 });
    const values = parsed.data;
    if (values.discountPrice !== null && values.discountPrice !== undefined && values.discountPrice >= values.price) return json({ error: "The selling price must be lower than the regular price to create a discount." }, { status: 400 });
    const suffix = Date.now().toString(36);
    const baseSlug = values.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const created = await db.transaction(async (tx) => {
      const [record] = await tx.insert(products).values({ categoryId: values.categoryId, name: values.name, slug: `${baseSlug}-${suffix}`, sku: `HF-${suffix.toUpperCase()}`, brand: values.brand || null, shortDescription: values.shortDescription || null, description: values.description || null, imageUrl: normalizeStoredImageUrl(values.imageUrl), discountPrice: values.discountPrice?.toString() ?? null, price: values.price.toString(), packSize: values.packSize || null, prescriptionRequired: values.prescriptionRequired, isFeatured: values.isFeatured, isActive: true });
      if (values.conditionIds.length) await tx.insert(productHealthConditions).values(values.conditionIds.map((conditionId) => ({ productId: record.insertId, conditionId })));
      const stores = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true));
      if (stores.length) await tx.insert(branchInventory).values(stores.map((store) => ({ branchId: store.id, productId: record.insertId, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: auth.session.userId })));
      return record;
    });
    return json({ ok: true, id: created.insertId }, { status: 201 });
  }
  if (!id || !Number.isInteger(id)) return json({ error: "Invalid product." }, { status: 400 });
  if (request.method === "DELETE") {
    await db.transaction(async (tx) => {
      await tx.delete(productHealthConditions).where(eq(productHealthConditions.productId, id));
      await tx.delete(productReviews).where(eq(productReviews.productId, id));
      await tx.delete(branchInventory).where(eq(branchInventory.productId, id));
      await tx.delete(products).where(eq(products.id, id));
    });
    return json({ ok: true });
  }
  if (request.method === "PATCH") {
    const parsed = z.object({ name: z.string().trim().min(2).max(220).optional(), categoryId: z.coerce.number().int().positive().optional(), brand: z.string().trim().max(150).nullable().optional(), shortDescription: z.string().trim().max(500).nullable().optional(), description: z.string().trim().max(10000).nullable().optional(), packSize: z.string().trim().max(100).nullable().optional(), price: z.coerce.number().nonnegative().optional(), discountPrice: z.coerce.number().nonnegative().nullable().optional(), imageUrl: z.string().trim().max(500).nullable().optional(), prescriptionRequired: z.boolean().optional(), isFeatured: z.boolean().optional(), isActive: z.boolean().optional(), conditionIds: z.array(z.coerce.number().int().positive()).optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Invalid product update." }, { status: 400 });
    if (parsed.data.price !== undefined && parsed.data.discountPrice !== null && parsed.data.discountPrice !== undefined && parsed.data.discountPrice >= parsed.data.price) return json({ error: "The selling price must be lower than the regular price to create a discount." }, { status: 400 });
    const { conditionIds, ...update } = parsed.data;
    const normalized = { ...update, imageUrl: parsed.data.imageUrl === undefined ? undefined : normalizeStoredImageUrl(parsed.data.imageUrl) };
    await db.transaction(async (tx) => {
      await tx.update(products).set({ ...normalized, price: parsed.data.price?.toString(), discountPrice: parsed.data.discountPrice === null ? null : parsed.data.discountPrice?.toString() }).where(eq(products.id, id));
      if (conditionIds) { await tx.delete(productHealthConditions).where(eq(productHealthConditions.productId, id)); if (conditionIds.length) await tx.insert(productHealthConditions).values(conditionIds.map((conditionId) => ({ productId: id, conditionId }))); }
    });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleReviews(request: Request, productId: number) {
  const auth = await requireSession(request, ["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(3).max(1200) }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Choose a rating and write a short review." }, { status: 400 });
  const db = getDb();
  const [purchase] = await db.select({ id: orderItems.id }).from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).where(and(eq(orderItems.productId, productId), eq(orders.customerId, auth.session.userId), eq(orders.status, "COMPLETED"))).limit(1);
  if (!purchase) return json({ error: "Reviews are available after a completed purchase." }, { status: 403 });
  const [existing] = await db.select({ id: productReviews.id }).from(productReviews).where(and(eq(productReviews.productId, productId), eq(productReviews.customerId, auth.session.userId))).limit(1);
  if (existing) await db.update(productReviews).set({ ...parsed.data, isApproved: true }).where(eq(productReviews.id, existing.id));
  else await db.insert(productReviews).values({ productId, customerId: auth.session.userId, ...parsed.data, isApproved: true });
  return json({ ok: true, message: "Thank you. Your verified-purchase review is now live." }, { status: existing ? 200 : 201 });
}

export async function handleBlogs(request: Request, id?: number) {
  const db=getDb();
  if(request.method==="GET"&&!id)return json({posts:await db.select().from(blogPosts).where(eq(blogPosts.isPublished,true)).orderBy(desc(blogPosts.publishedAt))});
  const auth=await requireSession(request,[...admins]);if("response" in auth)return auth.response;
  if(request.method==="POST"&&!id){const parsed=z.object({title:z.string().trim().min(3).max(220),excerpt:z.string().trim().min(10).max(500),content:z.string().trim().min(20).max(50000),imageUrl:z.string().trim().max(500).optional().default(""),metaTitle:z.string().trim().max(220).optional().default(""),metaDescription:z.string().trim().max(500).optional().default(""),isPublished:z.boolean().default(false)}).safeParse(await body(request));if(!parsed.success)return json({error:"Complete the blog title, excerpt and article."},{status:400});const slug=`${parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${Date.now().toString(36)}`,[created]=await db.insert(blogPosts).values({...parsed.data,slug,imageUrl:parsed.data.imageUrl||null,metaTitle:parsed.data.metaTitle||null,metaDescription:parsed.data.metaDescription||null,publishedAt:parsed.data.isPublished?new Date():null,authorId:auth.session.userId});return json({id:created.insertId,slug},{status:201})}
  if(request.method==="PATCH"&&id){const parsed=z.object({title:z.string().trim().min(3).max(220),excerpt:z.string().trim().min(10).max(500),content:z.string().trim().min(20).max(50000),imageUrl:z.string().trim().max(500).nullable(),metaTitle:z.string().trim().max(220).nullable(),metaDescription:z.string().trim().max(500).nullable(),isPublished:z.boolean()}).safeParse(await body(request));if(!parsed.success)return json({error:"Complete the blog title, excerpt and article."},{status:400});await db.update(blogPosts).set({...parsed.data,publishedAt:parsed.data.isPublished?new Date():null}).where(eq(blogPosts.id,id));return json({ok:true})}
  if(request.method==="DELETE"&&id){await db.delete(blogPosts).where(eq(blogPosts.id,id));return json({ok:true})}return json({error:"Method not allowed."},{status:405});
}

export const featuredCategoryLimit = 6;
// The storefront "Shop by category" list renders a fixed six-tile row, so the
// limit is enforced here as well as in the admin UI.
async function featuredCategoryCount(excludeId?: number) {
  const rows = await getDb().select({ id: categories.id }).from(categories).where(and(eq(categories.featuredOnStorefront, true), eq(categories.isActive, true)));
  return rows.filter((row) => row.id !== excludeId).length;
}

export async function handleTaxonomy(request: Request, kind: "categories" | "conditions", id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method === "DELETE" && id) { if(kind==="categories")await getDb().update(categories).set({isActive:false}).where(eq(categories.id,id));else await getDb().update(healthConditions).set({isActive:false}).where(eq(healthConditions.id,id)); return json({ok:true}); }
  if (request.method === "PATCH" && id) {
    const parsed=z.object({name:z.string().trim().min(2).max(150),description:z.string().trim().max(500).optional().default(""),featured:z.boolean().optional()}).safeParse(await body(request));
    if(!parsed.success)return json({error:"Enter a valid name."},{status:400});
    if(kind==="categories"){
      if(parsed.data.featured===true&&await featuredCategoryCount(id)>=featuredCategoryLimit)return json({error:`You can only feature ${featuredCategoryLimit} categories on the storefront. Unfeature another category first.`,code:"FEATURED_LIMIT"},{status:409});
      await getDb().update(categories).set({name:parsed.data.name,...(parsed.data.featured===undefined?{}:{featuredOnStorefront:parsed.data.featured})}).where(eq(categories.id,id));
    } else await getDb().update(healthConditions).set({name:parsed.data.name,description:parsed.data.description||null}).where(eq(healthConditions.id,id));
    return json({ok:true});
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({ name: z.string().trim().min(2).max(150), description: z.string().trim().max(500).optional().default(""), featured: z.boolean().optional().default(false) }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Enter a valid name." }, { status: 400 });
  if (kind === "categories" && parsed.data.featured && await featuredCategoryCount() >= featuredCategoryLimit) return json({ error: `You can only feature ${featuredCategoryLimit} categories on the storefront. Unfeature another category first.`, code: "FEATURED_LIMIT" }, { status: 409 });
  const slug = `${parsed.data.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
  const [created] = kind === "categories"
    ? await getDb().insert(categories).values({ name: parsed.data.name, slug, isActive: true, featuredOnStorefront: parsed.data.featured })
    : await getDb().insert(healthConditions).values({ name: parsed.data.name, slug, description: parsed.data.description || null, isActive: true });
  return json({ ok: true, id: created.insertId, name: parsed.data.name, featured: kind === "categories" ? parsed.data.featured : undefined }, { status: 201 });
}

function storageRoot() {
  return path.resolve(process.env.STORAGE_ROOT || path.join(process.cwd(), "storage"));
}

function normalizeStoredImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      const url = new URL(value);
      if (url.pathname.startsWith("/uploads/products/")) return url.pathname;
    }
  } catch { /* keep original */ }
  return value.startsWith("/uploads/products/") ? value : value;
}

async function optimizeProductImage(bytes: Buffer<ArrayBufferLike>, type: string): Promise<Buffer<ArrayBufferLike>> {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(type)) return bytes;
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
    const optimized = type === "image/png"
      ? await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      : type === "image/webp"
        ? await image.webp({ quality: 88, effort: 4 }).toBuffer()
        : await image.jpeg({ quality: 88, progressive: true, mozjpeg: true }).toBuffer();
    return optimized.length < bytes.length ? optimized : bytes;
  } catch (error) {
    console.warn("Product image optimization skipped", { name: error instanceof Error ? error.name : undefined });
    return bytes;
  }
}

export async function handleProductImage(request: Request) {
  const auth = await requireSession(request, [...admins], true);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: "Choose a product image." }, { status: 400 });
  const types = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"], ["image/avif", "avif"], ["image/bmp", "bmp"], ["image/tiff", "tiff"]]);
  const extension = types.get(image.type.toLowerCase());
  if (!extension) return json({ error: "Use JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF." }, { status: 415 });
  if (image.size <= 0 || image.size > 2 * 1024 * 1024) return json({ error: "Product images must be 2 MB or smaller." }, { status: 413 });
  let bytes: Buffer<ArrayBufferLike> = Buffer.from(await image.arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const validSignature = image.type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : image.type === "image/png" ? ascii(1, 4) === "PNG"
    : image.type === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
    : image.type === "image/gif" ? ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a"
    : image.type === "image/avif" ? ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))
    : image.type === "image/bmp" ? ascii(0, 2) === "BM"
    : (ascii(0, 4) === "II*\0" || ascii(0, 4) === "MM\0*");
  if (!validSignature) return json({ error: "The uploaded file does not match its declared image type." }, { status: 415 });
  bytes = await optimizeProductImage(bytes, image.type.toLowerCase());
  const filename = `${randomUUID()}.${extension}`;
  const directory = path.join(storageRoot(), "uploads", "products");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), bytes, { flag: "wx" });
  return json({ imageUrl: publicImageUrl(`/uploads/products/${filename}`) }, { status: 201 });
}

export async function serveProductImage(filename: string) {
  if (!/^[a-zA-Z0-9-]+\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(filename)) return json({ error: "Not found." }, { status: 404 });
  try {
    const buffer = await readFile(path.join(storageRoot(), "uploads", "products", filename));
    const extension = path.extname(filename).toLowerCase();
    const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff" };
    return new Response(buffer, { headers: { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch { return json({ error: "Image not found." }, { status: 404 }); }
}

export async function handlePrescriptions(request: Request, downloadId?: number) {
  if (downloadId) {
    const auth = await requireSession(request, [...team]);
    if ("response" in auth) return auth.response;
    const db=getDb();
    if(request.method==="PATCH"){
      if(!team.includes(auth.session.role as typeof team[number]))return json({error:"Not allowed."},{status:403});
      const parsed=z.object({status:z.enum(["RECEIVED","UNDER_REVIEW","APPROVED","MORE_INFORMATION_REQUIRED","DECLINED"]),pharmacistNotes:z.string().trim().max(2000).optional().default("")}).safeParse(await body(request));
      if(!parsed.success)return json({error:"Choose a valid prescription status."},{status:400});
      const [record]=await db.select({id:prescriptions.id,email:users.email,firstName:users.firstName}).from(prescriptions).leftJoin(users,eq(users.id,prescriptions.customerId)).where(eq(prescriptions.id,downloadId)).limit(1);
      if(!record)return json({error:"Prescription not found."},{status:404});
      await db.update(prescriptions).set({status:parsed.data.status,pharmacistNotes:parsed.data.pharmacistNotes||null,reviewedBy:auth.session.userId,reviewedAt:new Date()}).where(eq(prescriptions.id,downloadId));
      const [linked]=await db.select({orderId:prescriptions.orderId}).from(prescriptions).where(eq(prescriptions.id,downloadId)).limit(1);
      if(linked?.orderId)await db.update(orders).set({prescriptionStatus:parsed.data.status,status:parsed.data.status==="APPROVED"?"CONFIRMED":parsed.data.status==="DECLINED"?"CANCELLED":"UNDER_REVIEW"}).where(eq(orders.id,linked.orderId));
      if(record.email)void sendEmail({to:record.email,subject:"Prescription review update",message:`Hello ${record.firstName||"customer"},\n\nYour prescription status is now ${parsed.data.status.replaceAll("_"," ").toLowerCase()}.${parsed.data.pharmacistNotes?`\n\nPharmacist note: ${parsed.data.pharmacistNotes}`:""}\n\nSign in to your Healthfield account to track progress.`,action:{label:"View prescription progress",url:`${storefrontOrigin()}/account#prescriptions`},channel:"orders"});
      return json({ok:true,status:parsed.data.status});
    }
    const [record] = await db.select().from(prescriptions).where(eq(prescriptions.id, downloadId)).limit(1);
    if (!record) return json({ error: "Prescription not found." }, { status: 404 });
    if (auth.session.role === "CUSTOMER" && record.customerId !== auth.session.userId) return json({ error: "Not found." }, { status: 404 });
    try {
      const buffer = await readFile(path.join(storageRoot(), "prescriptions", path.basename(record.storageKey)));
      return new Response(buffer, { headers: { "Content-Type": record.mimeType, "Content-Disposition": `inline; filename="${safeFilename(record.originalFilename)}"`, "Cache-Control": "private, no-store" } });
    } catch { return json({ error: "Prescription file is missing." }, { status: 404 }); }
  }
  const auth = await requireSession(request, undefined, true);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const file = form.get("prescription");
  if (!(file instanceof File)) return json({ error: "Choose a prescription file." }, { status: 400 });
  const allowed = new Map([["application/pdf", ".pdf"], ["image/png", ".png"], ["image/jpeg", ".jpg"]]);
  const extension = allowed.get(file.type);
  if (!extension) return json({ error: "Only PDF, PNG, JPG and JPEG files are supported." }, { status: 415 });
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) return json({ error: "The file must be 2 MB or smaller." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid = file.type === "application/pdf" ? bytes.slice(0, 4).toString() === "37,80,68,70" : file.type === "image/png" ? bytes.slice(0, 8).toString() === "137,80,78,71,13,10,26,10" : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!valid) return json({ error: "The file content does not match its format." }, { status: 400 });
  const directory = path.join(storageRoot(), "prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  await writeFile(path.join(directory, storedName), bytes, { flag: "wx" });
  const [sender] = await getDb().select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, auth.session.userId)).limit(1);
  const senderName = `${sender?.firstName || auth.session.firstName} ${sender?.lastName || ""}`.trim().slice(0, 200);
  const displayName = `Prescription - ${senderName} - ${new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}${extension}`;
  const [created] = await getDb().insert(prescriptions).values({ customerId: auth.session.userId, senderName, storageKey: storedName, originalFilename: displayName, mimeType: file.type, sizeBytes: file.size, status: "RECEIVED" });
  void sendEmail({to:auth.session.email,subject:"Prescription received",message:`Hello ${auth.session.firstName},\n\nWe received your prescription and it is awaiting pharmacist review. Track its progress from your Healthfield account.`,action:{label:"Track prescription",url:`${storefrontOrigin()}/account#prescriptions`},channel:"orders"});
  if(process.env.NOTIFICATION_EMAIL)void sendEmail({to:process.env.NOTIFICATION_EMAIL,subject:"New prescription awaiting review",message:`A new prescription upload is awaiting pharmacist review. Reference: ${created.insertId}.`,channel:"orders"});
  return json({ ok: true, id: created.insertId }, { status: 201 });
}

export async function handleInventory(request: Request, id: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const parsed = z.object({ quantityAvailable: z.number().int().nonnegative(), quantityReserved: z.number().int().nonnegative(), reorderLevel: z.number().int().nonnegative() }).safeParse(await body(request));
  if (!Number.isInteger(id) || !parsed.success) return json({ error: "Enter valid non-negative stock quantities." }, { status: 400 });
  await getDb().update(branchInventory).set({ ...parsed.data, updatedBy: auth.session.userId }).where(eq(branchInventory.id, id));
  return json({ ok: true });
}

export async function handleSettings(request: Request) {
  const db = getDb();
  if (request.method === "GET") {
    const [settings] = await db.select({ pharmacyName: siteSettings.pharmacyName, phone: siteSettings.phone, whatsapp: siteSettings.whatsapp, supportEmail: siteSettings.supportEmail, address: siteSettings.address, openingHours: siteSettings.openingHours, deliveryMessage: siteSettings.deliveryMessage, freeDeliveryThreshold: siteSettings.freeDeliveryThreshold,licenceTitle:siteSettings.licenceTitle,licenceNumber:siteSettings.licenceNumber,licenceImageUrl:siteSettings.licenceImageUrl,onlineMpesaEnabled:siteSettings.onlineMpesaEnabled,onlineManualEnabled:siteSettings.onlineManualEnabled,posCashEnabled:siteSettings.posCashEnabled,posMpesaEnabled:siteSettings.posMpesaEnabled,posManualEnabled:siteSettings.posManualEnabled,mpesaTillNumber:siteSettings.mpesaTillNumber,mpesaAccountName:siteSettings.mpesaAccountName }).from(siteSettings).limit(1);
    return json({ settings: settings ?? null });
  }
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const parsed = z.object({
    pharmacyName: z.string().trim().min(2).max(150), phone: z.string().trim().max(30), whatsapp: z.string().trim().max(30), supportEmail: z.string().trim().email().or(z.literal("")),
    address: z.string().trim().max(1000), openingHours: z.string().trim().max(255), deliveryMessage: z.string().trim().min(2).max(255), freeDeliveryThreshold: z.coerce.number().nonnegative().optional(),
    bulkSmsApiUrl: z.string().trim().url().or(z.literal("")), bulkSmsApiKey: z.string().trim().max(500), bulkSmsSenderId: z.string().trim().max(50),
    facebookUrl: z.string().trim().url().or(z.literal("")), instagramUrl: z.string().trim().url().or(z.literal("")), xUrl: z.string().trim().url().or(z.literal("")), tiktokUrl: z.string().trim().url().or(z.literal("")), licenceTitle:z.string().trim().max(190),licenceNumber:z.string().trim().max(120),licenceImageUrl:z.string().trim().max(500), requireTeamTwoFactor: z.boolean(),
    onlineMpesaEnabled:z.boolean(),onlineManualEnabled:z.boolean(),posCashEnabled:z.boolean(),posMpesaEnabled:z.boolean(),posManualEnabled:z.boolean(),mpesaTillNumber:z.string().trim().max(30),mpesaAccountName:z.string().trim().max(150),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  const data = parsed.data;
  const values = { ...data, phone: data.phone || null, whatsapp: data.whatsapp || null, supportEmail: data.supportEmail || null, address: data.address || null, openingHours: data.openingHours || null, freeDeliveryThreshold: data.freeDeliveryThreshold?.toString() ?? null, bulkSmsApiUrl: data.bulkSmsApiUrl || null, bulkSmsApiKey: data.bulkSmsApiKey || null, bulkSmsSenderId: data.bulkSmsSenderId || null, facebookUrl: data.facebookUrl || null, instagramUrl: data.instagramUrl || null, xUrl: data.xUrl || null, tiktokUrl: data.tiktokUrl || null, mpesaTillNumber:data.mpesaTillNumber||null,mpesaAccountName:data.mpesaAccountName||null, updatedBy: auth.session.userId };
  const [current] = await db.select({ id: siteSettings.id }).from(siteSettings).limit(1);
  if (current) await db.update(siteSettings).set(values).where(eq(siteSettings.id, current.id)); else await db.insert(siteSettings).values(values);
  return json({ ok: true });
}

export async function handleStaff(request: Request, id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (request.method === "GET" && !id) return json({ staff: await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, role: users.role, homeBranchId: users.homeBranchId, isActive: users.isActive, twoFactorEnabled: users.twoFactorEnabled }).from(users).where(and(ne(users.role, "CUSTOMER"), isNull(users.deletedAt))).orderBy(desc(users.createdAt)) });
  if (request.method === "POST" && !id) {
    const parsed = z.object({ firstName: z.string().trim().min(2).max(100), lastName: z.string().trim().min(2).max(100), email: z.string().trim().email(), phone: z.string().trim().max(30).optional().default(""), role: z.enum(["STAFF", "ADMIN"]), homeBranchId: z.coerce.number().int().positive().nullable().optional(), password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/) }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Enter valid staff details and a strong password." }, { status: 400 });
    try { const { password, ...values } = parsed.data; const [created] = await db.insert(users).values({ ...values, phone: values.phone || null, passwordHash: await hash(password, 12), isActive: true, forcePasswordChange: true }); return json({ id: created.insertId }, { status: 201 }); } catch { return json({ error: "That email address or phone is already registered." }, { status: 409 }); }
  }
  if (request.method === "PATCH" && id) {
    const parsed = z.object({ firstName: z.string().trim().min(2).max(100).optional(), lastName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(30).optional(), role: z.enum(["STAFF", "ADMIN"]).optional(), homeBranchId: z.coerce.number().int().positive().nullable().optional(), isActive: z.boolean().optional(), password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Check the staff details." }, { status: 400 });
    const { password, ...values } = parsed.data;
    if (id === auth.session.userId && values.isActive === false) return json({ error: "You cannot suspend your own account." }, { status: 400 });
    await db.update(users).set({ ...values, phone: values.phone === "" ? null : values.phone, ...(password ? { passwordHash: await hash(password, 12), forcePasswordChange: true } : {}) }).where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (values.isActive === false) {
      await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, id));
    }
    if (values.isActive === false || password) await revokeUserSessions(id);
    return json({ ok: true });
  }
  if (request.method === "DELETE" && id) {
    if (id === auth.session.userId) return json({ error: "You cannot delete your own account." }, { status: 400 });
    const [target] = await db.select({ role: users.role }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!target) return json({ error: "Staff account not found." }, { status: 404 });
    if (target.role === "SUPER_ADMIN") return json({ error: "The pharmacy owner account cannot be deleted here." }, { status: 403 });
    await db.transaction(async tx => {
      await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, id));
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)));
      await tx.update(users).set({ isActive: false, twoFactorEnabled: false, deletedAt: new Date(), passwordHash: await hash(randomUUID() + randomUUID(), 12) }).where(eq(users.id, id));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "STAFF_ACCOUNT_DELETED", entityType: "USER", entityId: String(id), metadata: { formerRole: target.role } });
    });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleStores(request: Request, id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (request.method === "GET" && !id) return json({ stores: await db.select().from(branches).orderBy(desc(branches.createdAt)) });
  const schema = z.object({ name: z.string().trim().min(2).max(150), code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()), phone: z.string().trim().min(7).max(30), email: z.string().trim().email().or(z.literal("")), address: z.string().trim().min(4), latitude:z.coerce.number().min(-90).max(90).nullable().optional(), longitude:z.coerce.number().min(-180).max(180).nullable().optional(), openingHours:z.record(z.string(),z.string()).nullable().optional(), deliveryAreas:z.array(z.string().trim().min(1).max(120)).max(100).optional() });
  if (request.method === "POST" && !id) {
    const parsed = schema.safeParse(await body(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the store details." }, { status: 400 });
    try {
      const created = await db.transaction(async (tx) => { const [store] = await tx.insert(branches).values({ ...parsed.data, latitude:parsed.data.latitude?.toString()??null,longitude:parsed.data.longitude?.toString()??null,email: parsed.data.email || null, isActive: true }); const catalogue = await tx.select({ id: products.id }).from(products); if (catalogue.length) await tx.insert(branchInventory).values(catalogue.map((product) => ({ branchId: store.insertId, productId: product.id, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: auth.session.userId }))); return store; });
      return json({ id: created.insertId }, { status: 201 });
    } catch { return json({ error: "That store code is already in use." }, { status: 409 }); }
  }
  if (request.method === "PATCH" && id) {
    const parsed = schema.partial().extend({ isActive: z.boolean().optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the store details." }, { status: 400 });
    await db.update(branches).set({ ...parsed.data, latitude:parsed.data.latitude===undefined?undefined:parsed.data.latitude?.toString()??null,longitude:parsed.data.longitude===undefined?undefined:parsed.data.longitude?.toString()??null,email: parsed.data.email === "" ? null : parsed.data.email }).where(eq(branches.id, id));
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleCampaigns(request: Request) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const parsed = z.object({ name:z.string().trim().min(2).max(180),channel:z.enum(["EMAIL","SMS","EMAIL_AND_SMS"]),subject:z.string().trim().max(220).optional().default(""),message:z.string().trim().min(2).max(3000),audience:z.enum(["MARKETING_CUSTOMERS","ORDER_CUSTOMERS","ALL_CONTACTS"]).default("MARKETING_CUSTOMERS"),lookbackDays:z.coerce.number().int().min(0).max(3650).default(0) }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Invalid campaign." }, { status: 400 });
  const db = getDb();
  const [settings] = await db.select().from(siteSettings).limit(1);
  const since=parsed.data.lookbackDays?new Date(Date.now()-parsed.data.lookbackDays*86400000):null;
  const [registered,orderContacts]=await Promise.all([
    parsed.data.audience!=="ORDER_CUSTOMERS"?db.select({email:users.email,phone:users.phone}).from(users).where(and(eq(users.role,"CUSTOMER"),eq(users.isActive,true),eq(users.marketingConsent,true),...(since?[gte(users.createdAt,since)]:[]))):Promise.resolve([]),
    parsed.data.audience!=="MARKETING_CUSTOMERS"?db.select({email:orders.email,phone:orders.phone}).from(orders).where(since?gte(orders.createdAt,since):undefined):Promise.resolve([]),
  ]);
  const contacts=new Map<string,{email:string|null;phone:string|null}>();
  for(const contact of [...registered,...orderContacts]){const email=contact.email?.trim().toLowerCase()||null,phone=contact.phone?.trim()||null,key=email?`e:${email}`:phone?`p:${phone}`:"";if(key&&!contacts.has(key))contacts.set(key,{email,phone})}
  const customers=[...contacts.values()];
  const wantsEmail = parsed.data.channel !== "SMS", wantsSms = parsed.data.channel !== "EMAIL";
  if(wantsEmail&&(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD))return json({error:"Configure the cPanel SMTP mailbox in api-service/.env first."},{status:400});
  if (wantsSms && (!settings?.bulkSmsApiUrl || !settings.bulkSmsApiKey || !settings.bulkSmsSenderId)) return json({ error: "Configure the bulk SMS API first." }, { status: 400 });
  const {audience:_audience,lookbackDays:_lookbackDays,...campaignData}=parsed.data;
  const [created] = await db.insert(campaigns).values({ ...campaignData, subject: parsed.data.subject || null, status: "SENDING", recipientCount: customers.length, createdBy: auth.session.userId });
  let successCount = 0, failureCount = 0;
  try {
    if(wantsEmail){const recipients=customers.map(customer=>customer.email).filter((email):email is string=>Boolean(email)),result=await sendBulkEmail({recipients,subject:parsed.data.subject||parsed.data.name,message:parsed.data.message});successCount+=result.successCount;failureCount+=result.failureCount}
    if (wantsSms) { const recipients = customers.map((customer) => customer.phone).filter((phone): phone is string => Boolean(phone)); const response = await fetch(settings!.bulkSmsApiUrl!, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings!.bulkSmsApiKey}` }, body: JSON.stringify({ recipients, senderId: settings!.bulkSmsSenderId, message: parsed.data.message }) }); response.ok ? successCount += recipients.length : failureCount += recipients.length; }
    await db.update(campaigns).set({ status: failureCount ? "FAILED" : "SENT", successCount, failureCount, sentAt: new Date() }).where(eq(campaigns.id, created.insertId));
  } catch { failureCount = customers.length; await db.update(campaigns).set({ status: "FAILED", successCount, failureCount }).where(eq(campaigns.id, created.insertId)); }
  return json({ ok: failureCount === 0, id: created.insertId, recipientCount: customers.length, successCount, failureCount }, { status: failureCount ? 502 : 201 });
}
