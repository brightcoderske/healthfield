import assert from "node:assert/strict";
import test from "node:test";
import {
  DispensingError,
  dispenseSelectionSummary,
  lowestAllowedQuantity,
  resolveDispenseSelection,
  selectionIsAllowed,
} from "./prescription-dispensing.ts";

const antibiotic = { id: 1, approvedQuantity: 21, dispenseRule: "COURSE_BOUND" as const, minimumQuantity: null };
const repeat = { id: 2, approvedQuantity: 90, dispenseRule: "DIVISIBLE" as const, minimumQuantity: 30 };

test("an antibiotic course cannot be part paid",()=>{
  // The whole point: half a course fails the patient and breeds resistance.
  assert.equal(selectionIsAllowed(antibiotic, 10), false);
  assert.equal(selectionIsAllowed(antibiotic, 20), false);
  assert.equal(selectionIsAllowed(antibiotic, 21), true);
  assert.equal(lowestAllowedQuantity(antibiotic), 21);
});

test("a course-bound line may still be deferred in full",()=>{
  // Affordability is answered by buying it later, never by buying part of it.
  assert.equal(selectionIsAllowed(antibiotic, 0), true);
});

test("a repeat medicine may be reduced to the pharmacist's floor",()=>{
  assert.equal(lowestAllowedQuantity(repeat), 30);
  assert.equal(selectionIsAllowed(repeat, 30), true);
  assert.equal(selectionIsAllowed(repeat, 60), true);
  assert.equal(selectionIsAllowed(repeat, 29), false);
  assert.equal(selectionIsAllowed(repeat, 91), false);
});

test("nothing may exceed what the prescriber authorised",()=>{
  assert.equal(selectionIsAllowed(antibiotic, 22), false);
  assert.equal(selectionIsAllowed(repeat, 120), false);
});

test("an omitted line keeps its full authorised quantity",()=>{
  // A partial payload must never be read as a request to reduce a course.
  const resolved = resolveDispenseSelection([antibiotic, repeat], [{ id: repeat.id, quantity: 30 }]);
  assert.deepEqual(resolved.find((line) => line.id === antibiotic.id), { id: 1, quantity: 21, deferred: false });
});

test("a part course is refused with a reason the patient can act on",()=>{
  assert.throws(
    () => resolveDispenseSelection([antibiotic], [{ id: antibiotic.id, quantity: 7 }]),
    (error: unknown) => error instanceof DispensingError && /full course/i.test(error.message),
  );
});

test("deferring everything is not a payment",()=>{
  assert.throws(
    () => resolveDispenseSelection([antibiotic, repeat], [{ id: 1, quantity: 0 }, { id: 2, quantity: 0 }]),
    (error: unknown) => error instanceof DispensingError && /at least one/i.test(error.message),
  );
});

test("a mixed basket reports what was left for later",()=>{
  const resolved = resolveDispenseSelection([antibiotic, repeat], [{ id: 2, quantity: 0 }]);
  assert.deepEqual(dispenseSelectionSummary(resolved), { buyingNow: 1, deferred: 1, partial: true });
  const whole = resolveDispenseSelection([antibiotic, repeat], []);
  assert.deepEqual(dispenseSelectionSummary(whole), { buyingNow: 2, deferred: 0, partial: false });
});

test("a divisible line with no floor still cannot go to a bare fraction below one",()=>{
  const open = { id: 3, approvedQuantity: 10, dispenseRule: "DIVISIBLE" as const, minimumQuantity: null };
  assert.equal(lowestAllowedQuantity(open), 1);
  assert.equal(selectionIsAllowed(open, 1), true);
  assert.equal(selectionIsAllowed(open, -1), false);
  assert.equal(selectionIsAllowed(open, 1.5), false);
});
