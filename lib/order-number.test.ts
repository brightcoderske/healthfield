import assert from "node:assert/strict";
import test from "node:test";
import { healthfieldOrderNumber } from "./order-number.ts";

test("new order numbers use Healthfield, branch code and database sequence", () => {
  assert.equal(healthfieldOrderNumber("JJC", 1234), "HF-JJC-1234");
  assert.equal(healthfieldOrderNumber("Nairobi CBD", 7), "HF-NAIROBIC-0007");
  assert.equal(healthfieldOrderNumber("", 25), "HF-WEB-0025");
});
