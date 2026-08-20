import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt, { hash } from "bcryptjs";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  branches, branchInventory, campaigns, chatConversations, chatMessages, mpesaIncomingPayments, mpesaStkCallbacks, orderItemFulfilments, orderItems, orders, paymentTransactions,
  activityLogs, authSessions, blogPostProducts, blogPosts, categories, offerItems, offers, emailVerificationTokens, healthConditions, prescriptionRequestItems, prescriptions, productHealthConditions, productReviews, products, promotionalBanners, siteSettings, staffPermissions, twoFactorChallenges, users,
} from "../../db/schema";
import { DEFAULT_STAFF_PERMISSIONS, STAFF_PERMISSION_VALUES, normalizeStaffPermissions } from "../../lib/staff-permissions";
import { healthfieldOrderNumber } from "../../lib/order-number";
import { allowedOrderStatuses, canTransitionOrderStatus, isStockFinalizedOrderStatus, orderDetailsAreEditable, orderStatuses, orderTransitionChangesAllocation } from "../../lib/order-status-transitions";
import { canApplyPrescriptionAction, prescriptionReviewActions, type PrescriptionReviewAction, type PrescriptionStatus } from "../../lib/prescription-workflow";
import { DispensingError, dispenseRules, resolveDispenseSelection, type DispenseRule } from "../../lib/prescription-dispensing";
import { createPasswordResetToken, createSessionToken, createUploadToken, hasStoredTimestamp, requireSession, requestSession, revokeSession, revokeUserSessions, verifyPasswordResetToken } from "./auth";
import { getDb } from "./db";
import { repriceDeliveryForBranch, resolveDeliveryQuote } from "./delivery";
import { sendSms, smsConfiguration } from "./sms";
import { marketingSms } from "../../lib/sms-templates";
import { MAX_VAT_RATE, parseVatRate, vatOnNet } from "../../lib/vat";
import { extractContentReferences, isPersonalised, renderContentBlocks, renderMergeFields, type MergeRecipient } from "../../lib/campaign-merge";
import { campaignContentResolver, loadCampaignContent } from "./campaign-content";
import { apportionBundle, isBundle, loadLiveOffers, offerPriceMap, offerTotal } from "./offers";
import { campaignBodyHtml, campaignEmailHtml, orderEmailHtml, orderStatusEmailContent, sendEmail, stripHtml } from "./email";
import { emailVerificationResendCooldownMs, emailVerificationRetryAfterSeconds, emailVerificationTiming } from "./email-verification";
import { json, publicImageUrl, safeFilename } from "./http";
import { storageRoot, validatePrescriptionUpload } from "./prescription-files";
import { extractMpesaReceipt, initiateStkPush, mpesaConfiguration } from "./mpesa";
import { queueOrderSms, queuePaidOrderNotification } from "./order-notifications";
import { reconcileManualPaymentFromIncoming, replayStoredStkCallback, requestKnownTransactionStatus } from "./payment-handlers";
import { canGrantTeamRole, canManageTeamAccount } from "./staff-access-policy";
import { secureHashEqual, twoFactorChallengeLifetimeMs, twoFactorCodeHash, twoFactorMaximumAttempts, twoFactorMaximumResends, twoFactorResendCooldownMs, twoFactorTiming } from "./two-factor";
import { requireTeamPermission, sessionHasPermission } from "./staff-permissions";

/**
 * VAT for an order the site prices itself. Shelf prices are net, so the tax is added to
 * the goods; delivery, where there is any, is added after it and is not taxed.
 */
async function onlineVatFor(net: number) {
  const [settings] = await getDb()
    .select({ vatEnabled: siteSettings.vatEnabled, vatRate: siteSettings.vatRate })
    .from(siteSettings)
    .limit(1);
  const rate = settings?.vatEnabled ? parseVatRate(settings.vatRate) : 0;
  const amount = rate ? vatOnNet(net, rate) ?? 0 : 0;
  return { rate, amount, payable: Math.round((net + amount) * 100) / 100 };
}

