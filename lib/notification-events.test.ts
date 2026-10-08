import assert from "node:assert/strict";
import test from "node:test";
import {
  channelEnabled,
  customerNotificationEvents,
  orderStatusEvent,
  parseNotificationPreferences,
  resolveNotificationPreferences,
} from "./notification-events.ts";

test("an event nobody has configured uses its default for each channel", () => {
  assert.equal(channelEnabled({}, "ORDER_PLACED", "email"), true);
  assert.equal(channelEnabled({}, "ORDER_PLACED", "sms"), true);
  assert.equal(channelEnabled(null, "ORDER_CONFIRMED", "sms"), false);
  assert.equal(channelEnabled(undefined, "ORDER_CANCELLED", "sms"), true);
});

test("a saved choice wins over the default, one channel at a time", () => {
  const preferences = { ORDER_CANCELLED: { sms: false }, ORDER_CONFIRMED: { sms: true } };
  assert.equal(channelEnabled(preferences, "ORDER_CANCELLED", "sms"), false);
  // The channel the admin did not touch keeps its default.
  assert.equal(channelEnabled(preferences, "ORDER_CANCELLED", "email"), true);
  assert.equal(channelEnabled(preferences, "ORDER_CONFIRMED", "sms"), true);
});

test("prescription and consultation confirmations go out by email and SMS by default", () => {
  for (const id of ["PRESCRIPTION_RECEIVED", "CONSULTATION_RECEIVED"] as const) {
    assert.equal(channelEnabled({}, id, "email"), true, `${id} email`);
    assert.equal(channelEnabled({}, id, "sms"), true, `${id} sms`);
  }
});

test("parsing keeps only known events and real booleans", () => {
  assert.deepEqual(
    parseNotificationPreferences({ ORDER_PLACED: { email: false, sms: "yes" }, NOT_AN_EVENT: { sms: true }, ORDER_CANCELLED: "nope" }),
    { ORDER_PLACED: { email: false } },
  );
  assert.deepEqual(parseNotificationPreferences('{"ORDER_PLACED":{"sms":false}}'), { ORDER_PLACED: { sms: false } });
  for (const bad of [null, undefined, "not json", [], 7]) assert.deepEqual(parseNotificationPreferences(bad), {});
});

test("every event has a unique id and is listed with both channels resolved", () => {
  const ids = customerNotificationEvents.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length);
  const resolved = resolveNotificationPreferences({ ORDER_PLACED: { email: false } });
  assert.equal(resolved.length, ids.length);
  assert.equal(resolved.find((event) => event.id === "ORDER_PLACED")?.email, false);
});

test("every order status customers can be told about has a switch, and cancelling is one of them", () => {
  for (const status of ["AWAITING_PAYMENT", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"]) {
    assert.ok(orderStatusEvent(status), `${status} has no switch`);
  }
  assert.equal(orderStatusEvent("CANCELLED"), "ORDER_CANCELLED");
  assert.equal(orderStatusEvent("NEW"), null);
  assert.equal(orderStatusEvent("SOMETHING_ELSE"), null);
});
