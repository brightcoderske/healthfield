import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { createElement } from "react";
import { z } from "zod";
import { IssuedPrescriptionPdf } from "../../app/prescriptions/issued/prescription-document";
import { activityLogs, consultationMessages, consultations, prescriptionRequestItems, prescriptions, products, siteSettings, users } from "../../db/schema";
import {
  canApplyConsultationAction, consultationAcceptsMessages, consultationActionRequiresNote, consultationActionResult,
  consultationActions, consultationStatusAfterCustomerReply, type ConsultationAction, type ConsultationStatus,
} from "../../lib/consultation-workflow";
import { healthfieldOrderNumber } from "../../lib/order-number";
import { requireSession } from "./auth";
import { getDb } from "./db";
import { sendEmail } from "./email";
import { json, safeFilename } from "./http";
import { storefrontOrigin } from "./mutations";
import { storageRoot, validatePrescriptionUpload } from "./prescription-files";
import { sessionHasPermission } from "./staff-permissions";

const team = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;

// A consultation costs nothing to open, unlike an upload which at least requires a
// real document. This cap is what stops one account from flooding the queue.
const OPEN_CONSULTATION_LIMIT = 3;

class ConsultationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

type Session = Extract<Awaited<ReturnType<typeof requireSession>>, { session: unknown }>["session"];

function teamMember(session: Session) {
  return team.includes(session.role as typeof team[number]);
}

// Every consultation route funnels through here. A patient may only ever reach their
// own thread, and a staff member needs the consultation permission explicitly --
// dispensing access to prescriptions does not carry over to consultation records.
async function authoriseConsultation(session: Session, consultationId: number, permission: "CONSULTATIONS_VIEW" | "CONSULTATIONS_PROCESS") {
  const db = getDb();
  const [record] = await db.select().from(consultations).where(eq(consultations.id, consultationId)).limit(1);
  if (!record) throw new ConsultationError("Consultation not found.", 404);
  if (teamMember(session)) {
    if (session.role === "STAFF" && !sessionHasPermission(session, permission))
      throw new ConsultationError("You do not have permission to open consultations.", 403);
    return { record, isTeam: true as const };
  }
  // Answer with the same "not found" a missing row would produce, so consultation
  // ids cannot be probed for existence from another account.
  if (record.customerId !== session.userId) throw new ConsultationError("Consultation not found.", 404);
  return { record, isTeam: false as const };
}

function errorResponse(error: unknown, context: string) {
  if (error instanceof ConsultationError) return json({ error: error.message }, { status: error.status });
  console.error(context, error);
  return json({ error: "The consultation could not be updated. Please try again." }, { status: 500 });
}

async function readBody(request: Request) {
  return await request.json().catch(() => ({}));
}

const createSchema = z.object({
  concern: z.string().trim().min(10, "Describe your symptoms in a little more detail.").max(4000),
  callbackRequested: z.boolean().optional().default(false),
  callbackPhone: z.string().trim().max(30).optional().default(""),
});