const admins = ["ADMIN", "SUPER_ADMIN"] as const;
const team = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
export function storefrontOrigin() {
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
    const session = { userId: user.id, email: user.email, firstName: user.firstName, role: user.role, forcePasswordChange: user.forcePasswordChange, homeBranchId: user.homeBranchId, permissions: [] };
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
    const session = { userId: user.id, email: user.email, firstName: user.firstName, role: user.role, forcePasswordChange: user.forcePasswordChange, homeBranchId: user.homeBranchId, permissions: [] };
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
    const auth = await requireSession(request, [...team, "CUSTOMER"]);
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
    const [linkedPrescription]=await db.select({id:prescriptions.id}).from(prescriptions).where(eq(prescriptions.orderId,id)).limit(1);
    if(linkedPrescription)return json({error:`This is a frozen prescription proposal. Delete prescription #${linkedPrescription.id} from the prescription modal so both records are handled safely.`},{status:409});
    if (!["NEW", "AWAITING_PAYMENT", "CONFIRMED", "UNDER_REVIEW", "CANCELLED"].includes(order.status)) return json({ error: "Only unfulfilled or cancelled orders can be deleted. Completed and dispatched orders are retained for audit records." }, { status: 409 });
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
    const auth = await requireTeamPermission(request, "ORDERS_PROCESS");
    if ("response" in auth) return auth.response;
    const parsed = z.object({ status:z.enum(orderStatuses),customerName:z.string().trim().max(200).optional(),phone:z.string().trim().max(30).optional(),email:z.string().trim().max(190).nullable().optional(),deliveryAddress:z.string().trim().max(1000).nullable().optional(),deliveryArea:z.string().trim().max(160).nullable().optional(),fulfilments:z.array(z.object({orderItemId:z.number().int().positive(),branchId:z.number().int().positive(),quantityReserved:z.number().int().nonnegative(),quantityPacked:z.number().int().nonnegative(),status:z.enum(["UNASSIGNED","RESERVED","PARTIALLY_RESERVED","PACKED","READY","UNAVAILABLE","REPLACED"])})).optional() }).safeParse(await body(request));
    if (!Number.isInteger(id) || !parsed.success) return json({ error: "Check the order details and status." }, { status: 400 });
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return json({ error: "Order not found." }, { status: 404 });
    const detailsEditable = orderDetailsAreEditable(order.status);
    const {status,fulfilments,...details}=parsed.data;
    if(order.status==="AWAITING_PAYMENT"&&order.paymentStatus!=="PAID"&&status!=="AWAITING_PAYMENT")return json({error:"A frozen prescription proposal cannot enter fulfilment before customer payment. Manage it from the prescription request."},{status:409});
    if (["BEING_FULFILLED","PARTIALLY_READY","READY_FOR_DISPATCH","OUT_FOR_DELIVERY","READY_FOR_PICKUP","COMPLETED"].includes(status) && order.prescriptionStatus !== "NOT_REQUIRED" && order.prescriptionStatus !== "APPROVED") return json({ error: "Approve the linked prescription before fulfilling or dispatching this order." }, { status: 409 });
    if (["CONFIRMED","BEING_FULFILLED","PARTIALLY_READY","READY_FOR_DISPATCH","OUT_FOR_DELIVERY","READY_FOR_PICKUP","COMPLETED"].includes(status) && order.paymentStatus !== "PAID") return json({ error: "Confirm payment before approving, processing or dispatching this order." }, { status: 409 });
    if (!canTransitionOrderStatus(order.status, status, order.fulfilmentMethod)) {
      const next = allowedOrderStatuses(order.status, order.fulfilmentMethod).filter((entry) => entry !== order.status).map((entry) => entry.replaceAll("_", " ").toLowerCase());
      return json({ error: next.length ? `An order marked ${order.status.replaceAll("_", " ").toLowerCase()} can only move to ${next.join(" or ")}.` : `An order marked ${order.status.replaceAll("_", " ").toLowerCase()} cannot move to another status.` }, { status: 409 });
    }
    if (!detailsEditable && fulfilments) return json({ error: "Serving-store assignments lock after packaging." }, { status: 400 });
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
        const finalStatus = isStockFinalizedOrderStatus(status);
        const changingAllocation = orderTransitionChangesAllocation(order.status, status, fulfilments !== undefined);
        if (changingAllocation) {
          for (const row of previous) {
            const item = byId.get(row.orderItemId);
            const record = item?.productId ? index.get(`${row.branchId}:${item.productId}`) : undefined;
            if (record) record.quantityReserved = Math.max(0, record.quantityReserved - row.quantityReserved);
          }
        }
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
        await tx.update(orders).set({ status, ...(detailsEditable ? details : {}) }).where(eq(orders.id, id));
        await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "ORDER_UPDATED", entityType: "order", entityId: String(id), metadata: { orderNumber: order.orderNumber, fromStatus: order.status, toStatus: status, fulfilmentBranches: target.map((row) => row.branchId), actorRole: auth.session.role } });
      });
    } catch(error) { return json({ error:error instanceof Error?error.message:"Order could not be updated." },{status:400}); }
    // Reassigning the serving store changes where the rider sets off from, so the
    // delivery leg is measured again from there rather than left on the old quote.
    let repricing: Awaited<ReturnType<typeof repriceDeliveryForBranch>> = null;
    if (fulfilments?.length && order.fulfilmentMethod === "DELIVERY") {
      const load = new Map<number, number>();
      for (const row of fulfilments) load.set(row.branchId, (load.get(row.branchId) ?? 0) + row.quantityReserved);
      const primary = [...load.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
      repricing = await repriceDeliveryForBranch(id, primary).catch((error) => {
        console.warn("Delivery could not be re-priced after a store change", { orderId: id, error });
        return null;
      });
      if (repricing && repricing.fee !== repricing.previousFee) {
        await db.insert(activityLogs).values({ actorId: auth.session.userId, action: repricing.repriced ? "ORDER_DELIVERY_REPRICED" : "ORDER_DELIVERY_FEE_MISMATCH", entityType: "order", entityId: String(id), metadata: { orderNumber: order.orderNumber, previousFee: repricing.previousFee, quotedFee: repricing.fee, distanceKm: repricing.distanceKm, branch: repricing.branch?.name ?? null, charged: repricing.repriced } });
      }
    }
    if(order.status===status)return json({ok:true,status,delivery:repricing});
    const notificationEmail=details.email===undefined?order.email:details.email,notificationName=details.customerName||order.customerName;
    if (status === "READY_FOR_PICKUP") queueOrderSms(id, "ORDER_READY_FOR_PICKUP");
    if (status === "OUT_FOR_DELIVERY") queueOrderSms(id, "ORDER_OUT_FOR_DELIVERY");
    if (status === "COMPLETED") {
      queuePaidOrderNotification(id, "ORDER_COMPLETED");
    } else if (notificationEmail) {
      const update = orderStatusEmailContent({ name: notificationName, orderId: id, orderNumber: order.orderNumber, status, fulfilmentMethod: order.fulfilmentMethod, storefrontOrigin: storefrontOrigin() });
      void sendEmail({ to: notificationEmail, ...update, channel: "orders" });
    }
    if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `Order ${order.orderNumber} → ${parsed.data.status}`, message: `${order.customerName}'s order ${order.orderNumber} changed from ${order.status} to ${parsed.data.status}.`, channel:"orders" });
    return json({ok:true,status,delivery:repricing});
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    fullName: z.string().trim().min(3).max(200), phone: z.string().trim().min(9).max(30), email: z.string().trim().email().optional().or(z.literal("")),
    fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]), paymentMethod: z.enum(["MPESA_EXPRESS", "MANUAL_MPESA", "CASH_ON_DELIVERY"]), billingPhone: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(30).optional()), manualPaymentMessage: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(2500).optional()), deliveryAddress: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(1000).optional()), deliveryArea: z.preprocess(value=>value===null?undefined:value,z.string().trim().max(160).optional()),
    deliveryLatitude: z.preprocess(value=>value===null?undefined:value,z.number().min(-90).max(90).optional()), deliveryLongitude: z.preprocess(value=>value===null?undefined:value,z.number().min(-180).max(180).optional()),
    checkoutToken: z.string().uuid(),
    items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).default([]),
    // A bundle is an all-or-nothing package, so at most one of each may be ordered.
    offerItems: z.array(z.object({ offerId: z.number().int().positive() })).max(10).optional().default([]),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  if (parsed.data.fulfilmentMethod === "DELIVERY" && !parsed.data.deliveryAddress) return json({ error: "Delivery address is required." }, { status: 400 });
  // Delivery is priced from a map pin, so an order without one cannot be quoted at all.
  if (parsed.data.fulfilmentMethod === "DELIVERY" && (parsed.data.deliveryLatitude === undefined || parsed.data.deliveryLongitude === undefined)) {
    return json({ error: "Pin your delivery location on the map so the delivery fee can be calculated.", code: "DELIVERY_LOCATION_REQUIRED" }, { status: 400 });
  }
  const db = getDb();
  const [duplicate] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, paymentStatus: orders.paymentStatus, paymentMethod: orders.paymentMethod }).from(orders).where(eq(orders.checkoutToken, parsed.data.checkoutToken)).limit(1);
  if (duplicate) return json({ ok: true, id: duplicate.id, orderNumber: duplicate.orderNumber, total: Number(duplicate.total), paymentStatus: duplicate.paymentStatus, paymentMethod: duplicate.paymentMethod, duplicate: true });
  const [paymentSettings] = await db.select({ onlineMpesaEnabled: siteSettings.onlineMpesaEnabled, onlineManualEnabled: siteSettings.onlineManualEnabled, onlineCodEnabled: siteSettings.onlineCodEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber, vatEnabled: siteSettings.vatEnabled, vatRate: siteSettings.vatRate }).from(siteSettings).limit(1);
  // Cash on delivery is only offered where there is a delivery to collect it on, and
  // only while the shop has it switched on.
  if (parsed.data.paymentMethod === "CASH_ON_DELIVERY") {
    if (!paymentSettings?.onlineCodEnabled) return json({ error: "Cash on delivery is not available right now. Choose an M-Pesa option.", code: "COD_UNAVAILABLE" }, { status: 409 });
    if (parsed.data.fulfilmentMethod !== "DELIVERY") return json({ error: "Cash on delivery applies to delivered orders only. Pay for a pickup order at the counter.", code: "COD_REQUIRES_DELIVERY" }, { status: 409 });
  }
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && (!paymentSettings?.onlineMpesaEnabled || !mpesaConfiguration())) return json({ error: "M-Pesa Express is currently unavailable. Choose manual M-Pesa payment.", code: "MPESA_UNAVAILABLE" }, { status: 409 });
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (!paymentSettings?.onlineManualEnabled || !paymentSettings.mpesaTillNumber)) return json({ error: "Manual M-Pesa payment is currently unavailable.", code: "MANUAL_PAYMENT_UNAVAILABLE" }, { status: 409 });
  // An online till payment must carry its receipt: nobody is standing at the counter to
  // vouch for who paid, so the code the customer pastes is the only thing tying this
  // stranger's money to this order. Automatic amount matching is for the POS counter.
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (parsed.data.manualPaymentMessage || "").trim().length < 10) return json({ error: "Paste the complete M-Pesa payment message." }, { status: 400 });
  const manualReceipt = parsed.data.paymentMethod === "MANUAL_MPESA" ? extractMpesaReceipt(parsed.data.manualPaymentMessage || "") : null;
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && !manualReceipt) return json({ error: "The M-Pesa receipt code could not be found. Paste the complete confirmation SMS." }, { status: 400 });
  const catalog = await db.select().from(products).where(inArray(products.id, parsed.data.items.map((item) => item.productId)));
  if (catalog.length !== new Set(parsed.data.items.map((item) => item.productId)).size) return json({ error: "One or more products are unavailable." }, { status: 409 });
  // Offer pricing is re-resolved here rather than trusted from the client, so the
  // charge always matches what the storefront is advertising at this moment.
  const liveOffers = await loadLiveOffers();
  const offerPrices = offerPriceMap(liveOffers);
  const lines = parsed.data.items.map((item) => { const product = catalog.find((entry) => entry.id === item.productId)!; const price = offerPrices.get(product.id) ?? Number(product.discountPrice ?? product.price); return { ...item, product, price, total: price * item.quantity }; });

  // Bundles: one order line per component so stock still moves per product, priced
  // by splitting the bundle total. The customer sees a single line named after the
  // offer, and pays exactly the bundle price.
  const bundleLines: Array<{ productId: number; productName: string; quantity: number; unitPrice: number; total: number; offerId: number; offerTitle: string }> = [];
  for (const requested of parsed.data.offerItems ?? []) {
    const offer = liveOffers.find((entry) => entry.id === requested.offerId);
    if (!offer || !isBundle(offer)) return json({ error: "That offer has ended or is no longer available.", code: "OFFER_UNAVAILABLE" }, { status: 409 });
    const weights = offer.items.map((item) => Math.round(item.normalPrice * item.quantity * 100));
    const shares = apportionBundle(Math.round(offerTotal(offer) * 100), weights);
    offer.items.forEach((item, index) => {
      const lineTotal = shares[index] / 100;
      bundleLines.push({
        productId: item.productId, productName: item.name, quantity: item.quantity,
        unitPrice: Number((lineTotal / item.quantity).toFixed(2)), total: lineTotal,
        offerId: offer.id, offerTitle: offer.title,
      });
    });
  }
  if (!lines.length && !bundleLines.length) return json({ error: "Your basket is empty." }, { status: 400 });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0) + bundleLines.reduce((sum, line) => sum + line.total, 0);
  // The fee is recalculated here rather than trusted from the client, for the same
  // reason offer prices are: the browser only ever showed a preview of it.
  const deliveryQuote = parsed.data.fulfilmentMethod === "DELIVERY"
    ? await resolveDeliveryQuote({
        point: { latitude: parsed.data.deliveryLatitude as number, longitude: parsed.data.deliveryLongitude as number },
        lines: [...lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })), ...bundleLines.map((line) => ({ productId: line.productId, quantity: line.quantity }))],
        subtotal,
      })
    : null;
  if (deliveryQuote && !deliveryQuote.quote.available) return json({ error: deliveryQuote.quote.message, code: "DELIVERY_UNAVAILABLE" }, { status: 409 });
  const deliveryFee = deliveryQuote?.quote.fee ?? 0;
  const vatRate = paymentSettings?.vatEnabled ? parseVatRate(paymentSettings.vatRate) : 0;
  const vat = vatRate ? vatOnNet(subtotal, vatRate) ?? 0 : 0;
  const payable = Math.round((subtotal + deliveryFee + vat) * 100) / 100;
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && !Number.isInteger(payable)) return json({ error: "M-Pesa Express requires a whole-shilling total. Choose manual M-Pesa for this order." }, { status: 409 });
  const session = await requestSession(request);
  const customerSession = session?.role === "CUSTOMER" ? session : null;
  if (!customerSession && !parsed.data.email) return json({ error: "Enter your email so this guest order can be linked if you create an account later." }, { status: 400 });
  const requiresPrescription = catalog.some(product => product.prescriptionRequired) || (parsed.data.offerItems || []).some((requested) => liveOffers.find((offer) => offer.id === requested.offerId)?.items.some((item) => item.prescriptionRequired));
  if (requiresPrescription) return json({ error: "Prescription medicines must be submitted for pharmacist review before they can be priced or paid for.", code: "PRESCRIPTION_REVIEW_REQUIRED" }, { status: 409 });
  const orderEmail = customerSession ? customerSession.email.trim().toLowerCase() : (parsed.data.email || "").trim().toLowerCase();
  const costs = await productCosts([...lines.map((line) => line.product.id), ...bundleLines.map((line) => line.productId)]);
  const result = await db.transaction(async (tx) => {
    const temporaryOrderNumber = `TMP-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
    const [created] = await tx.insert(orders).values({ orderNumber: temporaryOrderNumber, checkoutToken: parsed.data.checkoutToken, customerId: customerSession?.userId ?? null, customerName: parsed.data.fullName, phone: parsed.data.phone, email: orderEmail || null, fulfilmentMethod: parsed.data.fulfilmentMethod, paymentMethod: parsed.data.paymentMethod, paymentReference: manualReceipt, deliveryAddress: parsed.data.deliveryAddress || null, deliveryArea: parsed.data.deliveryArea || null, deliveryLatitude: parsed.data.deliveryLatitude?.toString() || null, deliveryLongitude: parsed.data.deliveryLongitude?.toString() || null, status: "NEW", prescriptionStatus: "NOT_REQUIRED", subtotal: subtotal.toString(), deliveryFee: deliveryFee.toString(), discount: "0", vat: vat.toFixed(2), vatRate: vatRate.toFixed(2), total: payable.toFixed(2), suggestedBranchId: deliveryQuote?.branch?.id ?? null, deliveryDistanceKm: deliveryQuote ? deliveryQuote.quote.distanceKm.toFixed(2) : null, deliveryDurationMinutes: deliveryQuote?.durationMinutes ?? null, deliveryBandId: deliveryQuote?.quote.band?.id ?? null, deliveryCourier: deliveryQuote?.quote.courier ?? null });
    const orderNumber = healthfieldOrderNumber("WEB", created.insertId);
    await tx.update(orders).set({ orderNumber }).where(eq(orders.id, created.insertId));
    await tx.insert(orderItems).values([
      ...lines.map((line) => ({ orderId: created.insertId, productId: line.product.id, productName: line.product.name, quantity: line.quantity, unitPrice: line.price.toString(), lineTotal: line.total.toString(), unitCost: costs.get(line.product.id) ?? null })),
      ...bundleLines.map((line) => ({ orderId: created.insertId, productId: line.productId, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice.toString(), lineTotal: line.total.toString(), unitCost: costs.get(line.productId) ?? null, offerId: line.offerId, offerTitle: line.offerTitle })),
    ]);
    const [payment] = await tx.insert(paymentTransactions).values({ orderId: created.insertId, method: parsed.data.paymentMethod, channel: "ONLINE", status: parsed.data.paymentMethod === "CASH_ON_DELIVERY" ? "PENDING" : parsed.data.paymentMethod === "MANUAL_MPESA" ? "REQUIRES_REVIEW" : "INITIATED", amount: payable.toFixed(2), phone: parsed.data.billingPhone || parsed.data.phone, receiptNumber: manualReceipt, manualMessage: parsed.data.manualPaymentMessage || null });
    return { orderId: created.insertId, paymentId: payment.insertId, orderNumber };
  });
  const orderNumber = result.orderNumber;
  // Cash on delivery states the amount the rider will collect; every other method just
  // acknowledges the order, since payment is still being settled.
  queueOrderSms(result.orderId, parsed.data.paymentMethod === "CASH_ON_DELIVERY" ? "CASH_ON_DELIVERY_DUE" : "ORDER_RECEIVED");
  let paymentStatus: "PENDING" | "FAILED" | "PAID" = "PENDING";
  let paymentMessage = parsed.data.paymentMethod === "CASH_ON_DELIVERY" ? "Order placed. Pay the rider in cash when your medicines arrive." : parsed.data.paymentMethod === "MANUAL_MPESA" ? "Receipt extracted. Healthfield is checking Safaricom before sending it for review." : "Check your phone and enter your M-Pesa PIN.";
  if (parsed.data.paymentMethod === "MPESA_EXPRESS") {
    try {
      const stk = await initiateStkPush({ orderNumber, phone: parsed.data.billingPhone || parsed.data.phone, amount: payable });
      await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, result.paymentId));
      await replayStoredStkCallback(stk.checkoutRequestId);
      paymentMessage = stk.customerMessage;
    } catch (error) {
      paymentStatus = "FAILED";
      paymentMessage = error instanceof Error ? error.message : "M-Pesa Express could not start.";
      await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: paymentMessage }).where(eq(paymentTransactions.id, result.paymentId));
      await db.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, result.orderId));
    }
  } else if (manualReceipt) {
    const matched = await reconcileManualPaymentFromIncoming(result.paymentId);
    if (matched.paid) {
      paymentStatus = "PAID";
      paymentMessage = "M-Pesa payment matched. Your order has been placed successfully.";
    } else {
      void requestKnownTransactionStatus(result.paymentId).catch((error) => console.warn("Transaction Status request could not be started", { transactionId: result.paymentId, error }));
    }
  }
  if (orderEmail && parsed.data.paymentMethod === "CASH_ON_DELIVERY") void sendEmail({ to: orderEmail, subject: `Invoice for ${orderNumber} — pay on delivery`, message: `Hello ${parsed.data.fullName},

Your order ${orderNumber} is confirmed for cash on delivery.

Medicines: KES ${subtotal.toLocaleString()}
Delivery: KES ${deliveryFee.toLocaleString()}
Amount due on delivery: KES ${payable.toLocaleString()}

Please have the exact amount ready for the rider.`, html:orderEmailHtml({name:parsed.data.fullName,orderNumber,items:lines.map(line=>({productName:line.product.name,quantity:line.quantity,lineTotal:line.total.toString()})),subtotal,deliveryFee,total:subtotal+deliveryFee,status:"CASH ON DELIVERY"}), channel:"orders" });
  if (orderEmail && parsed.data.paymentMethod === "MANUAL_MPESA" && paymentStatus !== "PAID") void sendEmail({ to: orderEmail, subject: `Payment proof received for ${orderNumber}`, message: `Hello ${parsed.data.fullName},\n\nWe received your payment proof for order ${orderNumber}. Total: KES ${payable.toLocaleString()}. We will confirm it before processing the order.`, html:orderEmailHtml({name:parsed.data.fullName,orderNumber,items:lines.map(line=>({productName:line.product.name,quantity:line.quantity,lineTotal:line.total.toString()})),subtotal,deliveryFee,total:subtotal+deliveryFee,status:"PAYMENT REVIEW"}), channel:"orders" });
  if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `New order ${orderNumber}`, message: `${parsed.data.fullName} placed order ${orderNumber}.\nPhone: ${parsed.data.phone}\nEmail: ${parsed.data.email || "not provided"}\nFulfilment: ${parsed.data.fulfilmentMethod}\nTotal: KES ${payable.toLocaleString()}.`, channel:"orders" });
  return json({ ok: true, id: result.orderId, orderNumber, total: payable, vat, paymentStatus, paymentMethod: parsed.data.paymentMethod, paymentMessage }, { status: 202 });
}

export async function handleCustomerOrderReceived(request: Request, id: number) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const auth = await requireSession(request, ["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  const db = getDb();
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.customerId, auth.session.userId))).limit(1);
  if (!order) return json({ error: "Order not found." }, { status: 404 });
  if (order.fulfilmentMethod !== "DELIVERY") return json({ error: "Only delivered orders can be marked as received." }, { status: 409 });
  if (order.paymentStatus !== "PAID") return json({ error: "Payment must be confirmed before delivery can be completed." }, { status: 409 });
  if (order.status === "COMPLETED") return json({ ok: true, status: "COMPLETED", message: "This order is already marked as received." });
  if (order.status !== "OUT_FOR_DELIVERY") return json({ error: "This order can be marked as received after it is dispatched." }, { status: 409 });
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(orders).set({ status: "COMPLETED" }).where(and(eq(orders.id, order.id), eq(orders.customerId, auth.session.userId), eq(orders.status, "OUT_FOR_DELIVERY")));
    if (updated.affectedRows !== 1) throw new Error("The order status changed before delivery confirmation.");
    await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "ORDER_RECEIVED_BY_CUSTOMER", entityType: "order", entityId: String(order.id), metadata: { orderNumber: order.orderNumber, fromStatus: "OUT_FOR_DELIVERY", toStatus: "COMPLETED" } });
  });
  queuePaidOrderNotification(order.id, "ORDER_COMPLETED");
  if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: `Customer received ${order.orderNumber}`, message: `${order.customerName} confirmed that delivery order ${order.orderNumber} was received. The order is now completed.`, channel: "orders" });
  return json({ ok: true, status: "COMPLETED", message: "Thank you. The pharmacy has been notified that you received the order." });
}

export async function handleWalkInSales(request: Request) {
  const auth = await requireTeamPermission(request, "POS_USE");
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
  const [branch] = await db.select({ id: branches.id, code: branches.code }).from(branches).where(and(eq(branches.id, parsed.data.branchId), eq(branches.isActive, true))).limit(1);
  if (!branch) return json({ error: "Choose an active branch." }, { status: 400 });
  if (auth.session.role === "STAFF" && auth.session.homeBranchId !== branch.id) return json({ error: "POS is limited to your assigned shop." }, { status: 403 });
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
      const temporaryOrderNumber = `TMP-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
      const [created] = await tx.insert(orders).values({ orderNumber: temporaryOrderNumber, checkoutToken: parsed.data.checkoutToken, customerName: parsed.data.customerName || "Walk-in customer", phone: parsed.data.phone || parsed.data.billingPhone || "Walk-in", email: parsed.data.email || null, fulfilmentMethod: "PICKUP", status: paidCash ? "COMPLETED" : "NEW", paymentStatus: paidCash ? "PAID" : "PENDING", paymentMethod: parsed.data.paymentMethod, paymentReference: null, amountPaid: paidCash ? subtotal.toFixed(2) : "0", subtotal: subtotal.toFixed(2), deliveryFee: "0", discount: "0", total: subtotal.toFixed(2), suggestedBranchId: branch.id });
      const orderNumber = healthfieldOrderNumber(branch.code, created.insertId);
      const cashReference = paidCash ? `CASH-${orderNumber}` : null;
      await tx.update(orders).set({ orderNumber, paymentReference: manualReceipt || cashReference }).where(eq(orders.id, created.insertId));
      const insertedItems: Array<{ id: number; productId: number; quantity: number }> = [];
      for (const item of itemList) {
        const product = catalog.find((entry) => entry.id === item.productId)!;
        const unitPrice = Number(product.discountPrice ?? product.price);
        const [createdItem] = await tx.insert(orderItems).values({ orderId: created.insertId, productId: product.id, productName: product.name, quantity: item.quantity, unitPrice: unitPrice.toFixed(2), lineTotal: (unitPrice * item.quantity).toFixed(2), unitCost: product.costPrice ?? null });
        insertedItems.push({ id: createdItem.insertId, productId: item.productId, quantity: item.quantity });
      }
      for (const item of insertedItems) {
        const record = stock.find((row) => row.productId === item.productId)!;
        await tx.update(branchInventory).set({ quantityAvailable: paidCash ? record.quantityAvailable - item.quantity : record.quantityAvailable, quantityReserved: paidCash ? record.quantityReserved : record.quantityReserved + item.quantity, updatedBy: auth.session.userId }).where(eq(branchInventory.id, record.id));
        await tx.insert(orderItemFulfilments).values({ orderItemId: item.id, branchId: branch.id, handledBy: auth.session.userId, quantityReserved: paidCash ? 0 : item.quantity, quantityPacked: paidCash ? item.quantity : 0, status: paidCash ? "READY" : "RESERVED" });
      }
      const [payment] = await tx.insert(paymentTransactions).values({ orderId: created.insertId, method: parsed.data.paymentMethod, channel: "POS", status: paidCash ? "PAID" : parsed.data.paymentMethod === "MANUAL_MPESA" ? "PENDING" : "INITIATED", amount: subtotal.toFixed(2), phone: parsed.data.billingPhone || parsed.data.phone || null, receiptNumber: cashReference, manualMessage: null, verifiedAt: paidCash ? new Date() : null, reviewedBy: paidCash ? auth.session.userId : null, reviewedAt: paidCash ? new Date() : null });
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: paidCash ? "WALK_IN_SALE" : "WALK_IN_PAYMENT_STARTED", entityType: "order", entityId: String(created.insertId), metadata: { branchId: branch.id, total: subtotal, itemCount: itemList.length, paymentMethod: parsed.data.paymentMethod } });
      return { orderId: created.insertId, paymentId: payment.insertId, orderNumber };
    });
    const orderNumber = result.orderNumber;
    if (parsed.data.paymentMethod === "CASH") {
      queuePaidOrderNotification(result.orderId);
      // The counter sale is settled and handed over, so the customer gets the closing
      // confirmation rather than an order-received message promising a later update.
      queueOrderSms(result.orderId, "POS_SALE_COMPLETE");
      return json({ ok: true, paid: true, paymentStatus: "PAID", id: result.orderId, orderNumber, total: subtotal }, { status: 201 });
    }
    let paymentStatus: "PENDING" | "FAILED" | "PAID" = "PENDING";
    let message = parsed.data.paymentMethod === "MANUAL_MPESA" ? "Checking the till payment." : "Check the customer's phone for the M-Pesa prompt.";
    if (parsed.data.paymentMethod === "MANUAL_MPESA") {
      // Customers routinely pay while the basket is still being rung up, so the money
      // is often already waiting by the time the sale exists. Matching here completes
      // it on the spot instead of making the seller wait for the first poll.
      const matched = await reconcileManualPaymentFromIncoming(result.paymentId);
      if (matched.paid) {
        paymentStatus = "PAID";
        message = "Till payment matched. The sale is complete.";
      }
    }
    if (parsed.data.paymentMethod === "MPESA_EXPRESS") {
      try {
        const stk = await initiateStkPush({ orderNumber, phone: parsed.data.billingPhone || parsed.data.phone || "", amount: subtotal });
        await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, result.paymentId));
        await replayStoredStkCallback(stk.checkoutRequestId);
        message = stk.customerMessage;
      } catch (error) {
        paymentStatus = "FAILED";
        message = error instanceof Error ? error.message : "M-Pesa Express could not start.";
        await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: message }).where(eq(paymentTransactions.id, result.paymentId));
        await db.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, result.orderId));
      }
    }
    return json({ ok: true, paid: paymentStatus === "PAID", paymentStatus, id: result.orderId, checkoutToken: parsed.data.checkoutToken, orderNumber, total: subtotal, message }, { status: paymentStatus === "PAID" ? 201 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Walk-in sale could not be completed.";
    console.error("Walk-in sale failed", error);
    return json({ error: message }, { status: message.startsWith("Insufficient stock") ? 409 : 500 });
  }
}

