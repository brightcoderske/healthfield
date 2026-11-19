import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STAFF_PERMISSIONS, firstStaffPath, hasAnyStaffPermission, hasStaffPermission, normalizeStaffPermissions, STAFF_PERMISSION_GROUPS, STAFF_PERMISSION_PATHS, STAFF_PERMISSION_VALUES } from "./staff-permissions.ts";

test("administrators bypass staff permission rows",()=>{
  assert.equal(hasStaffPermission("ADMIN",[],"BLOGS_MANAGE"),true);
  assert.equal(hasStaffPermission("SUPER_ADMIN",[],"OFFERS_MANAGE"),true);
});

test("staff receive only explicitly granted permissions",()=>{
  assert.equal(hasStaffPermission("STAFF",["ORDERS_VIEW"],"ORDERS_VIEW"),true);
  assert.equal(hasStaffPermission("STAFF",["ORDERS_VIEW"],"ORDERS_PROCESS"),false);
});

test("normalization removes duplicates and unknown values",()=>{
  assert.deepEqual(normalizeStaffPermissions(["BLOGS_MANAGE","INVALID","BLOGS_MANAGE","POS_USE"]),["BLOGS_MANAGE","POS_USE"]);
  assert.equal(STAFF_PERMISSION_VALUES.includes("OFFERS_MANAGE"),true);
});

test("staff landing uses the first available visible tab",()=>{
  assert.equal(firstStaffPath("STAFF",["PRODUCTS_VIEW"]),"/staff/products");
  assert.equal(firstStaffPath("STAFF",["BLOGS_MANAGE"]),"/staff/blogs");
  assert.equal(firstStaffPath("STAFF",[]),"/unauthorized");
});

test("prescribing rights are never granted by default",()=>{
  // Dispensing access is handed to new staff automatically; issuing a prescription
  // must be granted deliberately, so it stays out of the default set.
  assert.equal(DEFAULT_STAFF_PERMISSIONS.includes("CONSULTATIONS_PROCESS"),false);
  assert.equal(DEFAULT_STAFF_PERMISSIONS.includes("CONSULTATIONS_VIEW"),false);
  assert.equal(DEFAULT_STAFF_PERMISSIONS.includes("PRESCRIPTIONS_PROCESS"),true);
  assert.equal(hasStaffPermission("STAFF",[...DEFAULT_STAFF_PERMISSIONS],"CONSULTATIONS_PROCESS"),false);
  assert.equal(STAFF_PERMISSION_VALUES.includes("CONSULTATIONS_PROCESS"),true);
});

test("new staff receive an assignable POS role and land on the POS when it is their first permission",()=>{
  assert.equal(STAFF_PERMISSION_VALUES.includes("POS_USE"),true);
  assert.equal(DEFAULT_STAFF_PERMISSIONS.includes("POS_USE"),true);
  assert.equal(firstStaffPath("STAFF",["POS_USE"]),"/staff/sales");
});

test("products, SMS reports and campaigns can be granted, and are never granted by default", () => {
  // Each changes what customers pay or what they receive, and campaigns spend SMS credit, so an owner
  // ticks them per account. Existing and new staff gain nothing until then.
  for (const permission of ["PRODUCTS_MANAGE", "SMS_VIEW", "CAMPAIGNS_MANAGE"] as const) {
    assert.equal(STAFF_PERMISSION_VALUES.includes(permission), true, permission);
    assert.equal(DEFAULT_STAFF_PERMISSIONS.includes(permission), false, permission);
    assert.equal(hasStaffPermission("STAFF", [...DEFAULT_STAFF_PERMISSIONS], permission), false, permission);
    assert.equal(hasStaffPermission("STAFF", [permission], permission), true, permission);
    assert.deepEqual(normalizeStaffPermissions([permission]), [permission], "the grant handler accepts it");
  }
  assert.equal(DEFAULT_STAFF_PERMISSIONS.includes("BLOGS_MANAGE"), true, "blogs keep their existing default");
});

test("every permission appears exactly once on the staff form", () => {
  const listed = STAFF_PERMISSION_GROUPS.flatMap((group) => group.permissions.map((entry) => entry.value));
  assert.deepEqual([...listed].sort(), [...STAFF_PERMISSION_VALUES].sort());
  assert.equal(new Set(listed).size, listed.length);
  for (const group of STAFF_PERMISSION_GROUPS) for (const entry of group.permissions) {
    assert.ok(entry.label.trim() && entry.description.trim(), `${entry.value} needs a label and a description`);
  }
});

test("a tab shown for any one of several permissions", () => {
  assert.equal(hasAnyStaffPermission("STAFF", ["PRODUCTS_MANAGE"], ["PRODUCTS_VIEW", "PRODUCTS_MANAGE"]), true);
  assert.equal(hasAnyStaffPermission("STAFF", ["PRODUCTS_VIEW"], ["PRODUCTS_VIEW", "PRODUCTS_MANAGE"]), true);
  assert.equal(hasAnyStaffPermission("STAFF", ["POS_USE"], ["PRODUCTS_VIEW", "PRODUCTS_MANAGE"]), false);
  assert.equal(hasAnyStaffPermission("STAFF", ["SMS_VIEW"], "SMS_VIEW"), true, "a single permission works too");
  assert.equal(hasAnyStaffPermission("STAFF", [], []), false, "an empty list allows nothing");
  assert.equal(hasAnyStaffPermission("ADMIN", [], ["CAMPAIGNS_MANAGE"]), true, "administrators pass");
});

test("staff land on the new pages when those are all they have", () => {
  assert.equal(firstStaffPath("STAFF", ["PRODUCTS_MANAGE"]), "/staff/products");
  assert.equal(firstStaffPath("STAFF", ["SMS_VIEW"]), "/staff/sms");
  assert.equal(firstStaffPath("STAFF", ["CAMPAIGNS_MANAGE"]), "/staff/campaigns");
  for (const entry of STAFF_PERMISSION_PATHS) assert.ok(entry.href.startsWith("/staff"), entry.href);
});
