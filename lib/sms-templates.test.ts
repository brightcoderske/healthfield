import assert from "node:assert/strict";
import test from "node:test";
import {
  gsm7Length,
  isTransactional,
  marketingSms,
  orderSms,
  otpSms,
  smsRecipient,
  smsRecipients,
  smsSegments,
  toGsm7,
} from "./sms-templates.ts";

test("phone numbers are normalised to the 254 form the gateway expects", () => {
  assert.equal(smsRecipient("0712345678"), "254712345678");
  assert.equal(smsRecipient("0112345678"), "254112345678");
  assert.equal(smsRecipient("254712345678"), "254712345678");
  assert.equal(smsRecipient("+254 712 345 678"), "254712345678");
  assert.equal(smsRecipient("712345678"), "254712345678");
});

test("an unusable number is dropped rather than thrown", () => {
  // One bad number in a campaign must not abandon the whole send.
  assert.equal(smsRecipient("12345"), null);
  assert.equal(smsRecipient(""), null);
  assert.equal(smsRecipient(null), null);
  assert.equal(smsRecipient("0812345678"), null);
  assert.deepEqual(
    smsRecipients(["0712345678", "rubbish", null, "+254712345678", "0733111222"]),
    ["254712345678", "254733111222"],
    "duplicates collapse and invalid entries disappear",
  );
});

test("smart punctuation is folded down to GSM-7", () => {
  // A curly apostrophe pasted from a document would otherwise force the whole message
  // into UCS-2 and cut the segment allowance from 160 characters to 70.
  assert.equal(toGsm7("Healthfield’s order — ready…"), "Healthfield's order - ready...");
  assert.equal(toGsm7("Ksh 1,500 – paid"), "Ksh 1,500 - paid");
});

test("characters with no GSM-7 equivalent are dropped, not passed through", () => {
  assert.equal(toGsm7("Order ready \u{1F389}\u{1F48A}"), "Order ready");
  assert.equal(toGsm7("عربي Order"), "Order");
});

test("segment counting follows the concatenation rules", () => {
  assert.equal(smsSegments(""), 0);
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("a".repeat(306)), 2);
  assert.equal(smsSegments("a".repeat(307)), 3);
  // Extended characters are billed as two.
  assert.equal(gsm7Length("["), 2);
  assert.equal(smsSegments("[".repeat(80)), 1);
  assert.equal(smsSegments("[".repeat(81)), 2);
});

const order = { orderNumber: "HF-WEB-1042", customerName: "Grace Wanjiru", total: 2400, pharmacyName: "Healthfield", pharmacyPhone: "0757148900" };

test("every transactional message names the pharmacy and the order", () => {
  for (const purpose of ["ORDER_RECEIVED", "ORDER_READY_FOR_PICKUP", "ORDER_OUT_FOR_DELIVERY", "PAYMENT_CONFIRMED"] as const) {
    const message = orderSms(purpose, order);
    assert.ok(message.includes("HF-WEB-1042"), `${purpose} omits the order number`);
    assert.ok(/Healthfield/.test(message), `${purpose} omits the pharmacy name`);
    assert.equal(smsSegments(message), 1, `${purpose} costs more than one segment: ${message}`);
    assert.equal(message, toGsm7(message), `${purpose} contains non-GSM-7 characters`);
  }
});

test("the order-received message points at the tracking page", () => {
  const message = orderSms("ORDER_RECEIVED", order);
  assert.match(message, /received your order HF-WEB-1042/);
  assert.match(message, /healthfieldpharmacy\.co\.ke\/orders/);
  assert.equal(smsSegments(message), 1);
});

test("the counter sale message confirms payment and asks nothing further", () => {
  const message = orderSms("POS_SALE_COMPLETE", { orderNumber: "POS-1042", customerName: "Grace Wanjiru", pharmacyPhone: "0757148900" });
  assert.match(message, /received your payment/);
  assert.match(message, /been processed/);
  // The shop's number replaced the website here: a counter customer with a query wants
  // to call, and the message has no room for both inside one segment.
  assert.match(message, /Help: 0757148900/);
  assert.equal(smsSegments(message), 1, `too long: ${gsm7Length(message)} chars`);
  // Nothing is pending, so it must not promise a further update.
  assert.ok(!/we will let you know|ready for/i.test(message));
});

