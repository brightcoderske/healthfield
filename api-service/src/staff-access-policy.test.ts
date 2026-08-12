import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canGrantTeamRole, canManageTeamAccount } from "./staff-access-policy.ts";

describe("staff account privilege boundaries", () => {
  it("lets administrators manage staff without granting administrator access", () => {
    assert.equal(canGrantTeamRole("ADMIN", "STAFF"), true);
    assert.equal(canGrantTeamRole("ADMIN", "ADMIN"), false);
    assert.equal(canManageTeamAccount("ADMIN", "STAFF"), true);
    assert.equal(canManageTeamAccount("ADMIN", "ADMIN"), false);
    assert.equal(canManageTeamAccount("ADMIN", "SUPER_ADMIN"), false);
  });

  it("lets the owner manage administrators but never through the owner account", () => {
    assert.equal(canGrantTeamRole("SUPER_ADMIN", "ADMIN"), true);
    assert.equal(canManageTeamAccount("SUPER_ADMIN", "ADMIN"), true);
    assert.equal(canManageTeamAccount("SUPER_ADMIN", "SUPER_ADMIN"), false);
  });

  it("fails closed for customer actors and targets", () => {
    assert.equal(canGrantTeamRole("CUSTOMER", "ADMIN"), false);
    assert.equal(canManageTeamAccount("CUSTOMER", "STAFF"), false);
    assert.equal(canManageTeamAccount("SUPER_ADMIN", "CUSTOMER"), false);
  });
});