type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Applies the optional stock line from the product form.
 *
 * Product editing already requires an administrator, so this does not re-check the
 * inventory permission; it does write the same activity entry the inventory screen
 * does, so a stock change made here is just as traceable as one made there.
 *
 * Absent or null means "leave stock alone" — the field is optional and a product must
 * save without it.
 */
type ProductStockEntry = { branchId: number; quantityAvailable: number; reorderLevel?: number };

/**
 * Writes stock for one shop, or for every shop the caller sent.
 *
 * The product form used to make you pick a single shop from a dropdown, which meant
 * three shops took three saves and no way to see the other two while typing. It now
 * sends a row per shop, so this takes a list; a lone entry is still accepted because
 * other callers have no reason to change.
 */
async function applyProductStock(
  tx: DatabaseTransaction,
  productId: number,
  actorId: number,
  stock: ProductStockEntry | ProductStockEntry[] | null | undefined,
) {
  if (!stock) return;
  if (Array.isArray(stock)) {
    for (const entry of stock) await applyProductStock(tx, productId, actorId, entry);
    return;
  }
  const [existing] = await tx.select({ id: branchInventory.id, reorderLevel: branchInventory.reorderLevel })
    .from(branchInventory)
    .where(and(eq(branchInventory.branchId, stock.branchId), eq(branchInventory.productId, productId)))
    .limit(1);
  const reorderLevel = stock.reorderLevel ?? existing?.reorderLevel ?? 5;
  if (existing) {
    await tx.update(branchInventory)
      .set({ quantityAvailable: stock.quantityAvailable, reorderLevel, updatedBy: actorId })
      .where(eq(branchInventory.id, existing.id));
  } else {
    await tx.insert(branchInventory).values({ branchId: stock.branchId, productId, quantityAvailable: stock.quantityAvailable, quantityReserved: 0, reorderLevel, updatedBy: actorId });
  }
  await tx.insert(activityLogs).values({
    actorId, action: "INVENTORY_UPDATED", entityType: "branch_inventory",
    entityId: String(existing?.id ?? productId),
    metadata: { branchId: stock.branchId, productId, quantityAvailable: stock.quantityAvailable, via: "product-form" },
  });
}

/**
 * Buying prices for a set of products, keyed by id.
 *
 * Order lines snapshot the cost in force when they sold, so a later change of supplier
 * cannot rewrite a profit report that has already been sent. Read outside the writing
 * transaction because it is reference data, not part of what is being written.
 */
async function productCosts(ids: Array<number | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
  if (!unique.length) return new Map<number, string>();
  const rows = await getDb().select({ id: products.id, costPrice: products.costPrice }).from(products).where(inArray(products.id, unique));
  return new Map(rows.flatMap((row) => (row.costPrice == null ? [] : [[row.id, row.costPrice] as const])));
}

const stockEntrySchema = z.object({ branchId: z.coerce.number().int().positive(), quantityAvailable: z.coerce.number().int().nonnegative().max(1_000_000), reorderLevel: z.coerce.number().int().nonnegative().optional() });
const productStockSchema = z.union([stockEntrySchema, z.array(stockEntrySchema).max(50)]).nullable().optional();