export async function handleConsultations(request: Request, consultationId?: number) {
  if (consultationId) return handleConsultationReview(request, consultationId);

  const auth = await requireSession(request, ["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });

  const parsed = createSchema.safeParse(await readBody(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the consultation details." }, { status: 400 });
  if (parsed.data.callbackRequested && !parsed.data.callbackPhone) return json({ error: "Add a phone number for the callback." }, { status: 400 });

  const db = getDb();
  try {
    const created = await db.transaction(async (tx) => {
      const [open] = await tx.select({ total: sql<number>`count(*)` }).from(consultations)
        .where(and(eq(consultations.customerId, auth.session.userId), ne(consultations.status, "CLOSED")));
      if (Number(open?.total || 0) >= OPEN_CONSULTATION_LIMIT)
        throw new ConsultationError(`You already have ${OPEN_CONSULTATION_LIMIT} consultations open. Please continue one of those before starting another.`, 429);

      const [customer] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, auth.session.userId)).limit(1);
      const [row] = await tx.insert(consultations).values({
        reference: `TMP-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
        customerId: auth.session.userId,
        concern: parsed.data.concern,
        callbackRequested: parsed.data.callbackRequested,
        callbackPhone: parsed.data.callbackRequested ? parsed.data.callbackPhone || customer?.phone || null : null,
        status: "NEW",
      });
      const reference = healthfieldOrderNumber("CON", row.insertId);
      await tx.update(consultations).set({ reference }).where(eq(consultations.id, row.insertId));
      await tx.insert(activityLogs).values({
        actorId: auth.session.userId, action: "CONSULTATION_CREATED", entityType: "consultation",
        entityId: String(row.insertId), metadata: { reference, callbackRequested: parsed.data.callbackRequested },
      });
      return { id: row.insertId, reference };
    });

    void sendEmail({
      to: auth.session.email,
      subject: "Your consultation request has been received",
      message: `Hello ${auth.session.firstName},\n\nWe received your consultation request (${created.reference}). A healthcare professional will review what you have described and reply through the platform.${parsed.data.callbackRequested ? " You asked for a callback, so expect a phone call as well." : ""}\n\nThis is a request for a consultation. It is not a prescription, and no medicine is issued until a professional has reviewed your case.`,
      action: { label: "Open consultation", url: `${storefrontOrigin()}/account/consultations/${created.id}` },
      channel: "orders",
    });
    if (process.env.NOTIFICATION_EMAIL) void sendEmail({
      to: process.env.NOTIFICATION_EMAIL,
      subject: parsed.data.callbackRequested ? "New consultation request (callback requested)" : "New consultation request",
      message: `A new consultation request is waiting for review. Reference: ${created.reference}.`,
      channel: "orders",
    });
    return json({ ok: true, id: created.id, reference: created.reference }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Consultation creation failed");
  }
}

const messageSchema = z.object({ message: z.string().trim().min(1, "Write a message before sending.").max(4000) });

export async function handleConsultationMessages(request: Request, consultationId: number) {
  const auth = await requireSession(request, [...team, "CUSTOMER"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });

  let storedPath: string | null = null;
  try {
    const { record, isTeam } = await authoriseConsultation(auth.session, consultationId, "CONSULTATIONS_PROCESS");
    if (!consultationAcceptsMessages(record.status as ConsultationStatus))
      throw new ConsultationError("This consultation is closed. Start a new request if you need further help.");

    const contentType = request.headers.get("content-type") || "";
    let text = "";
    let attachment: { storedName: string; displayName: string; mimeType: string; size: number } | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const parsed = messageSchema.safeParse({ message: String(form.get("message") || "") });
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Write a message before sending." }, { status: 400 });
      text = parsed.data.message;
      const file = form.get("attachment");
      if (file instanceof File && file.size > 0) {
        // Deliberately the same validator the prescription upload uses, so this
        // second upload surface cannot drift into weaker checks.
        const validated = await validatePrescriptionUpload(file);
        if (!validated.ok) return json({ error: validated.error }, { status: validated.status });
        const directory = path.join(storageRoot(), "consultations");
        await mkdir(directory, { recursive: true });
        const storedName = `${randomUUID()}${validated.extension}`;
        storedPath = path.join(directory, storedName);
        await writeFile(storedPath, validated.bytes, { flag: "wx" });
        attachment = { storedName, displayName: file.name.slice(0, 255) || `attachment${validated.extension}`, mimeType: file.type, size: validated.bytes.length };
      }
    } else {
      const parsed = messageSchema.safeParse(await readBody(request));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Write a message before sending." }, { status: 400 });
      text = parsed.data.message;
    }

    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(consultations).where(eq(consultations.id, consultationId)).limit(1).for("update");
      if (!current) throw new ConsultationError("Consultation not found.", 404);
      if (!consultationAcceptsMessages(current.status as ConsultationStatus)) throw new ConsultationError("This consultation is closed.");

      const [message] = await tx.insert(consultationMessages).values({
        consultationId,
        senderId: auth.session.userId,
        senderRole: isTeam ? "PROFESSIONAL" : "CUSTOMER",
        message: text,
        attachmentKey: attachment?.storedName || null,
        attachmentName: attachment?.displayName || null,
        attachmentMime: attachment?.mimeType || null,
        attachmentSize: attachment?.size || null,
        readByCustomer: !isTeam,
        readByProfessional: isTeam,
      });

      const nextStatus = isTeam ? current.status : consultationStatusAfterCustomerReply(current.status as ConsultationStatus);
      await tx.update(consultations).set({ lastMessageAt: new Date(), status: nextStatus }).where(eq(consultations.id, consultationId));
      return { messageId: message.insertId, status: nextStatus, customerId: current.customerId, reference: current.reference };
    });

    if (isTeam) {
      const [customer] = await getDb().select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, result.customerId)).limit(1);
      if (customer) void sendEmail({
        to: customer.email,
        subject: "A healthcare professional replied to your consultation",
        message: `Hello ${customer.firstName},\n\nThere is a new reply on your consultation ${result.reference}.`,
        action: { label: "Open consultation", url: `${storefrontOrigin()}/account/consultations/${consultationId}` },
        channel: "orders",
      });
    }
    return json({ ok: true, id: result.messageId, status: result.status }, { status: 201 });
  } catch (error) {
    if (storedPath) await unlink(storedPath).catch(() => undefined);
    return errorResponse(error, "Consultation message failed");
  }
}

export async function handleConsultationAttachment(request: Request, messageId: number) {
  const auth = await requireSession(request, [...team, "CUSTOMER"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "GET") return json({ error: "Method not allowed." }, { status: 405 });

  try {
    const db = getDb();
    const [message] = await db.select().from(consultationMessages).where(eq(consultationMessages.id, messageId)).limit(1);
    if (!message?.attachmentKey) throw new ConsultationError("Attachment not found.", 404);
    // Ownership is decided by the parent consultation, never by the message id.
    await authoriseConsultation(auth.session, message.consultationId, "CONSULTATIONS_VIEW");
    const buffer = await readFile(path.join(storageRoot(), "consultations", path.basename(message.attachmentKey))).catch(() => null);
    if (!buffer) throw new ConsultationError("Attachment file is missing.", 404);
    return new Response(buffer, {
      headers: {
        "Content-Type": message.attachmentMime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeFilename(message.attachmentName || "attachment")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, "Consultation attachment failed");
  }
}

const issuedLineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(99),
  directions: z.string().trim().max(300).optional().default(""),
});

const reviewSchema = z.object({
  action: z.enum(consultationActions),
  reviewVersion: z.number().int().nonnegative(),
  note: z.string().trim().max(4000).optional().default(""),
  prescriberName: z.string().trim().max(200).optional().default(""),
  prescriberRegistration: z.string().trim().max(60).optional().default(""),
  items: z.array(issuedLineSchema).max(30).optional(),
});

async function handleConsultationReview(request: Request, consultationId: number) {
  const auth = await requireSession(request, [...team]);
  if ("response" in auth) return auth.response;
  if (request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });

  const parsed = reviewSchema.safeParse(await readBody(request));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Check the consultation decision." }, { status: 400 });
  const action = parsed.data.action as ConsultationAction;

  try {
    const { record } = await authoriseConsultation(auth.session, consultationId, "CONSULTATIONS_PROCESS");
    if (record.reviewVersion !== parsed.data.reviewVersion)
      throw new ConsultationError("This consultation changed in another session. Reload it and try again.");
    if (consultationActionRequiresNote(action) && parsed.data.note.length < 5)
      throw new ConsultationError("Add a clear note for the patient before continuing.", 400);

    if (action === "ISSUE_PRESCRIPTION") return await issuePrescription(auth.session, consultationId, parsed.data);
    return await applySimpleAction(auth.session, consultationId, action, parsed.data.note);
  } catch (error) {
    return errorResponse(error, "Consultation review failed");
  }
}

async function applySimpleAction(session: Session, consultationId: number, action: ConsultationAction, note: string) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(consultations).where(eq(consultations.id, consultationId)).limit(1).for("update");
    if (!current) throw new ConsultationError("Consultation not found.", 404);
    if (!canApplyConsultationAction(current.status as ConsultationStatus, action))
      throw new ConsultationError(`This consultation cannot ${action.replaceAll("_", " ").toLowerCase()} from its current stage.`);

    const next = consultationActionResult(action);
    await tx.update(consultations).set({
      status: next.status,
      outcome: next.outcome ?? current.outcome,
      assignedTo: current.assignedTo ?? session.userId,
      professionalNotes: note || current.professionalNotes,
      reviewVersion: current.reviewVersion + 1,
    }).where(eq(consultations.id, consultationId));

    if (note) await tx.insert(consultationMessages).values({
      consultationId, senderId: session.userId, senderRole: "PROFESSIONAL", message: note,
      readByCustomer: false, readByProfessional: true,
    });
    await tx.insert(activityLogs).values({
      actorId: session.userId, action: `CONSULTATION_${action}`, entityType: "consultation",
      entityId: String(consultationId), metadata: { from: current.status, to: next.status, outcome: next.outcome },
    });

    const [customer] = await tx.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, current.customerId)).limit(1);
    return { ...next, reviewVersion: current.reviewVersion + 1, customer, reference: current.reference };
  });

  if (result.customer && note) void sendEmail({
    to: result.customer.email,
    subject: result.status === "CLOSED" ? "Your consultation has been completed" : "An update on your consultation",
    message: `Hello ${result.customer.firstName},\n\n${note}`,
    action: { label: "Open consultation", url: `${storefrontOrigin()}/account/consultations/${consultationId}` },
    channel: "orders",
  });
  return json({ ok: true, status: result.status, outcome: result.outcome, reviewVersion: result.reviewVersion });
}

// Issuing hands the consultation over to the existing prescription pipeline: a real
// prescription document is produced and filed exactly like an uploaded one, so the
// dispensing pharmacist reviews, prices and carts it through the unchanged flow.
async function issuePrescription(session: Session, consultationId: number, input: z.infer<typeof reviewSchema>) {
  if (!input.items?.length) throw new ConsultationError("Add at least one medicine before issuing a prescription.", 400);
  if (new Set(input.items.map((item) => item.productId)).size !== input.items.length)
    throw new ConsultationError("Each medicine can appear only once.", 400);
  if (!input.prescriberName || !input.prescriberRegistration)
    throw new ConsultationError("Confirm the prescriber name and registration number before issuing.", 400);

  const db = getDb();
  const [current] = await db.select().from(consultations).where(eq(consultations.id, consultationId)).limit(1);
  if (!current) throw new ConsultationError("Consultation not found.", 404);
  if (!canApplyConsultationAction(current.status as ConsultationStatus, "ISSUE_PRESCRIPTION"))
    throw new ConsultationError("This consultation cannot issue a prescription from its current stage.");

  const productIds = input.items.map((item) => item.productId);
  const [catalogue, customerRows, settingsRows] = await Promise.all([
    db.select({ id: products.id, name: products.name, isActive: products.isActive }).from(products).where(inArray(products.id, productIds)),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: users.role }).from(users).where(eq(users.id, current.customerId)).limit(1),
    db.select().from(siteSettings).limit(1),
  ]);
  if (catalogue.length !== productIds.length || catalogue.some((product) => !product.isActive))
    throw new ConsultationError("One or more selected medicines are no longer active.", 400);
  const customer = customerRows[0];
  if (!customer || customer.role !== "CUSTOMER") throw new ConsultationError("This consultation is not linked to an active customer account.");

  const patientName = `${customer.firstName} ${customer.lastName}`.trim();
  const issuedAt = new Date();
  const lines = input.items.map((item) => ({
    productId: item.productId,
    name: catalogue.find((product) => product.id === item.productId)!.name,
    quantity: item.quantity,
    directions: item.directions || null,
  }));

  const settings = settingsRows[0];
  const pdf = await renderToBuffer(createElement(IssuedPrescriptionPdf, {
    reference: current.reference,
    issuedAt,
    patientName,
    prescriberName: input.prescriberName,
    prescriberRegistration: input.prescriberRegistration,
    notes: input.note || null,
    items: lines.map((line) => ({ name: line.name, quantity: line.quantity, directions: line.directions })),
    business: {
      pharmacyName: settings?.pharmacyName || "Healthfield Pharmacy",
      phone: settings?.phone || null,
      address: settings?.address || null,
      licenceNumber: settings?.licenceNumber || null,
    },
  }) as Parameters<typeof renderToBuffer>[0]);
  const bytes = Buffer.from(pdf);

  const directory = path.join(storageRoot(), "prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}.pdf`;
  const storedPath = path.join(directory, storedName);
  await writeFile(storedPath, bytes, { flag: "wx" });

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(consultations).where(eq(consultations.id, consultationId)).limit(1).for("update");
      if (!locked) throw new ConsultationError("Consultation not found.", 404);
      if (locked.reviewVersion !== input.reviewVersion) throw new ConsultationError("This consultation changed in another session. Reload it and try again.");
      if (!canApplyConsultationAction(locked.status as ConsultationStatus, "ISSUE_PRESCRIPTION"))
        throw new ConsultationError("This consultation cannot issue a prescription from its current stage.");

      const displayName = `Prescription - ${patientName} - ${current.reference}.pdf`;
      const [prescriptionRow] = await tx.insert(prescriptions).values({
        customerId: current.customerId,
        senderName: patientName.slice(0, 200),
        storageKey: storedName,
        originalFilename: displayName,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        status: "UNDER_REVIEW",
        pharmacistNotes: `Issued from consultation ${current.reference} by ${input.prescriberName} (registration ${input.prescriberRegistration}).`,
      });
      await tx.insert(prescriptionRequestItems).values(lines.map((line) => ({
        prescriptionId: prescriptionRow.insertId,
        productId: line.productId,
        productName: line.name,
        requestedQuantity: line.quantity,
        availability: "PENDING" as const,
        source: "PHARMACIST" as const,
        pharmacistNote: line.directions,
      })));
      await tx.update(consultations).set({
        status: "CLOSED",
        outcome: "PRESCRIPTION_ISSUED",
        prescriptionId: prescriptionRow.insertId,
        assignedTo: locked.assignedTo ?? session.userId,
        prescriberName: input.prescriberName,
        prescriberRegistration: input.prescriberRegistration,
        professionalNotes: input.note || locked.professionalNotes,
        reviewVersion: locked.reviewVersion + 1,
      }).where(eq(consultations.id, consultationId));
      await tx.insert(activityLogs).values({
        actorId: session.userId, action: "CONSULTATION_PRESCRIPTION_ISSUED", entityType: "consultation",
        entityId: String(consultationId),
        metadata: { prescriptionId: prescriptionRow.insertId, prescriberRegistration: input.prescriberRegistration, itemCount: lines.length },
      });
      return { prescriptionId: prescriptionRow.insertId, reviewVersion: locked.reviewVersion + 1 };
    });

    void sendEmail({
      to: customer.email,
      subject: "Your prescription has been issued",
      message: `Hello ${customer.firstName},\n\nFollowing your consultation ${current.reference}, a prescription has been issued by ${input.prescriberName}. Our pharmacist is now confirming availability and prices, and you will be able to review and pay once that is done.`,
      action: { label: "Track prescription", url: `${storefrontOrigin()}/account/prescriptions/${result.prescriptionId}` },
      channel: "orders",
    });
    return json({ ok: true, status: "CLOSED", outcome: "PRESCRIPTION_ISSUED", prescriptionId: result.prescriptionId, reviewVersion: result.reviewVersion });
  } catch (error) {
    await unlink(storedPath).catch(() => undefined);
    throw error;
  }
}

// Reader used by the account and admin views. It returns a Response so the one
// ownership rule above stays the only place that decides who may read a thread.
export async function handleConsultationThread(request: Request, consultationId: number) {
  const auth = await requireSession(request, [...team, "CUSTOMER"]);
  if ("response" in auth) return auth.response;
  try {
    const { record, isTeam } = await authoriseConsultation(auth.session, consultationId, "CONSULTATIONS_VIEW");
    const db = getDb();
    const messages = await db.select({
      id: consultationMessages.id,
      senderRole: consultationMessages.senderRole,
      message: consultationMessages.message,
      attachmentName: consultationMessages.attachmentName,
      attachmentMime: consultationMessages.attachmentMime,
      hasAttachment: sql<number>`case when ${consultationMessages.attachmentKey} is null then 0 else 1 end`,
      createdAt: consultationMessages.createdAt,
    }).from(consultationMessages).where(eq(consultationMessages.consultationId, consultationId)).orderBy(asc(consultationMessages.createdAt));

    // Opening a thread clears the unread marks for whichever side is reading it.
    await db.update(consultationMessages)
      .set(isTeam ? { readByProfessional: true } : { readByCustomer: true })
      .where(and(
        eq(consultationMessages.consultationId, consultationId),
        eq(consultationMessages.senderRole, isTeam ? "CUSTOMER" : "PROFESSIONAL"),
      ));

    return json({
      consultation: record,
      messages: messages.map((message) => ({ ...message, hasAttachment: Number(message.hasAttachment) === 1 })),
    });
  } catch (error) {
    return errorResponse(error, "Consultation thread failed");
  }
}
