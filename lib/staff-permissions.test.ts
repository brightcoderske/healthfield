import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STAFF_PERMISSIONS, firstStaffPath, hasStaffPermission, normalizeStaffPermissions, STAFF_PERMISSION_VALUES } from "./staff-permissions.ts";

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