test("pickup and delivery messages differ by the fulfilment the customer chose", () => {
  const pickup = orderSms("ORDER_READY_FOR_PICKUP", { ...order, branchName: "Juja" });
  const delivery = orderSms("ORDER_OUT_FOR_DELIVERY", order);
  assert.match(pickup, /ready for pickup/i);
  assert.ok(!/on its way/i.test(pickup));
  assert.match(delivery, /on its way/i);
  assert.ok(!/pickup/i.test(delivery));
});

test("the cash-on-delivery message states what the rider will collect", () => {
  const message = orderSms("CASH_ON_DELIVERY_DUE", { ...order, amountDue: 2400 });
  assert.match(message, /KES 2,400/);
  assert.match(message, /cash on delivery/i);
  assert.equal(smsSegments(message), 1);
});

test("a real first name is used, and a placeholder never is", () => {
  assert.match(orderSms("ORDER_RECEIVED", order), /^Hi Grace, /);
  // A counter sale with nobody named is recorded as "Walk-in customer". Greeting
  // someone as "Hi Walk-in" reads as careless, so it falls back to a neutral opening.
  for (const placeholder of ["Walk-in customer", "walk-in", "Walk in customer", "Customer", "Guest", "N/A", null, "", "G"]) {
    const message = orderSms("ORDER_RECEIVED", { ...order, customerName: placeholder });
    assert.match(message, /^Hi customer, /, `bad greeting for ${JSON.stringify(placeholder)}: ${message}`);
    assert.ok(!/Hi Walk/i.test(message), "a placeholder leaked into the greeting");
  }
});

test("every message carries the shop phone and still fits one segment", () => {
  for (const purpose of ["ORDER_RECEIVED", "POS_SALE_COMPLETE", "ORDER_READY_FOR_PICKUP", "ORDER_OUT_FOR_DELIVERY", "PAYMENT_CONFIRMED", "CASH_ON_DELIVERY_DUE"] as const) {
    const message = orderSms(purpose, { ...order, amountDue: 2400, customerName: "Walk-in customer" });
    assert.match(message, /Help: 0757148900$/, `${purpose} omits the shop phone`);
    assert.equal(smsSegments(message), 1, `${purpose} spills to a second segment: ${gsm7Length(message)} chars`);
  }
});

test("no shop phone means no dangling label", () => {
  const message = orderSms("ORDER_RECEIVED", { ...order, pharmacyPhone: null });
  assert.ok(!/Help:/.test(message), `left an empty helpline: ${message}`);
});

test("the pickup message points at the branch holding the order", () => {
  const message = orderSms("ORDER_READY_FOR_PICKUP", { ...order, branchName: "Juja" });
  assert.match(message, /Juja/);
  assert.match(message, /ready for pickup/i);
});

test("the OTP message warns against sharing the code", () => {
  const message = otpSms("482913", 10);
  assert.match(message, /^482913 is your Healthfield verification code/);
  assert.match(message, /expires in 10 minutes/);
  assert.match(message, /never ask you for this code/i);
  assert.equal(smsSegments(message), 1);
});

test("marketing always carries an opt-out, and never twice", () => {
  const once = marketingSms("Save 20% on vitamins this week at Healthfield.");
  assert.match(once, /Txt STOP to opt out$/);
  // A campaign that already wrote its own opt-out does not get a second one bolted on.
  const already = marketingSms("Flash sale today. Reply STOP to unsubscribe.");
  assert.equal(already.match(/STOP/gi)?.length, 1);
  assert.equal(marketingSms(""), "");
});

test("marketing and transactional messages stay distinguishable", () => {
  assert.equal(isTransactional("MARKETING"), false);
  assert.equal(isTransactional("OTP"), true);
  assert.equal(isTransactional("ORDER_RECEIVED"), true);
});
