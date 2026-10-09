import assert from "node:assert/strict";
import test from "node:test";
import { MemoryOutboxStorage, Outbox, type DeliveryOutcome, type OutboxJob, type OutboxSender } from "./outbox.ts";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

/** A sender whose answers the test scripts, and which records what it was asked to send. */
function scripted(...answers: DeliveryOutcome[]) {
  const sent: OutboxJob[] = [];
  const sender: OutboxSender = async (job) => {
    sent.push(job);
    return answers[Math.min(sent.length, answers.length) - 1] ?? { result: "delivered" };
  };
  return { sender, sent };
}

function setup(sender: OutboxSender, options: ConstructorParameters<typeof Outbox>[2] = {}) {
  const time = clock();
  const storage = new MemoryOutboxStorage();
  const outbox = new Outbox(storage, { email: sender, sms: sender }, { clock: time.now, ...options });
  return { time, storage, outbox };
}

test("a queued message is sent once and then gone", async () => {
  const { sender, sent } = scripted({ result: "delivered" });
  const { storage, outbox } = setup(sender);
  assert.equal(await outbox.enqueue("email", { to: "a@example.test" }), true);
  assert.deepEqual(await outbox.runOnce(), { delivered: 1, retried: 0, failed: 0, skipped: 0 });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, { to: "a@example.test" });
  assert.deepEqual(await storage.counts(), { queued: 0, failed: 0 });
  assert.equal((await outbox.runOnce()).delivered, 0, "nothing is sent twice");
});

test("a failure is retried after a growing delay, and delivered when it finally works", async () => {
  const { sender, sent } = scripted({ result: "retry", reason: "smtp down" }, { result: "retry", reason: "smtp down" }, { result: "delivered" });
  const { time, storage, outbox } = setup(sender, { retryDelaysMs: [30_000, 120_000] });
  await outbox.enqueue("email", {});
  await outbox.runOnce();
  assert.equal(sent.length, 1);
  assert.deepEqual(await storage.counts(), { queued: 1, failed: 0 });
  time.advance(29_000);
  await outbox.runOnce();
  assert.equal(sent.length, 1, "it must wait out the first delay");
  time.advance(2_000);
  await outbox.runOnce();
  assert.equal(sent.length, 2);
  time.advance(100_000);
  await outbox.runOnce();
  assert.equal(sent.length, 2, "the second delay is longer");
  time.advance(21_000);
  await outbox.runOnce();
  assert.equal(sent.length, 3);
  assert.deepEqual(await storage.counts(), { queued: 0, failed: 0 });
  assert.deepEqual(sent.map((job) => job.attempts), [0, 1, 2]);
});

test("a message that keeps failing is set aside, not retried forever and not silently dropped", async () => {
  const { sender, sent } = scripted({ result: "retry", reason: "mailbox full" });
  const logs: string[] = [];
  const { time, storage, outbox } = setup(sender, { retryDelaysMs: [1_000], maxAttempts: 3, log: (message) => logs.push(message) });
  await outbox.enqueue("sms", { to: "0700000000" });
  for (let i = 0; i < 6; i += 1) { await outbox.runOnce(); time.advance(2_000); }
  assert.equal(sent.length, 3, "exactly the allowed number of tries");
  assert.deepEqual(await storage.counts(), { queued: 0, failed: 1 });
  assert.equal(storage.failed[0].reason, "mailbox full");
  assert.equal(storage.failed[0].job.attempts, 3);
  assert.ok(logs.some((line) => line.includes("gave up")), "giving up must be logged");
});

test("something that can never succeed is let go at once rather than retried", async () => {
  const { sender, sent } = scripted({ result: "skipped", reason: "email is not configured" });
  const { time, storage, outbox } = setup(sender);
  await outbox.enqueue("email", {});
  assert.equal((await outbox.runOnce()).skipped, 1);
  time.advance(60 * 60_000);
  await outbox.runOnce();
  assert.equal(sent.length, 1);
  assert.deepEqual(await storage.counts(), { queued: 0, failed: 0 });
});

test("a sender that throws counts as a failure to retry, and never takes the worker down", async () => {
  let calls = 0;
  const { time, outbox, storage } = setup(async () => { calls += 1; if (calls === 1) throw new Error("socket hang up"); return { result: "delivered" }; });
  await outbox.enqueue("email", {});
  await outbox.runOnce();
  assert.deepEqual(await storage.counts(), { queued: 1, failed: 0 });
  time.advance(31_000);
  assert.equal((await outbox.runOnce()).delivered, 1);
});

test("a job taken by a worker that then died is handed to another once its lease lapses", async () => {
  const { sender, sent } = scripted({ result: "delivered" });
  const { time, storage, outbox } = setup(sender, { leaseMs: 60_000 });
  await outbox.enqueue("email", {});
  // A worker claims it and is never heard from again.
  const taken = await storage.claim(time.now(), 60_000, 10);
  assert.equal(taken.length, 1);
  await outbox.runOnce();
  assert.equal(sent.length, 0, "still leased, so nobody else may take it");
  time.advance(61_000);
  await outbox.runOnce();
  assert.equal(sent.length, 1, "after the lease the job is not lost");
});

test("two workers on one queue never send the same message", async () => {
  const sentBy: string[] = [];
  const time = clock();
  const storage = new MemoryOutboxStorage();
  const make = (name: string) => new Outbox(storage, { email: async (job) => { sentBy.push(`${name}:${job.id}`); await new Promise((r) => setTimeout(r, 5)); return { result: "delivered" }; } }, { clock: time.now, batchSize: 3 });
  const a = make("a"), b = make("b");
  for (let i = 0; i < 12; i += 1) await a.enqueue("email", { i });
  await Promise.all([a.runOnce(), b.runOnce()]);
  const ids = sentBy.map((entry) => entry.split(":")[1]);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12, "a message went out twice");
  assert.ok(sentBy.some((entry) => entry.startsWith("a:")) && sentBy.some((entry) => entry.startsWith("b:")), "the work should have been shared");
});

test("a message that has waited too long is not sent after all", async () => {
  const { sender, sent } = scripted({ result: "delivered" });
  const { time, storage, outbox } = setup(sender, { maxAgeMs: 60 * 60_000 });
  await outbox.enqueue("sms", {});
  time.advance(2 * 60 * 60_000);
  await outbox.runOnce();
  assert.equal(sent.length, 0);
  assert.deepEqual(await storage.counts(), { queued: 0, failed: 1 });
});

test("with no storage, queueing says no and the caller sends the message directly", async () => {
  const outbox = new Outbox(null, {});
  assert.equal(outbox.enabled, false);
  assert.equal(await outbox.enqueue("email", {}), false);
  assert.deepEqual(await outbox.runOnce(), { delivered: 0, retried: 0, failed: 0, skipped: 0 });
});

test("when the storage is down, queueing says no too, so a message is never lost to the queue itself", async () => {
  const storage = new MemoryOutboxStorage();
  storage.add = async () => { throw new Error("redis down"); };
  const outbox = new Outbox(storage, {});
  assert.equal(await outbox.enqueue("email", {}), false);
});

test("an unknown kind of message is let go rather than retried for ever", async () => {
  const time = clock();
  const storage = new MemoryOutboxStorage();
  const outbox = new Outbox(storage, {}, { clock: time.now });
  await outbox.enqueue("email", {});
  assert.equal((await outbox.runOnce()).skipped, 1);
});
