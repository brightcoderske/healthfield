/**
 * The outbox: emails and SMS the API has promised to send, kept somewhere that survives a
 * restart and retried until they go.
 *
 * Until now a message was sent from inside the request that caused it, fire and forget. If
 * the mail server hiccupped, or the API was restarted a moment later (a deploy, a crash,
 * LiteSpeed recycling a worker), the message was simply lost and nobody knew. Here the
 * message is written down first, a worker sends it, and a failure is retried with a growing
 * delay. One that still will not go after several tries is set aside for a person to look
 * at, rather than retried forever or silently dropped.
 *
 * Delivery is at least once. A worker that dies after sending but before noting it will have
 * its job handed to another once the lease lapses, so a message can very occasionally go
 * twice. That is the right side to err on for an order confirmation.
 *
 * This file is the logic only, with storage behind an interface so it can be tested without
 * Redis. The Redis storage is in ./redis; what actually sends is in ./outbox-delivery.
 *
 * Written without enums or constructor parameter properties: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export type OutboxKind = "email" | "sms";

export type OutboxJob = {
  id: string;
  kind: OutboxKind;
  /** What to send; the shape is the sender's own, and must survive being turned into JSON. */
  payload: unknown;
  /** How many times delivery has been tried and failed. */
  attempts: number;
  /** When it was first queued, so a message that has gone stale can be let go. */
  createdAt: number;
};

/** What a sender says about one try. */
export type DeliveryOutcome =
  | { result: "delivered" }
  /** Nothing to do and nothing to retry: not configured, switched off, no valid recipient. */
  | { result: "skipped"; reason: string }
  /** Might work next time: the provider was unreachable, or refused for now. */
  | { result: "retry"; reason: string };

export interface OutboxStorage {
  /** Stores a job and schedules its first try. */
  add(job: OutboxJob, runAt: number): Promise<void>;
  /**
   * Hands out up to `limit` jobs that are due, atomically, so two workers never get the
   * same one. Each is leased: if it is not finished or rescheduled before `now + leaseMs`
   * it becomes due again, which is what rescues a job from a worker that died.
   */
  claim(now: number, leaseMs: number, limit: number): Promise<OutboxJob[]>;
  /** Removes a finished job. */
  complete(job: OutboxJob): Promise<void>;
  /** Puts a job back with its updated attempt count, to be tried again at `runAt`. */
  reschedule(job: OutboxJob, runAt: number): Promise<void>;
  /** Sets a job aside for a person to look at. */
  fail(job: OutboxJob, reason: string, at: number): Promise<void>;
  counts(): Promise<{ queued: number; failed: number }>;
}

export type OutboxOptions = {
  /** Delay before each retry, in milliseconds; the last entry is reused if there are more tries. */
  retryDelaysMs?: number[];
  /** Tries before a job is set aside. */
  maxAttempts?: number;
  /** A message older than this is not worth sending any more. */
  maxAgeMs?: number;
  /** How long a worker may hold a job before another may take it. */
  leaseMs?: number;
  batchSize?: number;
  clock?: () => number;
  log?: (message: string, detail?: Record<string, unknown>) => void;
};

export class MemoryOutboxStorage implements OutboxStorage {
  jobs: Map<string, { job: OutboxJob; runAt: number }>;
  failed: Array<{ job: OutboxJob; reason: string; at: number }>;

  constructor() {
    this.jobs = new Map();
    this.failed = [];
  }

  async add(job: OutboxJob, runAt: number) {
    this.jobs.set(job.id, { job: { ...job }, runAt });
  }

  async claim(now: number, leaseMs: number, limit: number) {
    const due = [...this.jobs.values()].filter((entry) => entry.runAt <= now).sort((a, b) => a.runAt - b.runAt).slice(0, limit);
    for (const entry of due) entry.runAt = now + leaseMs;
    return due.map((entry) => ({ ...entry.job }));
  }

  async complete(job: OutboxJob) {
    this.jobs.delete(job.id);
  }

  async reschedule(job: OutboxJob, runAt: number) {
    this.jobs.set(job.id, { job: { ...job }, runAt });
  }

  async fail(job: OutboxJob, reason: string, at: number) {
    this.jobs.delete(job.id);
    this.failed.push({ job: { ...job }, reason, at });
  }

  async counts() {
    return { queued: this.jobs.size, failed: this.failed.length };
  }
}

export type OutboxSender = (job: OutboxJob) => Promise<DeliveryOutcome>;

const DEFAULT_RETRY_DELAYS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