const productSchema = z.object({
  categoryId: z.coerce.number().int().positive(), name: z.string().trim().min(2).max(220), brand: z.string().trim().max(150).optional().default(""),
  barcode: z.string().trim().max(100).optional().default(""),
  shortDescription: z.string().trim().max(500).optional().default(""), imageUrl: z.string().trim().max(500).optional().default(""),
  description: z.string().trim().max(10000).optional().default(""),
  price: z.coerce.number().nonnegative(), discountPrice: z.coerce.number().nonnegative().nullable().optional(), costPrice: z.coerce.number().nonnegative().nullable().optional(), packSize: z.string().trim().max(100).optional().default(""),
  prescriptionRequired: z.coerce.boolean().default(false), isFeatured: z.coerce.boolean().default(false), conditionIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  stock: productStockSchema,
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
    // A manager can price a product; only the owner decides what it cost.
    if (auth.session.role !== "SUPER_ADMIN") values.costPrice = undefined;
    if (values.discountPrice !== null && values.discountPrice !== undefined && values.discountPrice > values.price) return json({ error: "The selling price cannot be higher than the regular price." }, { status: 400 });
    // Equal prices are not a discount, they are one price typed twice — which is what
    // pricing straight off a buying price produces.
    if (values.discountPrice === values.price) values.discountPrice = null;
    if (values.barcode) {
      const [duplicate] = await db.select({ id: products.id }).from(products).where(eq(products.barcode, values.barcode)).limit(1);
      if (duplicate) return json({ error: "That barcode or QR code is already assigned to another product." }, { status: 409 });
    }
    const suffix = Date.now().toString(36);
    const generatedSku = `HF-${suffix.toUpperCase()}`;
    const baseSlug = values.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const created = await db.transaction(async (tx) => {
      const [record] = await tx.insert(products).values({ categoryId: values.categoryId, name: values.name, slug: `${baseSlug}-${suffix}`, sku: generatedSku, barcode: values.barcode || null, brand: values.brand || null, shortDescription: values.shortDescription || null, description: values.description || null, imageUrl: normalizeStoredImageUrl(values.imageUrl), discountPrice: values.discountPrice?.toString() ?? null, price: values.price.toString(), costPrice: values.costPrice == null ? null : values.costPrice.toFixed(2), costPriceEstimated: values.costPrice == null, packSize: values.packSize || null, prescriptionRequired: values.prescriptionRequired, isFeatured: values.isFeatured, isActive: true });
      if (values.conditionIds.length) await tx.insert(productHealthConditions).values(values.conditionIds.map((conditionId) => ({ productId: record.insertId, conditionId })));
      const stores = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true));
      if (stores.length) await tx.insert(branchInventory).values(stores.map((store) => ({ branchId: store.id, productId: record.insertId, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: auth.session.userId })));
      await applyProductStock(tx, record.insertId, auth.session.userId, values.stock);
      return record;
    });
    return json({ ok: true, id: created.insertId, sku: generatedSku }, { status: 201 });
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
    const parsed = z.object({ name: z.string().trim().min(2).max(220).optional(), categoryId: z.coerce.number().int().positive().optional(), barcode: z.string().trim().max(100).nullable().optional(), brand: z.string().trim().max(150).nullable().optional(), shortDescription: z.string().trim().max(500).nullable().optional(), description: z.string().trim().max(10000).nullable().optional(), packSize: z.string().trim().max(100).nullable().optional(), price: z.coerce.number().nonnegative().optional(), discountPrice: z.coerce.number().nonnegative().nullable().optional(), costPrice: z.coerce.number().nonnegative().nullable().optional(), imageUrl: z.string().trim().max(500).nullable().optional(), prescriptionRequired: z.boolean().optional(), isFeatured: z.boolean().optional(), isActive: z.boolean().optional(), conditionIds: z.array(z.coerce.number().int().positive()).optional(), stock: productStockSchema }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Invalid product update." }, { status: 400 });
    if (auth.session.role !== "SUPER_ADMIN") parsed.data.costPrice = undefined;
    if (parsed.data.price !== undefined && parsed.data.discountPrice !== null && parsed.data.discountPrice !== undefined && parsed.data.discountPrice > parsed.data.price) return json({ error: "The selling price cannot be higher than the regular price." }, { status: 400 });
    if (parsed.data.price !== undefined && parsed.data.discountPrice === parsed.data.price) parsed.data.discountPrice = null;
    if (parsed.data.barcode) {
      const [duplicate] = await db.select({ id: products.id }).from(products).where(and(eq(products.barcode, parsed.data.barcode), ne(products.id, id))).limit(1);
      if (duplicate) return json({ error: "That barcode or QR code is already assigned to another product." }, { status: 409 });
    }
    const { conditionIds, stock, ...update } = parsed.data;
    const normalized = { ...update, imageUrl: parsed.data.imageUrl === undefined ? undefined : normalizeStoredImageUrl(parsed.data.imageUrl) };
    await db.transaction(async (tx) => {
      await tx.update(products).set({
        ...normalized,
        price: parsed.data.price?.toString(),
        discountPrice: parsed.data.discountPrice === null ? null : parsed.data.discountPrice?.toString(),
        costPrice: parsed.data.costPrice === undefined ? undefined : parsed.data.costPrice === null ? null : parsed.data.costPrice.toFixed(2),
        // A buying price someone typed is confirmed; that is what takes the row off the
        // estimated list the profit report counts.
        costPriceEstimated: parsed.data.costPrice === undefined ? undefined : parsed.data.costPrice === null,
      }).where(eq(products.id, id));
      await applyProductStock(tx, id, auth.session.userId, stock);
      if (conditionIds) { await tx.delete(productHealthConditions).where(eq(productHealthConditions.productId, id)); if (conditionIds.length) await tx.insert(productHealthConditions).values(conditionIds.map((conditionId) => ({ productId: id, conditionId }))); }
    });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

/**
 * Saves a page of the bulk product editor in one transaction.
 *
 * Everything is validated before anything is written, and the whole page lands or none
 * of it does: a hundred rows half-applied is worse than a hundred rows rejected, because
 * nobody can tell afterwards which half took. Rows arrive already filtered to the ones
 * that were actually edited, so an untouched row cannot be overwritten by a stale value
 * the browser happened to be holding.
 */
export async function handleProductsBulk(request: Request) {
  // Owner only. The table carries buying prices, which is the shop's margin laid out
  // in one screen — the same reason the profit card is not shown to managers.
  const auth = await requireSession(request, ["SUPER_ADMIN"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    rows: z.array(z.object({
      id: z.coerce.number().int().positive(),
      name: z.string().trim().min(2).max(220).optional(),
      costPrice: z.coerce.number().nonnegative().nullable().optional(),
      price: z.coerce.number().nonnegative().optional(),
      discountPrice: z.coerce.number().nonnegative().nullable().optional(),
      stock: z.array(stockEntrySchema).max(50).optional(),
    })).min(1).max(200),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Some rows could not be read. Check the changed figures and try again." }, { status: 400 });

  const rows = parsed.data.rows;
  const ids = [...new Set(rows.map((row) => row.id))];
  if (ids.length !== rows.length) return json({ error: "The same product appears twice in this save." }, { status: 400 });
  const db = getDb();
  const existing = await db.select({ id: products.id, price: products.price, discountPrice: products.discountPrice }).from(products).where(inArray(products.id, ids));
  const known = new Map(existing.map((row) => [row.id, row]));

  // Validated as a set first, naming the row rather than failing anonymously halfway.
  for (const row of rows) {
    const current = known.get(row.id);
    if (!current) return json({ error: `Product ${row.id} no longer exists. Reload the page and try again.` }, { status: 409 });
    const price = row.price ?? Number(current.price);
    const selling = row.discountPrice === undefined ? (current.discountPrice === null ? null : Number(current.discountPrice)) : row.discountPrice;
    if (selling !== null && selling > price) return json({ error: `${row.name || `Product ${row.id}`}: the selling price cannot be higher than the crossed-out price.` }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const current = known.get(row.id)!;
      const price = row.price ?? Number(current.price);
      const selling = row.discountPrice === undefined ? undefined : row.discountPrice;
      await tx.update(products).set({
        name: row.name,
        price: row.price === undefined ? undefined : row.price.toFixed(2),
        // Equal prices are one price typed twice, not a discount worth crossing out.
        discountPrice: selling === undefined ? undefined : selling === null || selling === price ? null : selling.toFixed(2),
        costPrice: row.costPrice === undefined ? undefined : row.costPrice === null ? null : row.costPrice.toFixed(2),
        costPriceEstimated: row.costPrice === undefined ? undefined : row.costPrice === null,
      }).where(eq(products.id, row.id));
      if (row.stock?.length) await applyProductStock(tx, row.id, auth.session.userId, row.stock);
    }
    await tx.insert(activityLogs).values({
      actorId: auth.session.userId,
      action: "PRODUCTS_BULK_UPDATED",
      entityType: "product",
      entityId: null,
      metadata: { products: rows.length, stockRows: rows.reduce((sum, row) => sum + (row.stock?.length ?? 0), 0), actorRole: auth.session.role },
    });
  });
  return json({ ok: true, updated: rows.length });
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

export async function handleOffers(request: Request, id?: number) {
  const auth = await requireTeamPermission(request, "OFFERS_MANAGE");
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (request.method === "DELETE" && id) {
    await db.delete(offerItems).where(eq(offerItems.offerId, id));
    await db.delete(offers).where(eq(offers.id, id));
    await db.insert(activityLogs).values({ actorId:auth.session.userId, action:"OFFER_DELETED", entityType:"offer", entityId:String(id), metadata:{ actorRole:auth.session.role } });
    return json({ ok: true });
  }
  if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().max(500).optional().default(""),
    endsAt: z.string().trim().max(40).optional().default(""),
    isActive: z.boolean().default(true),
    // A bundle price marks the offer as a group buy; leaving it out means each item
    // carries its own replacement price instead.
    bundlePrice: z.number().nonnegative().max(10_000_000).nullable().optional(),
    items: z.array(z.object({
      productId: z.number().int().positive(),
      offerPrice: z.number().nonnegative().max(10_000_000).nullable().optional(),
      quantity: z.number().int().min(1).max(99).optional().default(1),
    })).min(1).max(20),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Add a title and at least one product." }, { status: 400 });
  const { items, bundlePrice, endsAt, ...fields } = parsed.data;
  const expiry = endsAt ? new Date(endsAt) : null;
  if (expiry && Number.isNaN(expiry.getTime())) return json({ error: "Enter a valid offer end date." }, { status: 400 });
  if (expiry && request.method === "POST" && expiry.getTime() <= Date.now()) return json({ error: "The offer end date must be in the future." }, { status: 400 });
  const isGroup = bundlePrice !== null && bundlePrice !== undefined && items.length > 1;
  if (!isGroup && items.some((item) => item.offerPrice === null || item.offerPrice === undefined)) return json({ error: "Set an offer price for the product." }, { status: 400 });
  const live = await db.select({ id: products.id }).from(products).where(and(inArray(products.id, items.map((item) => item.productId)), eq(products.isActive, true)));
  if (live.length !== new Set(items.map((item) => item.productId)).size) return json({ error: "One or more selected products are unavailable." }, { status: 409 });

  const values = { ...fields, description: fields.description || null, bundlePrice: isGroup ? String(bundlePrice) : null, endsAt: expiry };
  let offerId = id ?? 0;
  if (request.method === "POST") {
    const slug = `${fields.title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    const [created] = await db.insert(offers).values({ ...values, slug });
    offerId = created.insertId;
  } else {
    if (!id) return json({ error: "Offer not found." }, { status: 404 });
    await db.update(offers).set(values).where(eq(offers.id, id));
  }
  await db.delete(offerItems).where(eq(offerItems.offerId, offerId));
  await db.insert(offerItems).values(items.map((item, index) => ({
    offerId, productId: item.productId, quantity: item.quantity ?? 1, displayOrder: index,
    offerPrice: isGroup ? null : String(item.offerPrice),
  })));
  await db.insert(activityLogs).values({ actorId:auth.session.userId, action:request.method === "POST" ? "OFFER_CREATED" : "OFFER_UPDATED", entityType:"offer", entityId:String(offerId), metadata:{ title:fields.title, productIds:items.map((item)=>item.productId), isActive:fields.isActive, actorRole:auth.session.role } });
  return json({ ok: true, id: offerId }, { status: request.method === "POST" ? 201 : 200 });
}

export const blogProductLimit = 3;
// Replaces an article's promoted products in one step. Unknown or inactive ids are
// dropped rather than rejected so a retired product cannot block saving an article.
async function setBlogProducts(postId: number, productIds: number[]) {
  const db = getDb();
  await db.delete(blogPostProducts).where(eq(blogPostProducts.postId, postId));
  const wanted = [...new Set(productIds)].slice(0, blogProductLimit);
  if (!wanted.length) return;
  const live = await db.select({ id: products.id }).from(products).where(and(inArray(products.id, wanted), eq(products.isActive, true)));
  const ordered = wanted.filter((productId) => live.some((row) => row.id === productId));
  if (ordered.length) await db.insert(blogPostProducts).values(ordered.map((productId, index) => ({ postId, productId, displayOrder: index })));
}

export async function handleBlogs(request: Request, id?: number) {
  const db=getDb();
  if(request.method==="GET"&&!id)return json({posts:await db.select().from(blogPosts).where(eq(blogPosts.isPublished,true)).orderBy(desc(blogPosts.publishedAt))});
  const auth=await requireTeamPermission(request,"BLOGS_MANAGE");if("response" in auth)return auth.response;
  if(request.method==="POST"&&!id){const parsed=z.object({title:z.string().trim().min(3).max(220),excerpt:z.string().trim().min(10).max(500),content:z.string().trim().min(20).max(60000),imageUrl:z.string().trim().max(500).optional().default(""),metaTitle:z.string().trim().max(220).optional().default(""),metaDescription:z.string().trim().max(500).optional().default(""),isPublished:z.boolean().default(false),category:z.string().trim().max(60).optional().default(""),productIds:z.array(z.number().int().positive()).max(blogProductLimit).optional().default([])}).safeParse(await body(request));if(!parsed.success){const issue=parsed.error.issues[0];const field=String(issue?.path?.[0]??"field");const labels:Record<string,string>={title:"title",excerpt:"summary",content:"article",imageUrl:"cover image",metaTitle:"meta title",metaDescription:"meta description",category:"category"};const label=labels[field]??field;const detail=issue?.code==="too_big"?`The ${label} is too long. ${field==="content"?"Very large pasted images are the usual cause — upload the image instead of pasting it.":"Shorten it and try again."}`:issue?.code==="too_small"?`The ${label} is too short.`:`Check the ${label}.`;return json({error:detail},{status:400});}const {productIds,...rest}=parsed.data;const fields={...rest,category:rest.category||null};const slug=`${fields.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${Date.now().toString(36)}`,[created]=await db.insert(blogPosts).values({...fields,slug,imageUrl:fields.imageUrl||null,metaTitle:fields.metaTitle||null,metaDescription:fields.metaDescription||null,publishedAt:fields.isPublished?new Date():null,authorId:auth.session.userId});await setBlogProducts(created.insertId,productIds);await db.insert(activityLogs).values({actorId:auth.session.userId,action:"BLOG_CREATED",entityType:"blog",entityId:String(created.insertId),metadata:{title:fields.title,isPublished:fields.isPublished,actorRole:auth.session.role}});return json({id:created.insertId,slug},{status:201})}
  if(request.method==="PATCH"&&id){const parsed=z.object({title:z.string().trim().min(3).max(220),excerpt:z.string().trim().min(10).max(500),content:z.string().trim().min(20).max(60000),imageUrl:z.string().trim().max(500).nullable(),metaTitle:z.string().trim().max(220).nullable(),metaDescription:z.string().trim().max(500).nullable(),isPublished:z.boolean(),category:z.string().trim().max(60).optional(),productIds:z.array(z.number().int().positive()).max(blogProductLimit).optional()}).safeParse(await body(request));if(!parsed.success){const issue=parsed.error.issues[0];const field=String(issue?.path?.[0]??"field");const labels:Record<string,string>={title:"title",excerpt:"summary",content:"article",imageUrl:"cover image",metaTitle:"meta title",metaDescription:"meta description",category:"category"};const label=labels[field]??field;const detail=issue?.code==="too_big"?`The ${label} is too long. ${field==="content"?"Very large pasted images are the usual cause — upload the image instead of pasting it.":"Shorten it and try again."}`:issue?.code==="too_small"?`The ${label} is too short.`:`Check the ${label}.`;return json({error:detail},{status:400});}const [existing]=await db.select({slug:blogPosts.slug}).from(blogPosts).where(eq(blogPosts.id,id)).limit(1);if(!existing)return json({error:"Article not found."},{status:404});const {productIds,...rest}=parsed.data;const fields={...rest,...(rest.category===undefined?{}:{category:rest.category||null})};await db.update(blogPosts).set({...fields,publishedAt:fields.isPublished?new Date():null}).where(eq(blogPosts.id,id));if(productIds!==undefined)await setBlogProducts(id,productIds);await db.insert(activityLogs).values({actorId:auth.session.userId,action:"BLOG_UPDATED",entityType:"blog",entityId:String(id),metadata:{title:fields.title,isPublished:fields.isPublished,actorRole:auth.session.role}});return json({ok:true,slug:existing.slug})}
  if(request.method==="DELETE"&&id){const [existing]=await db.select({slug:blogPosts.slug}).from(blogPosts).where(eq(blogPosts.id,id)).limit(1);await db.delete(blogPostProducts).where(eq(blogPostProducts.postId,id));await db.delete(blogPosts).where(eq(blogPosts.id,id));await db.insert(activityLogs).values({actorId:auth.session.userId,action:"BLOG_DELETED",entityType:"blog",entityId:String(id),metadata:{actorRole:auth.session.role}});return json({ok:true,slug:existing?.slug})}return json({error:"Method not allowed."},{status:405});
}

export async function handlePromotionalBanners(request: Request, id?: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  const db = getDb();

  if (request.method === "DELETE" && id) {
    const [existing] = await db.select({ id: promotionalBanners.id, title: promotionalBanners.title }).from(promotionalBanners).where(eq(promotionalBanners.id, id)).limit(1);
    if (!existing) return json({ error: "Promotional banner not found." }, { status: 404 });
    await db.transaction(async (tx) => {
      await tx.delete(promotionalBanners).where(eq(promotionalBanners.id, id));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "PROMOTIONAL_BANNER_DELETED", entityType: "promotional_banner", entityId: String(id), metadata: { title: existing.title, actorRole: auth.session.role } });
    });
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  if (request.method === "PATCH" && !id) return json({ error: "Promotional banner not found." }, { status: 404 });
  const parsed = z.object({
    title: z.string().trim().min(2).max(180),
    imageUrl: z.string().trim().min(1).max(500),
    productId: z.number().int().positive(),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).max(10000).optional().default(0),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Add an advert image and choose the product it should open." }, { status: 400 });
  const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, parsed.data.productId), eq(products.isActive, true))).limit(1);
  if (!product) return json({ error: "Choose an active product for this advert." }, { status: 409 });
  const values = { ...parsed.data, imageUrl: normalizeStoredImageUrl(parsed.data.imageUrl) ?? parsed.data.imageUrl };

  if (request.method === "POST") {
    const [created] = await db.transaction(async (tx) => {
      const result = await tx.insert(promotionalBanners).values({ ...values, createdBy: auth.session.userId });
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "PROMOTIONAL_BANNER_CREATED", entityType: "promotional_banner", entityId: String(result[0].insertId), metadata: { title: values.title, productId: values.productId, isActive: values.isActive, actorRole: auth.session.role } });
      return result;
    });
    return json({ ok: true, id: created.insertId }, { status: 201 });
  }

  const [existing] = await db.select({ id: promotionalBanners.id }).from(promotionalBanners).where(eq(promotionalBanners.id, id!)).limit(1);
  if (!existing) return json({ error: "Promotional banner not found." }, { status: 404 });
  await db.transaction(async (tx) => {
    await tx.update(promotionalBanners).set(values).where(eq(promotionalBanners.id, id!));
    await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "PROMOTIONAL_BANNER_UPDATED", entityType: "promotional_banner", entityId: String(id), metadata: { title: values.title, productId: values.productId, isActive: values.isActive, actorRole: auth.session.role } });
  });
  return json({ ok: true });
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

async function handleImageUpload(request: Request, kind: "product" | "promotion") {
  const auth = kind === "product" ? await requireTeamPermission(request, "BLOGS_MANAGE") : await requireSession(request, [...admins], true);
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return json({ error: kind === "promotion" ? "Choose a promotional banner image." : "Choose a product image." }, { status: 400 });
  const types = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"], ["image/avif", "avif"], ["image/bmp", "bmp"], ["image/tiff", "tiff"]]);
  const extension = types.get(image.type.toLowerCase());
  if (!extension) return json({ error: "Use JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF." }, { status: 415 });
  if (kind === "promotion" && !new Set(["image/jpeg", "image/png", "image/webp"]).has(image.type.toLowerCase())) return json({ error: "Promotional banners must be JPEG, PNG or WebP." }, { status: 415 });
  if (image.size <= 0 || image.size > 2 * 1024 * 1024) return json({ error: `${kind === "promotion" ? "Promotional banner" : "Product"} images must be 2 MB or smaller.` }, { status: 413 });
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

export async function handleProductImage(request: Request) {
  return handleImageUpload(request, "product");
}

export async function handlePromotionalImage(request: Request) {
  return handleImageUpload(request, "promotion");
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

const prescriptionLineSchema = z.object({
  productId: z.number().int().positive(),
  requestedQuantity: z.number().int().min(0).max(99).optional().default(0),
  approvedQuantity: z.number().int().min(0).max(99).nullable().optional().default(null),
  unitPrice: z.number().positive().max(10_000_000).nullable().optional().default(null),
  availability: z.enum(["PENDING", "AVAILABLE", "PARTIALLY_AVAILABLE", "UNAVAILABLE"]),
  source: z.enum(["CUSTOMER_CART", "PHARMACIST"]).optional().default("PHARMACIST"),
  dispenseRule: z.enum(dispenseRules).optional().default("COURSE_BOUND"),
  minimumQuantity: z.number().int().min(1).max(99).nullable().optional().default(null),
  pharmacistNote: z.string().trim().max(500).optional().default(""),
});

class PrescriptionWorkflowError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function handlePrescriptions(request: Request, downloadId?: number) {
  if (downloadId) {
    const auth = await requireSession(request, [...team, "CUSTOMER"]);
    if ("response" in auth) return auth.response;
    if (auth.session.role === "STAFF") {
      const permission = request.method === "GET" ? "PRESCRIPTIONS_VIEW" : "PRESCRIPTIONS_PROCESS";
      if (!sessionHasPermission(auth.session, permission)) return json({ error:"You do not have permission to perform this prescription action." }, { status:403 });
    }
    const db=getDb();
    if(request.method==="DELETE"){
      if(!admins.includes(auth.session.role as typeof admins[number]))return json({error:"Only an administrator can delete a prescription request."},{status:403});
      try{
        const deleted=await db.transaction(async(tx)=>{
          const [record]=await tx.select().from(prescriptions).where(eq(prescriptions.id,downloadId)).limit(1).for("update");
          if(!record)throw new PrescriptionWorkflowError("Prescription request not found.",404);
          let deletedOrderNumber:string|null=null;
          if(record.orderId){
            const [order]=await tx.select().from(orders).where(eq(orders.id,record.orderId)).limit(1).for("update");
            if(order){
              if(order.paymentStatus==="PAID"||!["NEW","AWAITING_PAYMENT","UNDER_REVIEW","CANCELLED"].includes(order.status))throw new PrescriptionWorkflowError("This prescription is linked to a paid or active fulfilment order and must be retained for the order history.");
              deletedOrderNumber=order.orderNumber;
              const items=await tx.select({id:orderItems.id,productId:orderItems.productId}).from(orderItems).where(eq(orderItems.orderId,order.id));
              if(items.length){
                const fulfilments=await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId,items.map((item)=>item.id)));
                for(const fulfilment of fulfilments){
                  const item=items.find((row)=>row.id===fulfilment.orderItemId);
                  if(!item?.productId||fulfilment.quantityReserved<=0)continue;
                  const [stock]=await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId,fulfilment.branchId),eq(branchInventory.productId,item.productId))).limit(1).for("update");
                  if(stock)await tx.update(branchInventory).set({quantityReserved:Math.max(0,stock.quantityReserved-fulfilment.quantityReserved),updatedBy:auth.session.userId}).where(eq(branchInventory.id,stock.id));
                }
                await tx.delete(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId,items.map((item)=>item.id)));
              }
              const payments=await tx.select({id:paymentTransactions.id,status:paymentTransactions.status}).from(paymentTransactions).where(eq(paymentTransactions.orderId,order.id));
              if(payments.some((payment)=>!["FAILED","CANCELLED"].includes(payment.status)))throw new PrescriptionWorkflowError("This prescription has a payment in progress or retained payment history and cannot be deleted.");
              if(payments.length){
                await tx.update(mpesaIncomingPayments).set({matchedTransactionId:null}).where(inArray(mpesaIncomingPayments.matchedTransactionId,payments.map((payment)=>payment.id)));
                await tx.update(mpesaStkCallbacks).set({processedTransactionId:null}).where(inArray(mpesaStkCallbacks.processedTransactionId,payments.map((payment)=>payment.id)));
                await tx.delete(paymentTransactions).where(eq(paymentTransactions.orderId,order.id));
              }
              await tx.delete(prescriptions).where(eq(prescriptions.id,downloadId));
              await tx.delete(orderItems).where(eq(orderItems.orderId,order.id));
              await tx.delete(orders).where(eq(orders.id,order.id));
            }else await tx.delete(prescriptions).where(eq(prescriptions.id,downloadId));
          }else await tx.delete(prescriptions).where(eq(prescriptions.id,downloadId));
          await tx.insert(activityLogs).values({actorId:auth.session.userId,action:"PRESCRIPTION_DELETED",entityType:"prescription",entityId:String(downloadId),metadata:{originalFilename:record.originalFilename,deletedOrderNumber}});
          return{storageKey:record.storageKey,deletedOrderNumber};
        });
        await unlink(path.join(storageRoot(),"prescriptions",path.basename(deleted.storageKey))).catch((error)=>console.warn("Deleted prescription file was already unavailable",{prescriptionId:downloadId,error}));
        return json({ok:true,message:deleted.deletedOrderNumber?`Prescription and unpaid proposal ${deleted.deletedOrderNumber} were deleted.`:"Prescription request was deleted."});
      }catch(error){
        if(error instanceof PrescriptionWorkflowError)return json({error:error.message},{status:error.status});
        console.error("Prescription deletion failed",{prescriptionId:downloadId,error});
        return json({error:"The prescription could not be deleted."},{status:500});
      }
    }
    if(request.method==="PATCH"){
      if(!team.includes(auth.session.role as typeof team[number]))return json({error:"Only pharmacy staff can review prescriptions."},{status:403});
      const parsed=z.object({action:z.enum(prescriptionReviewActions),reviewVersion:z.number().int().nonnegative(),pharmacistNotes:z.string().trim().max(2000).optional().default(""),items:z.array(prescriptionLineSchema).max(50).optional()}).safeParse(await body(request));
      if(!parsed.success)return json({error:parsed.error.issues[0]?.message||"Check the prescription review details."},{status:400});
      const action=parsed.data.action as PrescriptionReviewAction;
      if(["REQUEST_CLARIFICATION","DECLINE"].includes(action)&&parsed.data.pharmacistNotes.length<5)return json({error:"Add a clear note for the customer before continuing."},{status:400});
      if(action==="APPROVE"&&!parsed.data.items?.length)return json({error:"Add at least one medicine before approving this prescription."},{status:400});
      if(parsed.data.items&&new Set(parsed.data.items.map((item)=>item.productId)).size!==parsed.data.items.length)return json({error:"Each medicine can appear only once."},{status:400});
      try{
        const result=await db.transaction(async(tx)=>{
          const [record]=await tx.select().from(prescriptions).where(eq(prescriptions.id,downloadId)).limit(1).for("update");
          if(!record)throw new PrescriptionWorkflowError("Prescription request not found.",404);
          if(record.reviewVersion!==parsed.data.reviewVersion)throw new PrescriptionWorkflowError("This prescription changed in another session. Close the modal and open it again.");
          if(!canApplyPrescriptionAction(record.status as PrescriptionStatus,action))throw new PrescriptionWorkflowError(`This prescription cannot perform ${action.replaceAll("_"," ").toLowerCase()} from its current stage.`);
          const [customer]=record.customerId?await tx.select({id:users.id,firstName:users.firstName,lastName:users.lastName,email:users.email,phone:users.phone,role:users.role}).from(users).where(eq(users.id,record.customerId)).limit(1):[];
          if(!customer||customer.role!=="CUSTOMER")throw new PrescriptionWorkflowError("This request is not linked to an active customer account.");
          let normalizedItems:Array<{productId:number;productName:string;requestedQuantity:number;approvedQuantity:number|null;unitPrice:string|null;availability:"PENDING"|"AVAILABLE"|"PARTIALLY_AVAILABLE"|"UNAVAILABLE";source:"CUSTOMER_CART"|"PHARMACIST";dispenseRule:DispenseRule;minimumQuantity:number|null;pharmacistNote:string|null}>|undefined;
          if(parsed.data.items){
            const productIds=parsed.data.items.map((item)=>item.productId);
            const [catalogue,stockRows,existingItems]=await Promise.all([
              tx.select({id:products.id,name:products.name,isActive:products.isActive}).from(products).where(inArray(products.id,productIds)),
              tx.select({productId:branchInventory.productId,available:sql<number>`sum(greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0))`}).from(branchInventory).where(inArray(branchInventory.productId,productIds)).groupBy(branchInventory.productId),
              tx.select().from(prescriptionRequestItems).where(eq(prescriptionRequestItems.prescriptionId,downloadId)),
            ]);
            if(catalogue.length!==productIds.length||catalogue.some((product)=>!product.isActive))throw new PrescriptionWorkflowError("One or more selected medicines are no longer active.",400);
            const stock=new Map(stockRows.map((row)=>[row.productId,Number(row.available)])),existing=new Map(existingItems.map((item)=>[item.productId,item]));
            normalizedItems=parsed.data.items.map((line)=>{
              const product=catalogue.find((entry)=>entry.id===line.productId)!,previous=existing.get(line.productId);
              const approvedQuantity=line.availability==="UNAVAILABLE"?null:line.approvedQuantity,unitPrice=line.availability==="UNAVAILABLE"?null:line.unitPrice;
              if(action==="APPROVE"&&line.availability==="PENDING")throw new PrescriptionWorkflowError(`Confirm availability for ${product.name}.`,400);
              if(action==="APPROVE"&&line.availability!=="UNAVAILABLE"&&(!approvedQuantity||!unitPrice))throw new PrescriptionWorkflowError(`Confirm the quantity and price for ${product.name}.`,400);
              if(action==="APPROVE"&&approvedQuantity&&approvedQuantity>(stock.get(line.productId)||0))throw new PrescriptionWorkflowError(`Only ${stock.get(line.productId)||0} units of ${product.name} are currently available.`);
              return{productId:line.productId,productName:product.name,requestedQuantity:Math.max(line.requestedQuantity,previous?.requestedQuantity||0),approvedQuantity,unitPrice:unitPrice?.toFixed(2)||null,availability:line.availability,source:previous?.source||line.source,dispenseRule:line.dispenseRule,minimumQuantity:line.dispenseRule==="DIVISIBLE"?(line.minimumQuantity&&approvedQuantity?Math.min(line.minimumQuantity,approvedQuantity):line.minimumQuantity):null,pharmacistNote:line.pharmacistNote||null};
            });
            await tx.delete(prescriptionRequestItems).where(eq(prescriptionRequestItems.prescriptionId,downloadId));
            if(normalizedItems.length)await tx.insert(prescriptionRequestItems).values(normalizedItems.map((item)=>({...item,prescriptionId:downloadId})));
          }
          let nextStatus:PrescriptionStatus=record.status as PrescriptionStatus,orderId=record.orderId,orderNumber:string|null=null,orderTotal:number|null=null;
          if(action==="START_REVIEW")nextStatus="UNDER_REVIEW";
          if(action==="REQUEST_CLARIFICATION")nextStatus="MORE_INFORMATION_REQUIRED";
          if(action==="DECLINE")nextStatus="DECLINED";
          if(action==="APPROVE"){
            nextStatus="APPROVED";
            const approvedLines=(normalizedItems||[]).filter((item)=>item.availability!=="UNAVAILABLE"&&item.approvedQuantity&&item.unitPrice);
            if(!approvedLines.length)throw new PrescriptionWorkflowError("At least one available, priced medicine is required for approval.",400);
            const subtotal=approvedLines.reduce((sum,item)=>sum+Number(item.unitPrice)*Number(item.approvedQuantity),0);
            const prescriptionVat=await onlineVatFor(subtotal);
            // Buying prices as they stand now, snapshotted onto the lines this approval creates.
            const approvedProductIds=[...new Set(approvedLines.map((item)=>item.productId).filter((value): value is number=>Number.isInteger(value)&&Number(value)>0))];
            const approvedCostRows=approvedProductIds.length?await tx.select({id:products.id,costPrice:products.costPrice}).from(products).where(inArray(products.id,approvedProductIds)):[];
            const prescriptionCosts=new Map(approvedCostRows.flatMap((row)=>row.costPrice==null?[]:[[row.id,row.costPrice] as const]));
            const linkedOrder=record.orderId?(await tx.select().from(orders).where(eq(orders.id,record.orderId)).limit(1).for("update"))[0]:undefined;
            if(linkedOrder?.paymentStatus==="PAID"){
              orderId=linkedOrder.id;orderNumber=linkedOrder.orderNumber;orderTotal=Number(linkedOrder.total);
              await tx.update(orders).set({prescriptionStatus:"APPROVED",status:"CONFIRMED"}).where(eq(orders.id,linkedOrder.id));
            }else{
              if(linkedOrder){
                const attempts=await tx.select({status:paymentTransactions.status}).from(paymentTransactions).where(eq(paymentTransactions.orderId,linkedOrder.id));
                if(attempts.some((payment)=>!["FAILED","CANCELLED"].includes(payment.status)))throw new PrescriptionWorkflowError("This linked order already has a payment awaiting confirmation and cannot be repriced.");
                await tx.delete(orderItems).where(eq(orderItems.orderId,linkedOrder.id));
                await tx.update(orders).set({checkoutToken:null,customerName:`${customer.firstName} ${customer.lastName}`.trim(),phone:customer.phone||"",email:customer.email,fulfilmentMethod:"PICKUP",deliveryAddress:null,deliveryArea:null,deliveryLatitude:null,deliveryLongitude:null,status:"AWAITING_PAYMENT",paymentStatus:"PENDING",paymentMethod:"PENDING",paymentReference:null,amountPaid:"0",prescriptionStatus:"APPROVED",subtotal:subtotal.toFixed(2),deliveryFee:"0",discount:"0",vat:prescriptionVat.amount.toFixed(2),vatRate:prescriptionVat.rate.toFixed(2),total:prescriptionVat.payable.toFixed(2)}).where(eq(orders.id,linkedOrder.id));
                orderId=linkedOrder.id;orderNumber=linkedOrder.orderNumber;
              }else{
                const temporaryOrderNumber=`TMP-${randomUUID().replaceAll("-","").slice(0,20).toUpperCase()}`;
                const [created]=await tx.insert(orders).values({orderNumber:temporaryOrderNumber,customerId:customer.id,customerName:`${customer.firstName} ${customer.lastName}`.trim(),phone:customer.phone||"",email:customer.email,fulfilmentMethod:"PICKUP",status:"AWAITING_PAYMENT",paymentStatus:"PENDING",paymentMethod:"PENDING",prescriptionStatus:"APPROVED",subtotal:subtotal.toFixed(2),deliveryFee:"0",discount:"0",vat:prescriptionVat.amount.toFixed(2),vatRate:prescriptionVat.rate.toFixed(2),total:prescriptionVat.payable.toFixed(2)});
                orderNumber=healthfieldOrderNumber("RX",created.insertId);
                await tx.update(orders).set({orderNumber}).where(eq(orders.id,created.insertId));
                orderId=created.insertId;
              }
              await tx.insert(orderItems).values(approvedLines.map((item)=>({orderId:orderId!,productId:item.productId,productName:item.productName,quantity:item.approvedQuantity!,unitPrice:item.unitPrice!,unitCost:prescriptionCosts.get(item.productId!)??null,lineTotal:(Number(item.unitPrice)*Number(item.approvedQuantity)).toFixed(2)})));
              orderTotal=prescriptionVat.payable;
            }
          }
          const reviewVersion=record.reviewVersion+1;
          await tx.update(prescriptions).set({status:nextStatus,orderId,pharmacistNotes:parsed.data.pharmacistNotes||record.pharmacistNotes,reviewedBy:auth.session.userId,reviewedAt:new Date(),reviewVersion}).where(eq(prescriptions.id,downloadId));
          await tx.insert(activityLogs).values({actorId:auth.session.userId,action:`PRESCRIPTION_${action}`,entityType:"prescription",entityId:String(downloadId),metadata:{from:record.status,to:nextStatus,orderId,itemCount:normalizedItems?.length}});
          const savedItems=await tx.select().from(prescriptionRequestItems).where(eq(prescriptionRequestItems.prescriptionId,downloadId)).orderBy(prescriptionRequestItems.id);
          return{customer,status:nextStatus,reviewVersion,orderId,orderNumber,orderTotal,items:savedItems};
        });
        if(action==="REQUEST_CLARIFICATION")void sendEmail({to:result.customer.email,subject:"Action required for your prescription",message:`Hello ${result.customer.firstName},\n\nA pharmacist needs more information before completing your prescription request.\n\n${parsed.data.pharmacistNotes}`,action:{label:"Review prescription request",url:`${storefrontOrigin()}/account/prescriptions/${downloadId}`},channel:"orders"});
        if(action==="APPROVE")void sendEmail({to:result.customer.email,subject:"Your prescription is approved and ready",message:`Hello ${result.customer.firstName},\n\nYour prescription has been approved. The confirmed medicines total KES ${Number(result.orderTotal).toLocaleString()}. Review the proposed order, choose delivery or pickup and proceed to payment.`,action:{label:"Review and pay",url:`${storefrontOrigin()}/account/prescriptions/${downloadId}`},channel:"orders"});
        if(action==="DECLINE")void sendEmail({to:result.customer.email,subject:"Prescription review update",message:`Hello ${result.customer.firstName},\n\nThis prescription request could not be approved.\n\n${parsed.data.pharmacistNotes}`,action:{label:"View prescription request",url:`${storefrontOrigin()}/account/prescriptions/${downloadId}`},channel:"orders"});
        return json({ok:true,...result});
      }catch(error){if(error instanceof PrescriptionWorkflowError)return json({error:error.message},{status:error.status});console.error("Prescription review failed",{prescriptionId:downloadId,action,error});return json({error:"The prescription review could not be saved."},{status:500});}
    }
    const [record] = await db.select().from(prescriptions).where(eq(prescriptions.id, downloadId)).limit(1);
    if (!record) return json({ error: "Prescription not found." }, { status: 404 });
    if (auth.session.role === "CUSTOMER" && record.customerId !== auth.session.userId) return json({ error: "Not found." }, { status: 404 });
    try {
      const buffer = await readFile(path.join(storageRoot(), "prescriptions", path.basename(record.storageKey)));
      return new Response(buffer, { headers: { "Content-Type": record.mimeType, "Content-Disposition": `inline; filename="${safeFilename(record.originalFilename)}"`, "Cache-Control": "private, no-store" } });
    } catch { return json({ error: "Prescription file is missing." }, { status: 404 }); }
  }
  const auth = await requireSession(request, ["CUSTOMER"], true);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const form = await request.formData();
  const file = form.get("prescription");
  if (!(file instanceof File)) return json({ error: "Choose a prescription file." }, { status: 400 });
  let submittedItems: unknown = [];
  try { submittedItems = JSON.parse(String(form.get("items") || "[]")); }
  catch { return json({ error: "The linked prescription medicines are invalid." }, { status: 400 }); }
  const uploadItems = z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).max(50).safeParse(submittedItems);
  if (!uploadItems.success || new Set(uploadItems.data.map((item) => item.productId)).size !== uploadItems.data.length) return json({ error: "The linked prescription medicines are invalid." }, { status: 400 });
  const validated = await validatePrescriptionUpload(file);
  if (!validated.ok) return json({ error: validated.error }, { status: validated.status });
  const { extension, bytes } = validated;
  const db = getDb();
  const linkedProducts = uploadItems.data.length ? await db.select({ id: products.id, name: products.name, prescriptionRequired: products.prescriptionRequired, isActive: products.isActive }).from(products).where(inArray(products.id, uploadItems.data.map((item) => item.productId))) : [];
  if (linkedProducts.length !== uploadItems.data.length || linkedProducts.some((product) => !product.isActive || !product.prescriptionRequired)) return json({ error: "Only active prescription medicines can be linked from the cart." }, { status: 409 });
  const directory = path.join(storageRoot(), "prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  const storedPath = path.join(directory, storedName);
  await writeFile(storedPath, bytes, { flag: "wx" });
  try {
    const [sender] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, auth.session.userId)).limit(1);
    const senderName = `${sender?.firstName || auth.session.firstName} ${sender?.lastName || ""}`.trim().slice(0, 200);
    const displayName = `Prescription - ${senderName} - ${new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}${extension}`;
    const created = await db.transaction(async (tx) => {
      const [requestRow] = await tx.insert(prescriptions).values({ customerId: auth.session.userId, senderName, storageKey: storedName, originalFilename: displayName, mimeType: file.type, sizeBytes: bytes.length, status: "UNDER_REVIEW" });
      if (linkedProducts.length) await tx.insert(prescriptionRequestItems).values(linkedProducts.map((product) => ({ prescriptionId: requestRow.insertId, productId: product.id, productName: product.name, requestedQuantity: uploadItems.data.find((item) => item.productId === product.id)!.quantity, availability: "PENDING" as const, source: "CUSTOMER_CART" as const })));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "PRESCRIPTION_REQUEST_CREATED", entityType: "prescription", entityId: String(requestRow.insertId), metadata: { linkedProductIds: linkedProducts.map((product) => product.id) } });
      return requestRow;
    });
    void sendEmail({ to: auth.session.email, subject: "Prescription under pharmacist review", message: `Hello ${auth.session.firstName},\n\nWe received your prescription and placed it under pharmacist review.${linkedProducts.length ? ` ${linkedProducts.length} prescription ${linkedProducts.length === 1 ? "medicine was" : "medicines were"} linked from your cart; prices will be confirmed by the pharmacist.` : " The pharmacist will identify the medicines, availability, quantities and prices."}`, action: { label: "Track prescription", url: `${storefrontOrigin()}/account/prescriptions/${created.insertId}` }, channel: "orders" });
    if (process.env.NOTIFICATION_EMAIL) void sendEmail({ to: process.env.NOTIFICATION_EMAIL, subject: "New prescription under review", message: `A new prescription request is ready for pharmacist review. Reference: ${created.insertId}.`, channel: "orders" });
    return json({ ok: true, id: created.insertId, linkedProductIds: linkedProducts.map((product) => product.id) }, { status: 201 });
  } catch (error) {
    await unlink(storedPath).catch(() => undefined);
    console.error("Prescription request creation failed", error);
    return json({ error: "The prescription could not be saved. Please try again." }, { status: 500 });
  }
}

export async function handlePrescriptionCheckout(request: Request, prescriptionId: number) {
  const auth = await requireSession(request, ["CUSTOMER"], true);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    checkoutToken: z.string().uuid(), fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]), paymentMethod: z.enum(["MPESA_EXPRESS", "MANUAL_MPESA"]),
    phone: z.string().trim().min(9).max(30), billingPhone: z.string().trim().min(9).max(30).optional(), manualPaymentMessage: z.string().trim().max(2500).optional(),
    deliveryAddress: z.string().trim().max(1000).optional(), deliveryArea: z.string().trim().max(160).optional(), deliveryLatitude: z.number().min(-90).max(90).optional(), deliveryLongitude: z.number().min(-180).max(180).optional(),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the checkout details." }, { status: 400 });
  if (parsed.data.fulfilmentMethod === "DELIVERY" && !parsed.data.deliveryAddress) return json({ error: "Delivery address is required." }, { status: 400 });
  const db = getDb();
  const [settings] = await db.select({ onlineMpesaEnabled: siteSettings.onlineMpesaEnabled, onlineManualEnabled: siteSettings.onlineManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber }).from(siteSettings).limit(1);
  if (parsed.data.paymentMethod === "MPESA_EXPRESS" && (!settings?.onlineMpesaEnabled || !mpesaConfiguration())) return json({ error: "M-Pesa Express is currently unavailable. Choose manual M-Pesa payment." }, { status: 409 });
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (!settings?.onlineManualEnabled || !settings.mpesaTillNumber)) return json({ error: "Manual M-Pesa payment is currently unavailable." }, { status: 409 });
  if (parsed.data.paymentMethod === "MANUAL_MPESA" && (parsed.data.manualPaymentMessage || "").length < 10) return json({ error: "Paste the complete M-Pesa payment message." }, { status: 400 });
  const manualReceipt = parsed.data.paymentMethod === "MANUAL_MPESA" ? extractMpesaReceipt(parsed.data.manualPaymentMessage || "") : null;
  // Delivery is priced before the transaction opens: the quote may call Google for a
  // routed distance, and a network round trip must never be held inside a row lock.
  let deliveryQuote: Awaited<ReturnType<typeof resolveDeliveryQuote>> | null = null;
  if (parsed.data.fulfilmentMethod === "DELIVERY") {
    if (parsed.data.deliveryLatitude === undefined || parsed.data.deliveryLongitude === undefined) {
      return json({ error: "Pin your delivery location on the map so the delivery fee can be calculated.", code: "DELIVERY_LOCATION_REQUIRED" }, { status: 400 });
    }
    const [proposal] = await db.select({ id: orders.id, subtotal: orders.subtotal }).from(orders).innerJoin(prescriptions, eq(prescriptions.orderId, orders.id)).where(and(eq(prescriptions.id, prescriptionId), eq(prescriptions.customerId, auth.session.userId))).limit(1);
    if (!proposal) return json({ error: "This prescription is not ready for checkout." }, { status: 409 });
    const proposalLines = await db.select({ productId: orderItems.productId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, proposal.id));
    deliveryQuote = await resolveDeliveryQuote({
      point: { latitude: parsed.data.deliveryLatitude, longitude: parsed.data.deliveryLongitude },
      lines: proposalLines.flatMap((line) => (line.productId ? [{ productId: line.productId, quantity: line.quantity }] : [])),
      subtotal: Number(proposal.subtotal),
    });
    if (!deliveryQuote.quote.available) return json({ error: deliveryQuote.quote.message, code: "DELIVERY_UNAVAILABLE" }, { status: 409 });
  }
  try {
    const outcome = await db.transaction(async (tx) => {
      const [requestRow] = await tx.select().from(prescriptions).where(and(eq(prescriptions.id, prescriptionId), eq(prescriptions.customerId, auth.session.userId))).limit(1).for("update");
      if (!requestRow || requestRow.status !== "APPROVED" || !requestRow.orderId) throw new PrescriptionWorkflowError("This prescription is not ready for checkout.");
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, requestRow.orderId), eq(orders.customerId, auth.session.userId))).limit(1).for("update");
      if (!order) throw new PrescriptionWorkflowError("The proposed order could not be found.", 404);
      if (order.paymentStatus === "PAID") return { duplicate: true, order, paymentId: null };
      if (order.status !== "AWAITING_PAYMENT") throw new PrescriptionWorkflowError("This prescription order is no longer awaiting payment.");
      const proposalLines=await tx.select({productId:orderItems.productId,productName:orderItems.productName,quantity:orderItems.quantity}).from(orderItems).where(eq(orderItems.orderId,order.id));
      if(!proposalLines.length)throw new PrescriptionWorkflowError("The proposed order has no medicines. Ask the pharmacy to review it again.");
      const productIds=proposalLines.flatMap((line)=>line.productId?[line.productId]:[]);
      const stockRows=productIds.length?await tx.select({productId:branchInventory.productId,available:sql<number>`sum(greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0))`}).from(branchInventory).where(inArray(branchInventory.productId,productIds)).groupBy(branchInventory.productId):[];
      const stock=new Map(stockRows.map((row)=>[row.productId,Number(row.available)]));
      const changed=proposalLines.filter((line)=>!line.productId||(stock.get(line.productId)||0)<line.quantity);
      if(changed.length){
        const note=`Availability changed for ${changed.map((line)=>line.productName).join(", ")}. A pharmacist is rechecking the proposal before payment.`;
        await tx.update(prescriptions).set({status:"MORE_INFORMATION_REQUIRED",pharmacistNotes:note,reviewVersion:requestRow.reviewVersion+1}).where(eq(prescriptions.id,prescriptionId));
        await tx.insert(activityLogs).values({actorId:auth.session.userId,action:"PRESCRIPTION_CHECKOUT_STOCK_REVIEW",entityType:"prescription",entityId:String(prescriptionId),metadata:{orderId:order.id,products:changed.map((line)=>line.productName)}});
        return{availabilityChanged:true as const,note,order};
      }
      const deliveryFee = deliveryQuote?.quote.fee ?? 0;
      const total = Number(order.subtotal) + deliveryFee;
      if (parsed.data.paymentMethod === "MPESA_EXPRESS" && !Number.isInteger(total)) throw new PrescriptionWorkflowError("M-Pesa Express requires a whole-shilling total. Choose manual M-Pesa.");
      if (order.checkoutToken === parsed.data.checkoutToken) {
        const [payment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
        return { duplicate: true, order: { ...order, total: total.toFixed(2) }, paymentId: payment?.id || null };
      }
      const attempts = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt));
      if (attempts.some((payment) => ["INITIATED", "PENDING", "REQUIRES_REVIEW"].includes(payment.status))) throw new PrescriptionWorkflowError("A payment for this prescription is already awaiting confirmation.");
      await tx.update(orders).set({ checkoutToken: parsed.data.checkoutToken, phone: parsed.data.phone, fulfilmentMethod: parsed.data.fulfilmentMethod, deliveryAddress: parsed.data.deliveryAddress || null, deliveryArea: parsed.data.deliveryArea || null, deliveryLatitude: parsed.data.deliveryLatitude?.toString() || null, deliveryLongitude: parsed.data.deliveryLongitude?.toString() || null, paymentMethod: parsed.data.paymentMethod, paymentStatus: "PENDING", paymentReference: manualReceipt, deliveryFee: deliveryFee.toFixed(2), total: total.toFixed(2), suggestedBranchId: deliveryQuote?.branch?.id ?? order.suggestedBranchId, deliveryDistanceKm: deliveryQuote ? deliveryQuote.quote.distanceKm.toFixed(2) : null, deliveryDurationMinutes: deliveryQuote?.durationMinutes ?? null, deliveryBandId: deliveryQuote?.quote.band?.id ?? null, deliveryCourier: deliveryQuote?.quote.courier ?? null }).where(eq(orders.id, order.id));
      const [payment] = await tx.insert(paymentTransactions).values({ orderId: order.id, method: parsed.data.paymentMethod, channel: "ONLINE", status: parsed.data.paymentMethod === "MANUAL_MPESA" ? "REQUIRES_REVIEW" : "INITIATED", amount: total.toFixed(2), phone: parsed.data.billingPhone || parsed.data.phone, receiptNumber: manualReceipt, manualMessage: parsed.data.manualPaymentMessage || null });
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "PRESCRIPTION_CHECKOUT_STARTED", entityType: "order", entityId: String(order.id), metadata: { prescriptionId, paymentMethod: parsed.data.paymentMethod, total } });
      return { duplicate: false, order: { ...order, checkoutToken: parsed.data.checkoutToken, total: total.toFixed(2) }, paymentId: payment.insertId };
    });
    if("availabilityChanged" in outcome){
      void sendEmail({to:auth.session.email,subject:"Your prescription proposal needs a new availability check",message:`Hello ${auth.session.firstName},\n\n${outcome.note}\n\nYou have not been charged. Your normal shopping cart is unaffected.`,action:{label:"View prescription update",url:`${storefrontOrigin()}/account/prescriptions/${prescriptionId}`},channel:"orders"});
      return json({error:outcome.note},{status:409});
    }
    if (outcome.duplicate) return json({ ok: true, id: outcome.order.id, orderNumber: outcome.order.orderNumber, total: Number(outcome.order.total), paymentStatus: outcome.order.paymentStatus, duplicate: true });
    let paymentStatus: "PENDING" | "FAILED" = "PENDING";
    let paymentMessage = parsed.data.paymentMethod === "MANUAL_MPESA" ? "Payment proof submitted for administrator approval." : "Check your phone and enter your M-Pesa PIN.";
    if (parsed.data.paymentMethod === "MPESA_EXPRESS") {
      try {
        const stk = await initiateStkPush({ orderNumber: outcome.order.orderNumber, phone: parsed.data.billingPhone || parsed.data.phone, amount: Number(outcome.order.total) });
        await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, outcome.paymentId!));
        await replayStoredStkCallback(stk.checkoutRequestId);
        paymentMessage = stk.customerMessage;
      } catch (error) {
        paymentStatus = "FAILED";
        paymentMessage = error instanceof Error ? error.message : "M-Pesa Express could not start.";
        await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: paymentMessage }).where(eq(paymentTransactions.id, outcome.paymentId!));
        await db.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, outcome.order.id));
      }
    } else if (manualReceipt && outcome.paymentId) {
      void requestKnownTransactionStatus(outcome.paymentId).catch((error) => console.warn("Transaction Status request could not be started", { transactionId: outcome.paymentId, error }));
    }
    return json({ ok: true, id: outcome.order.id, orderNumber: outcome.order.orderNumber, total: Number(outcome.order.total), paymentStatus, paymentMethod: parsed.data.paymentMethod, paymentMessage }, { status: 202 });
  } catch (error) {
    if (error instanceof PrescriptionWorkflowError) return json({ error: error.message }, { status: error.status });
    console.error("Prescription checkout failed", { prescriptionId, error });
    return json({ error: "Prescription checkout could not be started." }, { status: 500 });
  }
}

export async function handleInventory(request: Request, id: number) {
  const auth = await requireTeamPermission(request, "INVENTORY_UPDATE");
  if ("response" in auth) return auth.response;
  if (request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({ quantityAvailable: z.number().int().nonnegative(), quantityReserved: z.number().int().nonnegative(), reorderLevel: z.number().int().nonnegative() }).safeParse(await body(request));
  if (!Number.isInteger(id) || !parsed.success) return json({ error: "Enter valid non-negative stock quantities." }, { status: 400 });
  const [record] = await getDb().select({ id: branchInventory.id, branchId: branchInventory.branchId, productId: branchInventory.productId, quantityAvailable: branchInventory.quantityAvailable, quantityReserved: branchInventory.quantityReserved, reorderLevel: branchInventory.reorderLevel }).from(branchInventory).where(eq(branchInventory.id, id)).limit(1);
  if (!record) return json({ error: "Inventory record not found." }, { status: 404 });
  if (auth.session.role === "STAFF" && (!auth.session.homeBranchId || record.branchId !== auth.session.homeBranchId)) return json({ error: "You can update inventory only for your assigned shop." }, { status: 403 });
  await getDb().transaction(async (tx)=>{
    await tx.update(branchInventory).set({ ...parsed.data, updatedBy: auth.session.userId }).where(eq(branchInventory.id, id));
    await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "INVENTORY_UPDATED", entityType: "branch_inventory", entityId: String(id), metadata: { branchId: record.branchId, productId: record.productId, before: { quantityAvailable: record.quantityAvailable, quantityReserved: record.quantityReserved, reorderLevel: record.reorderLevel }, after: parsed.data, actorRole: auth.session.role } });
  });
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
    facebookUrl: z.string().trim().url().or(z.literal("")), instagramUrl: z.string().trim().url().or(z.literal("")), xUrl: z.string().trim().url().or(z.literal("")), tiktokUrl: z.string().trim().url().or(z.literal("")), licenceTitle:z.string().trim().max(190),licenceNumber:z.string().trim().max(120),licenceImageUrl:z.string().trim().max(500), requireTeamTwoFactor: z.boolean(),
    onlineMpesaEnabled:z.boolean(),onlineManualEnabled:z.boolean(),onlineCodEnabled:z.boolean(),posCashEnabled:z.boolean(),posMpesaEnabled:z.boolean(),posManualEnabled:z.boolean(),mpesaTillNumber:z.string().trim().max(30),mpesaAccountName:z.string().trim().max(150),
    // Disclosure only: shelf prices already include VAT, so this changes the receipt
    // and nothing a customer is charged. 0 keeps the line off the receipt.
    taxNumber:z.string().trim().max(60),vatEnabled:z.boolean(),vatRate:z.coerce.number().min(0).max(MAX_VAT_RATE),
  })
    // Partial so each section of the settings screen can save on its own. A section
    // sends only its own fields; anything absent is left exactly as it was, which is
    // what stops one section's save from blanking another's values.
    .partial()
    .safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  const data = parsed.data;
  // Only keys the caller actually sent are written. Spreading the parsed object would
  // reintroduce defaults for absent fields and quietly overwrite other sections.
  const sent = new Set(Object.keys(data));
  const values = { ...data, phone: data.phone || null, whatsapp: data.whatsapp || null, supportEmail: data.supportEmail || null, address: data.address || null, openingHours: data.openingHours || null, freeDeliveryThreshold: data.freeDeliveryThreshold?.toString() ?? null, taxNumber: data.taxNumber === undefined ? undefined : data.taxNumber.toUpperCase() || null, vatRate: data.vatRate === undefined ? undefined : parseVatRate(data.vatRate).toFixed(2), facebookUrl: data.facebookUrl || null, instagramUrl: data.instagramUrl || null, xUrl: data.xUrl || null, tiktokUrl: data.tiktokUrl || null, mpesaTillNumber:data.mpesaTillNumber||null,mpesaAccountName:data.mpesaAccountName||null, updatedBy: auth.session.userId };
  // updatedBy is derived here rather than sent, so it survives the prune; every other
  // key the caller did not send is dropped so one section cannot blank another's.
  for (const key of Object.keys(values)) if (key !== "updatedBy" && !sent.has(key)) delete (values as Record<string, unknown>)[key];
  if (!sent.size) return json({ error: "Nothing to save." }, { status: 400 });
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
    if (!canGrantTeamRole(auth.session.role, parsed.data.role)) return json({ error: "Only the pharmacy owner can create administrator accounts." }, { status: 403 });
    if (parsed.data.role === "STAFF") {
      if (!parsed.data.homeBranchId) return json({ error: "Assign this staff account to an active shop." }, { status: 400 });
      const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, parsed.data.homeBranchId), eq(branches.isActive, true))).limit(1);
      if (!branch) return json({ error: "The selected shop is inactive or unavailable." }, { status: 400 });
    }
    try {
      const { password, ...values } = parsed.data;
      const createdId = await db.transaction(async (tx) => {
        const [created] = await tx.insert(users).values({ ...values, homeBranchId: values.role === "STAFF" ? values.homeBranchId : null, phone: values.phone || null, passwordHash: await hash(password, 12), isActive: true, forcePasswordChange: true });
        if (values.role === "STAFF") await tx.insert(staffPermissions).values(DEFAULT_STAFF_PERMISSIONS.map((permission) => ({ userId: created.insertId, permission, grantedBy: auth.session.userId })));
        await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "STAFF_ACCOUNT_CREATED", entityType: "USER", entityId: String(created.insertId), metadata: { actorRole: auth.session.role, targetRole: values.role, homeBranchId: values.role === "STAFF" ? values.homeBranchId : null } });
        return created.insertId;
      });
      return json({ id: createdId }, { status: 201 });
    } catch {
      return json({ error: "That email address or phone is already registered." }, { status: 409 });
    }
  }
  if (request.method === "PATCH" && id) {
    const parsed = z.object({ firstName: z.string().trim().min(2).max(100).optional(), lastName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(30).optional(), role: z.enum(["STAFF", "ADMIN"]).optional(), homeBranchId: z.coerce.number().int().positive().nullable().optional(), isActive: z.boolean().optional(), password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).optional() }).safeParse(await body(request));
    if (!parsed.success) return json({ error: "Check the staff details." }, { status: 400 });
    const [target] = await db.select({ id: users.id, role: users.role, homeBranchId: users.homeBranchId, isActive: users.isActive }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!target) return json({ error: "Staff account not found." }, { status: 404 });
    if (!canManageTeamAccount(auth.session.role, target.role)) return json({ error: target.role === "SUPER_ADMIN" ? "The pharmacy owner account cannot be changed here." : "Only the pharmacy owner can manage administrator accounts." }, { status: 403 });
    if (parsed.data.role && !canGrantTeamRole(auth.session.role, parsed.data.role)) return json({ error: "Only the pharmacy owner can grant administrator access." }, { status: 403 });
    const { password, ...values } = parsed.data;
    if (id === auth.session.userId && values.isActive === false) return json({ error: "You cannot suspend your own account." }, { status: 400 });
    const resultingRole = values.role ?? target.role;
    const resultingBranchId = values.homeBranchId === undefined ? target.homeBranchId : values.homeBranchId;
    if (resultingRole === "STAFF") {
      if (!resultingBranchId) return json({ error: "Assign this staff account to an active shop." }, { status: 400 });
      const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, resultingBranchId), eq(branches.isActive, true))).limit(1);
      if (!branch) return json({ error: "The selected shop is inactive or unavailable." }, { status: 400 });
    }
    const sessionsMustBeRevoked = Boolean(password) || values.role !== undefined || values.homeBranchId !== undefined || values.isActive !== undefined;
    await db.transaction(async (tx) => {
      await tx.update(users).set({ ...values, homeBranchId: resultingRole === "STAFF" ? resultingBranchId : null, phone: values.phone === "" ? null : values.phone, ...(password ? { passwordHash: await hash(password, 12), forcePasswordChange: true } : {}) }).where(eq(users.id, id));
      if (target.role !== resultingRole) {
        await tx.delete(staffPermissions).where(eq(staffPermissions.userId, id));
        if (resultingRole === "STAFF") await tx.insert(staffPermissions).values(DEFAULT_STAFF_PERMISSIONS.map((permission) => ({ userId: id, permission, grantedBy: auth.session.userId })));
      }
      if (values.isActive === false) await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, id));
      if (sessionsMustBeRevoked) await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "STAFF_ACCOUNT_UPDATED", entityType: "USER", entityId: String(id), metadata: { actorRole: auth.session.role, before: { role: target.role, homeBranchId: target.homeBranchId, isActive: target.isActive }, after: { role: resultingRole, homeBranchId: resultingRole === "STAFF" ? resultingBranchId : null, isActive: values.isActive ?? target.isActive }, passwordReset: Boolean(password), sessionsRevoked: sessionsMustBeRevoked } });
    });
    return json({ ok: true });
  }
  if (request.method === "DELETE" && id) {
    if (id === auth.session.userId) return json({ error: "You cannot delete your own account." }, { status: 400 });
    const [target] = await db.select({ role: users.role }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!target) return json({ error: "Staff account not found." }, { status: 404 });
    if (!canManageTeamAccount(auth.session.role, target.role)) return json({ error: target.role === "SUPER_ADMIN" ? "The pharmacy owner account cannot be deleted here." : "Only the pharmacy owner can delete administrator accounts." }, { status: 403 });
    await db.transaction(async tx => {
      await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, id));
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)));
      await tx.update(users).set({ isActive: false, twoFactorEnabled: false, deletedAt: new Date(), passwordHash: await hash(randomUUID() + randomUUID(), 12) }).where(eq(users.id, id));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "STAFF_ACCOUNT_DELETED", entityType: "USER", entityId: String(id), metadata: { actorRole: auth.session.role, formerRole: target.role } });
    });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handleStaffPermissions(request: Request, id: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({ permissions: z.array(z.string()).max(STAFF_PERMISSION_VALUES.length) }).safeParse(await body(request));
  if (!parsed.success) return json({ error: "Choose valid staff permissions." }, { status: 400 });
  const requested = normalizeStaffPermissions(parsed.data.permissions);
  if (requested.length !== new Set(parsed.data.permissions).size) return json({ error: "One or more permissions are invalid or duplicated." }, { status: 400 });
  const db = getDb();
  const [target] = await db.select({ id: users.id, role: users.role, firstName: users.firstName, lastName: users.lastName }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
  if (!target) return json({ error: "Staff account not found." }, { status: 404 });
  if (target.role !== "STAFF") return json({ error: "Granular permissions apply to staff accounts. Administrators already have full access." }, { status: 409 });
  if (!canManageTeamAccount(auth.session.role, target.role)) return json({ error: "You cannot manage permissions for this account." }, { status: 403 });
  const before = normalizeStaffPermissions((await db.select({ permission: staffPermissions.permission }).from(staffPermissions).where(eq(staffPermissions.userId, id))).map((row) => row.permission));
  await db.transaction(async (tx) => {
    await tx.delete(staffPermissions).where(eq(staffPermissions.userId, id));
    if (requested.length) await tx.insert(staffPermissions).values(requested.map((permission) => ({ userId: id, permission, grantedBy: auth.session.userId })));
    await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)));
    await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "STAFF_PERMISSIONS_UPDATED", entityType: "USER", entityId: String(id), metadata: { actorRole: auth.session.role, staffName: `${target.firstName} ${target.lastName}`, before, after: requested, sessionsRevoked: true } });
  });
  return json({ ok: true, permissions: requested, message: "Permissions saved. The staff member must sign in again." });
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

/** A recipient whose name fields are safe to drop into HTML. */
function safeName<T extends { firstName?: string | null; lastName?: string | null; fullName?: string | null }>(customer: T) {
  const clean = (value: string | null | undefined) =>
    value === null || value === undefined ? value : String(value).replace(/[<>&"]/g, "");
  return { ...customer, firstName: clean(customer.firstName), lastName: clean(customer.lastName), fullName: clean(customer.fullName) };
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
    parsed.data.audience!=="ORDER_CUSTOMERS"?db.select({email:users.email,phone:users.phone,firstName:users.firstName,lastName:users.lastName,fullName:sql<string|null>`null`}).from(users).where(and(eq(users.role,"CUSTOMER"),eq(users.isActive,true),eq(users.marketingConsent,true),...(since?[gte(users.createdAt,since)]:[]))):Promise.resolve([]),
    parsed.data.audience!=="MARKETING_CUSTOMERS"?db.select({email:orders.email,phone:orders.phone,firstName:sql<string|null>`null`,lastName:sql<string|null>`null`,fullName:orders.customerName}).from(orders).where(since?gte(orders.createdAt,since):undefined):Promise.resolve([]),
  ]);
  const contacts=new Map<string,{email:string|null;phone:string|null;firstName:string|null;lastName:string|null;fullName:string|null}>();
  for(const contact of [...registered,...orderContacts]){const email=contact.email?.trim().toLowerCase()||null,phone=contact.phone?.trim()||null,key=email?`e:${email}`:phone?`p:${phone}`:"";if(key&&!contacts.has(key))contacts.set(key,{email,phone,firstName:contact.firstName??null,lastName:contact.lastName??null,fullName:contact.fullName??null})}
  const customers=[...contacts.values()];
  const wantsEmail = parsed.data.channel !== "SMS", wantsSms = parsed.data.channel !== "EMAIL";
  if(wantsEmail&&(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD))return json({error:"Configure the cPanel SMTP mailbox in api-service/.env first."},{status:400});
  // Credentials live in the API environment, not in settings: nobody in the admin has
  // to hold them, and marketing cannot be sent under the transactional sender ID.
  if (wantsSms && !smsConfiguration()) return json({ error: "Bulk SMS is not configured. Add the Celcom credentials and a promotional sender ID to the API environment." }, { status: 400 });
  const {audience:_audience,lookbackDays:_lookbackDays,...campaignData}=parsed.data;
  const [created] = await db.insert(campaigns).values({ ...campaignData, subject: parsed.data.subject || null, status: "SENDING", recipientCount: customers.length, createdBy: auth.session.userId });
  let successCount = 0, failureCount = 0;
  try {
    // Content blocks are fetched once and reused for every recipient; only the merge
    // fields differ per person, so nothing is queried per customer.
    const contentIndex = await loadCampaignContent(extractContentReferences(parsed.data.message), storefrontOrigin());
    const resolveContent = campaignContentResolver(contentIndex);
    const mergeContext = { pharmacyName: settings?.pharmacyName, pharmacyPhone: settings?.phone, storefrontUrl: storefrontOrigin().replace(/^https?:\/\//, "") };
    const personalised = isPersonalised(parsed.data.message);

    if (wantsEmail) {
      const withEmail = customers.filter((customer) => Boolean(customer.email));
      const subject = parsed.data.subject || parsed.data.name;
      if (personalised) {
        // Every body differs, so a single bulk send is impossible — each is composed
        // and sent for its own recipient.
        for (const customer of withEmail) {
          const body = renderContentBlocks(renderMergeFields(campaignBodyHtml(parsed.data.message), safeName(customer), mergeContext), "EMAIL", resolveContent);
          const outcome = await sendEmail({ to: customer.email as string, subject, message: stripHtml(body), html: campaignEmailHtml(body, mergeContext.pharmacyName || "Healthfield Pharmacy") });
          if (outcome.sent) successCount += 1; else failureCount += 1;
        }
      } else {
        const body = renderContentBlocks(renderMergeFields(campaignBodyHtml(parsed.data.message), {}, mergeContext), "EMAIL", resolveContent);
        const html = campaignEmailHtml(body, mergeContext.pharmacyName || "Healthfield Pharmacy");
        for (const customer of withEmail) {
          const outcome = await sendEmail({ to: customer.email as string, subject, message: stripHtml(body), html });
          if (outcome.sent) successCount += 1; else failureCount += 1;
        }
      }
    }
    if (wantsSms) {
      // marketingSms guarantees the opt-out, and MARKETING routes the send through the
      // promotional sender ID rather than the transactional one.
      const compose = (customer: MergeRecipient) =>
        marketingSms(renderContentBlocks(renderMergeFields(parsed.data.message, customer, mergeContext), "SMS", resolveContent));
      if (personalised) {
        // One request per recipient, because each body carries a different name. This
        // costs more API calls than a bulk send, which is the price of personalisation.
        for (const customer of customers.filter((entry) => Boolean(entry.phone))) {
          const outcome = await sendSms({ to: customer.phone as string, message: compose(customer), purpose: "MARKETING", campaignId: created.insertId });
          successCount += outcome.sent;
          failureCount += outcome.failed;
        }
      } else {
        const outcome = await sendSms({
          to: customers.map((customer) => customer.phone),
          message: compose({}),
          purpose: "MARKETING",
          campaignId: created.insertId,
        });
        successCount += outcome.sent;
        failureCount += outcome.failed;
        if (outcome.skipped) console.warn("Campaign SMS skipped", { campaign: parsed.data.name, reason: outcome.skipped });
      }
    }
    await db.update(campaigns).set({ status: failureCount ? "FAILED" : "SENT", successCount, failureCount, sentAt: new Date() }).where(eq(campaigns.id, created.insertId));
  } catch { failureCount = customers.length; await db.update(campaigns).set({ status: "FAILED", successCount, failureCount }).where(eq(campaigns.id, created.insertId)); }
  return json({ ok: failureCount === 0, id: created.insertId, recipientCount: customers.length, successCount, failureCount }, { status: failureCount ? 502 : 201 });
}

/**
 * Applies the patient's buy-now selection to an approved prescription.
 *
 * The prescription and its authorised quantities are never altered. This only
 * rewrites the unpaid proposal order, so a patient who cannot afford everything can
 * pay for part of it now and return for the rest later, while a course-bound line
 * stays all-or-nothing.
 */
export async function handlePrescriptionSelection(request: Request, prescriptionId: number) {
  const auth = await requireSession(request, ["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    selections: z.array(z.object({ id: z.number().int().positive(), quantity: z.number().int().min(0).max(99) })).max(50),
  }).safeParse(await body(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the medicines you selected." }, { status: 400 });

  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const [record] = await tx.select().from(prescriptions).where(and(eq(prescriptions.id, prescriptionId), eq(prescriptions.customerId, auth.session.userId))).limit(1).for("update");
      if (!record || record.status !== "APPROVED" || !record.orderId) throw new PrescriptionWorkflowError("This prescription is not ready for checkout.");
      const [order] = await tx.select().from(orders).where(eq(orders.id, record.orderId)).limit(1).for("update");
      if (!order) throw new PrescriptionWorkflowError("The proposed order could not be found.", 404);
      if (order.paymentStatus === "PAID") throw new PrescriptionWorkflowError("This order is already paid and cannot be changed.");
      if (order.status !== "AWAITING_PAYMENT") throw new PrescriptionWorkflowError("This order is no longer awaiting payment.");
      // Same guard the pharmacist repricing path uses: never move the total out from
      // under a payment that Safaricom may still confirm.
      const attempts = await tx.select({ status: paymentTransactions.status }).from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id));
      if (attempts.some((payment) => !["FAILED", "CANCELLED"].includes(payment.status)))
        throw new PrescriptionWorkflowError("A payment on this order is still being confirmed. Wait for it to finish before changing the medicines.");

      const items = await tx.select().from(prescriptionRequestItems).where(eq(prescriptionRequestItems.prescriptionId, prescriptionId)).orderBy(prescriptionRequestItems.id);
      const payable = items.filter((item) => item.availability !== "UNAVAILABLE" && item.approvedQuantity && item.unitPrice && item.productId);
      const resolved = resolveDispenseSelection(
        payable.map((item) => ({ id: item.id, approvedQuantity: Number(item.approvedQuantity), dispenseRule: item.dispenseRule as DispenseRule, minimumQuantity: item.minimumQuantity })),
        parsed.data.selections,
      );

      const chosen = resolved.filter((line) => !line.deferred);
      const lines = chosen.map((line) => {
        const item = payable.find((entry) => entry.id === line.id)!;
        return { item, quantity: line.quantity, lineTotal: Number(item.unitPrice) * line.quantity };
      });
      const productIds = lines.map((line) => line.item.productId!);
      const stockRows = productIds.length
        ? await tx.select({ productId: branchInventory.productId, available: sql<number>`sum(greatest(${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}, 0))` }).from(branchInventory).where(inArray(branchInventory.productId, productIds)).groupBy(branchInventory.productId)
        : [];
      const stock = new Map(stockRows.map((row) => [row.productId, Number(row.available)]));
      // Same snapshot rule as every other order line.
      const costRows = productIds.length
        ? await tx.select({ id: products.id, costPrice: products.costPrice }).from(products).where(inArray(products.id, productIds))
        : [];
      const checkoutCosts = new Map(costRows.flatMap((row) => (row.costPrice == null ? [] : [[row.id, row.costPrice] as const])));
      const short = lines.filter((line) => (stock.get(line.item.productId!) || 0) < line.quantity);
      if (short.length) throw new PrescriptionWorkflowError(`Only limited stock remains for ${short.map((line) => line.item.productName).join(", ")}. Reduce the quantity or ask the pharmacy to recheck.`);

      for (const line of resolved)
        await tx.update(prescriptionRequestItems).set({ selectedQuantity: line.quantity, deferred: line.deferred }).where(eq(prescriptionRequestItems.id, line.id));

      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const selectionVat = await onlineVatFor(subtotal);
      await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
      await tx.insert(orderItems).values(lines.map((line) => ({
        orderId: order.id,
        productId: line.item.productId,
        productName: line.item.productName,
        quantity: line.quantity,
        unitPrice: line.item.unitPrice!,
        lineTotal: line.lineTotal.toFixed(2),
        unitCost: checkoutCosts.get(line.item.productId!) ?? null,
      })));
      // The checkout token is cleared so a stale tab cannot pay the previous total.
      await tx.update(orders).set({ checkoutToken: null, subtotal: subtotal.toFixed(2), vat: selectionVat.amount.toFixed(2), vatRate: selectionVat.rate.toFixed(2), total: selectionVat.payable.toFixed(2) }).where(eq(orders.id, order.id));
      await tx.insert(activityLogs).values({
        actorId: auth.session.userId, action: "PRESCRIPTION_SELECTION_UPDATED", entityType: "prescription", entityId: String(prescriptionId),
        metadata: { orderId: order.id, buyingNow: chosen.length, deferred: resolved.length - chosen.length, subtotal },
      });
      return { subtotal, buyingNow: chosen.length, deferred: resolved.length - chosen.length };
    });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof DispensingError) return json({ error: error.message }, { status: error.status });
    if (error instanceof PrescriptionWorkflowError) return json({ error: error.message }, { status: error.status });
    console.error("Prescription selection failed", { prescriptionId, error });
    return json({ error: "The selection could not be saved. Please try again." }, { status: 500 });
  }
}