export class Outbox {
  storage: OutboxStorage | null;
  senders: Partial<Record<OutboxKind, OutboxSender>>;
  retryDelaysMs: number[];
  maxAttempts: number;
  maxAgeMs: number;
  leaseMs: number;
  batchSize: number;
  clock: () => number;
  log: (message: string, detail?: Record<string, unknown>) => void;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  nextId: number;

  constructor(storage: OutboxStorage | null, senders: Partial<Record<OutboxKind, OutboxSender>>, options: OutboxOptions = {}) {
    this.storage = storage;
    this.senders = senders;
    this.retryDelaysMs = options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS;
    // One try plus a retry after each delay, unless told otherwise.
    this.maxAttempts = options.maxAttempts ?? this.retryDelaysMs.length + 1;
    this.maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60_000;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.batchSize = options.batchSize ?? 10;
    this.clock = options.clock ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.running = false;
    this.timer = null;
    this.nextId = 0;
  }

  get enabled() {
    return this.storage !== null;
  }

  /**
   * Writes a message down to be sent. Returns false when it could not be (no storage, or the
   * storage is down), in which case the caller sends it the way it always did — the outbox
   * only ever adds safety, it never becomes the reason a message is not sent.
   */
  async enqueue(kind: OutboxKind, payload: unknown): Promise<boolean> {
    const storage = this.storage;
    if (!storage) return false;
    this.nextId += 1;
    const now = this.clock();
    const job: OutboxJob = { id: `${now.toString(36)}-${this.nextId}-${Math.random().toString(36).slice(2, 8)}`, kind, payload, attempts: 0, createdAt: now };
    try {
      await storage.add(job, now);
    } catch (error) {
      this.log("could not queue a message; sending it directly", { kind, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
    return true;
  }

  /** Delay before the retry that follows `attempts` failed tries. */
  retryDelay(attempts: number) {
    return this.retryDelaysMs[Math.min(Math.max(attempts, 1), this.retryDelaysMs.length) - 1];
  }

  /** Works through whatever is due. Safe to call at any time, from any number of workers. */
  async runOnce(): Promise<{ delivered: number; retried: number; failed: number; skipped: number }> {
    const tally = { delivered: 0, retried: 0, failed: 0, skipped: 0 };
    const storage = this.storage;
    if (!storage || this.running) return tally;
    this.running = true;
    try {
      for (;;) {
        const jobs = await storage.claim(this.clock(), this.leaseMs, this.batchSize);
        if (!jobs.length) break;
        for (const job of jobs) await this.handle(storage, job, tally);
        if (jobs.length < this.batchSize) break;
      }
    } catch (error) {
      this.log("outbox run failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running = false;
    }
    return tally;
  }

  async handle(storage: OutboxStorage, job: OutboxJob, tally: { delivered: number; retried: number; failed: number; skipped: number }) {
    const now = this.clock();
    if (now - job.createdAt > this.maxAgeMs) {
      await storage.fail(job, "too old to be worth sending", now);
      tally.failed += 1;
      this.log("gave up on a message that waited too long", { kind: job.kind, attempts: job.attempts });
      return;
    }
    const send = this.senders[job.kind];
    let outcome: DeliveryOutcome;
    try {
      outcome = send ? await send(job) : { result: "skipped", reason: `no sender for ${job.kind}` };
    } catch (error) {
      // A sender that throws has told us nothing except that it did not work this time.
      outcome = { result: "retry", reason: error instanceof Error ? error.message : String(error) };
    }
    if (outcome.result === "delivered") {
      await storage.complete(job);
      tally.delivered += 1;
    } else if (outcome.result === "skipped") {
      await storage.complete(job);
      tally.skipped += 1;
    } else {
      const attempts = job.attempts + 1;
      if (attempts >= this.maxAttempts) {
        await storage.fail({ ...job, attempts }, outcome.reason, now);
        tally.failed += 1;
        this.log("gave up on a message after repeated failures", { kind: job.kind, attempts, reason: outcome.reason });
      } else {
        await storage.reschedule({ ...job, attempts }, now + this.retryDelay(attempts));
        tally.retried += 1;
      }
    }
  }

  /** Asks for a pass soon, without making the caller wait for it. */
  kick() {
    if (this.storage && !this.running) setTimeout(() => void this.runOnce(), 0);
  }

  /** Starts working through the queue every few seconds. */
  start(intervalMs = 3_000) {
    if (!this.storage || this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    this.timer.unref?.();
    this.kick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
